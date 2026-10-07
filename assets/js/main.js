/* Palma Studio — scroll choreography. No libraries.
   Only transforms/opacity are animated; one passive scroll listener + rAF. */
(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- 1. Hero: scroll progress → --p (lerped for a smooth feel) ---------- */
  const hero = $('#hero');
  const nav = $('#nav');
  const waFloat = $('.wa-float');
  let target = 0, current = 0, ticking = false;

  function heroProgress() {
    const track = hero.offsetHeight - window.innerHeight;   // pinned distance
    const y = window.scrollY;
    return track > 0 ? Math.min(1, Math.max(0, y / track)) : 1;
  }

  function frame() {
    // lerp toward target; stop when settled
    current += (target - current) * 0.14;
    if (Math.abs(target - current) < 0.0005) current = target;
    hero.style.setProperty('--p', current.toFixed(4));
    if (current !== target) requestAnimationFrame(frame); else ticking = false;
  }

  function onScroll() {
    target = heroProgress();
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
    // stateful nav + floating CTA once the hero has left
    const past = window.scrollY > hero.offsetHeight - window.innerHeight * 0.5;
    nav.classList.toggle('is-solid', past);
    waFloat.classList.toggle('is-on', past);
  }

  if (!reduce) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  } else {
    // static hero: nav turns solid as soon as we scroll at all
    window.addEventListener('scroll', () => {
      const past = window.scrollY > window.innerHeight * 0.6;
      nav.classList.toggle('is-solid', past);
      waFloat.classList.toggle('is-on', past);
    }, { passive: true });
  }

  /* ---------- 2. Reveal on enter ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
  $$('.reveal').forEach((el) => io.observe(el));

  /* ---------- 3. Statement: split into words, reveal one by one ---------- */
  $$('[data-split]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.textContent = w; s.style.setProperty('--i', i);
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
    io.observe(el);
  });

  /* ---------- 4. Services: which one is in the middle of the screen? ---------- */
  const services = $$('.service');
  const frames = $$('.services__img');
  function activate(key) {
    services.forEach((s) => s.classList.toggle('is-active', s.dataset.service === key));
    frames.forEach((f) => f.classList.toggle('is-active', f.dataset.for === key));
  }
  const sio = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) activate(e.target.dataset.service); });
  }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  services.forEach((s) => sio.observe(s));

  /* ---------- 5. Gallery buttons (touch/keyboard already work natively) ---------- */
  const track = $('#work-track');
  $$('.work__btn').forEach((b) => {
    b.addEventListener('click', () => {
      const step = track.clientWidth * 0.7;
      // RTL: "next" moves toward the left (negative scrollLeft direction)
      track.scrollBy({ left: b.dataset.dir === 'next' ? -step : step, behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  /* ---------- 6. Progressive background: body follows the section in view ---------- */
  const themed = $$('[data-theme]').filter((el) => el.tagName !== 'BODY');
  const tio = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) document.body.dataset.theme = e.target.dataset.theme; });
  }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
  themed.forEach((el) => tio.observe(el));

  /* ---------- 7. Mobile menu ---------- */
  const burger = $('#burger');
  const menu = $('#mobile-menu');
  function setMenu(open) {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'סגירת תפריט' : 'פתיחת תפריט');
    menu.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) nav.classList.add('is-solid');
  }
  burger.addEventListener('click', () => setMenu(menu.hidden));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });
})();

/* =====================================================================
   Enhancements for this template: progress bar, current nav link,
   marquee, gallery drag + parallax, card tilt, magnetic buttons,
   photo parallax, cursor follower. Transforms only; one rAF per frame.
   ===================================================================== */
(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- current section → nav link ---------- */
  const navLinks = $$('.nav__links a');
  const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const cio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      navLinks.forEach((l) => l.classList.remove('is-current'));
      const link = byId.get(e.target.id);
      if (link) link.classList.add('is-current');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['hero', ...byId.keys()].forEach((id) => { const el = document.getElementById(id); if (el) cio.observe(el); });

  /* ---------- scroll-linked work, batched into one frame ---------- */
  const bar = $('.progress');
  const photo = $('[data-parallax]');
  const photoImg = photo && photo.querySelector('img');
  let ticking = false;

  function onFrame() {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--progress', max > 0 ? (window.scrollY / max).toFixed(4) : 0);
    if (!reduce && photoImg) {
      const r = photo.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) {
        const d = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        photoImg.style.setProperty('--py', (d * -8).toFixed(2) + '%');
      }
    }
  }
  function requestFrame() { if (!ticking) { ticking = true; requestAnimationFrame(onFrame); } }
  window.addEventListener('scroll', requestFrame, { passive: true });
  window.addEventListener('resize', requestFrame, { passive: true });
  requestFrame();

  /* ---------- clip-path reveals: watch the parent, because a fully clipped
     element never counts as intersecting ---------- */
  const clipIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target._clipReveal.forEach((el) => el.classList.add('is-in'));
      clipIO.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  $$('.reveal--mask, .insta__item.reveal, .place__media.reveal').forEach((el) => {
    const host = el.parentElement;
    (host._clipReveal = host._clipReveal || []).push(el);
    clipIO.observe(host);
  });

  if (reduce) return;

  /* ---------- marquee: drifts on its own, speeds up and leans with scroll ---------- */
  const marquee = $('.marquee');
  const mTrack = $('.marquee__track');
  const mHalf = $('.marquee__half');
  let mx = 0, skew = 0, halfW = mHalf.offsetWidth, prevY = window.scrollY, mOn = false;
  window.addEventListener('resize', () => { halfW = mHalf.offsetWidth; }, { passive: true });
  function marqueeLoop() {
    if (!mOn) return;
    const y = window.scrollY, v = y - prevY;
    prevY = y;
    mx += 0.6 + Math.min(Math.abs(v) * 0.5, 24);   // RTL: the ribbon moves toward the right
    if (mx >= halfW) mx -= halfW;
    skew += (clamp(v * 0.15, -8, 8) - skew) * 0.1;
    mTrack.style.transform = `translate3d(${mx.toFixed(1)}px,0,0) skewX(${skew.toFixed(2)}deg)`;
    requestAnimationFrame(marqueeLoop);
  }
  new IntersectionObserver(([e]) => {
    mOn = e.isIntersecting;
    if (mOn) { prevY = window.scrollY; requestAnimationFrame(marqueeLoop); }
  }).observe(marquee);

  /* ---------- gallery: inner parallax, progress, mouse drag ---------- */
  const track = $('#work-track');
  const items = $$('.work__item', track);
  const gProgress = $('.work__progress');
  function galleryFrame() {
    const max = track.scrollWidth - track.clientWidth;
    gProgress.style.setProperty('--g', Math.max(0.08, max > 0 ? Math.abs(track.scrollLeft) / max : 0).toFixed(3));
    const tr = track.getBoundingClientRect();
    const cx = tr.left + tr.width / 2;
    items.forEach((it) => {
      const b = it.getBoundingClientRect();
      if (b.right < tr.left - 200 || b.left > tr.right + 200) return;
      const img = it.querySelector('img');
      if (img) img.style.setProperty('--px', (((b.left + b.width / 2 - cx) / tr.width) * -6).toFixed(2) + '%');
    });
  }
  let gTick = false;
  track.addEventListener('scroll', () => {
    if (!gTick) { gTick = true; requestAnimationFrame(() => { gTick = false; galleryFrame(); }); }
  }, { passive: true });
  galleryFrame();

  let down = false, moved = false, startX = 0, startLeft = 0;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true; moved = false; startX = e.clientX; startLeft = track.scrollLeft;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 4) { moved = true; track.classList.add('is-dragging'); }
    if (moved) track.scrollLeft = startLeft - dx;     // content follows the pointer
  });
  window.addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    track.classList.remove('is-dragging');            // snap re-engages and settles
  });
  track.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  track.addEventListener('dragstart', (e) => e.preventDefault());

  if (!fine) return;

  /* ---------- services: hovering a row drives the sticky frame ---------- */
  const services = $$('.service');
  const frames = $$('.services__img');
  services.forEach((s) => s.addEventListener('pointerenter', () => {
    services.forEach((x) => x.classList.toggle('is-active', x === s));
    frames.forEach((f) => f.classList.toggle('is-active', f.dataset.for === s.dataset.service));
  }));

  /* ---------- review cards: tilt toward the pointer, with a soft light ---------- */
  $$('.review').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.classList.add('is-tilting');
      card.style.transition = 'transform .15s ease-out, background-color .3s, border-color .3s';
      card.style.transform = `perspective(900px) rotateX(${((0.5 - py) * 7).toFixed(2)}deg) rotateY(${((px - 0.5) * 9).toFixed(2)}deg)`;
      card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
    });
    card.addEventListener('pointerleave', () => {
      card.classList.remove('is-tilting');
      card.style.transition = 'transform .7s var(--ease), background-color .3s, border-color .3s';
      card.style.transform = '';
    });
  });

  /* ---------- magnetic buttons ---------- */
  $$('.btn, .work__btn, .wa-float').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      if (el.classList.contains('wa-float') && !el.classList.contains('is-on')) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.35).toFixed(1)}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });

  /* ---------- cursor follower ---------- */
  const cursor = $('.cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  const label = $('.cursor__label');
  let px = -100, py = -100, rx = -100, ry = -100, running = false;
  function ringLoop() {
    rx += (px - rx) * 0.18; ry += (py - ry) * 0.18;
    ring.style.transform = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0)`;
    if (Math.abs(px - rx) > 0.1 || Math.abs(py - ry) > 0.1) requestAnimationFrame(ringLoop); else running = false;
  }
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    px = e.clientX; py = e.clientY;
    dot.style.transform = `translate3d(${px}px,${py}px,0)`;
    if (!running) { running = true; requestAnimationFrame(ringLoop); }
    setTarget(e.target);
    cursor.classList.remove('is-hidden');
  }, { passive: true });
  function setTarget(el) {
    const labelled = el && el.closest('[data-cursor]');
    const link = !labelled && el && el.closest('a, button');
    cursor.classList.toggle('is-label', !!labelled);
    cursor.classList.toggle('is-link', !!link);
    if (labelled) label.textContent = labelled.dataset.cursor;
  }
  // content slides under a still pointer while scrolling: re-check what's beneath it
  let cTick = false;
  window.addEventListener('scroll', () => {
    if (cTick || px < 0) return;
    cTick = true;
    requestAnimationFrame(() => { cTick = false; setTarget(document.elementFromPoint(px, py)); });
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => cursor.classList.add('is-hidden'));
})();
