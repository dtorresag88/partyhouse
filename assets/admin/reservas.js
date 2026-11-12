/* =====================================================================
   Panel · Reservas (listado, detalle, crear reserva manual, hoja de instalación)
   ===================================================================== */
(() => {
  const { $, $$, esc, clp } = A;
  const hoy = () => A.hoyKey();

  const TABS = [
    ["proximas", "Próximas", (r) => r.estado === "pagado" && A.fechaEv(r) >= hoy() && r.etapa !== "retirada"],
    ["por_instalar", "Por instalar", (r) => r.estado === "pagado" && r.etapa === "por_instalar"],
    ["instaladas", "Por retirar", (r) => r.estado === "pagado" && r.etapa === "instalada"],
    ["realizadas", "Realizadas", (r) => r.estado === "pagado" && r.etapa === "retirada"],
    ["no_pagadas", "Pagos no completados", (r) => ["pendiente", "rechazado"].includes(r.estado)],
    ["canceladas", "Canceladas", (r) => ["cancelado", "reembolsado"].includes(r.estado)],
    ["todas", "Todas", () => true],
  ];

  // ------------------------------------------------------------ ocupación de un día (bloqueos + reservas confirmadas)
  // Devuelve { cerrado: bool, ocupados: { productoId: "motivo" } } considerando equipos compartidos.
  A.ocupacionDia = async (fecha, excluirCodigo = null) => {
    await A.loadCatalog();
    const [bloq, res] = await Promise.all([
      A.q(A.sb.from("bloqueos").select("producto_id, motivo").eq("fecha", fecha)),
      A.q(A.sb.from("reservas").select("codigo, items").eq("estado", "pagado").contains("fechas", [fecha])),
    ]);
    const out = { cerrado: bloq.some((b) => !b.producto_id), ocupados: {} };
    const marcar = (id, motivo) => { for (const g of A.grupo(id)) if (!out.ocupados[g]) out.ocupados[g] = motivo; };
    for (const b of bloq) if (b.producto_id) marcar(b.producto_id, `bloqueado${b.motivo ? ": " + b.motivo : ""}`);
    for (const r of res) {
      if (r.codigo === excluirCodigo) continue;
      for (const i of r.items) {
        const p = A.prod(i.id);
        if (p && (p.bloqueo_automatico || p.equipo)) marcar(i.id, `reservado en ${r.codigo}`);
      }
    }
    return out;
  };

  // ------------------------------------------------------------ selects de productos y comunas, flete automático
  A.optsProd = (extra = []) => {
    const prods = A.state.productos.filter((p) => p.activo);
    const fuera = extra.filter((x) => x.id && !prods.some((p) => p.id === x.id));
    return `<option value="">Elige un producto…</option>${fuera.map((x) => `<option value="${esc(x.id)}">${esc(x.nombre)} (oculto)</option>`).join("")}${A.state.categorias.map((c) => `<optgroup label="${esc(c.nombre)}">${prods.filter((p) => p.categoria === c.id).map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)} · ${esc(p.tamano)} · ${clp(p.precio)}</option>`).join("")}</optgroup>`).join("")}`;
  };
  A.optsComuna = (actual = "") => {
    const cs = A.state.comunas.filter((c) => c.activa);
    const otra = actual && !cs.some((c) => c.nombre === actual);
    return `<option value="">Elige…</option>${cs.map((c) => `<option value="${esc(c.nombre)}" ${c.nombre === actual ? "selected" : ""}>${esc(c.nombre)} · ${clp(c.valor)}</option>`).join("")}${otra ? `<option value="${esc(actual)}" selected>${esc(actual)} (sin tarifa)</option>` : ""}<option value="__otra">Otra (escribir)</option>`;
  };
  // Productos escritos a mano (no están en el catálogo): id "manual-xxxx"
  A.esManual = (id) => /^manual-/.test(id || "");
  A.lineaManual = () => ({ id: "manual-" + Math.random().toString(36).slice(2, 10), manual: true, nombre: "", qty: 1, precio: null });
  // Flete según comuna y productos; null si la comuna no tiene tarifa
  A.fleteAuto = (comuna, ids) => {
    if (ids.length && ids.every((id) => A.prod(id)?.sin_flete)) return 0;
    return A.state.comunas.find((c) => c.nombre === comuna && c.activa)?.valor ?? null;
  };

  // ------------------------------------------------------------ llamadas a la función "pagos" con la sesión del admin
  A.pagosApi = async (ruta, body) => {
    const { data: { session } } = await A.sb.auth.getSession();
    const resp = await fetch(A.CFG.PAGOS_URL + "/" + ruta, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session?.access_token }, body: JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw Object.assign(new Error({ sin_correo: "La reserva no tiene correo", sin_saldo: "No hay saldo pendiente", no_autorizado: "Sesión vencida: vuelve a ingresar", reserva_no_confirmada: "La reserva no está confirmada" }[data.error] || data.error || "No se pudo completar"), data);
    return data;
  };
  A.lugar = (r) => [r.direccion, r.comuna].filter(Boolean).join(", ");
  // RUT chileno: "12.345.678-9" si el dígito verificador es válido, si no ""
  A.rut = (v) => {
    const s = String(v || "").toUpperCase().replace(/[^0-9K]/g, "");
    if (s.length < 2 || s.length > 9 || !/^\d+$/.test(s.slice(0, -1))) return "";
    const cuerpo = s.slice(0, -1); let suma = 0, m = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) { suma += +cuerpo[i] * m; m = m === 7 ? 2 : m + 1; }
    const r = 11 - (suma % 11), dv = r === 11 ? "0" : r === 10 ? "K" : String(r);
    return s.slice(-1) === dv ? cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv : "";
  };
  A.mapa = (r) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(A.lugar(r) + ", Chile")}`;

  // Mensaje con todo lo que necesita el equipo que instala
  A.textoEquipo = (r) => {
    const f = A.eventoLargo(A.fechaEv(r));
    const lineas = r.items.map((i) => {
      const p = A.prod(i.id);
      const inc = (p?.incluye || []).filter((x) => !/instalaci[oó]n|retiro|transporte/i.test(x));
      return `• ${i.qty}× ${i.nombre}${p?.tamano ? ` (${p.tamano})` : ""}${inc.length ? `\n   ↳ ${inc.join(", ")}` : ""}`;
    }).join("\n");
    const saldo = r.saldo_pagado_en || A.saldo(r) === 0 ? "✅ Saldo pagado" : `💰 *Cobrar saldo: ${clp(A.saldo(r))}*`;
    const gar = { pendiente: `🛡️ Garantía ${clp(r.garantia_monto)}: *pendiente*`, pagada: "🛡️ Garantía: pagada ✅", devuelta: "🛡️ Garantía: devuelta" }[r.garantia_estado] || "";
    return [`🎉 *PARTY HOUSE · ${r.codigo}*`,
      `📅 *${f.charAt(0).toUpperCase() + f.slice(1)}*${r.horario ? ` · ⏰ ${r.horario}` : ""}`,
      `👤 ${r.cliente_nombre}`, `📱 ${r.cliente_telefono}`,
      `📍 ${A.lugar(r) || "Dirección por confirmar"}`, `🗺️ ${A.mapa(r)}`, "",
      `📦 *Llevar e instalar:*`, lineas, "", saldo, gar,
      r.notas ? `💬 Cliente: ${r.notas}` : "", r.notas_internas ? `📝 Notas: ${r.notas_internas}` : ""].filter((x, i, a) => x !== "" || (a[i - 1] !== "" && i < a.length - 1)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };
  A.enviarEquipo = (rows) => {
    const texto = rows.map(A.textoEquipo).join("\n\n———————————\n\n");
    const m = A.modal({ title: rows.length > 1 ? `Enviar al equipo · ${rows.length} eventos` : "Enviar al equipo", wide: true,
      body: `<p class="muted" style="margin-top:0">Revisa o ajusta el mensaje y envíalo al grupo de WhatsApp de los instaladores.</p><textarea id="eq-txt" rows="16" style="font-family:inherit">${esc(texto)}</textarea>`,
      foot: `<button class="btn" id="eq-copy">📋 Copiar</button><a class="btn btn-green" id="eq-wa" target="_blank" rel="noopener">Abrir WhatsApp →</a>` });
    const val = () => m.el.querySelector("#eq-txt").value;
    const wa = m.el.querySelector("#eq-wa");
    const upd = () => (wa.href = `https://wa.me/?text=${encodeURIComponent(val())}`);
    m.el.querySelector("#eq-txt").addEventListener("input", upd); upd();
    m.el.querySelector("#eq-copy").onclick = () => navigator.clipboard.writeText(val()).then(() => A.toast("Copiado: pégalo en el grupo del equipo"), () => A.toast("No se pudo copiar", true));
  };

  // Cobro del saldo pendiente: link de Mercado Pago por correo, WhatsApp o copiado
  A.textoSaldo = (r, link) => {
    const n = (r.cliente_nombre || "").split(" ")[0];
    return `¡Hola ${n}! Te escribimos de Party House 🎉 Para tu evento del ${A.eventoLargo(A.fechaEv(r))} (reserva ${r.codigo}) te queda un saldo de ${clp(A.saldo(r))}.${link ? `\nPuedes pagarlo aquí con Mercado Pago: ${link}` : ""}\nSi prefieres transferir, respóndenos por aquí y te enviamos los datos. ¡Gracias!`;
  };
  A.cobrarSaldo = (r, alTerminar) => {
    const monto = A.saldo(r);
    const m = A.modal({ title: "Cobrar saldo pendiente", body: `
      <dl class="kv"><dt>Total</dt><dd>${clp(r.total)}</dd><dt>Ya pagado (abono)</dt><dd>${clp(r.monto_pagado || 0)}</dd><dt><b>Saldo pendiente</b></dt><dd><b>${clp(monto)}</b></dd></dl>
      <p class="muted">Se genera un link de Mercado Pago por ${clp(monto)}. Cuando el cliente pague, la reserva queda con <b>saldo pagado</b> sola y te llega un aviso.</p>
      <div class="stack" style="gap:8px">
        ${r.cliente_email ? `<button class="btn btn-primary" data-s="mail">✉️ Enviar por correo a ${esc(r.cliente_email)}</button>` : `<p class="help" style="margin:0">Sin correo: envíalo por WhatsApp o copia el link.</p>`}
        <button class="btn btn-green" data-s="wa">📱 Enviar por WhatsApp</button>
        <button class="btn" data-s="copy">📋 Copiar link de pago</button>
      </div><p class="form-error" id="s-err"></p>` });
    m.el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = async () => {
      const modo = b.dataset.s;
      // WhatsApp: se abre la ventana antes de pedir el link para que el navegador no la bloquee
      const win = modo === "wa" ? window.open("about:blank", "_blank") : null;
      b.disabled = true;
      try {
        const d = await A.pagosApi("saldo", { codigo: r.codigo, enviar_correo: modo === "mail" });
        Object.assign(r, { saldo_link: d.link, saldo_link_monto: d.monto });
        if (modo === "mail") A.toast("Correo enviado al cliente");
        if (modo === "wa") { win.location.href = A.wa(r.cliente_telefono, A.textoSaldo(r, d.link)); await A.actualizarReserva(r, {}, `Cobro del saldo ${clp(d.monto)} enviado por WhatsApp`); }
        if (modo === "copy") { await navigator.clipboard.writeText(d.link); A.toast("Link copiado"); }
        m.close(); alTerminar?.();
      } catch (e) { win?.close(); b.disabled = false; m.el.querySelector("#s-err").textContent = e.message; }
    }));
  };

  // ------------------------------------------------------------ plantillas de WhatsApp
  A.waTemplates = (r) => {
    const n = (r.cliente_nombre || "").split(" ")[0];
    const f = A.eventoLargo(A.fechaEv(r));
    const items = A.resumenItems(r);
    const list = [
      ["Saludo", `¡Hola ${n}! Te escribimos de Party House 🎉 por tu reserva ${r.codigo}.`],
      ["Reserva confirmada", `¡Hola ${n}! 🎉 Tu reserva ${r.codigo} para el ${f} está confirmada: ${items}.\nTotal ${clp(r.total)} · abono recibido ${clp(r.monto_pagado)} · saldo ${clp(A.saldo(r))} (se paga el día del evento, antes de instalar).\n¿Nos confirmas la dirección exacta, accesos y el horario en que podemos instalar?`],
      ["Coordinar instalación", `¡Hola ${n}! Te escribimos para coordinar la instalación de tu fiesta del ${f} 🎉. ¿A qué hora podemos llegar y hay algún acceso especial (estacionamiento, portón, escaleras)?`],
      ["Vamos en camino", `¡Hola ${n}! Vamos en camino a instalar tu Party House 🚚🎉. Recuerda tener listo el saldo de ${clp(A.saldo(r))}. ¡Nos vemos!`],
      ["Gracias / retiro", `¡Hola ${n}! Gracias por celebrar con Party House 🎉. Ya retiramos todo. Si te gustó, nos ayudas mucho etiquetándonos en Instagram @partyhouse_cl 🙌`],
    ];
    if (r.estado === "pagado" && r.garantia_estado === "pendiente" && r.garantia_monto > 0) {
      list.splice(2, 0, ["Pedir garantía", `¡Hola ${n}! Para dejar todo listo para tu evento del ${f} necesitamos la garantía reembolsable de ${clp(r.garantia_monto)} (te la devolvemos íntegra después del retiro si todo está en orden).${r.garantia_link ? `\nPuedes pagarla aquí: ${r.garantia_link}` : " Puedes transferirla y enviarnos el comprobante por aquí."}`]);
    }
    if (r.estado === "pagado" && !r.saldo_pagado_en && A.saldo(r) > 0) list.splice(2, 0, ["Cobrar saldo", A.textoSaldo(r, r.saldo_link && r.saldo_link_monto === A.saldo(r) ? r.saldo_link : null)]);
    if (r.garantia_estado === "pagada") list.push(["Garantía devuelta", `¡Hola ${n}! Te devolvimos la garantía de ${clp(r.garantia_monto)} de tu reserva ${r.codigo} 💸. ¡Gracias por preferirnos!`]);
    if (["pendiente", "rechazado"].includes(r.estado)) list.splice(1, 0, ["Recuperar reserva", `¡Hola ${n}! Vimos que tu reserva para el ${f} (${items}) quedó sin pagar. ¿Te ayudamos a completarla? La fecha aún no queda bloqueada hasta recibir el abono 🎉`]);
    return list;
  };

  // ------------------------------------------------------------ hoja de instalación (imprimir)
  A.imprimir = (rows) => {
    const w = window.open("", "_blank");
    if (!w) return A.toast("Permite las ventanas emergentes para imprimir", true);
    const base = location.href.replace(/admin\.html.*$/, "");
    const page = (r) => `<section>
      <header><img src="${base}assets/logo-dark.png" alt=""><div><h1>Hoja de instalación</h1><p>Party House · WhatsApp +56 9 4902 2463</p></div>
        <div class="num"><b>${esc(r.codigo)}</b><br>${esc(A.eventoLargo(A.fechaEv(r)))}</div></header>
      <div class="two"><div><h3>Cliente</h3><p><b>${esc(r.cliente_nombre)}</b>${r.cliente_rut ? ` · RUT ${esc(r.cliente_rut)}` : ""}<br>${esc(r.cliente_telefono)}<br>${esc(r.cliente_email || "")}</p></div>
        <div><h3>Lugar${r.horario ? ` · ${esc(r.horario)}` : ""}</h3><p><b>${esc(A.lugar(r))}</b>${r.notas ? `<br>${esc(r.notas)}` : ""}</p></div></div>
      ${r.notas_internas ? `<p class="note"><b>Notas internas:</b> ${esc(r.notas_internas)}</p>` : ""}
      <table><thead><tr><th>✓</th><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead><tbody>
      ${r.items.map((i) => `<tr><td class="box">☐</td><td>${esc(i.nombre)}</td><td class="c">${i.qty}</td><td class="r">${clp(i.precio * i.qty)}</td></tr>`).join("")}
      </tbody><tfoot>
      ${r.flete ? `<tr><td colspan="3" class="r">Flete y montaje</td><td class="r">${clp(r.flete)}</td></tr>` : ""}
      ${r.descuento ? `<tr><td colspan="3" class="r">Descuento</td><td class="r">-${clp(r.descuento)}</td></tr>` : ""}
      <tr class="t"><td colspan="3" class="r">Total</td><td class="r">${clp(r.total)}</td></tr>
      <tr><td colspan="3" class="r">Abono recibido</td><td class="r">${clp(r.monto_pagado)}</td></tr>
      <tr class="t"><td colspan="3" class="r">${r.saldo_pagado_en ? "Saldo (pagado)" : "SALDO A COBRAR"}</td><td class="r">${clp(r.saldo_pagado_en ? 0 : A.saldo(r))}</td></tr></tfoot></table>
      <p class="foot">Garantía: ${esc(A.GARANTIA[r.garantia_estado] || "")}${r.garantia_monto ? ` (${clp(r.garantia_monto)})` : ""} &nbsp;·&nbsp; Firma cliente: ______________________</p>
    </section>`;
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Instalación ${rows.map((r) => r.codigo).join(" ")}</title><style>
      body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:13px} section{padding:28px;page-break-after:always;max-width:780px;margin:auto}
      header{display:flex;gap:14px;align-items:center;border-bottom:2px solid #0c0a14;padding-bottom:12px;margin-bottom:14px} header img{height:48px}
      h1{margin:0;font-size:20px} header p{margin:2px 0 0;color:#555} .num{margin-left:auto;text-align:right;font-size:14px}
      .two{display:grid;grid-template-columns:1fr 1fr;gap:20px} h3{margin:0 0 4px;font-size:12px;text-transform:uppercase;color:#666} p{margin:0 0 10px}
      .note{background:#fff6dd;padding:8px 10px;border-radius:6px} table{width:100%;border-collapse:collapse;margin-top:10px} th,td{padding:7px 6px;border-bottom:1px solid #ddd;text-align:left}
      th{font-size:11px;text-transform:uppercase;color:#666} .r{text-align:right} .c{text-align:center} .box{font-size:16px;width:20px} tfoot td{border:0;padding:4px 6px} .t td{font-weight:bold;font-size:15px;border-top:2px solid #111}
      .foot{margin-top:22px;color:#333}
      </style></head><body>${rows.map(page).join("")}<script>window.onload=()=>{window.print()}<\/script></body></html>`);
    w.document.close();
  };

  // ------------------------------------------------------------ listado
  A.route("/reservas", (p, q) => (q.f === "no_pagadas" ? "no-pagadas" : "reservas"), async (_, query) => {
    const st = { tab: TABS.find((t) => t[0] === query.f) ? query.f : "proximas", q: query.q || "" };
    const all = await A.q(A.sb.from("reservas").select("*").order("creada", { ascending: false }).limit(3000));
    const visible = () => {
      const fn = TABS.find((t) => t[0] === st.tab)[2];
      const lista = all.filter((r) => fn(r) && (!st.q || A.match(`${r.codigo} ${r.cliente_nombre} ${r.cliente_email || ""} ${r.cliente_telefono} ${r.comuna} ${A.resumenItems(r)}`, st.q)));
      // Próximas y por instalar: por fecha del evento; el resto: más recientes primero
      if (["proximas", "por_instalar", "instaladas"].includes(st.tab)) lista.sort((a, b) => A.fechaEv(a).localeCompare(A.fechaEv(b)));
      return lista;
    };
    A.render(`<div class="page">
      ${A.head({ title: "Reservas", actions: `<button class="btn" id="r-equipo">👷 Enviar al equipo</button><button class="btn" id="r-print">🖨️ Imprimir hojas</button><button class="btn" id="r-csv">Exportar</button><a class="btn btn-orange" href="#/reservas/nueva">＋ Crear reserva</a>` })}
      <div class="card flush">
        <div class="tabs" id="r-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}<span class="c"></span></button>`).join("")}</div>
        <div class="toolbar"><div class="grow"><input id="r-q" type="search" placeholder="Buscar por código, cliente, teléfono, comuna o producto" value="${esc(st.q)}"></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Evento</th><th>Código</th><th>Cliente</th><th class="hide-sm">Productos</th><th class="num">Total</th><th>Estado</th><th class="hide-sm">Garantía</th></tr></thead><tbody id="r-body"></tbody></table></div>
      </div></div>`);
    function draw() {
      const rows = visible();
      $("#r-body").innerHTML = rows.length ? rows.map((r) => {
        const d = A.diasHasta(A.fechaEv(r));
        const cuando = d === 0 ? "Hoy" : d === 1 ? "Mañana" : d > 1 && d <= 14 ? `en ${d} días` : "";
        return `<tr class="click" data-c="${esc(r.codigo)}">
          <td class="nowrap"><b>${A.evento(A.fechaEv(r))}</b>${cuando ? `<br><small class="muted">${cuando}</small>` : ""}</td>
          <td class="nowrap"><span class="mono">${esc(r.codigo)}</span>${r.origen === "manual" ? ` <span title="Creada desde el panel">🧾</span>` : ""}</td>
          <td class="nowrap">${esc(r.cliente_nombre)}<br><small class="muted">${esc(r.comuna)}</small></td>
          <td class="hide-sm"><small>${esc(A.resumenItems(r))}</small></td>
          <td class="num"><b>${clp(r.total)}</b>${r.estado === "pagado" && !r.saldo_pagado_en && A.saldo(r) ? `<br><small class="muted">saldo ${clp(A.saldo(r))}</small>` : ""}</td>
          <td>${A.estadoBadge(r)} ${A.etapaBadge(r)}</td>
          <td class="hide-sm">${A.garantiaBadge(r)}</td></tr>`;
      }).join("") : `<tr><td colspan="7"><div class="empty-state"><div class="emo">📭</div><h3>No hay reservas aquí</h3><p>${st.q ? "Prueba con otra búsqueda." : "Prueba con otra pestaña o crea una reserva."}</p></div></td></tr>`;
      $$("#r-tabs button").forEach((b) => {
        b.classList.toggle("on", b.dataset.tab === st.tab);
        b.querySelector(".c").textContent = all.filter(TABS.find((t) => t[0] === b.dataset.tab)[2]).length;
      });
    }
    $("#r-tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { st.tab = b.dataset.tab; draw(); } };
    $("#r-q").oninput = A.debounce((e) => { st.q = e.target.value.trim(); draw(); }, 200);
    $("#r-body").onclick = (e) => { const tr = e.target.closest("tr[data-c]"); if (tr) A.go(`/reservas/${tr.dataset.c}`); };
    $("#r-equipo").onclick = () => { const rows = visible().filter((r) => r.estado === "pagado" && A.fechaEv(r) >= hoy()); rows.length ? A.enviarEquipo(rows) : A.toast("No hay eventos próximos confirmados en esta pestaña", true); };
    $("#r-print").onclick = () => { const rows = visible().filter((r) => r.estado === "pagado"); rows.length ? A.imprimir(rows) : A.toast("No hay reservas confirmadas en esta pestaña", true); };
    $("#r-csv").onclick = () => A.csv(`reservas-${hoy()}.csv`, [["Código", "Fecha evento", "Estado", "Etapa", "Origen", "Cliente", "RUT", "Teléfono", "Correo", "Comuna", "Productos", "Flete", "Descuento", "Total", "Abono recibido", "Saldo", "Saldo pagado", "Garantía", "Creada"],
      ...visible().map((r) => [r.codigo, A.fechaEv(r), A.ESTADO[r.estado] || r.estado, A.ETAPA[r.etapa] || "", r.origen, r.cliente_nombre, r.cliente_rut || "", r.cliente_telefono, r.cliente_email || "", r.comuna, A.resumenItems(r), r.flete, r.descuento, r.total, r.monto_pagado || 0, A.saldo(r), r.saldo_pagado_en ? "sí" : "no", A.GARANTIA[r.garantia_estado] || "", A.dayKey(r.creada)])]);
    draw();
  });

  // ------------------------------------------------------------ detalle
  A.route("/reservas/:codigo", (p) => (p.codigo === "nueva" ? "reservas-nueva" : "reservas"), async ({ codigo }, query) => {
    if (codigo === "nueva") return nueva(query || {});
    await A.loadCatalog();
    const r = await A.q(A.sb.from("reservas").select("*").eq("codigo", codigo).maybeSingle());
    if (!r) { A.render(`<div class="page"><div class="card empty-state"><div class="emo">🔎</div><h3>No encontramos la reserva ${esc(codigo)}</h3><a class="btn" href="#/reservas">Volver</a></div></div>`); return; }
    const draw = () => {
      const conf = r.estado === "pagado";
      const sub = r.items.reduce((s, i) => s + i.precio * i.qty, 0);
      const d = A.diasHasta(A.fechaEv(r));
      A.render(`<div class="page">
        ${A.head({ title: `<span class="mono">${esc(r.codigo)}</span>`, back: "/reservas", badges: ` ${A.estadoBadge(r)} ${A.etapaBadge(r)} ${A.garantiaBadge(r)}`,
          sub: `Evento: <b>${esc(A.eventoLargo(A.fechaEv(r)))}</b>${d >= 0 ? ` (${d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`})` : ""} · ${r.origen === "manual" ? "creada desde el panel" : "reservada en el sitio"} el ${A.date(r.creada)}`,
          actions: `${conf ? `<button class="btn" id="d-equipo">👷 Enviar al equipo</button>` : ""}<div class="dd"><button class="btn btn-green" id="d-wa">WhatsApp ▾</button><div class="dd-menu" id="d-wa-menu" hidden>${A.waTemplates(r).map(([l], i) => `<button data-wa="${i}">${esc(l)}</button>`).join("")}</div></div>
            <div class="dd"><button class="btn" id="d-more">Más acciones ▾</button><div class="dd-menu" id="d-more-menu" hidden>
              <button data-a="print">🖨️ Hoja de instalación</button>
              ${r.cliente_email && conf ? `<button data-a="mail">✉️ ${r.confirmacion_cliente_en ? "Reenviar" : "Enviar"} confirmación por correo</button>` : ""}
              ${conf ? `<button data-a="fecha">📅 Cambiar fecha</button>` : ""}
              ${["pendiente", "rechazado"].includes(r.estado) ? `<button data-a="confirmar">✅ Confirmar (pago recibido por otro medio)</button>` : ""}
              ${r.estado !== "cancelado" ? `<button data-a="cancelar" class="danger">Cancelar reserva</button>` : `<button data-a="reactivar">Reactivar reserva</button>`}
            </div></div>` })}
        ${["pendiente", "rechazado"].includes(r.estado) ? `<div class="banner warn"><div><b>Esta reserva no está confirmada</b>El cliente no completó el pago, así que la fecha no quedó bloqueada. Si pagó por otro medio, usa "Más acciones → Confirmar".</div></div>` : ""}
        <div class="cols">
          <div class="stack">
            <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h2>Productos</h2>${r.estado !== "cancelado" ? `<button class="btn btn-sm" id="d-items">✏️ Editar productos y flete</button>` : ""}</div>
              <div class="tbl-wrap"><table class="tbl"><tbody>${r.items.map((i) => { const p = A.prod(i.id); return `<tr>
                <td><div class="pcell">${A.thumb(p?.imagenes?.[0], A.catEmoji(p?.categoria))}<div><b>${esc(i.nombre)}</b><small class="muted">${esc(p?.tamano || "")}</small></div></div></td>
                <td class="num">${clp(i.precio)} × ${i.qty}</td><td class="num"><b>${clp(i.precio * i.qty)}</b></td></tr>`; }).join("")}</tbody></table></div>
              <div style="padding:12px 16px 16px"><dl class="kv">
                <dt>Productos</dt><dd>${clp(sub)}</dd>
                <dt>Flete y montaje (${esc(r.comuna)})</dt><dd>${r.flete ? clp(r.flete) : "Incluido"}</dd>
                ${r.descuento ? `<dt>Descuento</dt><dd>-${clp(r.descuento)}</dd>` : ""}
                <dt><b>Total</b></dt><dd><b>${clp(r.total)}</b></dd>
              </dl></div></div>

            ${conf ? `<div class="card"><div class="card-head"><h2>Instalación</h2>${A.etapaBadge(r)}</div>
              <p class="muted" style="margin-top:0">${{ por_instalar: "Aún no se instala. Márcala cuando quede todo armado.", instalada: "Instalada. Márcala como retirada cuando vuelva todo.", retirada: "Evento terminado: todo retirado." }[r.etapa]}</p>
              <div class="btn-group">
                ${r.etapa === "por_instalar" ? `<button class="btn btn-primary" data-etapa="instalada">✓ Marcar instalada</button>` : ""}
                ${r.etapa === "instalada" ? `<button class="btn btn-primary" data-etapa="retirada">✓ Marcar retirada</button><button class="btn btn-plain" data-etapa="por_instalar">Deshacer</button>` : ""}
                ${r.etapa === "retirada" ? `<button class="btn btn-plain" data-etapa="instalada">Deshacer</button>` : ""}
              </div></div>` : ""}

            ${conf ? `<div class="card"><div class="card-head"><h2>Pagos</h2>${A.saldoBadge(r)}</div>
              <dl class="kv">
                <dt>Abono recibido</dt><dd><b>${clp(r.monto_pagado || 0)}</b> <small class="muted">· ${esc(A.MEDIO[r.abono_medio] || r.abono_medio)}${r.mp_payment_id ? ` #${esc(r.mp_payment_id)}` : ""}</small></dd>
                <dt>Saldo</dt><dd>${r.saldo_pagado_en ? `Pagado el ${A.date(r.saldo_pagado_en)} · ${esc(A.MEDIO[r.saldo_medio] || r.saldo_medio || "")}${r.saldo_payment_id ? ` #${esc(r.saldo_payment_id)}` : ""}` : `<b>${clp(A.saldo(r))}</b> por cobrar`}</dd>
                ${!r.saldo_pagado_en && r.saldo_link ? `<dt>Link de pago enviado</dt><dd><a href="${esc(r.saldo_link)}" target="_blank" rel="noopener">Mercado Pago · ${clp(r.saldo_link_monto)}</a></dd>` : ""}
              </dl>
              <div class="btn-group" style="margin-top:12px">
                ${!r.saldo_pagado_en && A.saldo(r) > 0 ? `<button class="btn btn-orange" id="p-cobrar">💳 Cobrar saldo al cliente</button><button class="btn btn-primary" id="p-saldo">Registrar pago del saldo</button>` : ""}
                ${r.saldo_pagado_en ? `<button class="btn btn-plain" id="p-saldo-undo">Deshacer pago del saldo</button>` : ""}
                ${r.origen === "manual" ? `<button class="btn btn-plain" id="p-abono">Editar abono recibido</button>` : ""}
              </div></div>` : ""}

            ${conf && r.garantia_estado !== "no_aplica" ? `<div class="card"><div class="card-head"><h2>Garantía reembolsable</h2>${A.garantiaBadge(r)}</div>
              <dl class="kv">
                <dt>Monto</dt><dd>${clp(r.garantia_monto)}</dd>
                <dt>Correos enviados</dt><dd>${r.garantia_avisos || 0}${r.garantia_ultimo_aviso ? ` · último ${A.evento(r.garantia_ultimo_aviso)}` : ""}${!r.cliente_email ? " · <span class='muted'>sin correo: no recibe recordatorios</span>" : ""}</dd>
                ${r.garantia_pagada_en ? `<dt>Pagada</dt><dd>${A.date(r.garantia_pagada_en)}${r.garantia_payment_id ? ` · MP #${esc(r.garantia_payment_id)}` : " · manual"}</dd>` : ""}
              </dl>
              <div class="btn-group" style="margin-top:12px">
                ${r.garantia_estado === "pendiente" ? `<button class="btn btn-primary" data-g="pagada">Marcar pagada (transferencia/efectivo)</button>` : ""}
                ${r.garantia_estado === "pagada" ? `<button class="btn btn-primary" data-g="devuelta">Marcar devuelta</button>` : ""}
                ${r.garantia_link && r.garantia_estado === "pendiente" ? `<button class="btn" id="g-link">Copiar link de pago</button>` : ""}
                ${r.garantia_estado === "pendiente" ? `<button class="btn btn-plain" data-g="no_aplica">No cobrar garantía</button>` : ""}
                ${r.garantia_estado !== "pendiente" ? `<button class="btn btn-plain" data-g="pendiente">Volver a pendiente</button>` : ""}
              </div>
              ${r.garantia_estado === "pagada" && r.garantia_payment_id ? `<p class="help" style="margin-bottom:0">Pagada con Mercado Pago: para devolverla, reembolsa el pago #${esc(r.garantia_payment_id)} desde tu panel de Mercado Pago (el sistema lo registra y avisa al cliente).</p>` : ""}
            </div>` : ""}

            <div class="card"><div class="card-head"><h2>Historial</h2></div>
              <form id="h-form" style="display:flex;gap:8px;margin-bottom:12px"><input name="t" placeholder="Agregar un comentario para el equipo…"><button class="btn">Agregar</button></form>
              ${[...(r.historial || [])].reverse().map((h) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${esc(h.txt)}</b><br><small class="muted">${A.dateTime(h.t)}${h.por ? ` · ${esc(h.por)}` : ""}</small></div>`).join("") || `<p class="muted">Sin movimientos registrados.</p>`}
              <div style="padding:8px 0;border-top:1px solid var(--line)"><b>Reserva creada</b><br><small class="muted">${A.dateTime(r.creada)}</small></div>
            </div>
          </div>

          <div class="stack">
            <div class="card"><div class="card-head"><h2>Cliente</h2><a class="btn btn-sm" href="#/clientes/${encodeURIComponent(A.claveCliente(r))}">Ver</a></div>
              <p style="margin:0 0 6px"><b>${esc(r.cliente_nombre)}</b></p>
              <p style="margin:0 0 6px"><a href="${A.wa(r.cliente_telefono)}" target="_blank" rel="noopener">📱 ${esc(r.cliente_telefono)}</a></p>
              ${r.cliente_email ? `<p style="margin:0 0 6px"><a href="mailto:${esc(r.cliente_email)}">✉️ ${esc(r.cliente_email)}</a></p>` : `<p class="muted" style="margin:0 0 6px">Sin correo</p>`}
              ${r.cliente_rut ? `<p style="margin:0 0 6px">🪪 RUT ${esc(r.cliente_rut)}</p>` : ""}
              <p style="margin:0 0 6px">📍 ${esc(A.lugar(r))} · <a href="${A.mapa(r)}" target="_blank" rel="noopener">Mapa</a></p>
              <p style="margin:0">⏰ ${r.horario ? esc(r.horario) : `<span class="muted">Horario por coordinar</span>`}</p>
              ${r.notas ? `<div class="sep"></div><p class="small" style="margin:0"><b>Comentario del cliente:</b><br>${esc(r.notas)}</p>` : ""}
              <div class="sep"></div><button class="btn btn-sm btn-plain" id="c-edit">Editar cliente, dirección y horario</button>
            </div>
            <div class="card"><h2 style="margin-bottom:8px">Notas internas</h2>
              <textarea id="n-int" rows="4" placeholder="Dirección exacta, accesos, horario de instalación… (solo el equipo las ve)">${esc(r.notas_internas || "")}</textarea>
              <button class="btn btn-sm" id="n-save" style="margin-top:8px">Guardar notas</button></div>
          </div>
        </div></div>`);
      bind();
    };

    const guardar = async (cambios, txt, ok = "Guardado") => {
      try { await A.actualizarReserva(r, cambios, txt); A.toast(ok); A.refreshBadges(); draw(); } catch (e) { A.fail(e); }
    };
    function bind() {
      A.dropdown($("#d-wa"), $("#d-wa-menu"));
      $("#d-equipo")?.addEventListener("click", () => A.enviarEquipo([r]));
      $("#d-items")?.addEventListener("click", editarProductos);
      $("#p-cobrar")?.addEventListener("click", () => A.cobrarSaldo(r, draw));
      A.dropdown($("#d-more"), $("#d-more-menu"));
      $("#d-wa-menu").onclick = (e) => { const b = e.target.closest("[data-wa]"); if (b) window.open(A.wa(r.cliente_telefono, A.waTemplates(r)[+b.dataset.wa][1]), "_blank", "noopener"); };
      $("#d-more-menu").onclick = async (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "print") A.imprimir([r]);
        if (a === "mail") {
          const { data: { session } } = await A.sb.auth.getSession();
          try {
            const resp = await fetch(A.CFG.PAGOS_URL + "/confirmar", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ codigo: r.codigo, reenviar: !!r.confirmacion_cliente_en }) });
            if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || "No se pudo enviar");
            await A.actualizarReserva(r, {}, `Confirmación enviada por correo a ${r.cliente_email}`);
            A.toast("Confirmación enviada"); draw();
          } catch (err) { A.fail(err); }
        }
        if (a === "fecha") cambiarFecha();
        if (a === "confirmar") {
          const v = await A.ask({ title: "Confirmar reserva", intro: "La fecha quedará bloqueada y la reserva entra a los recordatorios de garantía.", ok: "Confirmar", fields: [
            { name: "monto", label: "Abono recibido", type: "number", value: r.abono, required: true },
            { name: "medio", label: "Medio", type: "select", value: "transferencia", options: Object.entries(A.MEDIO) }] });
          if (!v) return;
          const libre = await disponible(A.fechaEv(r));
          if (libre !== true && !(await A.confirm({ title: "Fecha ocupada", message: libre + "<br><br>¿Confirmar de todos modos?", ok: "Confirmar igual", danger: true }))) return;
          guardar({ estado: "pagado", monto_pagado: A.int(v.monto), abono_medio: v.medio, pagada_en: new Date().toISOString() }, `Reserva confirmada manualmente · abono ${clp(A.int(v.monto))} (${A.MEDIO[v.medio]})`, "Reserva confirmada");
        }
        if (a === "cancelar" && await A.confirm({ title: "Cancelar reserva", message: `La fecha quedará libre para otros clientes.${r.mp_payment_id ? "<br><br>Si corresponde devolver el abono, reembólsalo desde tu panel de Mercado Pago." : ""}`, ok: "Cancelar reserva", danger: true }))
          guardar({ estado: "cancelado" }, "Reserva cancelada", "Reserva cancelada");
        if (a === "reactivar" && await A.confirm({ title: "Reactivar reserva", message: "Vuelve a quedar confirmada y bloquea la fecha.", ok: "Reactivar" }))
          guardar({ estado: "pagado" }, "Reserva reactivada");
      };
      $$("[data-etapa]").forEach((b) => (b.onclick = () => guardar({ etapa: b.dataset.etapa }, `Etapa: ${A.ETAPA[b.dataset.etapa]}`)));
      $$("[data-g]").forEach((b) => (b.onclick = async () => {
        const g = b.dataset.g;
        if (g === "no_aplica" && !(await A.confirm({ title: "No cobrar garantía", message: "No se enviarán más recordatorios para esta reserva.", ok: "No cobrar" }))) return;
        guardar({ garantia_estado: g, ...(g === "pagada" ? { garantia_pagada_en: new Date().toISOString() } : {}) }, `Garantía: ${A.GARANTIA[g]}`);
      }));
      $("#g-link")?.addEventListener("click", () => navigator.clipboard.writeText(r.garantia_link).then(() => A.toast("Link copiado")));
      $("#p-saldo")?.addEventListener("click", async () => {
        const v = await A.ask({ title: "Pago del saldo", intro: `Saldo a cobrar: <b>${clp(A.saldo(r))}</b>`, ok: "Registrar", fields: [{ name: "medio", label: "Medio de pago", type: "select", value: "transferencia", options: Object.entries(A.MEDIO).filter(([k]) => k !== "mercadopago") }] });
        if (v) guardar({ saldo_pagado_en: new Date().toISOString(), saldo_medio: v.medio }, `Saldo ${clp(A.saldo(r))} pagado (${A.MEDIO[v.medio]})`, "Saldo registrado");
      });
      $("#p-saldo-undo")?.addEventListener("click", () => guardar({ saldo_pagado_en: null, saldo_medio: null }, "Pago del saldo deshecho"));
      $("#p-abono")?.addEventListener("click", async () => {
        const v = await A.ask({ title: "Abono recibido", ok: "Guardar", fields: [
          { name: "monto", label: "Monto", type: "number", value: r.monto_pagado || 0, required: true },
          { name: "medio", label: "Medio", type: "select", value: r.abono_medio, options: Object.entries(A.MEDIO) }] });
        if (v) guardar({ monto_pagado: A.int(v.monto), abono_medio: v.medio }, `Abono actualizado: ${clp(A.int(v.monto))} (${A.MEDIO[v.medio]})`);
      });
      $("#h-form").onsubmit = (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (t) guardar({}, `💬 ${t}`, "Comentario agregado"); };
      $("#n-save").onclick = () => guardar({ notas_internas: $("#n-int").value.trim() || null }, "Notas internas actualizadas");
      $("#c-edit").onclick = async () => {
        const v = await A.ask({ title: "Datos del cliente", ok: "Guardar", fields: [
          { name: "nombre", label: "Nombre", value: r.cliente_nombre, required: true },
          { name: "telefono", label: "Teléfono", type: "tel", value: r.cliente_telefono, required: true },
          { name: "email", label: "Correo", type: "email", value: r.cliente_email || "", help: "Sin correo no recibe confirmaciones ni recordatorios de garantía" },
          { name: "rut", label: "RUT (opcional)", value: r.cliente_rut || "", placeholder: "12.345.678-9" },
          { name: "direccion", label: "Dirección del evento", value: r.direccion || "", placeholder: "Calle, número, casa/depto" },
          { name: "comuna", label: "Comuna", type: "select", value: r.comuna || "", options: [...A.state.comunas.filter((c) => c.activa).map((c) => [c.nombre, `${c.nombre} · ${clp(c.valor)}`]), ...(r.comuna && !A.state.comunas.some((c) => c.nombre === r.comuna && c.activa) ? [[r.comuna, `${r.comuna} (sin tarifa)`]] : [])], help: "Si cambias la comuna, el flete y el total se recalculan solos" },
          { name: "horario", label: "Horario de instalación", value: r.horario || "", placeholder: "Ej: 15:00 o 12:00-14:00" },
          { name: "notas", label: "Comentario del cliente", type: "textarea", value: r.notas || "" }] });
        if (v && v.rut.trim() && !A.rut(v.rut)) return A.toast("El RUT no es válido", "error");
        if (!v) return;
        const cambios = { cliente_nombre: v.nombre, cliente_telefono: v.telefono, cliente_email: v.email.toLowerCase() || null, cliente_rut: A.rut(v.rut) || null, direccion: v.direccion || null, comuna: v.comuna || r.comuna, horario: v.horario || null, notas: v.notas || null };
        let txt = "Datos del cliente actualizados";
        const flete = cambios.comuna !== r.comuna ? A.fleteAuto(cambios.comuna, r.items.map((i) => i.id)) : null;
        if (flete != null && flete !== r.flete) {
          const total = r.items.reduce((s, i) => s + i.precio * i.qty, 0) + flete - (r.descuento || 0);
          if (total > 0) { Object.assign(cambios, { flete, total }); txt += ` · comuna ${cambios.comuna}: flete ${clp(r.flete)} → ${clp(flete)}, total ${clp(r.total)} → ${clp(total)}`; }
        }
        guardar(cambios, txt);
      };
    }

    // Editar productos, cantidades, precios, comuna, flete y descuento de la reserva
    async function editarProductos() {
      await A.loadCatalog();
      const fecha = A.fechaEv(r);
      const st = { lineas: r.items.map((i) => ({ id: i.id, nombre: i.nombre, qty: i.qty, precio: i.precio, manual: A.esManual(i.id) })), oc: null };
      const m = A.modal({ title: "Productos del evento", wide: true, body: `
        <div class="row2"><label class="f">Comuna<select name="comuna">${A.optsComuna(r.comuna)}</select></label>
          <label class="f" id="e-otra" hidden>Nombre de la comuna<input name="comuna_otra" placeholder="Ej: Pirque"></label></div>
        <div class="card-head" style="margin:4px 0 8px"><h3 style="margin:0">Productos</h3><div class="btn-group"><button type="button" class="btn btn-sm" id="e-add">＋ Agregar producto</button><button type="button" class="btn btn-sm" id="e-add-m">✍️ Producto manual</button></div></div>
        <div id="e-lineas"></div>
        <div class="row2" style="margin-top:8px"><label class="f">Flete y montaje<div class="prefix"><span>$</span><input name="flete" type="number" min="0" value="${r.flete || 0}"></div><small id="e-flete-help"></small></label>
          <label class="f">Descuento<div class="prefix"><span>$</span><input name="descuento" type="number" min="0" value="${r.descuento || 0}"></div></label></div>
        <dl class="kv" id="e-tot"></dl><p class="form-error" id="e-err"></p>`,
        foot: `<button class="btn" data-x>Cancelar</button><button class="btn btn-primary" id="e-ok">Guardar cambios</button>` });
      const el = m.el, q = (s) => el.querySelector(s);
      const comunaSel = () => q("[name=comuna]").value === "__otra" ? q("[name=comuna_otra]").value.trim() : q("[name=comuna]").value;
      const ids = () => st.lineas.filter((l) => l.id).map((l) => l.id);
      const opts = A.optsProd(st.lineas.filter((l) => !l.manual));
      const calc = () => {
        const sub = st.lineas.reduce((s, l) => s + (l.id ? (l.precio || 0) * l.qty : 0), 0);
        const flete = A.int(q("[name=flete]").value) || 0, desc = A.int(q("[name=descuento]").value) || 0;
        return { sub, flete, desc, total: sub + flete - desc };
      };
      const totales = () => {
        q("#e-err").textContent = "";
        const auto = A.fleteAuto(comunaSel(), ids());
        q("#e-flete-help").textContent = auto != null ? `Según la comuna: ${clp(auto)}` : comunaSel() ? "Esta comuna no tiene tarifa: escríbelo a mano" : "";
        const t = calc(), pagado = r.monto_pagado || 0;
        q("#e-tot").innerHTML = `<dt>Productos</dt><dd>${clp(t.sub)}</dd><dt>Flete y montaje</dt><dd>${clp(t.flete)}</dd>
          ${t.desc ? `<dt>Descuento</dt><dd>-${clp(t.desc)}</dd>` : ""}
          <dt><b>Nuevo total</b></dt><dd><b>${clp(t.total)}</b>${t.total !== r.total ? ` <small class="muted">(antes ${clp(r.total)})</small>` : ""}</dd>
          <dt>Ya pagado</dt><dd>${clp(pagado)}</dd><dt>Saldo</dt><dd><b>${clp(Math.max(t.total - pagado, 0))}</b></dd>`;
      };
      const drawLineas = () => {
        q("#e-lineas").innerHTML = st.lineas.map((l, i) => {
          const oc = st.oc && l.id ? st.oc.ocupados[l.id] : null;
          return `<div class="linea-prod" data-i="${i}">
            ${A.esManual(l.id) ? `<input data-k="nombre" value="${esc(l.nombre || "")}" placeholder="Nombre del producto o servicio" aria-label="Nombre" maxlength="120">` : `<select data-k="id">${opts.replace(`value="${esc(l.id)}"`, `value="${esc(l.id)}" selected`)}</select>`}
            <input data-k="qty" type="number" min="1" value="${l.qty}" aria-label="Cantidad">
            <div class="prefix"><span>$</span><input data-k="precio" type="number" min="0" value="${l.id && l.precio != null ? l.precio : ""}" placeholder="Precio" aria-label="Precio unitario"></div>
            <button type="button" class="btn btn-plain danger" data-del="${i}" aria-label="Quitar">✕</button>
            ${oc ? `<small style="grid-column:1/-1;color:var(--red);font-weight:700;margin-top:-4px">⚠ Ocupado ese día: ${esc(oc)}</small>` : ""}
          </div>`;
        }).join("");
        totales();
      };
      const fleteAuto = () => { const a = A.fleteAuto(comunaSel(), ids()); if (a != null) q("[name=flete]").value = a; totales(); };
      q("#e-add").onclick = () => { st.lineas.push({ id: "", qty: 1, precio: 0 }); drawLineas(); };
      q("#e-add-m").onclick = () => { st.lineas.push(A.lineaManual()); drawLineas(); fleteAuto(); q("#e-lineas .linea-prod:last-child [data-k=nombre]").focus(); };
      q("#e-lineas").addEventListener("change", (e) => {
        const row = e.target.closest("[data-i]"); if (!row) return;
        const l = st.lineas[+row.dataset.i], k = e.target.dataset.k;
        if (k === "id") { const p = A.prod(e.target.value); l.id = e.target.value; l.nombre = p?.nombre || l.nombre; l.precio = p?.precio ?? 0; drawLineas(); fleteAuto(); return; }
        if (k === "nombre") l.nombre = e.target.value.trim();
        if (k === "qty") l.qty = Math.max(1, A.int(e.target.value) || 1);
        if (k === "precio") l.precio = Math.max(0, A.int(e.target.value) || 0);
        totales();
      });
      q("#e-lineas").addEventListener("input", (e) => { if (e.target.dataset.k === "nombre") st.lineas[+e.target.closest("[data-i]").dataset.i].nombre = e.target.value.trim(); });
      q("#e-lineas").addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { st.lineas.splice(+d.dataset.del, 1); drawLineas(); fleteAuto(); } });
      q("[name=comuna]").onchange = () => { q("#e-otra").hidden = q("[name=comuna]").value !== "__otra"; fleteAuto(); };
      ["flete", "descuento"].forEach((n) => (q(`[name=${n}]`).oninput = totales));
      drawLineas();
      A.ocupacionDia(fecha, r.codigo).then((oc) => { st.oc = oc; if (el.isConnected) drawLineas(); }).catch(() => {});

      q("#e-ok").onclick = async () => {
        const err = (t) => { q("#e-err").textContent = t; };
        const lineas = st.lineas.filter((l) => l.id);
        if (!lineas.length) return err("La reserva debe tener al menos un producto");
        if (lineas.some((l) => l.manual && !l.nombre)) return err("Escribe el nombre del producto manual");
        if (lineas.some((l) => l.manual && l.precio == null)) return err("Indica el precio del producto manual");
        if (!comunaSel()) return err("Indica la comuna");
        const t = calc();
        if (t.total <= 0) return err("El total debe ser mayor a $0");
        const malos = st.oc ? lineas.filter((l) => st.oc.ocupados[l.id] && !r.items.some((i) => i.id === l.id)) : [];
        if (r.estado === "pagado" && malos.length && !(await A.confirm({ title: "Producto ocupado", message: `No disponible ese día: ${esc(malos.map((l) => `${l.nombre} (${st.oc.ocupados[l.id]})`).join(", "))}.<br><br>¿Guardar de todos modos?`, ok: "Guardar igual", danger: true }))) return;
        const items = lineas.map((l) => ({ id: l.id, nombre: A.prod(l.id)?.nombre || l.nombre, qty: l.qty, fecha, precio: l.precio || 0, ...(l.manual ? { manual: true } : {}) }));
        const resumen = (xs) => xs.map((i) => `${i.qty}× ${i.nombre} ${i.precio}`).join(", ");
        const partes = [];
        if (resumen(items) !== resumen(r.items)) partes.push(`productos: ${items.map((i) => `${i.qty}× ${i.nombre}`).join(", ")}`);
        if (comunaSel() !== r.comuna) partes.push(`comuna ${r.comuna} → ${comunaSel()}`);
        if (t.flete !== (r.flete || 0)) partes.push(`flete ${clp(r.flete || 0)} → ${clp(t.flete)}`);
        if (t.desc !== (r.descuento || 0)) partes.push(`descuento ${clp(t.desc)}`);
        if (!partes.length) return m.close();
        partes.push(`total ${clp(r.total)} → ${clp(t.total)}`);
        q("#e-ok").disabled = true;
        try {
          await A.actualizarReserva(r, { items, comuna: comunaSel(), flete: t.flete, descuento: t.desc, total: t.total }, `Reserva editada · ${partes.join(" · ")}`);
          m.close(); A.toast("Reserva actualizada"); A.refreshBadges(); draw();
        } catch (e) { q("#e-ok").disabled = false; A.fail(e); }
      };
    }

    // Revisa que todos los productos de la reserva estén libres en la fecha. true o texto con el problema.
    async function disponible(fecha) {
      const oc = await A.ocupacionDia(fecha, r.codigo);
      if (oc.cerrado) return "Ese día está marcado como cerrado.";
      const malos = r.items.filter((i) => oc.ocupados[i.id]).map((i) => `${i.nombre} (${oc.ocupados[i.id]})`);
      return malos.length ? `No disponible: ${esc(malos.join(", "))}.` : true;
    }
    async function cambiarFecha() {
      const v = await A.ask({ title: "Cambiar fecha del evento", ok: "Cambiar", fields: [{ name: "f", label: "Nueva fecha", type: "date", value: A.fechaEv(r), required: true }] });
      if (!v || v.f === A.fechaEv(r)) return;
      const libre = await disponible(v.f);
      if (libre !== true && !(await A.confirm({ title: "Fecha ocupada", message: libre + "<br><br>¿Cambiar de todos modos?", ok: "Cambiar igual", danger: true }))) return;
      guardar({ fechas: [v.f], items: r.items.map((i) => ({ ...i, fecha: v.f })), garantia_ultimo_aviso: null }, `Fecha cambiada: ${A.evento(A.fechaEv(r))} → ${A.evento(v.f)}`, "Fecha cambiada");
    }
    draw();
  });

  // ------------------------------------------------------------ crear reserva manual
  async function nueva(query) {
    await Promise.all([A.loadCatalog(), A.loadAjustes()]);
    const prods = A.state.productos.filter((p) => p.activo);
    const st = { lineas: [{ id: "", qty: 1, precio: null }], oc: null };
    const optsProd = A.optsProd();
    A.render(`<div class="page narrow">
      ${A.head({ title: "Crear reserva", back: "/reservas", sub: "Para reservas cerradas por WhatsApp, teléfono o en persona. Queda confirmada, bloquea la fecha y entra a los recordatorios de garantía." })}
      <form id="nv" class="stack">
        <div class="card"><h2 style="margin-bottom:12px">Evento</h2>
          <div class="row2"><label class="f">Fecha del evento<input type="date" name="fecha" required></label>
            <label class="f">Comuna<select name="comuna"><option value="">Elige…</option>${A.state.comunas.filter((c) => c.activa).map((c) => `<option value="${esc(c.nombre)}">${esc(c.nombre)} · ${clp(c.valor)}</option>`).join("")}<option value="__otra">Otra (escribir)</option></select></label></div>
          <label class="f" id="otra-wrap" hidden>Nombre de la comuna<input name="comuna_otra" placeholder="Ej: Pirque"></label>
          <div class="row2"><label class="f">Dirección del evento<input name="direccion" required minlength="5" placeholder="Calle, número, casa/depto"></label>
            <label class="f">Horario de instalación<input name="horario" placeholder="Ej: 15:00"></label></div>
          <p class="help" id="dia-info" style="margin:-4px 0 0"></p>
        </div>
        <div class="card"><div class="card-head"><h2>Productos</h2><div class="btn-group"><button type="button" class="btn btn-sm" id="add-l">＋ Agregar producto</button><button type="button" class="btn btn-sm" id="add-m">✍️ Producto manual</button></div></div>
          <div id="lineas"></div></div>
        <div class="card"><h2 style="margin-bottom:12px">Cliente</h2>
          <div class="row2"><label class="f">Nombre<input name="nombre" required></label><label class="f">Teléfono / WhatsApp<input name="telefono" type="tel" required placeholder="+56 9 …"></label></div>
          <div class="row2"><label class="f">Correo <small>(opcional; sin correo no recibe confirmación ni recordatorios de garantía)</small><input name="email" type="email"></label>
            <label class="f">RUT <small>(opcional)</small><input name="rut" placeholder="12.345.678-9" maxlength="12"></label></div>
          <label class="f">Comentario del cliente<textarea name="notas" rows="2" placeholder="Accesos, estacionamiento, detalles del evento…"></textarea></label>
          <label class="f">Notas internas<textarea name="notas_internas" rows="2" placeholder="Solo las ve el equipo"></textarea></label>
        </div>
        <div class="card"><h2 style="margin-bottom:12px">Pago</h2>
          <div class="row2"><label class="f">Flete y montaje<div class="prefix"><span>$</span><input name="flete" type="number" min="0" placeholder="elige la comuna"></div><small id="flete-help"></small></label>
            <label class="f">Descuento<div class="prefix"><span>$</span><input name="descuento" type="number" min="0" value="0"></div></label></div>
          <div class="row2"><label class="f">Abono recibido<div class="prefix"><span>$</span><input name="abono_pagado" type="number" min="0" value="0"></div><small id="abono-help"></small></label>
            <label class="f">Medio del abono<select name="abono_medio">${Object.entries(A.MEDIO).map(([k, l]) => `<option value="${k}" ${k === "transferencia" ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
          <label class="check"><input type="checkbox" name="garantia" checked> Cobrar garantía reembolsable de ${clp(A.state.ajustes.garantia_monto)} (se pide por correo ${A.state.ajustes.recordatorio_dias} días antes)</label>
          <label class="check"><input type="checkbox" name="forzar"> Crear aunque la fecha aparezca ocupada</label>
          <div class="sep"></div>
          <dl class="kv" id="tot"></dl>
          <p class="form-error" id="nv-err"></p>
          <button class="btn btn-orange" style="width:100%;padding:12px;margin-top:8px">Crear reserva</button>
        </div>
      </form></div>`);
    const f = $("#nv");

    const comunaSel = () => f.comuna.value === "__otra" ? f.comuna_otra.value.trim() : f.comuna.value;
    const fleteAuto = () => A.fleteAuto(f.comuna.value, st.lineas.filter((l) => l.id).map((l) => l.id));
    // Al elegir comuna (o cambiar productos) el flete se completa solo; se puede sobrescribir a mano
    const rellenarFlete = () => { const a = fleteAuto(); f.flete.value = a != null ? a : ""; totales(); };
    function drawLineas() {
      $("#lineas").innerHTML = st.lineas.map((l, i) => {
        const p = A.prod(l.id);
        const oc = st.oc && l.id ? st.oc.ocupados[l.id] : null;
        return `<div class="linea-prod" data-i="${i}">
          ${A.esManual(l.id) ? `<input data-k="nombre" value="${esc(l.nombre || "")}" placeholder="Nombre del producto o servicio" aria-label="Nombre" maxlength="120">` : `<select data-k="id">${optsProd.replace(`value="${esc(l.id)}"`, `value="${esc(l.id)}" selected`)}</select>`}
          <input data-k="qty" type="number" min="1" value="${l.qty}" aria-label="Cantidad">
          <div class="prefix"><span>$</span><input data-k="precio" type="number" min="0" value="${l.precio ?? p?.precio ?? ""}" placeholder="Precio" aria-label="Precio unitario"></div>
          <button type="button" class="btn btn-plain danger" data-del="${i}" aria-label="Quitar">✕</button>
          ${oc ? `<small style="grid-column:1/-1;color:var(--red);font-weight:700;margin-top:-4px">⚠ Ocupado ese día: ${esc(oc)}</small>` : ""}
        </div>`;
      }).join("");
      totales();
    }
    function totales() {
      const sub = st.lineas.reduce((s, l) => s + (l.id ? (l.precio ?? A.prod(l.id)?.precio ?? 0) * l.qty : 0), 0);
      const auto = fleteAuto();
      const flete = f.flete.value !== "" ? A.int(f.flete.value) : auto;
      $("#flete-help").textContent = auto != null ? `Según la comuna: ${clp(auto)}` : f.comuna.value ? "Escribe el flete para esta comuna" : "";
      const total = Math.max(sub + (flete || 0) - (A.int(f.descuento.value) || 0), 0);
      const abono = Math.round(total * A.state.ajustes.abono_pct / 100);
      $("#abono-help").textContent = total ? `Abono sugerido (${A.state.ajustes.abono_pct}%): ${clp(abono)}` : "";
      $("#tot").innerHTML = `<dt>Productos</dt><dd>${clp(sub)}</dd><dt>Flete y montaje</dt><dd>${flete == null ? "—" : clp(flete)}</dd>
        ${A.int(f.descuento.value) ? `<dt>Descuento</dt><dd>-${clp(A.int(f.descuento.value))}</dd>` : ""}
        <dt><b>Total</b></dt><dd><b>${clp(total)}</b></dd><dt>Saldo el día del evento</dt><dd>${clp(Math.max(total - (A.int(f.abono_pagado.value) || 0), 0))}</dd>`;
    }
    async function revisarDia() {
      st.oc = null;
      const fecha = f.fecha.value;
      if (!fecha) { $("#dia-info").textContent = ""; return drawLineas(); }
      st.oc = await A.ocupacionDia(fecha);
      const n = Object.keys(st.oc.ocupados).length;
      $("#dia-info").innerHTML = st.oc.cerrado ? `<b style="color:var(--red)">⚠ Ese día está marcado como cerrado.</b>`
        : `${A.eventoLargo(fecha)} · ${n ? `${n} producto(s) ya ocupados ese día` : "todo disponible"}`;
      drawLineas();
    }

    $("#add-l").onclick = () => { st.lineas.push({ id: "", qty: 1, precio: null }); drawLineas(); };
    $("#add-m").onclick = () => {
      if (st.lineas.length === 1 && !st.lineas[0].id) st.lineas.pop();  // reemplaza la línea vacía inicial
      st.lineas.push(A.lineaManual()); drawLineas(); rellenarFlete(); $("#lineas .linea-prod:last-child [data-k=nombre]").focus();
    };
    $("#lineas").addEventListener("input", (e) => { if (e.target.dataset.k === "nombre") st.lineas[+e.target.closest("[data-i]").dataset.i].nombre = e.target.value.trim(); });
    $("#lineas").addEventListener("change", (e) => {
      const row = e.target.closest("[data-i]"); if (!row) return;
      const l = st.lineas[+row.dataset.i], k = e.target.dataset.k;
      if (k === "id") { l.id = e.target.value; l.precio = null; drawLineas(); rellenarFlete(); return; }
      if (k === "nombre") l.nombre = e.target.value.trim();
      if (k === "qty") l.qty = Math.max(1, A.int(e.target.value) || 1);
      if (k === "precio") l.precio = e.target.value === "" ? null : A.int(e.target.value);
      totales();
    });
    $("#lineas").addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { st.lineas.splice(+d.dataset.del, 1); if (!st.lineas.length) st.lineas.push({ id: "", qty: 1, precio: null }); drawLineas(); } });
    f.fecha.onchange = revisarDia;
    f.comuna.onchange = () => { $("#otra-wrap").hidden = f.comuna.value !== "__otra"; rellenarFlete(); };
    ["flete", "descuento", "abono_pagado"].forEach((n) => (f[n].oninput = totales));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const items = st.lineas.filter((l) => l.id).map((l) => l.manual
        ? { id: l.id, manual: true, nombre: l.nombre, qty: l.qty, precio: l.precio }
        : { id: l.id, qty: l.qty, ...(l.precio != null && l.precio !== A.prod(l.id).precio ? { precio: l.precio } : {}) });
      const err = (m) => { $("#nv-err").textContent = m; };
      if (!f.fecha.value) return err("Elige la fecha del evento");
      if (!items.length) return err("Agrega al menos un producto");
      if (items.some((i) => i.manual && !i.nombre)) return err("Escribe el nombre del producto manual");
      if (items.some((i) => i.manual && i.precio == null)) return err("Indica el precio del producto manual");
      if (!comunaSel()) return err("Indica la comuna");
      if (f.direccion.value.trim().length < 5) return err("Indica la dirección del evento");
      if (f.rut.value.trim() && !A.rut(f.rut.value)) return err("El RUT no es válido (o déjalo en blanco)");
      const btn = f.querySelector("button.btn-orange"); btn.disabled = true; err("");
      try {
        const codigo = await A.rpc("admin_crear_reserva", { p: {
          fecha: f.fecha.value, comuna: comunaSel(), items, direccion: f.direccion.value.trim(), horario: f.horario.value.trim(),
          ...(f.flete.value !== "" ? { flete: A.int(f.flete.value) } : {}),
          descuento: A.int(f.descuento.value) || 0, abono_pagado: A.int(f.abono_pagado.value) || 0, abono_medio: f.abono_medio.value,
          garantia: f.garantia.checked, forzar: f.forzar.checked, notas: f.notas.value.trim(), notas_internas: f.notas_internas.value.trim(),
          cliente: { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), email: f.email.value.trim(), rut: A.rut(f.rut.value) },
        } });
        A.toast(`Reserva ${codigo} creada`);
        A.refreshBadges();
        A.go(`/reservas/${codigo}`);
      } catch (ex) { btn.disabled = false; err(ex.message || "No se pudo crear la reserva"); }
    };
    drawLineas();
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.fecha || "")) { f.fecha.value = query.fecha; revisarDia(); }
  }
})();
