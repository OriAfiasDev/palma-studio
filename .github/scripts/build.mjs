#!/usr/bin/env node
/*
 * Production build for a static site → dist/
 *
 * - Minifies HTML (html-minifier-terser), CSS and JS (esbuild), JSON.
 * - Inlines local stylesheets into <style> so the first paint needs no extra request.
 * - Self-hosts Google Fonts (downloads the woff2 files, inlines the @font-face rules),
 *   removing two third-party connections from the critical path. Falls back to a
 *   non-blocking <link> if the fonts can't be fetched.
 * - When SITE_URL is set (CI passes the GitHub Pages URL), makes og:image /
 *   twitter:image / JSON-LD images absolute and adds canonical + og:url.
 * - Writes .nojekyll so Pages serves every file untouched.
 *
 * Usage: SITE_URL=https://user.github.io/repo/ node .github/scripts/build.mjs
 */
import { mkdir, readFile, readdir, rm, writeFile, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';
import { minify as minifyHtml } from 'html-minifier-terser';

const ROOT = process.cwd();
const OUT = path.join(ROOT, process.env.OUT_DIR || 'dist');
const SITE_URL = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/+$/, '') + '/' : '';
const CSS_TARGET = ['chrome111', 'edge111', 'firefox114', 'safari16.4'];
const INLINE_CSS_LIMIT = 150 * 1024;

/* ---------- what ships ---------- */

// Tooling, docs and private notes never ship. Dotfiles/dirs are skipped too,
// except .well-known. Add project-specific paths to a .deployignore file.
const IGNORE_NAMES = new Set(['node_modules', 'dist', 'package.json', 'package-lock.json', 'brief.md', 'research']);
const IGNORE_EXT = new Set(['.md', '.py', '.sh', '.log', '.map']);
const extraIgnore = existsSync(path.join(ROOT, '.deployignore'))
  ? (await readFile(path.join(ROOT, '.deployignore'), 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];

function ignored(rel) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  if (parts.some((p) => p.startsWith('.') && p !== '.well-known')) return true;
  if (parts.some((p) => IGNORE_NAMES.has(p))) return true;
  if (IGNORE_EXT.has(path.extname(name).toLowerCase())) return true;
  return extraIgnore.some((pat) => {
    const p = pat.replace(/^\/+|\/+$/g, '');
    if (p.startsWith('*.')) return name.endsWith(p.slice(1));
    return rel === p || rel.startsWith(p + '/');
  });
}

async function walk(dir, rel = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (ignored(r)) continue;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/* ---------- helpers ---------- */

const isLocal = (href) => href && !/^([a-z]+:)?\/\//i.test(href) && !href.startsWith('data:') && !href.startsWith('#');
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}
const relFrom = (fromFile, toFile) => path.posix.relative(path.posix.dirname(fromFile), toFile) || path.posix.basename(toFile);

async function minifyCss(css) {
  return (await transform(css, { loader: 'css', minify: true, target: CSS_TARGET, legalComments: 'none' })).code.trim();
}
async function minifyJs(js) {
  return (await transform(js, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' })).code.trim();
}

// Re-point relative url(...) in a stylesheet so it still resolves once the CSS
// is inlined into an HTML file that lives somewhere else.
function rebaseCssUrls(css, cssFile, htmlFile) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    if (!isLocal(u) || u.startsWith('/')) return m;
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(cssFile), u));
    return `url(${q}${relFrom(htmlFile, abs)}${q})`;
  });
}

/* ---------- Google Fonts, self-hosted ---------- */

const fontCache = new Map(); // href → css with /assets/fonts/ urls (root-relative placeholder)
async function selfHostGoogleFonts(href) {
  if (fontCache.has(href)) return fontCache.get(href);
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  const res = await fetch(href.replace(/&amp;/g, '&'), { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Google Fonts CSS ${res.status}`);
  let css = await res.text();
  // Remember which files carry the Hebrew subset; they're preloaded below.
  const hebrew = new Set([...css.matchAll(/\/\*\s*hebrew\s*\*\/\s*@font-face\s*\{[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]));
  const preload = [];
  await mkdir(path.join(OUT, 'assets/fonts'), { recursive: true });
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
  await Promise.all(urls.map(async (u) => {
    const file = `assets/fonts/${path.posix.basename(new URL(u).pathname)}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`font ${r.status}: ${u}`);
    await writeFile(path.join(OUT, file), Buffer.from(await r.arrayBuffer()));
    css = css.split(u).join(`__FONTROOT__${file}`);
    if (hebrew.has(u)) preload.push(file);
  }));
  css = await minifyCss(css);
  fontCache.set(href, { css, count: urls.length, preload });
  return fontCache.get(href);
}

/* ---------- HTML ---------- */

async function buildHtml(file, html) {
  const notes = [];

  // 1. Stylesheets: inline local ones, self-host Google Fonts.
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (rel.includes('preconnect') && /fonts\.(googleapis|gstatic)\.com/.test(href || '')) {
      html = html.replace(tag, '');
      continue;
    }
    if (!rel.split(/\s+/).includes('stylesheet') || !href) continue;
    const media = attr(tag, 'media');
    const mediaAttr = media && media !== 'all' ? ` media="${media}"` : '';

    if (/^https:\/\/fonts\.googleapis\.com\/css/.test(href)) {
      try {
        const { css, count, preload } = await selfHostGoogleFonts(href);
        const prefix = relFrom(file, 'x').replace(/x$/, '');
        const links = preload.map((f) => `<link rel="preload" href="${prefix}${f}" as="font" type="font/woff2" crossorigin>`).join('');
        html = html.replace(tag, `${links}<style>${css.split('__FONTROOT__').join(prefix)}</style>`);
        notes.push(`self-hosted Google Fonts (${count} files, ${preload.length} preloaded)`);
      } catch (err) {
        const safe = href.replace(/"/g, '&quot;');
        html = html.replace(tag, `<link rel="stylesheet" href="${safe}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${safe}"></noscript>`);
        notes.push(`Google Fonts left remote, non-blocking (${err.message})`);
      }
      continue;
    }

    if (isLocal(href)) {
      const cssFile = path.posix.normalize(path.posix.join(path.posix.dirname(file), href.split(/[?#]/)[0]));
      const p = path.join(ROOT, cssFile);
      if (existsSync(p) && (await stat(p)).size <= INLINE_CSS_LIMIT) {
        const css = await minifyCss(rebaseCssUrls(await readFile(p, 'utf8'), cssFile, file));
        html = html.replace(tag, `<style${mediaAttr}>${css}</style>`);
        notes.push(`inlined ${cssFile}`);
      }
    }
  }

  // 2. Absolute social / canonical URLs (only when we know where we're deployed).
  if (SITE_URL) {
    const pageUrl = new URL(file.replace(/(^|\/)index\.html$/, '$1'), SITE_URL).href;
    html = html.replace(/<meta\b[^>]*>/gi, (tag) => {
      const key = attr(tag, 'property') || attr(tag, 'name');
      const content = attr(tag, 'content');
      if (!/^(og:image|og:image:url|twitter:image|og:url)$/i.test(key || '') || !content || !isLocal(content)) return tag;
      return tag.replace(content, new URL(content, pageUrl).href);
    });
    const head = [];
    if (!/<link\b[^>]*rel=["']?canonical/i.test(html)) head.push(`<link rel="canonical" href="${pageUrl}">`);
    if (/property=["']og:/i.test(html) && !/property=["']og:url/i.test(html)) head.push(`<meta property="og:url" content="${pageUrl}">`);
    if (head.length) html = html.replace(/<\/head>/i, `${head.join('')}</head>`);

    html = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, body, close) => {
      try {
        const data = JSON.parse(body);
        const fix = (o) => {
          if (Array.isArray(o)) return o.forEach(fix);
          if (!o || typeof o !== 'object') return;
          for (const k of ['image', 'logo']) if (typeof o[k] === 'string' && isLocal(o[k])) o[k] = new URL(o[k], pageUrl).href;
          Object.values(o).forEach(fix);
        };
        fix(data);
        if (!Array.isArray(data) && !data.url) data.url = pageUrl;
        return open + JSON.stringify(data) + close;
      } catch { return m; }
    });
  } else {
    // Still compact JSON-LD.
    html = html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, body, close) => {
      try { return open + JSON.stringify(JSON.parse(body)) + close; } catch { return m; }
    });
  }

  // 3. Minify the document itself. CSS was already minified by esbuild above.
  html = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    collapseBooleanAttributes: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    minifyJS: true,
    minifyCSS: false,
    decodeEntities: true,
  });
  return { html, notes };
}

/* ---------- run ---------- */

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const files = await walk(ROOT);
const rows = [];
const warnings = [];

for (const file of files) {
  const src = path.join(ROOT, file);
  const dst = path.join(OUT, file);
  await mkdir(path.dirname(dst), { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const before = (await stat(src)).size;
  let out = null;
  let notes = [];

  if (ext === '.html') ({ html: out, notes } = await buildHtml(file, await readFile(src, 'utf8')));
  else if (ext === '.css') out = await minifyCss(await readFile(src, 'utf8'));
  else if (ext === '.js' || ext === '.mjs') out = await minifyJs(await readFile(src, 'utf8'));
  else if (ext === '.json' || ext === '.webmanifest') {
    const raw = await readFile(src, 'utf8');
    try { out = JSON.stringify(JSON.parse(raw)); } catch { out = raw; }
  } else if (ext === '.svg') out = (await readFile(src, 'utf8')).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim();

  if (out !== null) {
    await writeFile(dst, out);
    const buf = Buffer.from(out);
    rows.push([file, before, buf.length, gzipSync(buf).length, notes.join('; ')]);
  } else {
    await copyFile(src, dst);
    if (/\.(jpe?g|png|webp|avif|gif)$/i.test(ext) && before > 400 * 1024) warnings.push(`${file} is ${(before / 1024).toFixed(0)} KB — consider resizing/compressing`);
  }
}
await writeFile(path.join(OUT, '.nojekyll'), '');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`\nBuilt ${files.length} files → ${path.relative(ROOT, OUT)}/${SITE_URL ? `  (SITE_URL ${SITE_URL})` : ''}\n`);
for (const [f, b, a, g, n] of rows) console.log(`  ${f.padEnd(34)} ${kb(b).padStart(9)} → ${kb(a).padStart(9)}  (gzip ${kb(g)})${n ? `  · ${n}` : ''}`);
if (warnings.length) console.log(`\nWarnings:\n  ${warnings.join('\n  ')}`);
if (!files.includes('index.html')) console.log('\nWarning: no index.html at the project root — Pages will 404 at the site URL.');
console.log('');
