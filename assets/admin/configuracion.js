/* =====================================================================
   Panel · Configuración (general, flete por comuna, administradores)
   ===================================================================== */
(() => {
  const { $, $$, esc, clp } = A;
  const tabsCfg = (on) => `<div class="tabs" style="margin-bottom:16px;background:#fff;border-radius:12px;box-shadow:var(--shadow)">${[["", "General"], ["flete", "Flete por comuna"], ["equipo", "Administradores"]]
    .map(([k, l]) => `<button onclick="location.hash='#/configuracion${k ? "/" + k : ""}'" class="${k === on ? "on" : ""}">${l}</button>`).join("")}</div>`;

  // ------------------------------------------------------------ general
  A.route("/configuracion", "configuracion", async () => {
    const a = await A.loadAjustes(true);
    A.render(`<div class="page narrow">${A.head({ title: "Configuración" })}${tabsCfg("")}
      <form id="cg" class="stack">
        <div class="card"><h2 style="margin-bottom:12px">Reservas y pagos</h2>
          <div class="row2">
            <label class="f">Abono para reservar<div class="prefix"><input name="abono_pct" type="number" min="1" max="100" value="${a.abono_pct}" style="text-align:right"><span style="padding:0 10px 0 0">%</span></div><small>Porcentaje del total (productos + flete) que se paga al reservar online.</small></label>
            <label class="f">Garantía reembolsable<div class="prefix"><span>$</span><input name="garantia_monto" type="number" min="0" value="${a.garantia_monto}"></div><small>Se pide por correo antes del evento. 0 = no se cobra.</small></label>
          </div>
          <div class="row2">
            <label class="f">Pedir la garantía desde<div class="prefix"><input name="recordatorio_dias" type="number" min="1" max="30" value="${a.recordatorio_dias}" style="text-align:right"><span style="padding:0 10px 0 0">días antes</span></div><small>Un correo diario hasta que se pague.</small></label>
            <label class="f">Anticipación mínima<div class="prefix"><input name="dias_anticipacion" type="number" min="0" value="${a.dias_anticipacion}" style="text-align:right"><span style="padding:0 10px 0 0">días</span></div><small>No se puede reservar en el sitio con menos días.</small></label>
          </div>
          <label class="f">Calendario abierto hasta<div class="prefix"><input name="meses_maximo" type="number" min="1" max="24" value="${a.meses_maximo}" style="text-align:right"><span style="padding:0 10px 0 0">meses hacia adelante</span></div></label>
        </div>
        <div class="banner info"><div><b>¿Dónde está lo demás?</b>Productos y fotos en <a href="#/productos">Productos</a> · valores de flete en <a href="#/configuracion/flete">Flete por comuna</a> · días cerrados y bloqueos en el <a href="#/calendario">Calendario</a>. Los cambios llegan al sitio en ~1 minuto.</div></div>
      </form></div>`);
    const f = $("#cg");
    const guardar = async () => {
      const d = Object.fromEntries(["abono_pct", "garantia_monto", "recordatorio_dias", "dias_anticipacion", "meses_maximo"].map((k) => [k, A.int(f[k].value)]));
      if (d.abono_pct < 1 || d.abono_pct > 100) return A.toast("El abono debe estar entre 1% y 100%", true);
      try { A.state.ajustes = await A.q(A.sb.from("ajustes").update({ ...d, updated_at: new Date().toISOString() }).eq("id", 1).select("*").single()); A.clearDirty(); A.toast("Guardado. El sitio se actualiza en ~1 minuto."); } catch (e) { A.fail(e); }
    };
    f.addEventListener("input", () => A.setDirty(guardar, () => A.navigate()));
    f.onsubmit = (e) => { e.preventDefault(); guardar(); };
  });

  // ------------------------------------------------------------ flete por comuna
  A.route("/configuracion/flete", "flete", async () => {
    await A.loadCatalog(true);
    const draw = () => {
      A.render(`<div class="page narrow">${A.head({ title: "Configuración", actions: `<button class="btn btn-orange" id="k-new">＋ Agregar comuna</button>` })}${tabsCfg("flete")}
        <div class="card flush"><div style="padding:16px 16px 6px"><h2>Flete y montaje por comuna</h2><p class="muted" style="margin:4px 0 0">Se suma al total de la reserva. Si el cliente elige una comuna que no está aquí, se le pide cotizar por WhatsApp.</p></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Comuna</th><th class="num">Valor</th><th class="num">Orden</th><th>Estado</th><th></th></tr></thead><tbody>
        ${A.state.comunas.map((c) => `<tr><td><b>${esc(c.nombre)}</b></td><td class="num">${clp(c.valor)}</td><td class="num">${c.orden}</td>
          <td>${c.activa ? A.badge("Visible", "b-green") : A.badge("Oculta", "b-gray")}</td>
          <td class="num"><button class="btn btn-sm" data-e="${esc(c.nombre)}">Editar</button></td></tr>`).join("")}
        </tbody></table></div></div></div>`);
      $("#k-new").onclick = () => editar(null);
      $$("[data-e]").forEach((b) => (b.onclick = () => editar(A.state.comunas.find((c) => c.nombre === b.dataset.e))));
    };
    async function editar(c) {
      const v = await A.ask({ title: c ? `Editar ${c.nombre}` : "Agregar comuna", ok: "Guardar", fields: [
        { name: "nombre", label: "Nombre (como lo verá el cliente)", value: c?.nombre || "", required: true, help: "Puedes agrupar: \"La Florida / Puente Alto\"" },
        { name: "valor", label: "Valor del flete y montaje ($)", type: "number", value: c?.valor ?? "", required: true },
        { name: "orden", label: "Orden en la lista", type: "number", value: c?.orden ?? A.state.comunas.length },
        { name: "activa", label: "Visible en el sitio", type: "checkbox", value: c ? c.activa : true }] });
      if (!v) return;
      const fila = { nombre: v.nombre.trim(), valor: A.int(v.valor) || 0, orden: A.int(v.orden) || 0, activa: v.activa };
      try {
        if (c) await A.q(A.sb.from("comunas").update(fila).eq("nombre", c.nombre));
        else await A.q(A.sb.from("comunas").insert(fila));
        await A.loadCatalog(true); A.toast("Guardado. El sitio se actualiza en ~1 minuto."); draw();
      } catch (e) { A.fail(e); }
    }
    draw();
  });

  // ------------------------------------------------------------ administradores
  A.route("/configuracion/equipo", "equipo", async () => {
    const draw = async () => {
      const team = await A.rpc("admin_team");
      A.render(`<div class="page narrow">${A.head({ title: "Configuración", actions: `<button class="btn btn-orange" id="t-add">＋ Agregar administrador</button>` })}${tabsCfg("equipo")}
        <div class="card flush"><div style="padding:16px 16px 6px"><h2>Administradores</h2><p class="muted" style="margin:4px 0 0">Personas con acceso a este panel.</p></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>${team.map((t) => `<tr><td><div class="pcell"><span class="avatar">${esc(A.initials(t.email))}</span><div><b>${esc(t.email)}</b>
          <small class="muted">${t.pending ? "Invitación pendiente: debe crear su cuenta" : t.last_sign_in_at ? `Último ingreso ${A.ago(t.last_sign_in_at)}` : "Sin ingresos"}</small></div></div></td>
          <td>${t.pending ? A.badge("Invitado", "b-amber") : A.badge("Activo", "b-green")}</td>
          <td class="num">${t.email === A.state.user?.email ? `<small class="muted">Tú</small>` : `<button class="btn btn-sm btn-plain danger" data-rm="${esc(t.email)}">Quitar acceso</button>`}</td></tr>`).join("")}</tbody></table></div></div></div>`);
      $("#t-add").onclick = async () => {
        const v = await A.ask({ title: "Agregar administrador", ok: "Agregar", fields: [{ name: "email", label: "Correo", type: "email", required: true }] });
        if (!v) return;
        try {
          const r = await A.rpc("admin_invite", { p_email: v.email });
          const url = location.href.split("#")[0];
          if (r === "added") A.toast("Listo: ya tiene acceso");
          else A.modal({ title: "Invitación creada", body: `<p>Envíale este mensaje a <b>${esc(v.email)}</b>:</p><textarea rows="5" readonly id="inv-msg">¡Hola! Te di acceso al panel de Party House 🎉\n1. Entra a ${url}\n2. Elige "¿Primera vez? Crear cuenta" con ${v.email}\n3. Confirma el correo que te llega y vuelve a ingresar.</textarea>`,
            foot: `<a class="btn btn-green" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`¡Hola! Te di acceso al panel de Party House 🎉\n1. Entra a ${url}\n2. Elige "¿Primera vez? Crear cuenta" con ${v.email}\n3. Confirma el correo que te llega y vuelve a ingresar.`)}">Enviar por WhatsApp</a><button class="btn btn-primary" data-x>Listo</button>` });
          draw();
        } catch (e) { A.fail(e); }
      };
      $$("[data-rm]").forEach((b) => (b.onclick = async () => {
        if (!(await A.confirm({ title: "Quitar acceso", message: `<b>${esc(b.dataset.rm)}</b> ya no podrá entrar al panel. Puedes volver a invitarlo cuando quieras.`, ok: "Quitar acceso", danger: true }))) return;
        try { await A.rpc("admin_remove", { p_email: b.dataset.rm }); A.toast("Acceso quitado"); draw(); } catch (e) { A.fail(e); }
      }));
    };
    await draw();
  });
})();
