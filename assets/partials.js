// Party House — shared nav + footer markup, injected into every page.
(function(){
  function escapeAttr(s){ return String(s).replace(/"/g,'&quot;'); }

  window.PH_renderNav = function(active){
    const links = [
      ['index.html', 'Home', 'home'],
      ['catalogo.html', 'Catálogo', 'catalogo'],
      ['packs.html', 'Packs', 'packs'],
      ['faq.html', 'Preguntas Frecuentes', 'faq'],
      ['condiciones.html', 'Condiciones', 'condiciones'],
      ['contacto.html', 'Contacto', 'contacto']
    ];
    return `
<header class="nav">
  <div class="nav-inner">
    <a href="index.html" class="logo" aria-label="Party House — inicio"><img src="assets/logo-white.png" alt="Party House" class="logo-img" /></a>
    <nav class="nav-links">
      ${links.map(l => `<a href="${l[0]}" class="${l[2]===active?'active':''}">${l[1]}</a>`).join('')}
    </nav>
    <div class="nav-right">
      <span class="lang">ES · CL</span>
      <button class="icon" data-search title="Buscar">⌕</button>
      <a href="carrito.html" class="icon cart-btn" title="Carrito">
        <span style="font-weight:900">⌃</span>
        <span class="cart-count empty">0</span>
      </a>
    </div>
  </div>
</header>`;
  };

  window.PH_renderFooter = function(){
    return `
<footer id="contacto">
  <div class="big-mark">PARTY/HOUSE</div>
  <div class="wrap" style="position:relative;z-index:1">
    <div class="foot-grid">
      <div>
        <div class="foot-brand"><img src="assets/logo-white.png" alt="Party House" class="foot-logo-img" /></div>
        <p class="foot-tagline">Arriendo de carpas disco inflables, mobiliario LED, audio y juegos para fiestas en casa. Santiago, Chile.</p>
        <div class="socials">
          <a class="soc" href="https://www.facebook.com/profile.php?id=100086912134318" target="_blank" rel="noopener" title="Facebook">FB</a>
          <a class="soc" href="http://instagram.com/partyhouse_cl" target="_blank" rel="noopener" title="Instagram">IG</a>
          <a class="soc" href="https://www.tiktok.com/@partyhouse_cl" target="_blank" rel="noopener" title="TikTok">TT</a>
        </div>
      </div>
      <div class="foot-col">
        <h5>Navegar</h5>
        <ul>
          <li><a href="index.html">Home</a></li>
          <li><a href="catalogo.html">Catálogo</a></li>
          <li><a href="packs.html">Packs</a></li>
          <li><a href="faq.html">Preguntas Frecuentes</a></li>
          <li><a href="condiciones.html">Condiciones</a></li>
          <li><a href="contacto.html">Contacto</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h5>Contacto</h5>
        <ul>
          <li><span class="contact-line"><span class="lbl">Tel</span> +56 9 3736 3825</span></li>
          <li><span class="contact-line"><span class="lbl">Mail</span> contacto@partyhouse.cl</span></li>
          <li><span class="contact-line"><span class="lbl">Ubic.</span> Las Condes, Santiago, Chile</span></li>
        </ul>
      </div>
      <div class="foot-col">
        <h5>Suscríbete</h5>
        <p style="color:var(--ink-dim);font-size:14px;line-height:1.5;margin:0">Recibe novedades, ofertas y combos para tu próxima fiesta.</p>
        <div class="news">
          <div class="news-input">
            <input placeholder="tu@correo.cl" type="email" />
            <button>OK →</button>
          </div>
        </div>
      </div>
    </div>
    <div class="foot-bottom">
      <small>© 2026 Party House · Todos los derechos reservados.</small>
      <div class="pay-row">
        <span class="pp">VISA</span>
        <span class="pp">MC</span>
        <span class="pp">WEBPAY</span>
        <span class="pp">TRANSF.</span>
      </div>
    </div>
  </div>
</footer>`;
  };

  window.PH_renderWaFloat = function(message){
    const m = message || '¡Hola Party House! Quiero info para mi fiesta 🎉';
    return `<a class="wa-float" href="https://wa.me/56937363825?text=${encodeURIComponent(m)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp"><svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M16.04 4C9.93 4 4.98 8.95 4.98 15.06c0 1.95.51 3.86 1.48 5.54L4 28l7.6-2.39a11.04 11.04 0 0 0 4.44.93h.01c6.11 0 11.06-4.95 11.06-11.06C27.11 8.95 22.15 4 16.04 4zm0 20.2h-.01c-1.42 0-2.81-.38-4.02-1.1l-.29-.17-4.51 1.42 1.45-4.39-.19-.3a8.99 8.99 0 0 1-1.38-4.8c0-4.98 4.06-9.04 9.04-9.04 2.42 0 4.69.94 6.4 2.65a8.98 8.98 0 0 1 2.65 6.4c0 4.98-4.06 9.04-9.04 9.04zm5.2-6.77c-.28-.14-1.68-.83-1.94-.93-.26-.1-.45-.14-.64.14-.19.28-.74.93-.9 1.12-.17.19-.33.21-.61.07-.28-.14-1.2-.44-2.28-1.41-.84-.75-1.41-1.68-1.58-1.96-.17-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.17.19-.28.28-.47.09-.19.05-.35-.02-.5-.07-.14-.64-1.54-.88-2.11-.23-.55-.46-.48-.64-.49-.17-.01-.36-.01-.55-.01-.19 0-.5.07-.76.35-.26.28-1 .98-1 2.38s1.02 2.76 1.17 2.95c.14.19 2.02 3.08 4.89 4.32.68.29 1.21.47 1.63.6.68.22 1.31.19 1.8.12.55-.08 1.68-.69 1.92-1.35.24-.66.24-1.23.17-1.35-.07-.12-.26-.19-.54-.33z"/></svg></a>`;
  };

  // Inject helpers — call from each page's body
  window.PH_mountChrome = function(opts){
    opts = opts || {};
    const navSlot = document.getElementById('nav-slot');
    const footSlot = document.getElementById('footer-slot');
    const waSlot = document.getElementById('wa-slot');
    if(navSlot) navSlot.outerHTML = window.PH_renderNav(opts.active);
    if(footSlot) footSlot.outerHTML = window.PH_renderFooter();
    if(waSlot) waSlot.outerHTML = window.PH_renderWaFloat(opts.waMessage);
  };
})();
