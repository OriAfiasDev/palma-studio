# סטודיו פאלמה — Palma Studio (template)

A demo beauty-studio site: Hebrew, fully RTL, plain HTML/CSS/JS with no framework or build step.
**Everything about the business is fictional**: the name, logo, address, phone number,
rating, reviews and social links. Photos are free-license stock from Unsplash (see [CREDITS.md](CREDITS.md)).
The page has `noindex` and a one-line demo notice in the footer, so it won't pass as a real business.

```
index.html
assets/css/style.css   — design system + "ENHANCEMENTS" block at the end
assets/js/main.js      — scroll choreography + enhancements module at the end
assets/img/            — stock photos, logo.svg
```

Run locally: `python3 -m http.server 8791` in this folder.

Live: https://oriafiasdev.github.io/palma-studio/ — deployed by GitHub Actions on every push to `main`.
`npm run build` writes the production site to `dist/`: HTML/CSS/JS minified, the stylesheet inlined,
Google Fonts self-hosted with the Hebrew subsets preloaded (no font-swap layout shift), absolute
OG/canonical URLs from `SITE_URL`. Docs (`*.md`) and dotfiles never ship.

## Mock data — swap these to brand it for a real client

| What | Where it appears | Mock value |
|---|---|---|
| Name | `<title>`, OG tags, JSON-LD, nav, hero words, footer | סטודיו פאלמה / Palma Studio |
| Address | meta description, JSON-LD, hero sub, place title, visit, footer | שדרות הדקלים 7, תל אביב |
| Phone / WhatsApp | nav, hero, mobile menu, visit, footer, floating button | 050-000-0000 · `wa.me/972500000000` |
| Hours | JSON-LD + visit section | Sun–Thu 9:00–20:00, Fri 9:00–14:00 |
| Rating | hero + reviews header | 4.9 · 212 reviews |
| Reviews | hero caption, statement, service quotes, gallery title, review wall | invented |
| Instagram | handle `@palma.studio`; all links point to instagram.com | — |
| Google / Waze | generic google.com/maps and waze.com links | — |
| Logo | `assets/img/logo.svg` (nav, Instagram avatar, favicon) | wine badge + frond |

Before using it for a real business: remove `<meta name="robots" content="noindex">` and the demo
notice in `.foot__copy`, and put real reviews in place of the invented ones.

## Design (shared with the original build)

Frank Ruhl Libre 900 + Assistant · palette `--paper` `--ink` `--wine` `--rose` `--palm` `--blush` ·
palm-frond SVG motif · pinned scroll-driven hero (photo, frond shadows and the giant two-word
headline on one `--p` timeline) · sticky services · snap gallery · review wall on wine ·
Instagram grid · WhatsApp-first contact section. The hero mechanics are unchanged from the original.

## Interactions added in this template

All of them are off under `prefers-reduced-motion`; pointer-only ones need a fine pointer.

- **Scroll progress** line under the nav, and the nav link of the section in view stays underlined.
- **Marquee ribbon** of treatments between the statement and services: drifts on its own,
  speeds up and leans (skew) with scroll velocity, and fills in on hover.
- **Heading reveals**: section titles rise out of a clip mask.
- **Services**: hovering a row switches the sticky photo (in addition to scroll).
- **Gallery**: mouse drag-to-scroll, inner-image parallax as the strip moves, and a progress bar.
- **Review cards**: 3D tilt toward the pointer with a soft light.
- **Place photo**: uncovers from the bottom, then parallaxes inside its leaf-shaped frame.
- **Instagram tiles**: wipe up in a stagger.
- **Magnetic buttons** (CTAs, gallery arrows, floating WhatsApp).
- **Cursor follower**: ring that grows on links and shows a label on the gallery ("גררי") and Instagram ("צפייה").
- **Big WhatsApp button**: slow pulse ring.
- **Footer wordmark** "Palma" rises as the page ends (CSS scroll-driven animation).

Note: elements revealed with `clip-path` are observed through their parent, since a fully
clipped element never counts as intersecting.
