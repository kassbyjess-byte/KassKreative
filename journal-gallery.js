document.querySelectorAll('.journal-carousel').forEach(gallery => {
  const slides = [...gallery.querySelectorAll('.journal-slide')];
  const status = gallery.querySelector('.journal-gallery-status');
  const size = gallery.getAttribute('aria-label').split(' ')[0];
  let current = 0;
  function advance(step) {
    current = (current + step + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== current; });
    status.textContent = `${current + 1} / ${slides.length} · ${current === 0 ? size + ' journal' : 'A5 left · A6 right'}`;
  }
  gallery.querySelectorAll('[data-gallery-step]').forEach(button => {
    button.addEventListener('click', () => advance(Number(button.dataset.galleryStep)));
  });
  gallery.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); advance(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  let startX = null;
  gallery.addEventListener('touchstart', event => { startX = event.changedTouches[0].clientX; }, {passive: true});
  gallery.addEventListener('touchend', event => {
    if (startX !== null) {
      const distance = event.changedTouches[0].clientX - startX;
      if (Math.abs(distance) > 50) advance(distance < 0 ? 1 : -1);
    }
    startX = null;
  }, {passive: true});
});
