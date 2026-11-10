/* =====================================================================
   Panel · Clientes (se generan desde las reservas confirmadas)
   ===================================================================== */
(() => {
  const { $, $$, esc, clp } = A;

  // Agrupa reservas por cliente (correo, o teléfono si no tiene correo)
  A.clientes = async () => {
    const res = await A.q(A.sb.from("reservas").select("*").order("creada", { ascending: false }).limit(5000));
    const map = new Map();
    for (const r of res) {
      const k = A.claveCliente(r);
      if (!map.has(k)) map.set(k, { clave: k, nombre: r.cliente_nombre, telefono: r.cliente_telefono, email: r.cliente_email, comunas: new Set(), reservas: [] });
      const c = map.get(k);
      c.reservas.push(r); c.comunas.add(r.comuna);
      if (!c.email && r.cliente_email) c.email = r.cliente_email;
    }
    const hoyK = A.hoyKey();
    return [...map.values()].map((c) => {
      const conf = c.reservas.filter((r) => r.estado === "pagado");
      const fechas = conf.map(A.fechaEv).sort();
      return { ...c, conf, gastado: conf.reduce((s, r) => s + r.total, 0), eventos: conf.length,
        ultima: fechas.filter((f) => f < hoyK).pop() || null, proxima: fechas.find((f) => f >= hoyK) || null,
        sinPagar: c.reservas.filter((r) => ["pendiente", "rechazado"].includes(r.estado)).length };
    });
  };

  A.route("/clientes", "clientes", async () => {
    const todos = await A.clientes();
    const st = { f: "todos", q: "" };
    const FILTROS = [["todos", "Todos", () => true], ["recurrentes", "Recurrentes (2+ eventos)", (c) => c.eventos >= 2],
      ["proximos", "Con evento próximo", (c) => c.proxima], ["sin_pagar", "Con pago no completado", (c) => c.sinPagar && !c.eventos]];
    A.render(`<div class="page">${A.head({ title: "Clientes", actions: `<button class="btn" id="cl-csv">Exportar</button>` })}
      <div class="kpis">
        <div class="kpi"><small>Clientes con reserva</small><b>${todos.filter((c) => c.eventos).length}</b></div>
        <div class="kpi"><small>Recurrentes</small><b>${todos.filter((c) => c.eventos >= 2).length}</b></div>
        <div class="kpi"><small>Gasto promedio</small><b>${clp(todos.filter((c) => c.eventos).reduce((s, c) => s + c.gastado, 0) / Math.max(1, todos.filter((c) => c.eventos).length))}</b></div>
        <div class="kpi"><small>Pagos no completados</small><b>${todos.filter((c) => c.sinPagar && !c.eventos).length}</b></div>
      </div>
      <div class="card flush"><div class="tabs" id="cl-tabs">${FILTROS.map(([k, l]) => `<button data-f="${k}">${l}<span class="c"></span></button>`).join("")}</div>
        <div class="toolbar"><div class="grow"><input id="cl-q" type="search" placeholder="Buscar por nombre, teléfono, correo o comuna"></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th class="hide-sm">Comuna</th><th class="num">Eventos</th><th class="num">Total</th><th class="hide-sm">Último / próximo</th><th></th></tr></thead><tbody id="cl-body"></tbody></table></div></div></div>`);
    const visible = () => todos.filter((c) => FILTROS.find((f) => f[0] === st.f)[2](c) && (!st.q || A.match(`${c.nombre} ${c.telefono} ${c.email || ""} ${[...c.comunas].join(" ")}`, st.q)))
      .sort((a, b) => b.gastado - a.gastado || (b.reservas[0]?.creada || "").localeCompare(a.reservas[0]?.creada || ""));
    function draw() {
      $("#cl-body").innerHTML = visible().map((c) => `<tr class="click" data-k="${esc(c.clave)}">
        <td><div class="pcell"><span class="avatar">${esc(A.initials(c.nombre))}</span><div><b>${esc(c.nombre)}</b><small class="muted">${esc(c.email || c.telefono)}</small></div></div></td>
        <td class="hide-sm">${esc([...c.comunas].join(", "))}</td><td class="num">${c.eventos}${c.sinPagar ? ` <small class="muted">(+${c.sinPagar} sin pagar)</small>` : ""}</td>
        <td class="num"><b>${clp(c.gastado)}</b></td>
        <td class="hide-sm nowrap">${c.proxima ? `Próximo: <b>${A.evento(c.proxima)}</b>` : c.ultima ? `Último: ${A.evento(c.ultima)}` : "—"}</td>
        <td class="num"><a class="btn btn-sm btn-green" href="${A.wa(c.telefono, `¡Hola ${c.nombre.split(" ")[0]}! Te escribimos de Party House 🎉`)}" target="_blank" rel="noopener" data-stop>WhatsApp</a></td></tr>`).join("") ||
        `<tr><td colspan="6"><div class="empty-state"><div class="emo">👤</div><h3>Sin clientes aquí</h3></div></td></tr>`;
      $$("#cl-tabs button").forEach((b) => { b.classList.toggle("on", b.dataset.f === st.f); b.querySelector(".c").textContent = todos.filter(FILTROS.find((f) => f[0] === b.dataset.f)[2]).length; });
    }
    $("#cl-tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { st.f = b.dataset.f; draw(); } };
    $("#cl-q").oninput = A.debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150);
    $("#cl-body").onclick = (e) => { if (e.target.closest("[data-stop]")) return; const tr = e.target.closest("tr[data-k]"); if (tr) A.go(`/clientes/${encodeURIComponent(tr.dataset.k)}`); };
    $("#cl-csv").onclick = () => A.csv("clientes-party-house.csv", [["Nombre", "Teléfono", "Correo", "Comunas", "Eventos", "Total", "Último evento", "Próximo evento"],
      ...visible().map((c) => [c.nombre, c.telefono, c.email || "", [...c.comunas].join(", "), c.eventos, c.gastado, c.ultima || "", c.proxima || ""])]);
    draw();
  });

  A.route("/clientes/:clave", "clientes", async ({ clave }) => {
    const c = (await A.clientes()).find((x) => x.clave === clave);
    if (!c) { A.render(`<div class="page"><div class="card empty-state"><div class="emo">👤</div><h3>Cliente no encontrado</h3><a class="btn" href="#/clientes">Volver</a></div></div>`); return; }
    const favoritos = {};
    c.conf.forEach((r) => r.items.forEach((i) => (favoritos[i.nombre] = (favoritos[i.nombre] || 0) + i.qty)));
    A.render(`<div class="page">${A.head({ title: esc(c.nombre), back: "/clientes", actions: `<a class="btn btn-green" href="${A.wa(c.telefono)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-orange" href="#/reservas/nueva">＋ Nueva reserva</a>` })}
      <div class="cols"><div class="stack">
        <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0">
          <div class="kpi"><small>Eventos</small><b>${c.eventos}</b></div><div class="kpi"><small>Total arriendos</small><b>${clp(c.gastado)}</b></div>
          <div class="kpi"><small>Próximo evento</small><b style="font-size:1.1rem">${c.proxima ? A.evento(c.proxima) : "—"}</b></div></div>
        <div class="card flush"><div style="padding:16px 16px 4px"><h2>Reservas</h2></div><div class="tbl-wrap"><table class="tbl"><tbody>
          ${c.reservas.map((r) => `<tr class="click" data-c="${esc(r.codigo)}"><td class="nowrap"><b>${A.evento(A.fechaEv(r))}</b></td><td class="mono">${esc(r.codigo)}</td>
            <td class="hide-sm"><small>${esc(A.resumenItems(r))}</small></td><td class="num">${clp(r.total)}</td><td>${A.estadoBadge(r)}</td></tr>`).join("")}
        </tbody></table></div></div></div>
      <div class="stack"><div class="card"><h2 style="margin-bottom:8px">Contacto</h2>
          <p style="margin:0 0 6px"><a href="${A.wa(c.telefono)}" target="_blank" rel="noopener">📱 ${esc(c.telefono)}</a></p>
          ${c.email ? `<p style="margin:0 0 6px"><a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a></p>` : ""}
          <p style="margin:0">📍 ${esc([...c.comunas].join(", "))}</p></div>
        <div class="card"><h2 style="margin-bottom:8px">Lo que más arrienda</h2>
          ${Object.keys(favoritos).length ? A.barsList(Object.entries(favoritos).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label: esc(label), value })), { money: false }) : `<p class="muted">Aún sin eventos confirmados.</p>`}</div></div></div></div>`);
    $$("tr[data-c]").forEach((tr) => (tr.onclick = () => A.go(`/reservas/${tr.dataset.c}`)));
  });
})();
