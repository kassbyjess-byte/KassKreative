/* KASS website settings. After editing, upload this file to GitHub with the rest of the site. */

/* Where the website sends design requests and newsletter signups (the kass-admin Worker).
   If kasskreative.com/api/* is ever routed to the Worker, this can be set to ''. */
window.KASS_API_BASE = 'https://kass-admin.kassbyjess.workers.dev';

/* Leathers listed here still appear on The Leathers page, marked "Currently unavailable",
   but can't be chosen in Design Your Journal. */
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
  neverOn: ['design'],
};
