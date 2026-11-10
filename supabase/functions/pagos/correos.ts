// Party House — correos de reserva (Resend)
//   correoDueno:   aviso interno de abono pagado (al correo de config.email_avisos)
//   correoCliente: confirmación para el cliente, con la fecha adjunta en formato calendario (.ics)
//   correoContacto: mensaje del formulario de contacto del sitio (al dueño)

// deno-lint-ignore-file no-explicit-any
export const REMITENTE = 'Party House <reservas@partyhouse.cl>';
const WHATSAPP = '56956981681';
const SITE = 'https://partyhouse.cl';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
export const fechaLarga = (f: string) =>
  new Date(f + 'T12:00:00Z').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pagado = (r: any) => r.monto_pagado || r.abono;

type Item = { nombre: string; qty: number; fecha: string; precio: number };

function filasItems(items: Item[]) {
  return items.map((i) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.nombre)} × ${i.qty}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;font-size:13px">${esc(mayus(fechaLarga(i.fecha)))}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${clp(i.precio * i.qty)}</td></tr>`).join('');
}

// ---------- aviso al dueño ----------
export function correoDueno(r: any, prueba: boolean) {
  const items = r.items as Item[];
  const fechas = (r.fechas as string[]).map(fechaLarga).join(' · ');
  const tel = String(r.cliente_telefono).replace(/[^\d]/g, '');
  const wa = 'https://wa.me/' + (tel.startsWith('56') ? tel : '56' + tel.replace(/^0+/, ''));
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111">
  ${prueba ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px"><b>PRUEBA</b> — no hay dinero real.</p>' : ''}
  <h2 style="margin:0 0 4px">🎉 Abono pagado · ${esc(r.codigo)}</h2>
  <p style="margin:0 0 16px;color:#444">Evento: <b>${esc(fechas)}</b> · ${esc(r.comuna)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${filasItems(items)}</table>
  <p style="font-size:15px;line-height:1.6">
    Productos: <b>${clp(r.total - (r.flete || 0))}</b><br>
    Flete y montaje (${esc(r.comuna)}): <b>${r.flete ? clp(r.flete) : 'incluido'}</b><br>
    Total: <b>${clp(r.total)}</b><br>
    Abono pagado: <b style="color:#0a7a3e">${clp(pagado(r))}</b><br>
    Saldo el día del evento: <b>${clp(r.total - pagado(r))}</b>
  </p>
  <h3 style="margin:20px 0 6px">Cliente</h3>
  <p style="font-size:15px;line-height:1.6;margin:0">
    ${esc(r.cliente_nombre)}<br>
    📞 <a href="${wa}">${esc(r.cliente_telefono)}</a> (WhatsApp)<br>
    ✉️ ${esc(r.cliente_email)}<br>
    📍 ${esc([r.direccion, r.comuna].filter(Boolean).join(', '))}${r.horario ? ` · ⏰ ${esc(r.horario)}` : ''}
    ${r.notas ? `<br>📝 ${esc(r.notas)}` : ''}
  </p>
  <p style="color:#888;font-size:12px;margin-top:20px">Pago Mercado Pago #${esc(r.mp_payment_id)} · Al cliente se le envió su confirmación por correo. Las fechas de productos con bloqueo automático ya quedaron bloqueadas en el sitio.</p>
</div>`;
  return {
    subject: `${prueba ? '[PRUEBA] ' : ''}💸 Abono pagado ${clp(pagado(r))} · ${r.codigo} · ${fechas}`,
    html,
  };
}

// ---------- confirmación al cliente ----------
function ics(r: any) {
  const e = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Party House//Reservas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  (r.fechas as string[]).forEach((f, i) => {
    const [y, m, d] = f.split('-').map(Number);
    const fin = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    const items = (r.items as Item[]).filter((it) => it.fecha === f).map((it) => `${it.nombre} x${it.qty}`).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${r.codigo}-${i}@partyhouse.cl`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${f.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${fin}`,
      `SUMMARY:${e('🎉 Mi fiesta con Party House')}`,
      `DESCRIPTION:${e(`Reserva ${r.codigo} (abono pagado)\n${items}\n\nWhatsApp Party House: +56 9 5698 1681`)}`,
      'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  let bin = '';
  new TextEncoder().encode(lines.join('\r\n')).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function correoCliente(r: any, prueba: boolean) {
  const items = r.items as Item[];
  const nombre = String(r.cliente_nombre).trim().split(/\s+/)[0];
  const fechas = (r.fechas as string[]).map((f) => mayus(fechaLarga(f)));
  const saldo = r.total - pagado(r);
  const waMsg = encodeURIComponent(`¡Hola Party House! Soy ${r.cliente_nombre}, mi reserva es ${r.codigo}. Quiero coordinar la dirección y el horario de instalación.`);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f1ea">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#15111f">
  ${prueba ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px;font-size:13px"><b>PRUEBA</b> — este correo es una vista previa.</p>' : ''}
  <div style="background:#0c0a14;border-radius:18px 18px 0 0;padding:28px 28px 22px;color:#f4eee0">
    <div style="font-family:'Arial Black',Arial,sans-serif;font-size:20px;letter-spacing:-0.5px">PARTY<span style="font-weight:400"> HOUSE</span></div>
    <h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:30px;line-height:1.05;margin:22px 0 8px;letter-spacing:-0.5px">¡Tu fiesta está <span style="color:#e8ff3a">reservada</span>, ${esc(nombre)}! 🎉</h1>
    <p style="margin:0;color:#a59cb0;font-size:15px;line-height:1.5">Recibimos tu abono y tu fecha quedó bloqueada para ti.</p>
  </div>
  <div style="background:#ffffff;border-radius:0 0 18px 18px;padding:26px 28px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tr>
      <td style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">Código de reserva</td>
      <td style="text-align:right;font-family:'Courier New',monospace;font-size:18px;font-weight:bold">${esc(r.codigo)}</td>
    </tr><tr>
      <td style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px;padding-top:6px">Fecha del evento</td>
      <td style="text-align:right;font-weight:bold;padding-top:6px">${esc(fechas.join(' · '))}</td>
    </tr></table>

    <table style="width:100%;border-collapse:collapse;font-size:14px">${filasItems(items)}</table>

    <table style="width:100%;border-collapse:collapse;font-size:15px;margin-top:14px">
      <tr><td style="padding:4px 0;color:#444">Productos</td><td style="padding:4px 0;text-align:right">${clp(r.total - (r.flete || 0))}</td></tr>
      <tr><td style="padding:4px 0;color:#444">Flete y montaje (${esc(r.comuna)})</td><td style="padding:4px 0;text-align:right">${r.flete ? clp(r.flete) : 'Incluido'}</td></tr>
      <tr><td style="padding:4px 0;color:#444;font-weight:bold">Total</td><td style="padding:4px 0;text-align:right;font-weight:bold">${clp(r.total)}</td></tr>
      <tr><td style="padding:4px 0;color:#0a7a3e;font-weight:bold">Abono pagado ✓</td><td style="padding:4px 0;text-align:right;color:#0a7a3e;font-weight:bold">${clp(pagado(r))}</td></tr>
      <tr><td style="padding:4px 0;color:#444">Saldo a pagar el día del evento</td><td style="padding:4px 0;text-align:right;font-weight:bold">${clp(saldo)}</td></tr>
    </table>

    <h2 style="font-size:17px;margin:26px 0 10px">¿Qué sigue?</h2>
    <ol style="padding-left:20px;margin:0;font-size:14px;line-height:1.6;color:#333">
      <li>Te escribimos por WhatsApp para coordinar <b>dirección, accesos y horario de instalación</b> (o escríbenos tú con el botón de abajo).</li>
      <li><b>Una semana antes</b> te enviaremos un correo para pagar la <b>garantía reembolsable de ${clp(r.garantia_monto ?? 100000)}</b> con Mercado Pago. Te la devolvemos íntegra después del retiro si todo está en orden.</li>
      <li>El día del evento, antes de la instalación, se paga el <b>saldo (${clp(saldo)})</b>.</li>
      <li>Llegamos, instalamos todo y dejamos la fiesta lista para prender.</li>
    </ol>

    <div style="text-align:center;margin:26px 0 10px">
      <a href="https://wa.me/${WHATSAPP}?text=${waMsg}" style="display:inline-block;background:#25D366;color:#0a3d1c;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px;font-size:15px">Coordinar por WhatsApp →</a>
    </div>
    <p style="text-align:center;font-size:12px;color:#888;margin:8px 0 0">📅 Te adjuntamos la fecha para que la guardes en tu calendario.</p>

    <p style="font-size:13px;color:#666;line-height:1.6;border-top:1px solid #eee;margin-top:24px;padding-top:16px">
      Revisa nuestras <a href="${SITE}/condiciones.html" style="color:#15111f">condiciones del arriendo</a> (duración, lluvia, cambios de fecha) y las
      <a href="${SITE}/faq.html" style="color:#15111f">preguntas frecuentes</a>. ¿Dudas? Responde este correo o escríbenos al +56 9 5698 1681.
    </p>
  </div>
  <p style="text-align:center;font-size:11px;color:#999;margin:16px 0 0">Party House · Arriendo de carpas disco, mobiliario LED, audio y juegos · Santiago, Chile<br>Pago procesado por Mercado Pago · Operación #${esc(r.mp_payment_id)}</p>
</div></body></html>`;
  return {
    subject: `${prueba ? '[PRUEBA] ' : ''}🎉 ¡Tu fiesta está reservada! · ${r.codigo} · ${fechas.join(' · ')}`,
    html,
    attachments: [{ filename: 'mi-fiesta-party-house.ics', content: ics(r), content_type: 'text/calendar' }],
  };
}

// ---------- garantía reembolsable ----------
function marco(contenido: string, prueba: boolean) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f1ea">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#15111f">
  ${prueba ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px;font-size:13px"><b>PRUEBA</b> — vista previa.</p>' : ''}
  <div style="background:#0c0a14;border-radius:18px 18px 0 0;padding:22px 28px;color:#f4eee0">
    <div style="font-family:'Arial Black',Arial,sans-serif;font-size:20px;letter-spacing:-0.5px">PARTY<span style="font-weight:400"> HOUSE</span></div>
  </div>
  <div style="background:#ffffff;border-radius:0 0 18px 18px;padding:26px 28px;font-size:15px;line-height:1.6">${contenido}</div>
  <p style="text-align:center;font-size:11px;color:#999;margin:16px 0 0">Party House · Arriendo de carpas disco, mobiliario LED, audio y juegos · Santiago, Chile</p>
</div></body></html>`;
}

// Solicitud de pago de la garantía (primer aviso y recordatorios diarios)
export function correoGarantia(r: any, dias: number, link: string, n: number, prueba: boolean) {
  const nombre = String(r.cliente_nombre).trim().split(/\s+/)[0];
  const fecha = mayus(fechaLarga(r.fechas[0]));
  const cuando = dias <= 1 ? '¡tu fiesta es mañana!' : `tu fiesta es en ${dias} días`;
  const html = marco(`
    <h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;line-height:1.15;margin:0 0 10px">${n > 1 ? 'Recordatorio: ' : ''}${esc(nombre)}, ${cuando} 🎉</h1>
    <p style="margin:0 0 16px;color:#333">Para dejar todo listo para tu evento del <b>${esc(fecha)}</b> (reserva <b>${esc(r.codigo)}</b>),
      necesitamos que pagues la <b>garantía reembolsable de ${clp(r.garantia_monto)}</b>.</p>
    <div style="background:#f6f4ee;border-radius:12px;padding:14px 16px;margin:0 0 18px;font-size:14px;color:#333">
      <b>¿Qué es la garantía?</b> Cubre eventuales daños a la carpa y los equipos.
      <b>Te la devolvemos íntegra</b> después del retiro si todo está en orden.
    </div>
    <div style="text-align:center;margin:22px 0">
      <a href="${link}" style="display:inline-block;background:#009ee3;color:#fff;text-decoration:none;font-weight:bold;padding:15px 28px;border-radius:999px;font-size:16px">Pagar garantía ${clp(r.garantia_monto)} con Mercado Pago →</a>
    </div>
    <p style="font-size:13px;color:#666;margin:0">Debe quedar pagada antes del día del evento. Te enviaremos un recordatorio diario hasta recibirla.
      ¿Prefieres transferir o tienes dudas? Responde este correo o escríbenos por
      <a href="https://wa.me/${WHATSAPP}" style="color:#15111f">WhatsApp</a> al +56 9 5698 1681.</p>`, prueba);
  return {
    subject: `${prueba ? '[PRUEBA] ' : ''}${n > 1 ? 'Recordatorio: ' : ''}Garantía reembolsable ${clp(r.garantia_monto)} · ${cuando} · ${r.codigo}`,
    html,
  };
}

export function correoGarantiaRecibida(r: any, prueba: boolean) {
  const nombre = String(r.cliente_nombre).trim().split(/\s+/)[0];
  const html = marco(`
    <h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;line-height:1.15;margin:0 0 10px">¡Garantía recibida, ${esc(nombre)}! ✓</h1>
    <p style="margin:0 0 14px;color:#333">Recibimos tu garantía reembolsable de <b>${clp(r.garantia_monto)}</b> para la reserva <b>${esc(r.codigo)}</b>
      (${esc(mayus(fechaLarga(r.fechas[0])))}). Ya no te llegarán más recordatorios.</p>
    <p style="margin:0;color:#333">Te la devolvemos íntegra después del retiro si todo está en orden. ¡Nos vemos en la fiesta! 🎉</p>`, prueba);
  return { subject: `${prueba ? '[PRUEBA] ' : ''}✓ Garantía recibida · ${r.codigo}`, html };
}

export function correoGarantiaDevuelta(r: any, prueba: boolean) {
  const nombre = String(r.cliente_nombre).trim().split(/\s+/)[0];
  const html = marco(`
    <h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;line-height:1.15;margin:0 0 10px">Te devolvimos la garantía, ${esc(nombre)} 💸</h1>
    <p style="margin:0 0 14px;color:#333">Devolvimos tu garantía de <b>${clp(r.garantia_monto)}</b> (reserva <b>${esc(r.codigo)}</b>) al mismo medio de pago que usaste en Mercado Pago.
      Según tu banco, puede tardar unos días hábiles en verse reflejada.</p>
    <p style="margin:0;color:#333">¡Gracias por celebrar con Party House! Si te gustó, nos ayudas mucho recomendándonos 🙌</p>`, prueba);
  return { subject: `${prueba ? '[PRUEBA] ' : ''}Garantía devuelta · ${r.codigo}`, html };
}

export function correoGarantiaDueno(r: any, prueba: boolean) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111">
  ${prueba ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px"><b>PRUEBA</b></p>' : ''}
  <h2 style="margin:0 0 6px">🛡️ Garantía pagada · ${esc(r.codigo)}</h2>
  <p style="font-size:15px;line-height:1.6;margin:0">${esc(r.cliente_nombre)} pagó la garantía de <b>${clp(r.garantia_monto)}</b> para el evento del
    <b>${esc(fechaLarga(r.fechas[0]))}</b> en ${esc(r.comuna)}.<br>
    Pago Mercado Pago #${esc(r.garantia_payment_id)}. Para devolverla, reembolsa ese pago desde tu panel de Mercado Pago
    (el sistema lo registra y le avisa al cliente).</p>
</div>`;
  return { subject: `${prueba ? '[PRUEBA] ' : ''}🛡️ Garantía pagada ${clp(r.garantia_monto)} · ${r.codigo}`, html };
}

// ---------- saldo ----------
export function correoSaldo(r: any, monto: number, link: string, prueba: boolean) {
  const nombre = String(r.cliente_nombre).trim().split(/\s+/)[0];
  const fecha = mayus(fechaLarga(r.fechas[0]));
  const html = marco(`
    <h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;line-height:1.15;margin:0 0 10px">${esc(nombre)}, te falta el saldo de tu reserva 🎉</h1>
    <p style="margin:0 0 16px;color:#333">Para tu evento del <b>${esc(fecha)}</b> (reserva <b>${esc(r.codigo)}</b>) queda pendiente un saldo de <b>${clp(monto)}</b>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px;margin:0 0 6px">
      <tr><td style="padding:4px 0;color:#444">Total del arriendo</td><td style="padding:4px 0;text-align:right">${clp(r.total)}</td></tr>
      <tr><td style="padding:4px 0;color:#444">Ya pagado</td><td style="padding:4px 0;text-align:right">${clp(r.total - monto)}</td></tr>
      <tr><td style="padding:4px 0;font-weight:bold">Saldo pendiente</td><td style="padding:4px 0;text-align:right;font-weight:bold">${clp(monto)}</td></tr>
    </table>
    <div style="text-align:center;margin:22px 0">
      <a href="${link}" style="display:inline-block;background:#009ee3;color:#fff;text-decoration:none;font-weight:bold;padding:15px 28px;border-radius:999px;font-size:16px">Pagar saldo ${clp(monto)} con Mercado Pago →</a>
    </div>
    <p style="font-size:13px;color:#666;margin:0">¿Prefieres transferir o pagar el día del evento? Responde este correo o escríbenos por
      <a href="https://wa.me/${WHATSAPP}" style="color:#15111f">WhatsApp</a> al +56 9 5698 1681.</p>`, prueba);
  return { subject: `${prueba ? '[PRUEBA] ' : ''}Saldo pendiente ${clp(monto)} · tu reserva ${r.codigo}`, html };
}

export function correoSaldoRecibido(r: any, monto: number, prueba: boolean) {
  const nombre = String(r.cliente_nombre).trim().split(/\s+/)[0];
  const html = marco(`
    <h1 style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;line-height:1.15;margin:0 0 10px">¡Saldo recibido, ${esc(nombre)}! ✓</h1>
    <p style="margin:0;color:#333">Recibimos el pago de <b>${clp(monto)}</b> de tu reserva <b>${esc(r.codigo)}</b> (${esc(mayus(fechaLarga(r.fechas[0])))}).
      Tu arriendo quedó <b>100% pagado</b>. ¡Nos vemos en la fiesta! 🎉</p>`, prueba);
  return { subject: `${prueba ? '[PRUEBA] ' : ''}✓ Saldo recibido · ${r.codigo}`, html };
}

export function correoSaldoDueno(r: any, monto: number, paymentId: string, prueba: boolean) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111">
  ${prueba ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px"><b>PRUEBA</b></p>' : ''}
  <h2 style="margin:0 0 6px">💰 Saldo pagado · ${esc(r.codigo)}</h2>
  <p style="font-size:15px;line-height:1.6;margin:0">${esc(r.cliente_nombre)} pagó el saldo de <b>${clp(monto)}</b> para el evento del
    <b>${esc(fechaLarga(r.fechas[0]))}</b> en ${esc(r.comuna)}. La reserva quedó 100% pagada.<br>Pago Mercado Pago #${esc(paymentId)}.</p>
</div>`;
  return { subject: `${prueba ? '[PRUEBA] ' : ''}💰 Saldo pagado ${clp(monto)} · ${r.codigo}`, html };
}

// ---------- formulario de contacto ----------
export function correoContacto(m: { nombre: string; email: string; telefono: string; fecha: string; tipo: string; mensaje: string }) {
  const tel = m.telefono.replace(/[^\d]/g, '');
  const wa = tel ? 'https://wa.me/' + (tel.startsWith('56') ? tel : '56' + tel.replace(/^0+/, '')) : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111">
  <h2 style="margin:0 0 4px">📩 Mensaje desde partyhouse.cl</h2>
  <p style="margin:0 0 16px;color:#444">${esc(m.tipo || 'Sin tipo')}${m.fecha ? ' · evento ' + esc(mayus(fechaLarga(m.fecha))) : ''}</p>
  <div style="background:#f6f6f6;border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(m.mensaje)}</div>
  <p style="font-size:15px;line-height:1.7;margin-top:16px">
    <b>${esc(m.nombre)}</b><br>
    ✉️ ${esc(m.email)} <span style="color:#888">(responde este correo para contestarle)</span><br>
    ${m.telefono ? `📞 ${wa ? `<a href="${wa}">${esc(m.telefono)}</a> (WhatsApp)` : esc(m.telefono)}` : ''}
  </p>
</div>`;
  return { subject: `📩 Mensaje web: ${m.nombre}${m.tipo ? ' · ' + m.tipo : ''}`, html };
}

export async function enviarCorreo(key: string, idempotencia: string, payload: Record<string, unknown>) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencia },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('resend ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  return resp.json();
}
