// Party House — site-wide behavior (cart, search, newsletter, FAQ, etc.)
(function(){
  'use strict';

  // ============ CART (localStorage) ============
  const CART_KEY = 'ph_cart_v1';
  const PH = window.PH = window.PH || {};

  PH.getCart = function(){
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch(e){ return []; }
  };
  PH.saveCart = function(cart){
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    PH.updateCartBadge();
    window.dispatchEvent(new Event('ph:cart:change'));
  };
  PH.addToCart = function(productId, opts){
    opts = opts || {};
    const cart = PH.getCart();
    const existing = cart.find(c => c.id === productId && c.date === (opts.date||null));
    if(existing){ existing.qty += (opts.qty||1); }
    else {
      cart.push({ id: productId, qty: opts.qty || 1, date: opts.date || null, addedAt: Date.now() });
    }
    PH.saveCart(cart);
    if(!opts.silent){
      PH.toast('✓ Agregado al carrito', 'success');
      PH.celebrate({ particleCount: 60, spread: 60 });
    }
    PH.track('agregar_carrito', { producto: productId });
  };
  PH.removeFromCart = function(productId, date){
    let cart = PH.getCart();
    cart = cart.filter(c => !(c.id === productId && c.date === (date||null)));
    PH.saveCart(cart);
  };
  PH.updateQty = function(productId, date, qty){
    const cart = PH.getCart();
    const item = cart.find(c => c.id === productId && c.date === (date||null));
    if(item){
      item.qty = Math.max(1, qty);
      PH.saveCart(cart);
    }
  };
  PH.cartTotal = function(){
    const cart = PH.getCart();
    const products = window.PH_PRODUCTS || [];
    return cart.reduce((sum, item) => {
      const p = products.find(x => x.id === item.id);
      return sum + (p ? p.price * item.qty : 0);
    }, 0);
  };
  PH.cartCount = function(){
    return PH.getCart().reduce((s,i)=>s+i.qty, 0);
  };
  PH.updateCartBadge = function(){
    document.querySelectorAll('.cart-count').forEach(el => {
      const n = PH.cartCount();
      el.textContent = n;
      el.classList.toggle('empty', n === 0);
    });
  };
  PH.getProduct = function(id){
    return (window.PH_PRODUCTS || []).find(p => p.id === id);
  };
  PH.formatCLP = function(n){
    return '$' + Number(n).toLocaleString('es-CL');
  };
  // Render product image: real photo if available, else striped placeholder.
  PH.photo = function(p, opts){
    opts = opts || {};
    const src = opts.src || (p && p.img) || null;
    const label = opts.label != null ? opts.label
      : (p ? (p.name + (p.size ? ' · ' + p.size : '')) : ' ');
    if(src){
      const safe = String(label).replace(/"/g, '&quot;');
      return '<img class="photo-img" src="' + src + '" alt="' + safe + '" loading="lazy" />';
    }
    const tint = (p && p.tint) || 'magenta';
    return '<div class="photo tint-' + tint + '" data-label="' + label + '"></div>';
  };

  // ============ TOAST ============
  PH.toast = function(msg, type){
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 2400);
  };

  // ============ SEARCH ============
  PH.openSearch = function(){
    let overlay = document.querySelector('.search-overlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.className = 'search-overlay';
      overlay.innerHTML = `
        <button class="search-close" aria-label="Cerrar">✕</button>
        <div class="search-box">
          <input type="text" placeholder="¿Qué buscas?" autofocus />
          <div class="search-hint">Escribe para buscar carpas, mobiliario, juegos…</div>
          <div class="search-results"></div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.search-close').addEventListener('click', PH.closeSearch);
      overlay.addEventListener('click', e => { if(e.target === overlay) PH.closeSearch(); });
      overlay.querySelector('input').addEventListener('input', e => {
        renderSearchResults(e.target.value);
      });
      document.addEventListener('keydown', e => {
        if(e.key === 'Escape') PH.closeSearch();
      });
    }
    overlay.classList.add('open');
    setTimeout(() => overlay.querySelector('input').focus(), 80);
  };
  PH.closeSearch = function(){
    const overlay = document.querySelector('.search-overlay');
    if(overlay) overlay.classList.remove('open');
  };
  function renderSearchResults(query){
    const wrap = document.querySelector('.search-results');
    if(!wrap) return;
    const q = query.trim().toLowerCase();
    if(!q){ wrap.innerHTML = ''; return; }
    const matches = (window.PH_PRODUCTS||[]).filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.categoryName.toLowerCase().includes(q) ||
      (p.short||'').toLowerCase().includes(q)
    );
    if(matches.length === 0){
      wrap.innerHTML = '<div class="search-empty">No encontramos nada para "' + q + '"</div>';
      return;
    }
    wrap.innerHTML = matches.map(p => `
      <a class="search-result" href="producto.html?id=${p.id}">
        <div>
          <div class="name">${p.name}</div>
          <div class="meta">${p.categoryName} · ${p.size}</div>
        </div>
        <div class="price">${PH.formatCLP(p.price)}</div>
      </a>`).join('');
  }

  // ============ FAQ ACCORDION ============
  PH.initFAQ = function(scope){
    (scope || document).querySelectorAll('.faq-item').forEach(it => {
      if(it.dataset.bound) return;
      it.dataset.bound = '1';
      it.addEventListener('click', e => {
        // don't double-fire on nested clicks
        if(e.target.closest('a,button')) return;
        it.classList.toggle('open');
      });
    });
  };

  // ============ NEWSLETTER ============
  PH.initNewsletter = function(){
    document.querySelectorAll('.news-input').forEach(form => {
      if(form.dataset.bound) return;
      form.dataset.bound = '1';
      const btn = form.querySelector('button');
      const input = form.querySelector('input');
      const submit = () => {
        const val = (input.value || '').trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)){
          PH.toast('Email inválido', 'error');
          input.focus();
          return;
        }
        input.value = '';
        PH.toast('✓ Listo. Te avisamos las novedades.', 'success');
      };
      btn.addEventListener('click', e => { e.preventDefault(); submit(); });
      input.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); submit(); }});
    });
  };

  // ============ NAV WIRING ============
  PH.initNav = function(){
    // search trigger
    document.querySelectorAll('[data-search]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); PH.openSearch(); });
    });
    // WhatsApp links: ensure they always open in a new tab (native anchor behavior).
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href*="wa.me"], a[href*="whatsapp.com"]');
      if(!a) return;
      a.target = '_blank';
      a.rel = 'noopener';
      PH.track('click_whatsapp', { pagina: location.pathname.split('/').pop() || 'index.html' });
      // let the browser handle the navigation natively — do NOT call window.open()
    });
    // cart badge updates on storage events from other tabs
    window.addEventListener('storage', e => {
      if(e.key === CART_KEY) PH.updateCartBadge();
    });
    PH.updateCartBadge();
  };

  // ============ WHATSAPP HELPERS ============
  PH.waLink = function(message){
    const phone = '56956981681';
    return 'https://wa.me/' + phone + (message ? '?text=' + encodeURIComponent(message) : '');
  };

  // ============ DISPONIBILIDAD ============
  // Datos en assets/disponibilidad.js (lo edita el dueño). Fechas en formato 'AAAA-MM-DD'.
  function dispo(){ return window.PH_DISPONIBILIDAD || {}; }
  PH.toISODate = function(d){
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  };
  PH.bookingWindow = function(){
    const cfg = dispo();
    const today = new Date(); today.setHours(0,0,0,0);
    const min = new Date(today); min.setDate(min.getDate() + (cfg.diasAnticipacion != null ? cfg.diasAnticipacion : 3));
    const max = new Date(today); max.setMonth(max.getMonth() + (cfg.mesesMaximo || 4));
    return { today: today, min: min, max: max };
  };
  // Devuelve null si la fecha está disponible, o un texto con el motivo si no lo está.
  PH.unavailableReason = function(productId, dateStr){
    if(!dateStr) return null;
    const cfg = dispo();
    const w = PH.bookingWindow();
    const d = new Date(dateStr + 'T00:00');
    if(d < w.min) return 'Reservamos con al menos ' + (cfg.diasAnticipacion != null ? cfg.diasAnticipacion : 3) + ' días de anticipación';
    if(d > w.max) return 'Esa fecha aún no está abierta para reservas';
    if((cfg.cerrado || []).includes(dateStr)) return 'Ese día no tenemos atención';
    const grupo = (cfg.comparten || []).find(g => g.includes(productId)) || [productId];
    const ocupado = grupo.some(id => ((cfg.ocupado || {})[id] || []).includes(dateStr));
    if(ocupado) return 'Ese producto ya está reservado para esa fecha';
    return null;
  };
  PH.isAvailable = function(productId, dateStr){
    return PH.unavailableReason(productId, dateStr) === null;
  };

  // ============ "COMPLETA TU FIESTA" (venta cruzada) ============
  // Sugiere productos según lo que ya hay en el carrito. Reglas simples y editables.
  PH.suggestFor = function(cartIds, n){
    const all = window.PH_PRODUCTS || [];
    const inCart = new Set(cartIds);
    const has = cat => all.some(p => inCart.has(p.id) && p.category === cat);
    const hasVip = [...inCart].some(id => id.indexOf('pack-vip') === 0);
    let ids = [];
    if(!has('carpas')){
      ids.push('party-house-5x8-mts', 'party-cube-5x5-mts');
    } else {
      if(!hasVip && !has('mobiliario')) ids.push('pack-1-led', 'alfombra-cubrepiso');
      ids.push('maquina-de-sour-frozen-granizado', 'pack-beerpong-yenga-xl', 'letrero-neon-led-happy-birthday', 'cabeza-movil-robotica-par-7-led');
    }
    if(!has('mobiliario') && !hasVip) ids.push('pack-2-led');
    if(!has('experiencias')) ids.push('karaoke-night', 'maquina-de-pop-corn');
    ids.push('pack-4-luces-uv', 'maquina-de-burbujas', '2-microfonos-inalambricos');
    const seen = new Set();
    return ids
      .filter(id => !inCart.has(id) && !seen.has(id) && seen.add(id))
      .map(PH.getProduct).filter(Boolean)
      .slice(0, n || 4);
  };

  // ============ ANALÍTICA (Umami / Plausible, opcional) ============
  // Si el sitio carga el script de Umami o Plausible, estos eventos se registran solos.
  PH.track = function(name, data){
    try {
      if(window.umami && typeof window.umami.track === 'function') window.umami.track(name, data);
      else if(typeof window.plausible === 'function') window.plausible(name, { props: data });
    } catch(e){}
  };

  // ============ CONFETI (canvas-confetti) ============
  let confettiLoading = null;
  PH.celebrate = function(opts){
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fire = () => window.confetti(Object.assign({
      particleCount: 120, spread: 80, origin: { y: 0.7 },
      colors: ['#e8ff3a', '#ff3da6', '#36e6d4', '#ff7a2a'], disableForReducedMotion: true
    }, opts || {}));
    if(window.confetti){ fire(); return; }
    if(!confettiLoading){
      confettiLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    confettiLoading.then(fire).catch(() => {});
  };

  // ============ GUARDAR EN CALENDARIO (.ics) ============
  // events: [{ date:'AAAA-MM-DD', title, description }]
  PH.downloadICS = function(events, filename){
    const esc = s => String(s || '').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Party House//Reservas//ES','CALSCALE:GREGORIAN'];
    events.forEach((ev, i) => {
      const start = ev.date.replace(/-/g,'');
      const endD = new Date(ev.date + 'T00:00'); endD.setDate(endD.getDate()+1);
      lines.push('BEGIN:VEVENT',
        'UID:' + stamp + '-' + i + '@partyhouse.cl',
        'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + start,
        'DTEND;VALUE=DATE:' + PH.toISODate(endD).replace(/-/g,''),
        'SUMMARY:' + esc(ev.title),
        'DESCRIPTION:' + esc(ev.description),
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'mi-fiesta-party-house.ics';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  // ============ GALERÍA A PANTALLA COMPLETA (PhotoSwipe) ============
  PH.openGallery = function(srcs, index){
    if(!srcs || !srcs.length) return;
    if(!document.getElementById('pswp-css')){
      const l = document.createElement('link');
      l.id = 'pswp-css'; l.rel = 'stylesheet';
      l.href = 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.css';
      document.head.appendChild(l);
    }
    const size = src => new Promise(res => {
      const im = new Image();
      im.onload = () => res({ src: src, width: im.naturalWidth, height: im.naturalHeight });
      im.onerror = () => res({ src: src, width: 1600, height: 1200 });
      im.src = src;
    });
    Promise.all([
      import('https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js'),
      Promise.all(srcs.map(size))
    ]).then(([mod, items]) => {
      new mod.default({ dataSource: items, index: index || 0, bgOpacity: 0.95, showHideAnimationType: 'fade' }).init();
    }).catch(() => window.open(srcs[index || 0], '_blank', 'noopener'));
  };

  // ============ AUTO INIT ============
  document.addEventListener('DOMContentLoaded', function(){
    PH.initNav();
    PH.initFAQ();
    PH.initNewsletter();
  });

})();
