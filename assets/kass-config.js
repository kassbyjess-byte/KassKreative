/* KASS website settings. After editing, upload this file to GitHub with the rest of the site. */

/* Where the website sends design requests and newsletter signups (the kass-admin Worker).
   If kasskreative.com/api/* is ever routed to the Worker, this can be set to ''. */
window.KASS_API_BASE = 'https://kass-admin.kassbyjess.workers.dev';

/* Sold-out leathers are now switched on and off in the admin portal (Leather Stock tab), which
   updates the website within about a minute. Leathers listed here are ALWAYS treated as sold out,
   whatever the admin portal says, so leave this empty unless you're retiring a leather for good. */
window.KASS_UNAVAILABLE_LEATHERS = [];  // e.g. ['Emerald', 'Charcoal']

/* Leathers offered in some sizes only. Any leather not listed is offered in both A5 and A6. */
window.KASS_LEATHER_SIZES = {
  // e.g. Forest: ['A5'],
};

/* Newsletter pop-up ("little notes from kass"). It appears after delaySeconds on a page, or once
   the visitor has scrolled scrollPercent of the way down, whichever comes first. It never appears
   on the pages listed in neverOn, and stays hidden for 7 days after someone closes it. */
window.KASS_NEWSLETTER_POPUP = {
  delaySeconds: 30,
  scrollPercent: 60,
  neverOn: ['design', 'review'],
};


/* ---- Phones: compact header with Bag and Menu (styles in studio-palette.css). Desktop is unchanged. ---- */
(function () {
  function bagCount() {
    try { var b = JSON.parse(localStorage.getItem('kass-bag')); return b && b.items && b.items.length && Date.now() - b.at < 30 * 864e5 ? Math.min(b.items.length, 4) : 0; } catch (e) { return 0; }
  }
  function build() {
    var header = document.querySelector('.centered-header');
    if (!header || header.querySelector('.kass-header-actions')) return;
    var links = [].slice.call(header.querySelectorAll('nav a'));
    var actions = document.createElement('div'); actions.className = 'kass-header-actions';
    var onCheckout = /^\/checkout/.test(location.pathname);
    var bag = document.createElement('a'); bag.className = 'kass-bag-link'; bag.href = '/checkout';
    function showCount() { var n = bagCount(); bag.textContent = n ? 'Bag (' + n + ')' : 'Bag'; bag.setAttribute('aria-label', n ? 'Your bag, ' + n + ' journal' + (n > 1 ? 's' : '') : 'Your bag'); }
    showCount();
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'kass-menu-btn';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'kass-menu');
    btn.innerHTML = '<span class="kass-burger" aria-hidden="true"></span>Menu';
    if (!onCheckout) actions.appendChild(bag);
    actions.appendChild(btn);
    header.appendChild(actions);

    var panel = document.createElement('nav'); panel.id = 'kass-menu'; panel.className = 'kass-menu-panel'; panel.setAttribute('aria-label', 'Menu'); panel.hidden = true;
    var head = document.createElement('div'); head.className = 'kass-menu-head';
    var logo = header.querySelector('.logo img');
    if (logo) head.appendChild(logo.cloneNode(true)); else head.appendChild(document.createElement('span'));
    var close = document.createElement('button'); close.type = 'button'; close.className = 'kass-menu-close'; close.setAttribute('aria-label', 'Close menu'); close.textContent = '×';
    head.appendChild(close); panel.appendChild(head);
    var cta = null;
    links.forEach(function (a) {
      var c = a.cloneNode(true); c.removeAttribute('class');
      if (a.getAttribute('data-page') === 'design') { c.className = 'kass-menu-cta'; cta = c; }
      else { c.className = 'kass-menu-link'; panel.appendChild(c); }
    });
    if (cta) panel.insertBefore(cta, head.nextSibling);
    var bagLink = document.createElement('a'); bagLink.className = 'kass-menu-link'; bagLink.href = '/checkout';
    bagLink.textContent = 'Your bag'; panel.appendChild(bagLink);
    var note = document.createElement('p'); note.className = 'kass-menu-note'; note.textContent = 'Handmade in Canada · Shipping worldwide · Secure checkout'; panel.appendChild(note);
    var backdrop = document.createElement('div'); backdrop.className = 'kass-menu-backdrop'; backdrop.hidden = true;
    document.body.appendChild(backdrop); document.body.appendChild(panel);

    function open() {
      panel.hidden = false; backdrop.hidden = false; document.body.classList.add('kass-menu-open');
      btn.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(function () { panel.classList.add('open'); });
      close.focus();
    }
    function shut(focusBtn) {
      if (btn.getAttribute('aria-expanded') !== 'true') return;
      panel.classList.remove('open'); backdrop.hidden = true; document.body.classList.remove('kass-menu-open');
      btn.setAttribute('aria-expanded', 'false');
      setTimeout(function () { if (btn.getAttribute('aria-expanded') !== 'true') panel.hidden = true; }, 260);
      if (focusBtn) btn.focus();
    }
    btn.addEventListener('click', function () { btn.getAttribute('aria-expanded') === 'true' ? shut(true) : open(); });
    close.addEventListener('click', function () { shut(true); });
    backdrop.addEventListener('click', function () { shut(true); });
    panel.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) shut(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(true); });
    window.addEventListener('storage', function (e) { if (e.key === 'kass-bag') showCount(); });
    window.addEventListener('pageshow', showCount);
    document.addEventListener('visibilitychange', showCount);
    window.kassUpdateBagCount = showCount;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
