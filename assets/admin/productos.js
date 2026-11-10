/* =====================================================================
   Panel · Productos (listado, ficha con fotos) y Categorías
   ===================================================================== */
(() => {
  const { $, $$, esc, clp } = A;
  const TINTS = [["magenta", "Magenta"], ["cyan", "Cian"], ["acid", "Verde ácido"], ["orange", "Naranjo"], ["purple", "Morado"]];
  const BADGES = [["sale", "OFERTA"], ["new", "NUEVO"], ["incluye", "+ AUDIO · LUCES"]];
  const refrescarSitio = () => A.toast("Guardado. El sitio se actualiza en ~1 minuto.");

  // ------------------------------------------------------------ listado
  A.route("/productos", "productos", async (_, query) => {
    await A.loadCatalog(true);
    const st = { f: query.f || "todos", cat: query.c || "", q: "" };
    const FILTROS = [["todos", "Todos", () => true], ["visibles", "Visibles", (p) => p.activo], ["ocultos", "Ocultos", (p) => !p.activo],
      ["oferta", "En oferta", (p) => p.precio_antes], ["sinfoto", "Sin foto", (p) => !p.imagenes.length], ["unicos", "Unidad única", (p) => p.bloqueo_automatico]];
    A.render(`<div class="page">
      ${A.head({ title: "Productos", actions: `<button class="btn" id="p-csv">Exportar</button><a class="btn btn-orange" href="#/productos/nuevo">＋ Agregar producto</a>` })}
      <div class="card flush">
        <div class="tabs" id="p-tabs">${FILTROS.map(([k, l]) => `<button data-f="${k}">${l}<span class="c"></span></button>`).join("")}</div>
        <div class="toolbar"><div class="grow"><input id="p-q" type="search" placeholder="Buscar productos"></div>
          <select id="p-cat"><option value="">Todas las categorías</option>${A.state.categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.icono)} ${esc(c.nombre)}</option>`).join("")}</select></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="hide-sm">Categoría</th><th class="num">Precio</th><th class="hide-sm">Reglas</th><th>Estado</th></tr></thead><tbody id="p-body"></tbody></table></div>
      </div></div>`);
    const visible = () => A.state.productos.filter((p) => FILTROS.find((f) => f[0] === st.f)[2](p) && (!st.cat || p.categoria === st.cat) && (!st.q || A.match(`${p.nombre} ${p.id} ${p.tamano} ${p.corto}`, st.q)));
    function draw() {
      const rows = visible();
      $("#p-body").innerHTML = rows.map((p) => `<tr class="click" data-id="${esc(p.id)}">
        <td><div class="pcell">${A.thumb(p.imagenes[0], A.catEmoji(p.categoria))}<div><b>${esc(p.nombre)}</b><small class="muted">${esc(p.tamano)}${p.capacidad ? ` · ${esc(p.capacidad)}` : ""}</small></div></div></td>
        <td class="hide-sm">${esc(A.catName(p.categoria))}</td>
        <td class="num"><b>${clp(p.precio)}</b>${p.precio_antes ? `<br><small class="muted"><s>${clp(p.precio_antes)}</s></small>` : ""}</td>
        <td class="hide-sm">${p.bloqueo_automatico ? A.badge("1 unidad", "b-violet") : ""} ${p.equipo ? A.badge(`equipo: ${p.equipo}`, "b-info") : ""} ${p.sin_flete ? A.badge("sin flete", "b-gray") : ""}</td>
        <td>${p.activo ? A.badge("Visible", "b-green") : A.badge("Oculto", "b-gray")}</td></tr>`).join("") ||
        `<tr><td colspan="5"><div class="empty-state"><div class="emo">🔎</div><h3>Sin productos</h3></div></td></tr>`;
      $$("#p-tabs button").forEach((b) => { b.classList.toggle("on", b.dataset.f === st.f); b.querySelector(".c").textContent = A.state.productos.filter(FILTROS.find((f) => f[0] === b.dataset.f)[2]).length; });
    }
    $("#p-tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { st.f = b.dataset.f; draw(); } };
    $("#p-q").oninput = A.debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150);
    $("#p-cat").onchange = (e) => { st.cat = e.target.value; draw(); };
    $("#p-body").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) A.go(`/productos/${encodeURIComponent(tr.dataset.id)}`); };
    $("#p-csv").onclick = () => A.csv("productos-party-house.csv", [["ID", "Nombre", "Categoría", "Tamaño", "Capacidad", "Precio", "Precio antes", "Visible", "Unidad única", "Equipo", "Sin flete", "Fotos"],
      ...visible().map((p) => [p.id, p.nombre, A.catName(p.categoria), p.tamano, p.capacidad, p.precio, p.precio_antes || "", p.activo ? "sí" : "no", p.bloqueo_automatico ? "sí" : "no", p.equipo || "", p.sin_flete ? "sí" : "no", p.imagenes.length])]);
    draw();
  });

  // ------------------------------------------------------------ ficha de producto
  A.route("/productos/:id", "productos", async ({ id }) => {
    await A.loadCatalog(true);
    const nuevo = id === "nuevo";
    const orig = nuevo ? { id: "", nombre: "", categoria: A.state.categorias[0]?.id, etiqueta: "", tamano: "", capacidad: "", precio: 0, precio_antes: null, tint: "magenta",
      badges: [], imagenes: [], corto: "", largo: "", incluye: [], orden: A.state.productos.length, activo: true, bloqueo_automatico: false, sin_flete: false, equipo: null } : A.prod(id);
    if (!orig) { A.render(`<div class="page"><div class="card empty-state"><div class="emo">🔎</div><h3>Producto no encontrado</h3><a class="btn" href="#/productos">Volver</a></div></div>`); return; }
    const p = JSON.parse(JSON.stringify(orig));
    const equipos = [...new Set(A.state.productos.map((x) => x.equipo).filter(Boolean))];
    // Uso en reservas (últimos 12 meses) para mostrar en la ficha
    let uso = [];
    if (!nuevo) {
      const desde = A.dayKey(new Date(Date.now() - 365 * 864e5));
      uso = (await A.q(A.sb.from("reservas").select("codigo, fechas, items, estado").eq("estado", "pagado").gte("creada", desde))).filter((r) => r.items.some((i) => i.id === p.id));
    }

    A.render(`<div class="page">
      ${A.head({ title: nuevo ? "Agregar producto" : esc(p.nombre), back: "/productos", badges: nuevo ? "" : ` ${p.activo ? A.badge("Visible", "b-green") : A.badge("Oculto", "b-gray")}`,
        actions: nuevo ? "" : `<a class="btn" href="${A.storeUrl()}/producto.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Ver en el sitio ↗</a>
          <div class="dd"><button class="btn" id="pr-more">Más ▾</button><div class="dd-menu" id="pr-more-menu" hidden><button data-a="dup">Duplicar</button><button data-a="del" class="danger">Eliminar producto</button></div></div>` })}
      <form id="pf" class="cols">
        <div class="stack">
          <div class="card">
            <label class="f">Nombre<input name="nombre" value="${esc(p.nombre)}" required></label>
            <div class="row2"><label class="f">Tamaño / formato<input name="tamano" value="${esc(p.tamano)}" placeholder="5 × 5 mts"></label>
              <label class="f">Capacidad / detalle<input name="capacidad" value="${esc(p.capacidad)}" placeholder="25–30 personas"></label></div>
            <label class="f">Descripción corta <small>(tarjetas del catálogo)</small><textarea name="corto" rows="2">${esc(p.corto)}</textarea></label>
            <label class="f">Descripción completa <small>(ficha del producto)</small><textarea name="largo" rows="5">${esc(p.largo)}</textarea></label>
            <label class="f">Qué incluye <small>(uno por línea)</small><textarea name="incluye" rows="4">${esc(p.incluye.join("\n"))}</textarea></label>
          </div>
          <div class="card"><div class="card-head"><h2>Fotos</h2><small class="muted">La primera es la principal · arrastra para ordenar</small></div>
            <div class="fotos" id="fotos"></div>
            <input type="file" id="f-file" accept="image/*" multiple hidden>
            <button type="button" class="btn btn-sm btn-plain" id="f-url" style="margin-top:8px">＋ Agregar foto por enlace</button>
          </div>
          <div class="card"><h2 style="margin-bottom:10px">Precio</h2>
            <div class="row2"><label class="f">Precio por noche<div class="prefix"><span>$</span><input name="precio" type="number" min="0" value="${p.precio}" required></div></label>
              <label class="f">Precio "antes" <small>(opcional, muestra oferta)</small><div class="prefix"><span>$</span><input name="precio_antes" type="number" min="0" value="${p.precio_antes ?? ""}"></div></label></div>
          </div>
          ${nuevo ? "" : `<div class="card"><h2 style="margin-bottom:8px">Reservas (últimos 12 meses)</h2>
            <p style="margin:0">${uso.length ? `<b>${uso.length}</b> reserva(s) confirmadas · próximas: ${uso.filter((r) => A.fechaEv(r) >= A.hoyKey()).map((r) => `<a href="#/reservas/${r.codigo}">${A.evento(A.fechaEv(r))}</a>`).join(", ") || "ninguna"}` : `<span class="muted">Sin reservas todavía.</span>`}</p></div>`}
        </div>
        <div class="stack">
          <div class="card"><h2 style="margin-bottom:10px">Publicación</h2>
            <label class="switch" style="margin-bottom:12px"><input type="checkbox" name="activo" ${p.activo ? "checked" : ""}> Visible en el sitio</label>
            <label class="f">Categoría<select name="categoria">${A.state.categorias.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categoria ? "selected" : ""}>${esc(c.icono)} ${esc(c.nombre)}</option>`).join("")}</select></label>
            <label class="f">Etiqueta de la tarjeta <small>(opcional; si no, se usa la categoría)</small><input name="etiqueta" value="${esc(p.etiqueta || "")}" placeholder="Ej: Mobiliario LED"></label>
            <label class="f">Insignias</label><div class="chips" style="margin:-6px 0 12px">${BADGES.map(([k, l]) => `<label class="chip"><input type="checkbox" name="badge" value="${k}" ${p.badges.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
            <label class="f">Color de respaldo <small>(si no hay foto)</small><select name="tint">${TINTS.map(([k, l]) => `<option value="${k}" ${k === p.tint ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label class="f">Orden en el catálogo<input name="orden" type="number" value="${p.orden}"></label>
            ${nuevo ? `<label class="f">Identificador en la dirección web<input name="id" placeholder="se genera del nombre" pattern="[a-z0-9-]+"><small>producto.html?id=… · solo minúsculas, números y guiones</small></label>` : `<p class="help" style="margin:0">Dirección: <span class="mono">producto.html?id=${esc(p.id)}</span></p>`}
          </div>
          <div class="card"><h2 style="margin-bottom:10px">Reglas de reserva</h2>
            <label class="switch" style="margin-bottom:6px"><input type="checkbox" name="bloqueo_automatico" ${p.bloqueo_automatico ? "checked" : ""}> Tengo una sola unidad</label>
            <p class="help" style="margin:0 0 12px">Al confirmarse una reserva, la fecha se bloquea sola para este producto.</p>
            <label class="f">Equipo compartido <small>(opcional)</small><input name="equipo" list="equipos" value="${esc(p.equipo || "")}" placeholder="Ej: equipo-1"><datalist id="equipos">${equipos.map((e) => `<option value="${esc(e)}">${esc(A.state.productos.filter((x) => x.equipo === e).map((x) => x.nombre).join(" + "))}</option>`).join("")}</datalist>
              <small>Productos con el mismo equipo usan la misma carpa: si uno está reservado, los demás también quedan ocupados.</small></label>
            <label class="switch" style="margin-bottom:6px"><input type="checkbox" name="sin_flete" ${p.sin_flete ? "checked" : ""}> Ya incluye su transporte</label>
            <p class="help" style="margin:0">Si el pedido trae solo productos así, no se cobra flete.</p>
          </div>
          ${nuevo ? `<button class="btn btn-orange" style="padding:12px">Crear producto</button>` : ""}
        </div>
      </form></div>`);

    const f = $("#pf");
    const leer = () => ({
      nombre: f.nombre.value.trim(), tamano: f.tamano.value.trim(), capacidad: f.capacidad.value.trim(), corto: f.corto.value.trim(), largo: f.largo.value.trim(),
      incluye: f.incluye.value.split("\n").map((x) => x.trim()).filter(Boolean), precio: A.int(f.precio.value) || 0,
      precio_antes: A.int(f.precio_antes.value) || null, activo: f.activo.checked, categoria: f.categoria.value, etiqueta: f.etiqueta.value.trim() || null,
      badges: $$("input[name=badge]:checked", f).map((x) => x.value), tint: f.tint.value, orden: A.int(f.orden.value) || 0,
      bloqueo_automatico: f.bloqueo_automatico.checked, equipo: f.equipo.value.trim() || null, sin_flete: f.sin_flete.checked, imagenes: p.imagenes,
    });
    const validar = (d) => {
      if (!d.nombre) return "Falta el nombre";
      if (d.precio_antes && d.precio_antes <= d.precio) return "El precio \"antes\" debe ser mayor al precio actual";
      return null;
    };
    async function guardar() {
      const d = leer(); const err = validar(d);
      if (err) { A.toast(err, true); return; }
      try {
        await A.q(A.sb.from("productos").update({ ...d, updated_at: new Date().toISOString() }).eq("id", p.id));
        Object.assign(orig, d); A.clearDirty(); refrescarSitio(); A.loadCatalog(true);
      } catch (e) { A.fail(e); }
    }
    if (!nuevo) {
      f.addEventListener("input", () => A.setDirty(guardar, () => A.navigate()));
      f.addEventListener("change", () => A.setDirty(guardar, () => A.navigate()));
      A.dropdown($("#pr-more"), $("#pr-more-menu"));
      $("#pr-more-menu").onclick = async (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "dup") {
          const nid = `${p.id}-copia-${Date.now().toString(36).slice(-4)}`;
          try { await A.q(A.sb.from("productos").insert({ ...orig, id: nid, nombre: orig.nombre + " (copia)", activo: false, created_at: undefined, updated_at: undefined })); await A.loadCatalog(true); A.toast("Copia creada (oculta)"); A.go(`/productos/${nid}`); } catch (er) { A.fail(er); }
        }
        if (a === "del") {
          if (uso.some((r) => A.fechaEv(r) >= A.hoyKey())) return A.toast("Tiene reservas próximas: mejor ocúltalo en vez de eliminarlo", true);
          if (!(await A.confirm({ title: "Eliminar producto", message: `Se eliminará <b>${esc(p.nombre)}</b> del catálogo. Las reservas pasadas mantienen su detalle. Si solo quieres sacarlo del sitio, ocúltalo.`, ok: "Eliminar", danger: true }))) return;
          try { await A.q(A.sb.from("productos").delete().eq("id", p.id)); await A.loadCatalog(true); A.toast("Producto eliminado"); A.go("/productos"); } catch (er) { A.fail(er); }
        }
      };
    } else {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const d = leer(); const err = validar(d);
        if (err) return A.toast(err, true);
        const nid = A.slugify(f.id.value || `${d.nombre} ${d.tamano}`);
        if (!nid) return A.toast("Escribe un identificador válido", true);
        if (A.prod(nid)) return A.toast("Ya existe un producto con ese identificador", true);
        try { await A.q(A.sb.from("productos").insert({ ...d, id: nid })); await A.loadCatalog(true); refrescarSitio(); A.go(`/productos/${nid}`); } catch (er) { A.fail(er); }
      };
    }

    // ---- fotos
    function drawFotos() {
      $("#fotos").innerHTML = p.imagenes.map((u, i) => `<div class="ft" draggable="true" data-i="${i}"><img src="${esc(u)}" alt="" loading="lazy">${i === 0 ? `<span class="principal">Principal</span>` : ""}<button type="button" data-del="${i}" aria-label="Quitar foto">✕</button></div>`).join("") +
        `<div class="drop" id="f-drop">📷<br>Subir fotos<br><small>o arrástralas aquí</small></div>`;
      $("#f-drop").onclick = () => $("#f-file").click();
    }
    const cambio = () => { drawFotos(); if (!nuevo) A.setDirty(guardar, () => A.navigate()); };
    async function subir(files) {
      const imgs = [...files].filter((x) => x.type.startsWith("image/"));
      if (!imgs.length) return;
      A.toast(`Subiendo ${imgs.length} foto(s)…`);
      for (const file of imgs) { try { p.imagenes.push(await A.upload(file, "productos")); } catch (e) { A.fail(e, "No se pudo subir la foto"); } }
      cambio();
    }
    $("#f-file").onchange = (e) => { subir(e.target.files); e.target.value = ""; };
    $("#fotos").addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { p.imagenes.splice(+d.dataset.del, 1); cambio(); } });
    $("#fotos").addEventListener("dragover", (e) => { e.preventDefault(); $("#f-drop")?.classList.add("over"); });
    $("#fotos").addEventListener("dragleave", () => $("#f-drop")?.classList.remove("over"));
    let arrastrando = null;
    $("#fotos").addEventListener("dragstart", (e) => { const t = e.target.closest(".ft"); if (t) arrastrando = +t.dataset.i; });
    $("#fotos").addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer.files?.length) return subir(e.dataTransfer.files);
      const t = e.target.closest(".ft");
      if (arrastrando != null && t) { const [x] = p.imagenes.splice(arrastrando, 1); p.imagenes.splice(+t.dataset.i, 0, x); cambio(); }
      arrastrando = null;
    });
    $("#f-url").onclick = async () => {
      const v = await A.ask({ title: "Agregar foto por enlace", ok: "Agregar", fields: [{ name: "u", label: "Enlace de la imagen (https://…)", type: "url", required: true }] });
      if (v && /^https:\/\//.test(v.u)) { p.imagenes.push(v.u); cambio(); }
    };
    drawFotos();
  });

  // ------------------------------------------------------------ categorías
  A.route("/categorias", "categorias", async () => {
    await A.loadCatalog(true);
    const draw = () => A.render(`<div class="page narrow">
      ${A.head({ title: "Categorías", actions: `<button class="btn btn-orange" id="c-new">＋ Agregar categoría</button>` })}
      <div class="card flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Categoría</th><th class="num">Productos</th><th class="num">Orden</th><th>Estado</th><th></th></tr></thead><tbody>
      ${A.state.categorias.map((c) => `<tr><td><b>${esc(c.icono)} ${esc(c.nombre)}</b><br><small class="muted mono">${esc(c.id)}</small></td>
        <td class="num"><a href="#/productos?c=${encodeURIComponent(c.id)}">${A.state.productos.filter((p) => p.categoria === c.id).length}</a></td><td class="num">${c.orden}</td>
        <td>${c.activa ? A.badge("Visible", "b-green") : A.badge("Oculta", "b-gray")}</td>
        <td class="num"><button class="btn btn-sm" data-e="${esc(c.id)}">Editar</button></td></tr>`).join("")}
      </tbody></table></div></div>
      <p class="help">Ocultar una categoría saca del sitio todos sus productos.</p></div>`);
    const editar = async (c) => {
      const v = await A.ask({ title: c ? "Editar categoría" : "Nueva categoría", ok: "Guardar", fields: [
        { name: "nombre", label: "Nombre", value: c?.nombre || "", required: true },
        { name: "icono", label: "Ícono (emoji)", value: c?.icono || "✦" },
        { name: "orden", label: "Orden", type: "number", value: c?.orden ?? A.state.categorias.length },
        { name: "activa", label: "Visible en el sitio", type: "checkbox", value: c ? c.activa : true }] });
      if (!v) return;
      try {
        if (c) await A.q(A.sb.from("categorias").update({ nombre: v.nombre, icono: v.icono || "✦", orden: A.int(v.orden) || 0, activa: v.activa }).eq("id", c.id));
        else await A.q(A.sb.from("categorias").insert({ id: A.slugify(v.nombre), nombre: v.nombre, icono: v.icono || "✦", orden: A.int(v.orden) || 0, activa: v.activa }));
        await A.loadCatalog(true); refrescarSitio(); draw(); bind();
      } catch (e) { A.fail(e); }
    };
    const bind = () => {
      $("#c-new").onclick = () => editar(null);
      $$("[data-e]").forEach((b) => (b.onclick = () => editar(A.state.categorias.find((c) => c.id === b.dataset.e))));
    };
    draw(); bind();
  });
})();
