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
 if (preview || (!storage.get('kass-newsletter-subscribed') && !recentlyDismissed)) {
  const show = () => { if (!preview && (storage.get('kass-newsletter-subscribed') || Date.now() - Number(storage.get('kass-newsletter-original-letter-dismissed') || 0) < 7 * 24 * 60 * 60 * 1000)) { document.removeEventListener('visibilitychange', show); return; } if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return; dialog.showModal(); document.removeEventListener('visibilitychange', show); };
  setTimeout(() => { document.addEventListener('visibilitychange', show); show(); }, 1200);
 }
})();
