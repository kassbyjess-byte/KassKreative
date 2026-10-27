(() => {
 const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} }
 };
 const dialog = document.querySelector('#studio-welcome');
 if (!dialog) return;
 const dismiss = () => { storage.set('kass-newsletter-original-letter-dismissed', String(Date.now())); dialog.close(); };
 dialog.querySelectorAll('[data-newsletter-close]').forEach(button => button.addEventListener('click', dismiss));
 dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
 dialog.addEventListener('click', event => { if (event.target === dialog) { const b = dialog.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dismiss(); } });
 document.querySelectorAll('.studio-newsletter-form').forEach(form => {
  form.addEventListener('submit', async event => {
   event.preventDefault();
   if (!form.reportValidity()) return;
   const button = form.querySelector('button[type=submit]');
   const status = form.querySelector('[role=status]');
   const fields = new FormData(form);
   button.disabled = true;
   button.textContent = 'Saving your spot…';
   status.textContent = '';
   try {
    const response = await fetch((window.KASS_API_BASE || '') + '/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fields.get('email'), consent: fields.get('consent') === 'yes' || form.dataset.consent === 'submit', website: fields.get('website'), source: form.dataset.source }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Please try again in a moment.');
    storage.set('kass-newsletter-subscribed', 'yes');
    try { if (window.gtag) gtag('event', 'newsletter_signup', { source: form.dataset.source }); } catch {}
    status.textContent = data.message;
    form.classList.add('is-newsletter-saved');
    form.querySelectorAll('input').forEach(input => { input.disabled = true; });
    button.textContent = 'You’re on the list ♡';
   } catch (error) {
    status.textContent = error.message || 'We couldn’t save your email. Please try again.';
    button.disabled = false;
    button.textContent = form.dataset.source === 'welcome-popup' ? 'Count me in ♡' : 'Send me little notes';
   }
  });
 });
 const preview = new URLSearchParams(location.search).get('newsletter') === 'preview';
 const recentlyDismissed = Date.now() - Number(storage.get('kass-newsletter-original-letter-dismissed') || 0) < 7 * 24 * 60 * 60 * 1000;
 // When the pop-up appears is set in assets/kass-config.js (KASS_NEWSLETTER_POPUP).
 const settings = Object.assign({ delaySeconds: 30, scrollPercent: 60, neverOn: ['design'] }, window.KASS_NEWSLETTER_POPUP || {});
 const pageName = document.body.dataset.view || location.pathname.replace(/^\/|\.html$/g, '');
 const blockedHere = settings.neverOn.includes(pageName);
 const isMuted = () => storage.get('kass-newsletter-subscribed') || Date.now() - Number(storage.get('kass-newsletter-original-letter-dismissed') || 0) < 7 * 24 * 60 * 60 * 1000;
 if (preview || (!blockedHere && !isMuted())) {
  let done = false, timer = null;
  const stop = () => { done = true; clearTimeout(timer); window.removeEventListener('scroll', onScroll); document.removeEventListener('visibilitychange', onVisible); };
  const show = () => {
   if (done) return;
   if (!preview && isMuted()) { stop(); return; }
   if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return; // try again later
   const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
   if (typing) return;
   stop();
   dialog.showModal();
  };
  const onScroll = () => {
   const page = document.documentElement.scrollHeight;
   if (page <= window.innerHeight * 1.2) return; // short pages rely on the timer
   if ((window.scrollY + window.innerHeight) / page * 100 >= settings.scrollPercent) show();
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && timer === 'fired') show(); };
  if (preview) { setTimeout(show, 300); }
  else {
   timer = setTimeout(() => { timer = 'fired'; show(); if (!done) { const retry = setInterval(() => { if (done) clearInterval(retry); else show(); }, 5000); } }, settings.delaySeconds * 1000);
   window.addEventListener('scroll', onScroll, { passive: true });
   document.addEventListener('visibilitychange', onVisible);
  }
 }
})();
