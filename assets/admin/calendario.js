/* =====================================================================
   Panel · Calendario (reservas y bloqueos por día) y Garantías
   ===================================================================== */
(() => {
  const { $, $$, esc, clp } = A;
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  // ------------------------------------------------------------ calendario mensual
  A.route("/calendario", "calendario", async (_, query) => {
    await A.loadCatalog();
    const hoy = new Date();
    let y = +(query.m || "").slice(0, 4) || hoy.getFullYear();
    let m = (query.m ? +query.m.slice(5, 7) - 1 : hoy.getMonth());

    async function cargar() {
      const ini = A.dayKey(new Date(y, m, 1)), fin = A.dayKey(new Date(y, m + 1, 0));
      const dias = []; for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) dias.push(A.dayKey(new Date(y, m, d)));
      const [res, bloq] = await Promise.all([
        A.q(A.sb.from("reservas").select("*").in("estado", ["pagado", "pendiente"]).overlaps("fechas", dias)),
        A.q(A.sb.from("bloqueos").select("*").gte("fecha", ini).lte("fecha", fin)),
      ]);
      return { res, bloq };
    }
    async function draw() {
      A.render(`<div class="page">${A.head({ title: "Calendario", actions: `<a class="btn btn-orange" href="#/reservas/nueva">＋ Crear reserva</a>` })}<div class="card"><div class="spinner"></div></div></div>`);
      const { res, bloq } = await cargar();
      const primero = new Date(y, m, 1), offset = (primero.getDay() + 6) % 7, total = new Date(y, m + 1, 0).getDate();
      const hoyK = A.hoyKey();
      let celdas = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="dow">${d}</div>`).join("");
      for (let i = 0; i < offset; i++) celdas += `<div class="day otro"></div>`;
      for (let d = 1; d <= total; d++) {
        const k = A.dayKey(new Date(y, m, d));
        const rs = res.filter((r) => r.fechas.includes(k));
        const bs = bloq.filter((b) => b.fecha === k);
        const cerrado = bs.some((b) => !b.producto_id);
        celdas += `<div class="day ${k === hoyK ? "hoy" : ""} ${cerrado ? "cerrado" : ""} ${k < hoyK ? "pasado" : ""}" data-k="${k}">
          <span class="n">${d}</span>
          ${rs.map((r) => `<span class="ev ${r.estado === "pagado" ? (r.etapa === "retirada" ? "ok" : "") : "bl"}" title="${esc(r.codigo)} · ${esc(r.cliente_nombre)} · ${esc(A.resumenItems(r))}">${r.estado === "pagado" ? "" : "⏳ "}${esc(r.cliente_nombre.split(" ")[0])} · ${esc(r.comuna)}</span>`).join("")}
          ${cerrado ? `<span class="ev bl">Cerrado</span>` : ""}
          ${bs.filter((b) => b.producto_id).map((b) => `<span class="ev bl" title="${esc(b.motivo || "")}">🔒 ${esc(A.prod(b.producto_id)?.nombre || b.producto_id)}</span>`).join("")}
        </div>`;
      }
      const conf = res.filter((r) => r.estado === "pagado");
      A.render(`<div class="page">
        ${A.head({ title: "Calendario", actions: `<a class="btn btn-orange" href="#/reservas/nueva">＋ Crear reserva</a>` })}
        <div class="card">
          <div class="card-head"><button class="btn btn-sm" id="c-prev" aria-label="Mes anterior">‹</button>
            <h2 style="margin:0 auto;text-align:center">${MESES[m]} ${y}</h2>
            <button class="btn btn-sm" id="c-hoy">Hoy</button><button class="btn btn-sm" id="c-next" aria-label="Mes siguiente">›</button></div>
          <p class="muted" style="margin-top:0">${conf.length} evento(s) confirmados · ${clp(conf.reduce((s, r) => s + r.total, 0))} en arriendos. Toca un día para ver el detalle, bloquearlo o crear una reserva.</p>
          <div class="cal">${celdas}</div>
          <p class="help" style="margin-bottom:0">Leyenda: <span class="badge b-info">confirmada</span> <span class="badge b-green">retirada</span> <span class="badge b-red">⏳ pago pendiente / bloqueo</span></p>
        </div></div>`);
      $("#c-prev").onclick = () => { m--; if (m < 0) { m = 11; y--; } draw(); };
      $("#c-next").onclick = () => { m++; if (m > 11) { m = 0; y++; } draw(); };
      $("#c-hoy").onclick = () => { y = hoy.getFullYear(); m = hoy.getMonth(); draw(); };
      $$(".cal .day[data-k]").forEach((el) => (el.onclick = () => dia(el.dataset.k, res.filter((r) => r.fechas.includes(el.dataset.k)), bloq.filter((b) => b.fecha === el.dataset.k))));
    }

    // Detalle de un día: reservas, ocupación y bloqueos
    async function dia(k, rs, bs) {
      const oc = await A.ocupacionDia(k);
      const cerrado = bs.find((b) => !b.producto_id);
      const unicos = A.state.productos.filter((p) => p.activo && (p.bloqueo_automatico || p.equipo));
      const md = A.modal({ title: A.eventoLargo(k), wide: true, body: `
        <h3 style="margin-bottom:8px">Reservas</h3>
        ${rs.length ? rs.map((r) => `<a href="#/reservas/${esc(r.codigo)}" data-x style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px;color:var(--ink);text-decoration:none">
          <span class="mono">${esc(r.codigo)}</span><span style="flex:1"><b>${esc(r.cliente_nombre)}</b> · ${esc(r.comuna)}<br><small class="muted">${esc(A.resumenItems(r))}</small></span>${A.estadoBadge(r)}</a>`).join("") : `<p class="muted">Sin reservas este día.</p>`}
        <div style="margin:10px 0 16px"><a class="btn btn-sm btn-orange" href="#/reservas/nueva?fecha=${k}" data-x>＋ Crear reserva este día</a></div>
        <h3 style="margin-bottom:8px">Disponibilidad de productos únicos</h3>
        <div class="tbl-wrap"><table class="tbl"><tbody>${unicos.map((p) => {
          const b = bs.find((x) => x.producto_id === p.id);
          const motivo = oc.ocupados[p.id];
          return `<tr><td><b>${esc(p.nombre)}</b> <small class="muted">${esc(p.tamano)}</small></td>
            <td>${cerrado ? A.badge("Día cerrado", "b-red") : motivo ? A.badge(motivo, b ? "b-red" : "b-info") : A.badge("Disponible", "b-green")}</td>
            <td class="num">${b ? `<button class="btn btn-sm btn-plain danger" data-unb="${b.id}">Quitar bloqueo</button>` : !motivo ? `<button class="btn btn-sm" data-bl="${esc(p.id)}">Bloquear</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>
        <p class="help">Los productos que no son únicos (sillas, cubos LED, etc.) no se bloquean por reservas. Las reservas confirmadas bloquean solas su carpa o equipo.</p>`,
        foot: cerrado ? `<button class="btn" data-unb="${cerrado.id}">Abrir este día</button><button class="btn btn-primary" data-x>Listo</button>`
          : `<button class="btn btn-danger" id="d-cerrar">Cerrar todo el día</button><button class="btn btn-primary" data-x>Listo</button>` });
      const quien = A.state.user?.email;
      md.el.querySelectorAll("[data-bl]").forEach((b) => (b.onclick = async () => {
        const v = await A.ask({ title: `Bloquear ${A.prod(b.dataset.bl)?.nombre || ""}`, intro: "No se podrá reservar este producto (ni los que comparten su equipo) ese día.", ok: "Bloquear", fields: [{ name: "motivo", label: "Motivo (opcional)", value: "Reservado por fuera" }] });
        if (!v) return; const motivo = v.motivo;
        try { await A.q(A.sb.from("bloqueos").insert({ fecha: k, producto_id: b.dataset.bl, motivo: motivo || null, creado_por: quien })); A.toast("Producto bloqueado"); md.close(); draw(); } catch (e) { A.fail(e); }
      }));
      md.el.querySelectorAll("[data-unb]").forEach((b) => (b.onclick = async () => {
        try { await A.q(A.sb.from("bloqueos").delete().eq("id", +b.dataset.unb)); A.toast("Bloqueo quitado"); md.close(); draw(); } catch (e) { A.fail(e); }
      }));
      $("#d-cerrar", md.el)?.addEventListener("click", async () => {
        const v = await A.ask({ title: "Cerrar todo el día", intro: "Nadie podrá reservar ningún producto ese día en el sitio.", ok: "Cerrar día", danger: true, fields: [{ name: "motivo", label: "Motivo (solo se ve en el panel)", value: "Feriado / sin atención" }] });
        if (!v) return; const motivo = v.motivo;
        try { await A.q(A.sb.from("bloqueos").insert({ fecha: k, motivo: motivo || null, creado_por: quien })); A.toast("Día cerrado: no se podrá reservar"); md.close(); draw(); } catch (e) { A.fail(e); }
      });
    }
    draw();
  });

  // ------------------------------------------------------------ garantías
  A.route("/garantias", "garantias", async () => {
    await A.loadAjustes();
    const all = await A.q(A.sb.from("reservas").select("*").eq("estado", "pagado").neq("garantia_estado", "no_aplica").order("fechas"));
    const hoyK = A.hoyKey();
    const grupos = [
      ["Por cobrar", "Se pide por correo desde " + A.state.ajustes.recordatorio_dias + " días antes del evento", all.filter((r) => r.garantia_estado === "pendiente" && A.fechaEv(r) >= hoyK)],
      ["Por devolver", "Pagadas: devuélvelas después del retiro si todo está en orden", all.filter((r) => r.garantia_estado === "pagada")],
      ["Pendientes de eventos pasados", "El evento ya ocurrió y la garantía quedó sin pagar", all.filter((r) => r.garantia_estado === "pendiente" && A.fechaEv(r) < hoyK)],
    ];
    A.render(`<div class="page">${A.head({ title: "Garantías", sub: `Garantía reembolsable de ${clp(A.state.ajustes.garantia_monto)} por reserva. Puedes cambiar el monto y los días en Configuración.` })}
      <div class="stack">${grupos.map(([t, sub, rows]) => `<div class="card flush"><div style="padding:16px 16px 4px"><h2>${t} <span class="badge b-gray plain">${rows.length}</span></h2><p class="muted" style="margin:4px 0 0">${sub}</p></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>${rows.map((r) => {
          const d = A.diasHasta(A.fechaEv(r));
          return `<tr class="click" data-c="${esc(r.codigo)}"><td class="nowrap"><b>${A.evento(A.fechaEv(r))}</b><br><small class="muted">${d === 0 ? "hoy" : d > 0 ? `en ${d} días` : `hace ${-d} días`}</small></td>
          <td><span class="mono">${esc(r.codigo)}</span><br>${esc(r.cliente_nombre)}</td>
          <td class="hide-sm">${r.cliente_email ? `${r.garantia_avisos || 0} correo(s) enviados` : `<span class="muted">sin correo</span>`}</td>
          <td class="num">${clp(r.garantia_monto)}</td><td>${A.garantiaBadge(r)}</td>
          <td class="num"><a class="btn btn-sm btn-green" href="${A.wa(r.cliente_telefono, (A.waTemplates(r).find(([l]) => l === (r.garantia_estado === "pagada" ? "Garantía devuelta" : "Pedir garantía")) || [, ""])[1])}" target="_blank" rel="noopener" data-stop>WhatsApp</a></td></tr>`;
        }).join("") || `<tr><td><p class="muted" style="margin:6px 0">Nada por aquí 🎉</p></td></tr>`}</tbody></table></div></div>`).join("")}</div></div>`);
    $$("tr[data-c]").forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest("[data-stop]")) A.go(`/reservas/${tr.dataset.c}`); }));
  });
})();
