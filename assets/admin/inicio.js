/* =====================================================================
   Panel · Inicio (resumen y tareas) y Análisis
   ===================================================================== */
(() => {
  const { $, $$, esc, clp } = A;
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  const delta = (a, b) => { if (!b) return a ? `<span class="delta up">nuevo</span>` : ""; const d = (a - b) / b; return `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(0)}% vs mes anterior</span>`; };

  A.route("/", "inicio", async () => {
    const [res] = await Promise.all([A.q(A.sb.from("reservas").select("*").order("creada", { ascending: false }).limit(5000)), A.loadAjustes()]);
    const hoyK = A.hoyKey(), now = new Date();
    const conf = res.filter((r) => r.estado === "pagado");
    const ini = A.dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), iniAnt = A.dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const delMes = conf.filter((r) => A.dayKey(r.creada) >= ini), mesAnt = conf.filter((r) => A.dayKey(r.creada) >= iniAnt && A.dayKey(r.creada) < ini);
    const suma = (l, f) => l.reduce((s, r) => s + (f(r) || 0), 0);
    const en = (r, a, b) => { const d = A.diasHasta(A.fechaEv(r)); return d >= a && d <= b; };

    const tareas = [
      ["🚚", "Instalaciones en los próximos 7 días", conf.filter((r) => r.etapa === "por_instalar" && en(r, 0, 7)), "/reservas?f=por_instalar"],
      ["📦", "Por retirar (evento ya pasó)", conf.filter((r) => r.etapa === "instalada" && A.fechaEv(r) < hoyK), "/reservas?f=instaladas"],
      ["🛡️", "Garantías por cobrar (próximos 7 días)", conf.filter((r) => r.garantia_estado === "pendiente" && en(r, 0, 7)), "/garantias"],
      ["💸", "Garantías por devolver", conf.filter((r) => r.garantia_estado === "pagada" && r.etapa === "retirada"), "/garantias"],
      ["💰", "Saldos por cobrar de eventos pasados", conf.filter((r) => A.fechaEv(r) < hoyK && !r.saldo_pagado_en && A.saldo(r) > 0), "/reservas?f=realizadas"],
      ["⏳", "Pagos no completados (últimos 7 días)", res.filter((r) => ["pendiente", "rechazado"].includes(r.estado) && Date.now() - new Date(r.creada) < 7 * 864e5), "/reservas?f=no_pagadas"],
    ].filter((t) => t[2].length);
    const proximos = conf.filter((r) => A.fechaEv(r) >= hoyK && r.etapa !== "retirada").sort((a, b) => A.fechaEv(a).localeCompare(A.fechaEv(b))).slice(0, 8);
    const meses = []; for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); meses.push([A.dayKey(d).slice(0, 7), `${MES[d.getMonth()]}`]); }
    const nombre = (A.state.user?.email || "").split("@")[0];

    A.render(`<div class="page">
      ${A.head({ title: `Hola${nombre ? ", " + esc(nombre) : ""} 👋`, sub: "Resumen de Party House", actions: `<a class="btn" href="#/calendario">📅 Calendario</a><a class="btn btn-orange" href="#/reservas/nueva">＋ Crear reserva</a>` })}
      <div class="kpis">
        <div class="kpi"><small>Reservas confirmadas este mes</small><b>${delMes.length}</b>${delta(delMes.length, mesAnt.length)}</div>
        <div class="kpi"><small>Arriendos este mes</small><b>${clp(suma(delMes, (r) => r.total))}</b>${delta(suma(delMes, (r) => r.total), suma(mesAnt, (r) => r.total))}</div>
        <div class="kpi"><small>Abonos recibidos este mes</small><b>${clp(suma(delMes, (r) => r.monto_pagado))}</b></div>
        <div class="kpi"><small>Eventos próximos</small><b>${conf.filter((r) => A.fechaEv(r) >= hoyK).length}</b><span class="muted small">${clp(suma(conf.filter((r) => A.fechaEv(r) >= hoyK && !r.saldo_pagado_en), A.saldo))} en saldos por cobrar</span></div>
      </div>
      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card-head"><h2>Próximos eventos</h2><a class="btn btn-sm" href="#/reservas">Ver todas</a></div>
            ${proximos.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${proximos.map((r) => { const d = A.diasHasta(A.fechaEv(r)); return `<tr class="click" data-c="${esc(r.codigo)}">
              <td class="nowrap"><b>${A.evento(A.fechaEv(r))}</b><br><small class="muted">${d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`}</small></td>
              <td>${esc(r.cliente_nombre)} · ${esc(r.comuna)}<br><small class="muted">${esc(A.resumenItems(r))}</small></td>
              <td class="hide-sm">${A.etapaBadge(r)} ${A.garantiaBadge(r)}</td></tr>`; }).join("")}</tbody></table></div>`
              : `<div class="empty-state"><div class="emo">🎈</div><h3>No hay eventos próximos</h3><p>Las reservas confirmadas aparecerán aquí.</p></div>`}</div>
          <div class="card"><div class="card-head"><h2>Arriendos por mes</h2><small class="muted">reservas confirmadas, según fecha de reserva</small></div>
            ${A.barChart(meses.map(([k, l]) => ({ label: l, title: k, value: suma(conf.filter((r) => A.dayKey(r.creada).startsWith(k)), (r) => r.total) })))}</div>
        </div>
        <div class="stack">
          <div class="card todo"><h2 style="margin-bottom:10px">Por hacer</h2>
            ${tareas.length ? tareas.map(([ico, t, l, href]) => `<a href="#${href}"><span>${ico}</span><span>${t}</span><span class="n">${l.length}</span></a>`).join("") : `<p class="muted" style="margin:0">Todo al día 🎉</p>`}</div>
          <div class="card"><h2 style="margin-bottom:8px">Accesos rápidos</h2>
            <div class="btn-group"><a class="btn btn-sm" href="#/productos">🏷️ Productos</a><a class="btn btn-sm" href="#/configuracion/flete">🚚 Flete</a><a class="btn btn-sm" href="#/garantias">🛡️ Garantías</a><a class="btn btn-sm" href="#/analisis">📊 Análisis</a></div></div>
        </div>
      </div></div>`);
    $$("tr[data-c]").forEach((tr) => (tr.onclick = () => A.go(`/reservas/${tr.dataset.c}`)));
  });

  // ------------------------------------------------------------ análisis
  A.route("/analisis", "analisis", async (_, query) => {
    await A.loadCatalog();
    const res = await A.q(A.sb.from("reservas").select("*").limit(10000));
    const hoy = new Date();
    const st = { desde: query.desde || A.dayKey(new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1)), hasta: query.hasta || A.dayKey(new Date(hoy.getFullYear(), hoy.getMonth() + 3, 0)), por: query.por || "evento" };
    function draw() {
      const fechaDe = (r) => (st.por === "evento" ? A.fechaEv(r) : A.dayKey(r.creada));
      const enRango = res.filter((r) => fechaDe(r) >= st.desde && fechaDe(r) <= st.hasta);
      const conf = enRango.filter((r) => r.estado === "pagado");
      const web = enRango.filter((r) => r.origen === "web");
      const suma = (l, f) => l.reduce((s, r) => s + (f(r) || 0), 0);
      const agrupar = (fnKey, fnVal) => { const m = {}; conf.forEach((r) => { for (const [k, v] of fnKey(r)) m[k] = (m[k] || 0) + v; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
      const prodIng = agrupar((r) => r.items.map((i) => [i.nombre, i.precio * i.qty]));
      const prodUni = agrupar((r) => r.items.map((i) => [i.nombre, i.qty]));
      const comunas = agrupar((r) => [[r.comuna, r.total]]);
      const cats = agrupar((r) => r.items.map((i) => [A.catName(A.prod(i.id)?.categoria) || "Otros", i.precio * i.qty]));
      const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
      const dias = DIAS.map((d, i) => [d, conf.filter((r) => A.ev(A.fechaEv(r)).getDay() === i).length]);
      const antic = conf.map((r) => Math.round((A.ev(A.fechaEv(r)) - A.ev(A.dayKey(r.creada))) / 864e5)).filter((x) => x >= 0);
      const meses = {}; conf.forEach((r) => { const k = fechaDe(r).slice(0, 7); meses[k] = (meses[k] || 0) + r.total; });
      const mesKeys = []; for (let d = new Date(st.desde.slice(0, 7) + "-01T12:00:00"); A.dayKey(d).slice(0, 7) <= st.hasta.slice(0, 7); d.setMonth(d.getMonth() + 1)) mesKeys.push(A.dayKey(d).slice(0, 7));
      const lista = (rows, money = true) => A.barsList(rows.slice(0, 8).map(([label, value]) => ({ label: esc(label), value })), { money });
      A.render(`<div class="page">${A.head({ title: "Análisis", actions: `<button class="btn" id="an-csv">Exportar líneas</button>` })}
        <div class="card" style="margin-bottom:16px"><div class="toolbar" style="padding:0;border:0">
          <label class="f" style="margin:0">Desde<input type="date" id="an-d" value="${st.desde}"></label>
          <label class="f" style="margin:0">Hasta<input type="date" id="an-h" value="${st.hasta}"></label>
          <label class="f" style="margin:0">Según<select id="an-por"><option value="evento" ${st.por === "evento" ? "selected" : ""}>Fecha del evento</option><option value="reserva" ${st.por === "reserva" ? "selected" : ""}>Fecha en que reservaron</option></select></label>
          <div class="btn-group" style="align-self:flex-end">${[["Este mes", 0, 0], ["3 meses", -2, 0], ["Este año", "y"], ["Próximos 3 meses", 0, 2]].map(([l, a, b], i) => `<button class="btn btn-sm" data-r="${i}">${l}</button>`).join("")}</div></div></div>
        <div class="kpis">
          <div class="kpi"><small>Eventos confirmados</small><b>${conf.length}</b></div>
          <div class="kpi"><small>Arriendos (con flete)</small><b>${clp(suma(conf, (r) => r.total))}</b><span class="muted small">flete ${clp(suma(conf, (r) => r.flete))}</span></div>
          <div class="kpi"><small>Ticket promedio</small><b>${clp(suma(conf, (r) => r.total) / Math.max(conf.length, 1))}</b></div>
          <div class="kpi"><small>Pago online completado</small><b>${web.length ? A.pct(web.filter((r) => r.estado === "pagado").length / web.length) : "—"}</b><span class="muted small">${web.filter((r) => r.estado === "pagado").length} de ${web.length} intentos web</span></div>
        </div>
        <div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:8px">Arriendos por mes</h2>${A.barChart(mesKeys.map((k) => ({ label: MES[+k.slice(5) - 1], title: k, value: meses[k] || 0 })))}</div>
        <div class="row2" style="gap:16px">
          <div class="card"><h2 style="margin-bottom:10px">Productos que más venden</h2>${lista(prodIng)}</div>
          <div class="card"><h2 style="margin-bottom:10px">Productos más arrendados (unidades)</h2>${lista(prodUni, false)}</div>
          <div class="card"><h2 style="margin-bottom:10px">Por comuna</h2>${lista(comunas)}</div>
          <div class="card"><h2 style="margin-bottom:10px">Por categoría</h2>${lista(cats)}</div>
          <div class="card"><h2 style="margin-bottom:10px">Día de la semana del evento</h2>${A.barsList(dias.map(([label, value]) => ({ label, value })), { money: false })}</div>
          <div class="card"><h2 style="margin-bottom:10px">Cómo reservan</h2><dl class="kv">
            <dt>Desde el sitio (Mercado Pago)</dt><dd>${conf.filter((r) => r.origen === "web").length}</dd>
            <dt>Creadas en el panel</dt><dd>${conf.filter((r) => r.origen === "manual").length}</dd>
            <dt>Anticipación promedio</dt><dd>${antic.length ? Math.round(antic.reduce((a, b) => a + b, 0) / antic.length) + " días" : "—"}</dd>
            <dt>Garantías cobradas</dt><dd>${conf.filter((r) => ["pagada", "devuelta"].includes(r.garantia_estado)).length}</dd>
            <dt>Clientes que repiten</dt><dd>${(() => { const m = {}; res.filter((r) => r.estado === "pagado").forEach((r) => (m[A.claveCliente(r)] = (m[A.claveCliente(r)] || 0) + 1)); const ks = new Set(conf.map(A.claveCliente)); return [...ks].filter((k) => m[k] > 1).length; })()}</dd></dl></div>
        </div></div>`);
      $("#an-d").onchange = (e) => { st.desde = e.target.value; draw(); };
      $("#an-h").onchange = (e) => { st.hasta = e.target.value; draw(); };
      $("#an-por").onchange = (e) => { st.por = e.target.value; draw(); };
      $$("[data-r]").forEach((b) => (b.onclick = () => {
        const i = +b.dataset.r, y = hoy.getFullYear(), m = hoy.getMonth();
        [[st.desde, st.hasta]] = [[
          [A.dayKey(new Date(y, m, 1)), A.dayKey(new Date(y, m - 2, 1)), A.dayKey(new Date(y, 0, 1)), A.hoyKey()][i],
          [A.dayKey(new Date(y, m + 1, 0)), A.dayKey(new Date(y, m + 1, 0)), A.dayKey(new Date(y, 11, 31)), A.dayKey(new Date(y, m + 3, 0))][i]]];
        draw();
      }));
      $("#an-csv").onclick = () => A.csv(`lineas-${st.desde}-a-${st.hasta}.csv`, [["Código", "Fecha evento", "Reservada", "Origen", "Cliente", "Comuna", "Producto", "Categoría", "Cantidad", "Precio", "Total línea"],
        ...conf.flatMap((r) => r.items.map((i) => [r.codigo, A.fechaEv(r), A.dayKey(r.creada), r.origen, r.cliente_nombre, r.comuna, i.nombre, A.catName(A.prod(i.id)?.categoria), i.qty, i.precio, i.precio * i.qty]))]);
    }
    draw();
  });
})();
