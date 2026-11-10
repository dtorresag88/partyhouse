// Party House — pagos del abono con Mercado Pago (Checkout Pro)
//
// Rutas (todas bajo /functions/v1/pagos):
//   POST /crear           → valida carrito, recalcula precios en el servidor, crea la reserva y el cobro
//   POST /webhook         → notificación de Mercado Pago; consulta el pago a la API y actualiza la reserva
//   GET  /estado?codigo=  → estado de una reserva (sin datos personales) para la página pago.html
//   GET  /disponibilidad  → fechas ya pagadas de productos con bloqueo automático
//   POST /contacto        → formulario de contacto del sitio: envía el mensaje por correo al dueño
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
import { correoCliente, correoContacto, correoDueno, enviarCorreo, REMITENTE } from './correos.ts';

const SITE = (Deno.env.get('SITE_URL') || 'https://partyhouse.cl').replace(/\/$/, '');
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ||
  'https://partyhouse.cl,https://www.partyhouse.cl,https://dtorresag88.github.io,http://127.0.0.1:8765,http://localhost:8765')
  .split(',').map((s) => s.trim());
const MP_API = 'https://api.mercadopago.com';
const ABONO = 0.5;

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

// ---------- catálogo y disponibilidad (leídos del sitio publicado) ----------
type Producto = { id: string; name: string; price: number };
type Dispo = {
  diasAnticipacion: number; mesesMaximo: number; cerrado: string[];
  ocupado: Record<string, string[]>; comparten: string[][]; bloqueoAutomatico: string[];
};
let cache: { t: number; productos: Map<string, Producto>; dispo: Dispo } | null = null;

async function cargarSitio() {
  if (cache && Date.now() - cache.t < 60_000) return cache;
  const [dataJs, dispoJs] = await Promise.all([
    fetch(SITE + '/assets/data.js?t=' + Date.now()).then((r) => { if (!r.ok) throw new Error('data.js ' + r.status); return r.text(); }),
    fetch(SITE + '/assets/disponibilidad.js?t=' + Date.now()).then((r) => (r.ok ? r.text() : '')),
  ]);
  const productos = new Map<string, Producto>();
  const re = /id:\s*'([^']+)',\s*name:\s*'([^']*)'[\s\S]*?price:\s*(\d+)/g;
  for (let m; (m = re.exec(dataJs));) productos.set(m[1], { id: m[1], name: m[2], price: Number(m[3]) });
  if (productos.size === 0) throw new Error('catálogo vacío');

  let dispo: Dispo = { diasAnticipacion: 3, mesesMaximo: 4, cerrado: [], ocupado: {}, comparten: [], bloqueoAutomatico: [] };
  try {
    const i = dispoJs.indexOf('{', dispoJs.indexOf('PH_DISPONIBILIDAD'));
    const src = dispoJs.slice(i, dispoJs.lastIndexOf('}') + 1)
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    dispo = { ...dispo, ...JSON.parse(src) };
  } catch (e) {
    console.error('No se pudo leer disponibilidad.js; uso valores por defecto', e);
  }
  cache = { t: Date.now(), productos, dispo };
  return cache;
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
  const codigo = p.external_reference;
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

  const { productos, dispo } = await cargarSitio();
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
  const total = lineas.reduce((s, l) => s + l.precio * l.qty, 0);
  const abono = Math.round(total * ABONO);
  const codigo = codigoNuevo();
  const fechas = [...new Set(lineas.map((l) => l.fecha))].sort();

  mpToken(); // falla temprano si no está configurado
  const { data: res, error } = await db.from('reservas').insert({
    codigo, items: lineas, fechas, total, abono,
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
        title: `Abono 50% reserva ${codigo} · Party House`,
        description: (`Evento ${fechaTxt}: ` + lineas.map((l) => `${l.nombre} x${l.qty}`).join(', ')).slice(0, 250),
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
  return json(req, { codigo, total, abono, init_point: pref.init_point });
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
  const codigo = clip(url.searchParams.get('codigo'), 20).toUpperCase();
  const paymentId = clip(url.searchParams.get('payment_id'), 30);
  if (!/^PH-[A-Z0-9]{8}$/.test(codigo)) return json(req, { error: 'codigo_invalido' }, 400);
  let { data: res } = await db.from('reservas').select('*').eq('codigo', codigo).maybeSingle();
  if (!res) return json(req, { error: 'no_encontrada' }, 404);
  // Si vuelve del checkout antes que el webhook, conciliamos consultando el pago directo a MP
  if (res.estado !== 'pagado' && /^\d+$/.test(paymentId)) {
    try { res = (await aplicarPago(paymentId)) || res; } catch (e) { console.error(e); }
  }
  return json(req, {
    codigo: res.codigo, estado: res.estado, mp_status: res.mp_status, total: res.total, abono: res.abono,
    monto_pagado: res.monto_pagado, fechas: res.fechas, comuna: res.comuna,
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
    if (req.method === 'GET' && ruta === 'estado') return await estado(req, url);
    if (req.method === 'GET' && ruta === 'disponibilidad') return await disponibilidad(req);
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
