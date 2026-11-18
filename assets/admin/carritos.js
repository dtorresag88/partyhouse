// Party House · Panel · Carritos armados
// Para clientes que ya dijeron por WhatsApp lo que quieren: se arma el pedido (productos, precios, fecha, flete)
// y se le envía un link a partyhouse.cl/pedido.html?c=TOKEN donde completa sus datos y paga el abono.
// Al pagarse, la reserva se crea sola (función "pagos") y el carrito queda "pagado".
(() => {
  const A = window.A, { esc, clp, $, $$ } = A;

  const ESTADO = {
    abierto: ["Enviado", "b-info"], visto: ["Visto por el cliente", "b-violet"], pagado: ["Pagado", "b-green"],
    vencido: ["Vencido", "b-gray"], anulado: ["Anulado", "b-red"],
  };
  const estadoDe = (c) => c.estado === "abierto" ? (c.vence < A.hoyKey() ? "vencido" : c.visto_en ? "visto" : "abierto") : c.estado;
  const estadoBadge = (c) => { const [t, k] = ESTADO[estadoDe(c)]; return A.badge(t, k); };
  const link = (c) => `${A.CFG.SITE_URL}/pedido.html?c=${c.token}`;
  const sumaProductos = (c) => c.items.reduce((s, i) => s + (i.precio || 0) * i.qty, 0);
  const fleteDe = (c) => c.flete != null ? c.flete : c.comuna ? A.fleteAuto(c.comuna, c.items.map((i) => i.id)) : null;
  const totalDe = (c) => { const f = fleteDe(c); return sumaProductos(c) + (f || 0) - (c.descuento || 0); };
  const sumarDias = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const nuevoToken = () => { const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => abc[b % abc.length]).join(""); };

  // Mensaje de WhatsApp con el pedido y el link
  A.textoCarrito = (c) => {
    const f = fleteDe(c), pct = A.state.ajustes?.abono_pct || 50, total = totalDe(c);
    const nombre = (c.cliente_nombre || "").trim().split(/\s+/)[0];
    return [`¡Hola${nombre ? " " + nombre : ""}! 🎉 Te dejo tu pedido de *Party House* listo para el *${A.eventoLargo(c.fecha)}*:`, "",
      ...c.items.map((i) => `• ${i.qty}× ${i.nombre} — ${clp(i.precio * i.qty)}`),
      f != null ? `• Flete y montaje${c.comuna ? ` (${c.comuna})` : ""}: ${f ? clp(f) : "incluido"}` : "• Flete y montaje: según tu comuna",
      ...(c.descuento ? [`• Descuento: -${clp(c.descuento)}`] : []), "",
      `*Total: ${clp(total)}*${f == null ? " + flete" : ""}`,
      `Para reservar pagas el abono del ${pct}%${f != null ? ` (*${clp(Math.round(total * pct / 100))}*)` : ""} con Mercado Pago. Solo completa tus datos aquí 👇`,
      link(c), "", `El link está disponible hasta el ${A.evento(c.vence)}. ¡Cualquier duda me escribes!`].join("\n");
  };
  const enviarWA = (c) => window.open(c.cliente_telefono ? A.wa(c.cliente_telefono, A.textoCarrito(c)) : `https://wa.me/?text=${encodeURIComponent(A.textoCarrito(c))}`, "_blank", "noopener");
  const copiar = (txt, ok) => navigator.clipboard.writeText(txt).then(() => A.toast(ok), () => A.toast("No se pudo copiar", true));

  // ------------------------------------------------------------ lista
  A.route("/carritos", "carritos", async () => {
    await Promise.all([A.loadCatalog(), A.loadAjustes()]);
    const lista = await A.q(A.sb.from("carritos").select("*").order("creado", { ascending: false }).limit(200));
    const st = { tab: "activos" };
    const TABS = [["activos", "Por pagar", (c) => ["abierto", "visto"].includes(estadoDe(c))], ["pagado", "Pagados", (c) => c.estado === "pagado"],
      ["otros", "Vencidos y anulados", (c) => ["vencido", "anulado"].includes(estadoDe(c))], ["todos", "Todos", () => true]];
    A.render(`<div class="page">
      ${A.head({ title: "Carritos", sub: "Arma el pedido que el cliente te pidió por WhatsApp y envíale el link para que complete sus datos y pague el abono. Al pagar, la reserva se crea sola.",
        actions: `<a class="btn btn-orange" href="#/carritos/nuevo">🛒 Armar carrito</a>` })}
      <div class="card flush">
        <div class="tabs" id="c-tabs">${TABS.map(([k, l, fn]) => `<button data-tab="${k}">${l}<span class="c">${lista.filter(fn).length}</span></button>`).join("")}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Evento</th><th>Cliente</th><th class="hide-sm">Productos</th><th class="num">Total</th><th>Estado</th><th class="hide-sm">Enviado</th></tr></thead><tbody id="c-body"></tbody></table></div>
      </div></div>`);
    const draw = () => {
      $$("#c-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === st.tab));
      const rows = lista.filter(TABS.find((t) => t[0] === st.tab)[2]);
      $("#c-body").innerHTML = rows.length ? rows.map((c) => `<tr data-t="${esc(c.token)}" style="cursor:pointer">
        <td class="nowrap"><b>${A.evento(c.fecha)}</b>${c.horario ? `<br><small class="muted">⏰ ${esc(c.horario)}</small>` : ""}</td>
        <td class="nowrap">${esc(c.cliente_nombre || "Sin nombre")}<br><small class="muted">${esc(c.comuna || "comuna: la elige el cliente")}</small></td>
        <td class="hide-sm"><small>${esc(c.items.map((i) => (i.qty > 1 ? i.qty + "× " : "") + i.nombre).join(", "))}</small></td>
        <td class="num"><b>${clp(totalDe(c))}</b>${fleteDe(c) == null ? `<br><small class="muted">+ flete</small>` : ""}</td>
        <td>${estadoBadge(c)}${c.estado === "pagado" && c.reserva_codigo ? `<br><small class="mono">${esc(c.reserva_codigo)}</small>` : ""}</td>
        <td class="hide-sm"><small class="muted">${A.ago(c.creado)}</small></td></tr>`).join("")
        : `<tr><td colspan="6"><div class="empty-state"><div class="emo">🛒</div><h3>No hay carritos aquí</h3><p>Arma uno con los productos que el cliente te pidió por WhatsApp.</p><a class="btn btn-orange" href="#/carritos/nuevo">Armar carrito</a></div></td></tr>`;
    };
    $("#c-tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { st.tab = b.dataset.tab; draw(); } };
    $("#c-body").onclick = (e) => { const tr = e.target.closest("tr[data-t]"); if (tr) A.go(`/carritos/${tr.dataset.t}`); };
    draw();
  });

  // ------------------------------------------------------------ detalle / formulario
  A.route("/carritos/:token", "carritos", async ({ token }, query) => {
    await Promise.all([A.loadCatalog(), A.loadAjustes()]);
    if (token === "nuevo") return formulario(null, query);
    const c = await A.q(A.sb.from("carritos").select("*").eq("token", token).maybeSingle());
    if (!c) { A.render(`<div class="page"><div class="card empty-state"><div class="emo">🔎</div><h3>No encontramos ese carrito</h3><a class="btn" href="#/carritos">Volver</a></div></div>`); return; }
    if (query.editar && c.estado === "abierto") return formulario(c, query);
    detalle(c);
  });

  function detalle(c) {
    const est = estadoDe(c), f = fleteDe(c), total = totalDe(c), pct = A.state.ajustes.abono_pct;
    const editable = c.estado === "abierto";
    A.render(`<div class="page narrow">
      ${A.head({ title: `Carrito · ${esc(c.cliente_nombre || "sin nombre")}`, back: "/carritos", badges: " " + estadoBadge(c),
        sub: `Evento: <b>${esc(A.eventoLargo(c.fecha))}</b> · creado ${A.date(c.creado)}${c.creado_por ? ` por ${esc(c.creado_por)}` : ""}`,
        actions: editable ? `<a class="btn" href="#/carritos/${esc(c.token)}?editar=1">✏️ Editar</a>` : "" })}
      ${c.estado === "pagado" ? `<div class="banner ok"><div><b>¡Pagado!</b> El cliente pagó el abono${c.pagado_en ? ` el ${A.dateTime(c.pagado_en)}` : ""}. La reserva ya está creada.</div><a class="btn btn-sm" href="#/reservas/${esc(c.reserva_codigo)}">Ver reserva ${esc(c.reserva_codigo)} →</a></div>` : ""}
      ${est === "vencido" ? `<div class="banner warn"><div><b>El link venció el ${A.evento(c.vence)}.</b> Extiéndelo para que el cliente pueda pagar.</div><button class="btn btn-sm" id="k-extender">Extender 3 días</button></div>` : ""}
      ${["abierto", "visto", "vencido"].includes(est) ? `<div class="card"><div class="card-head"><h2>Link para el cliente</h2>${c.visto_en ? `<small class="muted">👀 Abierto ${A.ago(c.visto_en)}</small>` : `<small class="muted">Aún no lo abre</small>`}</div>
        <div class="row2" style="align-items:center"><input readonly value="${esc(link(c))}" id="k-link" style="font-family:monospace;font-size:13px" onclick="this.select()">
          <div class="btn-group"><button class="btn btn-green" id="k-wa">WhatsApp${c.cliente_telefono ? "" : " (elegir chat)"}</button><button class="btn" id="k-copy">Copiar link</button><button class="btn btn-plain" id="k-msg">Copiar mensaje</button></div></div>
        <p class="help" style="margin:10px 0 0">Vence el ${A.evento(c.vence)}.${c.reserva_codigo && c.estado !== "pagado" ? ` El cliente intentó pagar (reserva ${esc(c.reserva_codigo)}, pago no completado).` : ""}</p></div>` : ""}
      <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h2>Pedido</h2></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>${c.items.map((i) => { const p = A.esManual(i.id) ? null : A.prod(i.id); return `<tr>
          <td><div class="pcell">${A.thumb(p?.imagenes?.[0], A.esManual(i.id) ? "✍️" : A.catEmoji(p?.categoria))}<div><b>${esc(i.nombre)}</b><small class="muted">${esc(p?.tamano || (A.esManual(i.id) ? "Producto manual" : ""))}</small></div></div></td>
          <td class="num">${clp(i.precio)} × ${i.qty}</td><td class="num"><b>${clp(i.precio * i.qty)}</b></td></tr>`; }).join("")}</tbody></table></div>
        <div style="padding:12px 16px 16px"><dl class="kv">
          <dt>Productos</dt><dd>${clp(sumaProductos(c))}</dd>
          <dt>Flete y montaje${c.comuna ? ` (${esc(c.comuna)})` : ""}</dt><dd>${f == null ? "Según la comuna que elija" : f ? clp(f) : "Incluido"}</dd>
          ${c.descuento ? `<dt>Descuento</dt><dd>-${clp(c.descuento)}</dd>` : ""}
          <dt><b>Total</b></dt><dd><b>${clp(total)}</b>${f == null ? " + flete" : ""}</dd>
          <dt>Abono (${pct}%)</dt><dd>${f == null ? "—" : clp(Math.round(total * pct / 100))}</dd>
        </dl></div></div>
      <div class="card"><h2 style="margin-bottom:8px">Cliente</h2>
        <dl class="kv"><dt>Nombre</dt><dd>${esc(c.cliente_nombre || "—")}</dd><dt>Teléfono</dt><dd>${c.cliente_telefono ? `<a href="${A.wa(c.cliente_telefono)}" target="_blank" rel="noopener">${esc(c.cliente_telefono)}</a>` : "—"}</dd>
          <dt>Correo</dt><dd>${esc(c.cliente_email || "—")}</dd><dt>Dirección</dt><dd>${esc(c.direccion || "—")}</dd><dt>Horario</dt><dd>${esc(c.horario || "—")}</dd></dl>
        ${c.mensaje ? `<div class="sep"></div><p class="small" style="margin:0"><b>Mensaje para el cliente:</b><br>${esc(c.mensaje)}</p>` : ""}
        ${c.notas_internas ? `<div class="sep"></div><p class="small" style="margin:0"><b>Notas internas:</b><br>${esc(c.notas_internas)}</p>` : ""}
      </div>
      ${editable ? `<div class="btn-group" style="justify-content:flex-end"><button class="btn btn-plain danger" id="k-anular">Anular carrito</button></div>` : ""}
    </div>`);
    $("#k-wa")?.addEventListener("click", () => enviarWA(c));
    $("#k-copy")?.addEventListener("click", () => copiar(link(c), "Link copiado"));
    $("#k-msg")?.addEventListener("click", () => copiar(A.textoCarrito(c), "Mensaje copiado: pégalo en WhatsApp"));
    $("#k-extender")?.addEventListener("click", async () => {
      try { await A.q(A.sb.from("carritos").update({ vence: sumarDias(A.hoyKey(), 3) }).eq("id", c.id)); A.toast("Link extendido 3 días"); A.navigate(); } catch (e) { A.fail(e); }
    });
    $("#k-anular")?.addEventListener("click", async () => {
      if (!(await A.confirm({ title: "Anular carrito", message: "El link dejará de funcionar para el cliente.", ok: "Anular", danger: true }))) return;
      try { await A.q(A.sb.from("carritos").update({ estado: "anulado" }).eq("id", c.id)); A.toast("Carrito anulado"); A.go("/carritos"); } catch (e) { A.fail(e); }
    });
  }

  function formulario(c, query) {
    const nuevo = !c;
    const st = {
      lineas: c ? c.items.map((i) => ({ ...i, manual: A.esManual(i.id) })) : [{ id: "", qty: 1, precio: null }],
      oc: null,
    };
    const optsProd = A.optsProd(st.lineas.filter((l) => !l.manual));
    A.render(`<div class="page narrow">
      ${A.head({ title: nuevo ? "Armar carrito" : "Editar carrito", back: nuevo ? "/carritos" : `/carritos/${c.token}`,
        sub: "Elige lo que el cliente te pidió. Él solo completa sus datos y paga el abono con Mercado Pago; la reserva se crea sola." })}
      <form id="kf" class="stack">
        <div class="card"><h2 style="margin-bottom:12px">Evento</h2>
          <div class="row2"><label class="f">Fecha del evento<input type="date" name="fecha" required value="${esc(c?.fecha || query.fecha || "")}"></label>
            <label class="f">Comuna<select name="comuna"><option value="">La elige el cliente (flete según su comuna)</option>${A.state.comunas.filter((x) => x.activa).map((x) => `<option value="${esc(x.nombre)}" ${c?.comuna === x.nombre ? "selected" : ""}>${esc(x.nombre)} · ${clp(x.valor)}</option>`).join("")}</select></label></div>
          <p class="help" id="k-dia" style="margin:-4px 0 0"></p>
        </div>
        <div class="card"><div class="card-head"><h2>Productos</h2><div class="btn-group"><button type="button" class="btn btn-sm" id="k-add">＋ Agregar producto</button><button type="button" class="btn btn-sm" id="k-add-m">✍️ Producto manual</button></div></div>
          <div id="k-lineas"></div>
          <div class="row2" style="margin-top:8px"><label class="f">Flete y montaje<div class="prefix"><span>$</span><input name="flete" type="number" min="0" value="${c?.flete ?? ""}" placeholder="según comuna"></div><small id="k-flete-help"></small></label>
            <label class="f">Descuento<div class="prefix"><span>$</span><input name="descuento" type="number" min="0" value="${c?.descuento || 0}"></div></label></div>
          <dl class="kv" id="k-tot"></dl>
        </div>
        <div class="card"><h2 style="margin-bottom:4px">Cliente <small class="muted" style="font-weight:400">(opcional: se prellena en su formulario)</small></h2>
          <div class="row2"><label class="f">Nombre<input name="cliente_nombre" value="${esc(c?.cliente_nombre || "")}"></label><label class="f">Teléfono / WhatsApp<input name="cliente_telefono" type="tel" value="${esc(c?.cliente_telefono || "")}" placeholder="+56 9 … (para enviarle el link)"></label></div>
          <div class="row2"><label class="f">Correo<input name="cliente_email" type="email" value="${esc(c?.cliente_email || "")}"></label><label class="f">Horario de instalación<input name="horario" value="${esc(c?.horario || "")}" placeholder="Ej: 15:00"></label></div>
          <label class="f">Dirección del evento<input name="direccion" value="${esc(c?.direccion || "")}" placeholder="Calle, número, casa/depto"></label>
        </div>
        <div class="card"><h2 style="margin-bottom:12px">Mensajes</h2>
          <label class="f">Mensaje para el cliente <small>(aparece arriba de su formulario)</small><textarea name="mensaje" rows="2" placeholder="Ej: ¡Hola! Te dejé el pack con 10% de descuento como conversamos 😊">${esc(c?.mensaje || "")}</textarea></label>
          <label class="f">Notas internas <small>(pasan a la reserva; el cliente no las ve)</small><textarea name="notas_internas" rows="2">${esc(c?.notas_internas || "")}</textarea></label>
          <div class="row2"><label class="f">El link vence el<input type="date" name="vence" required value="${esc(c?.vence || sumarDias(A.hoyKey(), 3))}"></label><div></div></div>
          <p class="form-error" id="k-err"></p>
          <button class="btn btn-orange" style="width:100%;padding:12px;margin-top:8px">${nuevo ? "Guardar y obtener link →" : "Guardar cambios"}</button>
        </div>
      </form></div>`);
    const f = $("#kf");
    const ids = () => st.lineas.filter((l) => l.id).map((l) => l.id);
    const leer = () => ({
      fecha: f.fecha.value, comuna: f.comuna.value || null, flete: f.flete.value === "" ? null : A.int(f.flete.value), descuento: A.int(f.descuento.value) || 0,
      items: st.lineas.filter((l) => l.id).map((l) => ({ id: l.id, nombre: l.manual ? l.nombre : (A.prod(l.id)?.nombre || l.nombre), qty: l.qty, precio: l.precio ?? A.prod(l.id)?.precio ?? 0, ...(l.manual ? { manual: true } : {}) })),
    });
    const totales = () => {
      $("#k-err").textContent = "";
      const k = leer(), auto = k.comuna ? A.fleteAuto(k.comuna, ids()) : null;
      $("#k-flete-help").textContent = k.comuna ? (auto != null ? `Según ${k.comuna}: ${clp(auto)}` : "") : "Vacío = se calcula con la comuna que elija el cliente";
      const flete = k.flete ?? auto, sub = k.items.reduce((s, i) => s + i.precio * i.qty, 0);
      const total = sub + (flete || 0) - k.descuento, pct = A.state.ajustes.abono_pct;
      $("#k-tot").innerHTML = `<dt>Productos</dt><dd>${clp(sub)}</dd><dt>Flete y montaje</dt><dd>${flete == null ? "según comuna del cliente" : clp(flete)}</dd>
        ${k.descuento ? `<dt>Descuento</dt><dd>-${clp(k.descuento)}</dd>` : ""}<dt><b>Total</b></dt><dd><b>${clp(total)}</b>${flete == null ? " + flete" : ""}</dd>
        <dt>Abono que pagará (${pct}%)</dt><dd>${flete == null ? "según comuna" : clp(Math.round(total * pct / 100))}</dd>`;
    };
    const drawLineas = () => {
      $("#k-lineas").innerHTML = st.lineas.map((l, i) => {
        const p = A.prod(l.id), oc = st.oc && l.id && !l.manual ? st.oc.ocupados[l.id] : null;
        return `<div class="linea-prod" data-i="${i}">
          ${l.manual ? `<input data-k="nombre" value="${esc(l.nombre || "")}" placeholder="Nombre del producto o servicio" maxlength="120">` : `<select data-k="id">${optsProd.replace(`value="${esc(l.id)}"`, `value="${esc(l.id)}" selected`)}</select>`}
          <input data-k="qty" type="number" min="1" value="${l.qty}" aria-label="Cantidad">
          <div class="prefix"><span>$</span><input data-k="precio" type="number" min="0" value="${l.precio ?? p?.precio ?? ""}" placeholder="Precio" aria-label="Precio unitario"></div>
          <button type="button" class="btn btn-plain danger" data-del="${i}" aria-label="Quitar">✕</button>
          ${oc ? `<small style="grid-column:1/-1;color:var(--red);font-weight:700;margin-top:-4px">⚠ Ocupado ese día: ${esc(oc)}</small>` : ""}
        </div>`;
      }).join("");
      totales();
    };
    const fleteAuto = () => { if (!f.comuna.value) { totales(); return; } const a = A.fleteAuto(f.comuna.value, ids()); if (a != null) f.flete.value = a; totales(); };
    const revisarDia = async () => {
      st.oc = null;
      if (!f.fecha.value) { $("#k-dia").textContent = ""; return drawLineas(); }
      st.oc = await A.ocupacionDia(f.fecha.value);
      const n = Object.keys(st.oc.ocupados).length;
      $("#k-dia").innerHTML = st.oc.cerrado ? `<b style="color:var(--red)">⚠ Ese día está marcado como cerrado.</b>` : `${A.eventoLargo(f.fecha.value)} · ${n ? `${n} producto(s) ya ocupados ese día` : "todo disponible"}`;
      drawLineas();
    };
    $("#k-add").onclick = () => { st.lineas.push({ id: "", qty: 1, precio: null }); drawLineas(); };
    $("#k-add-m").onclick = () => {
      if (st.lineas.length === 1 && !st.lineas[0].id) st.lineas.pop();
      st.lineas.push(A.lineaManual()); drawLineas(); fleteAuto(); $("#k-lineas .linea-prod:last-child [data-k=nombre]").focus();
    };
    $("#k-lineas").addEventListener("change", (e) => {
      const row = e.target.closest("[data-i]"); if (!row) return;
      const l = st.lineas[+row.dataset.i], k = e.target.dataset.k;
      if (k === "id") { l.id = e.target.value; l.precio = null; l.nombre = A.prod(l.id)?.nombre || ""; drawLineas(); fleteAuto(); return; }
      if (k === "nombre") l.nombre = e.target.value.trim();
      if (k === "qty") l.qty = Math.max(1, A.int(e.target.value) || 1);
      if (k === "precio") l.precio = e.target.value === "" ? null : Math.max(0, A.int(e.target.value));
      totales();
    });
    $("#k-lineas").addEventListener("input", (e) => { if (e.target.dataset.k === "nombre") st.lineas[+e.target.closest("[data-i]").dataset.i].nombre = e.target.value.trim(); });
    $("#k-lineas").addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { st.lineas.splice(+d.dataset.del, 1); if (!st.lineas.length) st.lineas.push({ id: "", qty: 1, precio: null }); drawLineas(); fleteAuto(); } });
    f.comuna.onchange = () => { f.flete.value = ""; fleteAuto(); };
    f.fecha.onchange = revisarDia;
    ["flete", "descuento"].forEach((n) => (f[n].oninput = totales));

    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = (m) => { $("#k-err").textContent = m; };
      const k = leer();
      if (!k.fecha) return err("Elige la fecha del evento");
      if (!k.items.length) return err("Agrega al menos un producto");
      if (st.lineas.some((l) => l.manual && !l.nombre)) return err("Escribe el nombre del producto manual");
      if (st.lineas.some((l) => l.manual && l.precio == null)) return err("Indica el precio del producto manual");
      if (sumaProductos(k) + (k.flete ?? 0) - k.descuento <= 0) return err("El total debe ser mayor a $0");
      if (!f.vence.value) return err("Indica hasta cuándo vale el link");
      const malos = st.oc ? k.items.filter((i) => !i.manual && st.oc.ocupados[i.id]) : [];
      if (malos.length && !(await A.confirm({ title: "Producto ocupado", message: `No disponible ese día: ${esc(malos.map((i) => `${i.nombre} (${st.oc.ocupados[i.id]})`).join(", "))}.<br><br>Si el cliente intenta pagar, el sistema no lo dejará. ¿Guardar igual?`, ok: "Guardar igual", danger: true }))) return;
      const tel = f.cliente_telefono.value.trim();
      const datos = { ...k, cliente_nombre: f.cliente_nombre.value.trim() || null, cliente_telefono: tel || null, cliente_email: f.cliente_email.value.trim().toLowerCase() || null,
        direccion: f.direccion.value.trim() || null, horario: f.horario.value.trim() || null, mensaje: f.mensaje.value.trim() || null,
        notas_internas: f.notas_internas.value.trim() || null, vence: f.vence.value };
      const btn = f.querySelector("button.btn-orange"); btn.disabled = true; err("");
      try {
        let token = c?.token;
        if (nuevo) {
          for (let intento = 0; intento < 3; intento++) {
            token = nuevoToken();
            const { error } = await A.sb.from("carritos").insert({ ...datos, token, creado_por: A.state.user?.email || null });
            if (!error) break;
            if (error.code !== "23505" || intento === 2) throw error;
          }
        } else {
          await A.q(A.sb.from("carritos").update(datos).eq("id", c.id));
        }
        A.toast(nuevo ? "Carrito listo: envíale el link 🎉" : "Carrito actualizado");
        A.go(`/carritos/${token}`);
      } catch (ex) { btn.disabled = false; err(ex.message || "No se pudo guardar"); }
    };
    drawLineas();
    if (f.fecha.value) revisarDia();
  }
})();
