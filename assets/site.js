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
    PH.toast('✓ Agregado al carrito', 'success');
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
    const phone = '56937363825';
    return 'https://wa.me/' + phone + (message ? '?text=' + encodeURIComponent(message) : '');
  };

  // ============ AUTO INIT ============
  document.addEventListener('DOMContentLoaded', function(){
    PH.initNav();
    PH.initFAQ();
    PH.initNewsletter();
  });

})();
