// Party House — pagos del abono con Mercado Pago (Checkout Pro)
//
// Rutas (todas bajo /functions/v1/pagos):
//   POST /crear           → valida carrito, recalcula precios y flete en el servidor, crea la reserva y el cobro
//   POST /webhook         → notificación de Mercado Pago; consulta el pago a la API y actualiza la reserva
//   GET  /estado?codigo=  → estado de una reserva (sin datos personales) para la página pago.html
//   GET  /disponibilidad  → fechas ya pagadas de productos con bloqueo automático
//   POST /contacto        → formulario de contacto del sitio: envía el mensaje por correo al dueño
//   POST /recordatorios   → (tarea diaria pg_cron, header x-cron-key) pide la garantía desde 7 días antes del evento
//   GET  /datos.js        → catálogo, disponibilidad, flete y ajustes para el sitio (window.PH_*), desde la base
//   POST /confirmar       → (panel, sesión de administrador) envía la confirmación por correo de una reserva
//   GET  /modo            → 'produccion' | 'prueba' | 'desactivado' (el checkout muestra el botón solo en producción)
//
// Secretos (Supabase → Edge Functions → Secrets):
//   MP_ACCESS_TOKEN    (obligatorio) Access Token de Mercado Pago (TEST-... o APP_USR-...)
//   MP_WEBHOOK_SECRET  (opcional)    "Clave secreta" de Webhooks de Mercado Pago para validar la firma
//   SITE_URL           (opcional)    por defecto https://partyhouse.cl
//   RESEND_API_KEY     (opcional)    para el aviso por correo de cada abono pagado (destino: tabla config, clave email_avisos)
//   EMAIL_FROM         (opcional)    remitente; por defecto "Party House <reservas@partyhouse.cl>"
// Correos: aviso al dueño + confirmación al cliente (plantillas en correos.ts)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  correoCliente, correoContacto, correoDueno, correoGarantia, correoGarantiaDevuelta, correoGarantiaDueno,
  correoGarantiaRecibida, enviarCorreo, REMITENTE,
} from './correos.ts';

const SITE = (Deno.env.get('SITE_URL') || 'https://partyhouse.cl').replace(/\/$/, '');
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ||
  'https://partyhouse.cl,https://www.partyhouse.cl,https://dtorresag88.github.io,http://127.0.0.1:8765,http://localhost:8765')
  .split(',').map((s) => s.trim());
const MP_API = 'https://api.mercadopago.com';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// ---------- utilidades ----------
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Vary': 'Origin',
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
const todayCL = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
const isISODate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
function codigoNuevo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(8));
  return 'PH-' + Array.from(r, (b) => abc[b % abc.length]).join('');
}

// ---------- catálogo, disponibilidad, flete y ajustes (tablas editables desde el panel) ----------
type Producto = { id: string; name: string; price: number };
type Dispo = {
  diasAnticipacion: number; mesesMaximo: number; cerrado: string[];
  ocupado: Record<string, string[]>; comparten: string[][]; bloqueoAutomatico: string[];
};
type Transporte = { comunas: Array<{ nombre: string; valor: number }>; sinFlete: string[] };
// deno-lint-ignore no-explicit-any
type Ajustes = Record<string, any>;
// deno-lint-ignore no-explicit-any
let cache: { t: number; productos: Map<string, Producto>; dispo: Dispo; transporte: Transporte; ajustes: Ajustes; filas: any } | null = null;

async function cargarSitio() {
  if (cache && Date.now() - cache.t < 30_000) return cache;
  const [prods, cats, coms, bloq, aj] = await Promise.all([
    db.from('productos').select('*').order('orden'),
    db.from('categorias').select('*').order('orden'),
    db.from('comunas').select('*').eq('activa', true).order('orden'),
    db.from('bloqueos').select('fecha, producto_id').gte('fecha', todayCL()),
    db.from('ajustes').select('*').eq('id', 1).single(),
  ]);
  for (const r of [prods, cats, coms, bloq, aj]) if (r.error) throw r.error;
  const catActiva = new Set((cats.data || []).filter((c) => c.activa).map((c) => c.id));
  const activos = (prods.data || []).filter((p) => p.activo && catActiva.has(p.categoria));
  const productos = new Map<string, Producto>(activos.map((p) => [p.id, { id: p.id, name: p.nombre, price: p.precio }]));
  const grupos: Record<string, string[]> = {};
  for (const p of prods.data || []) if (p.equipo) (grupos[p.equipo] ||= []).push(p.id);
  const ocupado: Record<string, string[]> = {};
  const cerrado: string[] = [];
  for (const x of bloq.data || []) {
    const f = String(x.fecha);
    if (!x.producto_id) cerrado.push(f); else (ocupado[x.producto_id] ||= []).push(f);
  }
  const dispo: Dispo = {
    diasAnticipacion: aj.data.dias_anticipacion, mesesMaximo: aj.data.meses_maximo, cerrado, ocupado,
    comparten: Object.values(grupos).filter((g) => g.length > 1),
    bloqueoAutomatico: (prods.data || []).filter((p) => p.bloqueo_automatico).map((p) => p.id),
  };
  const transporte: Transporte = {
    comunas: (coms.data || []).map((c) => ({ nombre: c.nombre, valor: c.valor })),
    sinFlete: (prods.data || []).filter((p) => p.sin_flete).map((p) => p.id),
  };
  if (!transporte.comunas.length) throw new Error('sin comunas con tarifa');
  cache = { t: Date.now(), productos, dispo, transporte, ajustes: aj.data, filas: { activos, cats: (cats.data || []).filter((c) => c.activa) } };
  return cache;
}

// Archivo JS para el sitio: mismo formato que tenían assets/data.js, disponibilidad.js y transporte.js
async function datosJs(_req: Request) {
  const { dispo, transporte, ajustes, filas } = await cargarSitio();
  const pagadas = await fechasPagadas(dispo);
  const ocupado: Record<string, string[]> = JSON.parse(JSON.stringify(dispo.ocupado));
  for (const [id, fs] of Object.entries(pagadas)) for (const f of fs) (ocupado[id] ||= []).includes(f) || ocupado[id].push(f);
  const catNombre = Object.fromEntries(filas.cats.map((c: { id: string; nombre: string }) => [c.id, c.nombre]));
  // deno-lint-ignore no-explicit-any
  const PH_PRODUCTS = filas.activos.map((p: any) => ({
    id: p.id, name: p.nombre, category: p.categoria, categoryName: p.etiqueta || catNombre[p.categoria] || '', size: p.tamano, capacity: p.capacidad,
    price: p.precio, ...(p.precio_antes ? { priceWas: p.precio_antes } : {}), tint: p.tint, badges: p.badges, images: p.imagenes,
    img: p.imagenes[0] || null, short: p.corto, long: p.largo, includes: p.incluye,
  }));
  const PH_CATEGORIES = [{ id: 'all', name: 'Todo', icon: '✦' },
    ...filas.cats.map((c: { id: string; nombre: string; icono: string }) => ({ id: c.id, name: c.nombre, icon: c.icono }))];
  const js = `// Party House · datos del sitio (generado desde el panel)\n` +
    `window.PH_PRODUCTS=${JSON.stringify(PH_PRODUCTS)};\nwindow.PH_CATEGORIES=${JSON.stringify(PH_CATEGORIES)};\n` +
    `window.PH_DISPONIBILIDAD=${JSON.stringify({ ...dispo, ocupado })};\nwindow.PH_TRANSPORTE=${JSON.stringify(transporte)};\n` +
    `window.PH_AJUSTES=${JSON.stringify({ garantia_monto: ajustes.garantia_monto, abono_pct: ajustes.abono_pct, recordatorio_dias: ajustes.recordatorio_dias })};\n`;
  return new Response(js, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } });
}

async function fechasPagadas(dispo: Dispo): Promise<Record<string, string[]>> {
  const { data, error } = await db.from('reservas')
    .select('items').eq('estado', 'pagado').overlaps('fechas', fechasProximas());
  if (error) throw error;
  const auto = new Set(dispo.bloqueoAutomatico || []);
  const out: Record<string, string[]> = {};
  const hoy = todayCL();
  for (const r of data || []) {
    for (const it of (r.items as Array<{ id: string; fecha: string }>)) {
      if (!auto.has(it.id) || !it.fecha || it.fecha < hoy) continue;
      (out[it.id] ||= []).includes(it.fecha) || out[it.id].push(it.fecha);
    }
  }
  return out;
}
// Lista de fechas desde hoy hasta 13 meses (para filtrar con el índice GIN)
function fechasProximas() {
  const out: string[] = []; const hoy = todayCL();
  for (let i = 0; i < 400; i++) out.push(addDays(hoy, i));
  return out;
}

function motivoNoDisponible(id: string, fecha: string, dispo: Dispo, pagadas: Record<string, string[]>) {
  const hoy = todayCL();
  if (fecha < addDays(hoy, dispo.diasAnticipacion ?? 3)) return `reservamos con al menos ${dispo.diasAnticipacion ?? 3} días de anticipación`;
  if (fecha > addMonths(hoy, dispo.mesesMaximo || 4)) return 'esa fecha aún no está abierta para reservas';
  if ((dispo.cerrado || []).includes(fecha)) return 'ese día no tenemos atención';
  const grupo = (dispo.comparten || []).find((g) => g.includes(id)) || [id];
  for (const g of grupo) {
    if ((dispo.ocupado?.[g] || []).includes(fecha) || (pagadas[g] || []).includes(fecha)) return 'ya está reservado para esa fecha';
  }
  return null;
}

// ---------- Mercado Pago ----------
function mpToken() {
  const t = Deno.env.get('MP_ACCESS_TOKEN');
  if (!t) throw Object.assign(new Error('pagos_no_configurados'), { status: 503 });
  return t;
}
async function mp(path: string, init: RequestInit = {}) {
  const r = await fetch(MP_API + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + mpToken(), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('mercadopago ' + r.status + ': ' + JSON.stringify(body).slice(0, 300)), { status: 502 });
  return body;
}

// Aplica un pago de Mercado Pago a su reserva. Solo confía en lo que devuelve la API de MP.
async function aplicarPago(paymentId: string) {
  const p = await mp('/v1/payments/' + encodeURIComponent(paymentId));
  const ref = String(p.external_reference || '');
  if (ref.endsWith('-G')) return aplicarGarantia(p, ref.slice(0, -2));
  const codigo = ref;
  if (!codigo) return null;
  const { data: res } = await db.from('reservas').select('*').eq('codigo', codigo).maybeSingle();
  if (!res) return null;

  let estado = res.estado as string;
  const montoOk = p.currency_id === 'CLP' && Number(p.transaction_amount) >= res.abono;
  if (p.status === 'approved' && montoOk) estado = 'pagado';
  else if (['refunded', 'charged_back'].includes(p.status)) estado = 'reembolsado';
  else if (['rejected', 'cancelled'].includes(p.status) && res.estado !== 'pagado') estado = 'rechazado';
  else if (p.status === 'approved' && !montoOk) console.error('Monto no coincide', codigo, p.transaction_amount, res.abono);

  const upd: Record<string, unknown> = {
    estado, mp_payment_id: String(p.id), mp_status: p.status, mp_status_detail: p.status_detail,
    monto_pagado: Math.round(Number(p.transaction_amount) || 0), actualizada: new Date().toISOString(),
  };
  if (estado === 'pagado' && !res.pagada_en) upd.pagada_en = p.date_approved || new Date().toISOString();
  await db.from('reservas').update(upd).eq('id', res.id);
  const actual = { ...res, ...upd };

  // Correos: cada uno se envía una sola vez (webhook y página pueden llegar a la vez); si falla, se reintenta
  // en la próxima notificación de Mercado Pago.
  if (estado === 'pagado') {
    await enviarUnaVez(res, 'aviso_enviado_en', () => avisarPago(actual));
    await enviarUnaVez(res, 'confirmacion_cliente_en', () => confirmarCliente(actual));
  }
  return actual;
}

// ---------- correos (plantillas en correos.ts) ----------
// deno-lint-ignore no-explicit-any
async function enviarUnaVez(res: any, columna: 'aviso_enviado_en' | 'confirmacion_cliente_en', enviar: () => Promise<unknown>) {
  if (res[columna]) return;
  const { data: marcada } = await db.from('reservas').update({ [columna]: new Date().toISOString() })
    .eq('id', res.id).is(columna, null).select('id');
  if (!marcada?.length) return;
  try { await enviar(); }
  catch (e) {
    console.error('No se pudo enviar correo (' + columna + ')', e);
    await db.from('reservas').update({ [columna]: null }).eq('id', res.id);
  }
}
const resendKey = () => {
  const k = Deno.env.get('RESEND_API_KEY');
  if (!k) throw new Error('RESEND_API_KEY no configurada');
  return k;
};
const esPrueba = () => String(Deno.env.get('MP_ACCESS_TOKEN') || '').startsWith('TEST-');

// Correo del dueño: tabla config (clave email_avisos). Recibe avisos, mensajes y las respuestas de los clientes.
async function emailDueno() {
  const { data: cfg } = await db.from('config').select('valor').eq('clave', 'email_avisos').maybeSingle();
  if (!cfg?.valor) throw new Error('config.email_avisos vacío');
  return cfg.valor as string;
}

// deno-lint-ignore no-explicit-any
async function avisarPago(r: any) {
  await enviarCorreo(resendKey(), 'aviso-' + r.codigo, {
    from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [await emailDueno()], reply_to: r.cliente_email, ...correoDueno(r, esPrueba()),
  });
}

// deno-lint-ignore no-explicit-any
async function confirmarCliente(r: any) {
  await enviarCorreo(resendKey(), 'cliente-' + r.codigo, {
    from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [r.cliente_email], reply_to: await emailDueno(), ...correoCliente(r, esPrueba()),
  });
}

// ---------- garantía reembolsable ----------
// Pago de garantía (referencia "<codigo>-G"). Solo confía en lo que devuelve la API de MP.
// deno-lint-ignore no-explicit-any
async function aplicarGarantia(p: any, codigo: string) {
  const { data: res } = await db.from('reservas').select('*').eq('codigo', codigo).maybeSingle();
  if (!res) return null;
  const ahora = new Date().toISOString();
  if (p.status === 'approved' && p.currency_id === 'CLP' && Number(p.transaction_amount) >= res.garantia_monto) {
    // Solo la primera vez que pasa a "pagada" se envían los correos
    const { data: cambio } = await db.from('reservas').update({
      garantia_estado: 'pagada', garantia_payment_id: String(p.id), garantia_pagada_en: p.date_approved || ahora, actualizada: ahora,
    }).eq('id', res.id).eq('garantia_estado', 'pendiente').select('*');
    if (cambio?.length) {
      const r = cambio[0];
      await Promise.allSettled([
        enviarCorreo(resendKey(), 'garantia-ok-' + codigo, {
          from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [r.cliente_email], reply_to: await emailDueno(), ...correoGarantiaRecibida(r, esPrueba()),
        }),
        enviarCorreo(resendKey(), 'garantia-dueno-' + codigo, {
          from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [await emailDueno()], reply_to: r.cliente_email, ...correoGarantiaDueno(r, esPrueba()),
        }),
      ]).then((rs) => rs.forEach((x) => x.status === 'rejected' && console.error('correo garantía', x.reason)));
      return r;
    }
  } else if (['refunded', 'charged_back'].includes(p.status)) {
    const { data: cambio } = await db.from('reservas').update({ garantia_estado: 'devuelta', actualizada: ahora })
      .eq('id', res.id).eq('garantia_estado', 'pagada').select('*');
    if (cambio?.length) {
      try {
        await enviarCorreo(resendKey(), 'garantia-devuelta-' + codigo, {
          from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [cambio[0].cliente_email], reply_to: await emailDueno(), ...correoGarantiaDevuelta(cambio[0], esPrueba()),
        });
      } catch (e) { console.error('correo garantía devuelta', e); }
      return cambio[0];
    }
  }
  const { data: actual } = await db.from('reservas').select('*').eq('id', res.id).single();
  return actual;
}

// Link de pago de la garantía (se crea una vez y se reutiliza en cada recordatorio)
// deno-lint-ignore no-explicit-any
async function linkGarantia(r: any) {
  if (r.garantia_link) return r.garantia_link as string;
  const pref = await mp('/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': r.codigo + '-G' },
    body: JSON.stringify({
      items: [{
        id: r.codigo + '-G',
        title: `Garantía reembolsable reserva ${r.codigo} · Party House`,
        description: `Garantía reembolsable para el evento del ${r.fechas[0]} en ${r.comuna}. Se devuelve tras el retiro si todo está en orden.`,
        category_id: 'services', quantity: 1, unit_price: r.garantia_monto, currency_id: 'CLP',
      }],
      payer: { name: r.cliente_nombre, email: r.cliente_email },
      external_reference: r.codigo + '-G',
      back_urls: { success: `${SITE}/pago.html`, pending: `${SITE}/pago.html`, failure: `${SITE}/pago.html` },
      auto_return: 'approved',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/pagos/webhook`,
      statement_descriptor: 'PARTYHOUSE',
      metadata: { codigo: r.codigo, tipo: 'garantia' },
    }),
  });
  await db.from('reservas').update({ garantia_link: pref.init_point }).eq('id', r.id);
  return pref.init_point as string;
}

// Tarea diaria: desde 7 días antes del evento, un correo por día hasta que la garantía quede pagada.
// Body opcional (pruebas): { codigo, forzar: true } envía solo a esa reserva aunque esté fuera de la ventana.
async function recordatorios(req: Request) {
  const { data: k } = await db.from('config').select('valor').eq('clave', 'cron_key').maybeSingle();
  if (!k?.valor || req.headers.get('x-cron-key') !== k.valor) return json(req, { error: 'no_autorizado' }, 401);
  const b = await req.json().catch(() => ({}));
  const hoy = todayCL();
  const { ajustes } = await cargarSitio();
  let q = db.from('reservas').select('*').eq('estado', 'pagado').eq('garantia_estado', 'pendiente').gt('garantia_monto', 0)
    .not('cliente_email', 'is', null);
  if (b?.codigo) q = q.eq('codigo', String(b.codigo));
  const { data: lista, error } = await q;
  if (error) throw error;
  const resultado: Array<Record<string, unknown>> = [];
  for (const r of lista || []) {
    const fecha = (r.fechas as string[])[0];
    const dias = Math.round((Date.parse(fecha + 'T00:00:00Z') - Date.parse(hoy + 'T00:00:00Z')) / 86_400_000);
    const enVentana = dias >= 1 && dias <= (ajustes.recordatorio_dias || 7);
    if ((!enVentana && !b?.forzar) || r.garantia_ultimo_aviso === hoy) { resultado.push({ codigo: r.codigo, dias, enviado: false }); continue; }
    try {
      const link = await linkGarantia(r);
      const n = (r.garantia_avisos || 0) + 1;
      await enviarCorreo(resendKey(), `garantia-${r.codigo}-${hoy}`, {
        from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [r.cliente_email], reply_to: await emailDueno(),
        ...correoGarantia(r, Math.max(dias, 1), link, n, esPrueba()),
      });
      await db.from('reservas').update({ garantia_avisos: n, garantia_ultimo_aviso: hoy }).eq('id', r.id);
      resultado.push({ codigo: r.codigo, dias, enviado: true, aviso: n });
    } catch (e) {
      console.error('recordatorio garantía', r.codigo, e);
      resultado.push({ codigo: r.codigo, dias, enviado: false, error: String(e).slice(0, 200) });
    }
  }
  return json(req, { hoy, resultado });
}

async function firmaValida(req: Request, url: URL) {
  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!secret) return true; // sin secreto configurado: igual se consulta el pago a la API de MP
  const sig = req.headers.get('x-signature') || '';
  const reqId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=') as [string, string]));
  const dataId = (url.searchParams.get('data.id') || '').toLowerCase();
  if (!parts.ts || !parts.v1) return false;
  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (reqId) manifest += `request-id:${reqId};`;
  manifest += `ts:${parts.ts};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return hex === parts.v1;
}

// ---------- rutas ----------
async function crear(req: Request) {
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  const c = body?.cliente || {};
  if (items.length < 1 || items.length > 40) return json(req, { error: 'carrito_invalido' }, 400);

  const cliente = {
    nombre: clip(c.name, 80), telefono: clip(c.phone, 30), email: clip(c.email, 120),
    comuna: clip(c.comuna, 60), notas: clip(c.notes, 600),
  };
  if (cliente.nombre.length < 2 || !/^[\d\s+()-]{7,}$/.test(cliente.telefono) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email) || !cliente.comuna) {
    return json(req, { error: 'datos_cliente_invalidos' }, 400);
  }

  const { productos, dispo, transporte, ajustes } = await cargarSitio();
  const pagadas = await fechasPagadas(dispo);
  const lineas: Array<{ id: string; nombre: string; qty: number; fecha: string; precio: number }> = [];
  for (const it of items) {
    const p = productos.get(String(it?.id));
    const qty = Number(it?.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 200) return json(req, { error: 'producto_invalido', id: it?.id }, 400);
    if (!isISODate(it?.date)) return json(req, { error: 'falta_fecha', id: p.id, nombre: p.name }, 400);
    const motivo = motivoNoDisponible(p.id, it.date, dispo, pagadas);
    if (motivo) return json(req, { error: 'no_disponible', id: p.id, nombre: p.name, fecha: it.date, motivo }, 409);
    lineas.push({ id: p.id, nombre: p.name, qty, fecha: it.date, precio: p.price });
  }
  const fechas = [...new Set(lineas.map((l) => l.fecha))].sort();
  if (fechas.length > 1) return json(req, { error: 'varias_fechas' }, 400); // cada pedido es para un solo día

  // Flete y montaje según comuna (assets/transporte.js). Pedidos solo con productos "sinFlete" no pagan.
  const soloSinFlete = lineas.every((l) => (transporte.sinFlete || []).includes(l.id));
  const tarifa = transporte.comunas.find((c) => c.nombre === cliente.comuna);
  if (!soloSinFlete && !tarifa) return json(req, { error: 'comuna_sin_tarifa' }, 400);
  const flete = soloSinFlete ? 0 : Math.round(Number(tarifa!.valor));

  const productosTotal = lineas.reduce((s, l) => s + l.precio * l.qty, 0);
  const total = productosTotal + flete;
  const abono = Math.round(total * ajustes.abono_pct / 100);
  const codigo = codigoNuevo();

  mpToken(); // falla temprano si no está configurado
  const { data: res, error } = await db.from('reservas').insert({
    codigo, items: lineas, fechas, total, abono, flete, garantia_monto: ajustes.garantia_monto,
    cliente_nombre: cliente.nombre, cliente_telefono: cliente.telefono, cliente_email: cliente.email,
    comuna: cliente.comuna, notas: cliente.notas || null,
  }).select('id').single();
  if (error) throw error;

  const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pagos`;
  const fechaTxt = fechas.map((f) => f.split('-').reverse().join('-')).join(', ');
  const pref = await mp('/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': codigo },
    body: JSON.stringify({
      items: [{
        id: codigo,
        title: `Abono ${ajustes.abono_pct}% reserva ${codigo} · Party House`,
        description: (`Evento ${fechaTxt} en ${cliente.comuna}: ` + lineas.map((l) => `${l.nombre} x${l.qty}`).join(', ') +
          (flete ? ` + flete y montaje` : '')).slice(0, 250),
        category_id: 'services',
        quantity: 1,
        unit_price: abono,
        currency_id: 'CLP',
      }],
      payer: { name: cliente.nombre, email: cliente.email },
      external_reference: codigo,
      back_urls: {
        success: `${SITE}/pago.html`,
        pending: `${SITE}/pago.html`,
        failure: `${SITE}/pago.html`,
      },
      auto_return: 'approved',
      notification_url: `${fnUrl}/webhook`,
      statement_descriptor: 'PARTYHOUSE',
      expires: true,
      expiration_date_to: new Date(Date.now() + 2 * 3600_000).toISOString(),
      metadata: { codigo },
    }),
  });
  await db.from('reservas').update({ mp_preference_id: pref.id }).eq('id', res.id);
  return json(req, { codigo, total, abono, flete, init_point: pref.init_point });
}

async function webhook(req: Request, url: URL) {
  if (!(await firmaValida(req, url))) return new Response('firma inválida', { status: 401 });
  const body = await req.json().catch(() => ({}));
  const type = body?.type || body?.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const id = body?.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id');
  if (type === 'payment' && id) await aplicarPago(String(id)); // si falla, MP reintenta (500)
  return new Response('ok', { status: 200 });
}

async function estado(req: Request, url: URL) {
  const ref = clip(url.searchParams.get('codigo'), 22).toUpperCase();
  const paymentId = clip(url.searchParams.get('payment_id'), 30);
  if (!/^PH-[A-Z0-9]{8}(-G)?$/.test(ref)) return json(req, { error: 'codigo_invalido' }, 400);
  const esGarantia = ref.endsWith('-G');
  const codigo = esGarantia ? ref.slice(0, -2) : ref;
  let { data: res } = await db.from('reservas').select('*').eq('codigo', codigo).maybeSingle();
  if (!res) return json(req, { error: 'no_encontrada' }, 404);
  // Si vuelve del checkout antes que el webhook, conciliamos consultando el pago directo a MP
  const pendiente = esGarantia ? res.garantia_estado === 'pendiente' : res.estado !== 'pagado';
  if (pendiente && /^\d+$/.test(paymentId)) {
    try { res = (await aplicarPago(paymentId)) || res; } catch (e) { console.error(e); }
  }
  return json(req, {
    codigo: res.codigo, estado: res.estado, mp_status: res.mp_status, total: res.total, abono: res.abono,
    monto_pagado: res.monto_pagado, fechas: res.fechas, comuna: res.comuna, flete: res.flete,
    garantia_estado: res.garantia_estado, garantia_monto: res.garantia_monto,
    items: (res.items as Array<{ nombre: string; qty: number; fecha: string }>).map((i) => ({ nombre: i.nombre, qty: i.qty, fecha: i.fecha })),
  });
}

// Formulario de contacto. Límite simple por IP (por instancia) + campo trampa para bots.
const envios = new Map<string, number[]>();
async function contacto(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b) return json(req, { error: 'datos_invalidos' }, 400);
  if (clip(b.website, 200)) return json(req, { ok: true }); // trampa: solo los bots llenan este campo
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'sin-ip';
  const ahora = Date.now();
  const previos = (envios.get(ip) || []).filter((t) => ahora - t < 10 * 60_000);
  if (previos.length >= 5) return json(req, { error: 'demasiados_envios' }, 429);
  const m = {
    nombre: clip(b.name, 80), email: clip(b.email, 120), telefono: clip(b.phone, 30),
    fecha: isISODate(b.date) ? b.date : '', tipo: clip(b.type, 60), mensaje: clip(b.message, 3000),
  };
  if (m.nombre.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email) || m.mensaje.length < 10 ||
      (m.telefono && !/^[\d\s+()-]{7,}$/.test(m.telefono))) {
    return json(req, { error: 'datos_invalidos' }, 400);
  }
  envios.set(ip, [...previos, ahora]);
  await enviarCorreo(resendKey(), 'contacto-' + crypto.randomUUID(), {
    from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [await emailDueno()], reply_to: m.email, ...correoContacto(m),
  });
  return json(req, { ok: true });
}

// Panel: enviar (o reenviar) la confirmación por correo de una reserva. Requiere sesión de administrador.
async function confirmar(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json(req, { error: 'no_autorizado' }, 401);
  const { data: adm } = await db.from('admins').select('user_id').eq('user_id', u.user.id).is('disabled_at', null).maybeSingle();
  if (!adm) return json(req, { error: 'no_autorizado' }, 401);
  const b = await req.json().catch(() => ({}));
  const { data: r } = await db.from('reservas').select('*').eq('codigo', clip(b.codigo, 20)).maybeSingle();
  if (!r) return json(req, { error: 'no_encontrada' }, 404);
  if (!r.cliente_email) return json(req, { error: 'sin_correo' }, 400);
  await enviarCorreo(resendKey(), 'cliente-' + r.codigo + (b.reenviar ? '-' + Date.now() : ''), {
    from: Deno.env.get('EMAIL_FROM') || REMITENTE, to: [r.cliente_email], reply_to: await emailDueno(), ...correoCliente(r, esPrueba()),
  });
  await db.from('reservas').update({ confirmacion_cliente_en: new Date().toISOString() }).eq('id', r.id);
  return json(req, { ok: true });
}

async function disponibilidad(req: Request) {
  const { dispo } = await cargarSitio();
  return json(req, { ocupado: await fechasPagadas(dispo) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const url = new URL(req.url);
  const ruta = url.pathname.split('/').filter(Boolean).pop();
  try {
    if (req.method === 'POST' && ruta === 'crear') return await crear(req);
    if (req.method === 'POST' && ruta === 'webhook') return await webhook(req, url);
    if (req.method === 'POST' && ruta === 'contacto') return await contacto(req);
    if (req.method === 'POST' && ruta === 'recordatorios') return await recordatorios(req);
    if (req.method === 'GET' && ruta === 'estado') return await estado(req, url);
    if (req.method === 'GET' && ruta === 'disponibilidad') return await disponibilidad(req);
    if (req.method === 'GET' && ruta === 'datos.js') return await datosJs(req);
    if (req.method === 'POST' && ruta === 'confirmar') return await confirmar(req);
    if (req.method === 'GET' && ruta === 'modo') {
      const t = Deno.env.get('MP_ACCESS_TOKEN') || '';
      return json(req, { modo: !t ? 'desactivado' : t.startsWith('TEST-') ? 'prueba' : 'produccion' });
    }
    return json(req, { error: 'ruta_no_encontrada' }, 404);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    console.error(e);
    return json(req, { error: status === 503 ? 'pagos_no_configurados' : 'error_interno' }, status);
  }
});
