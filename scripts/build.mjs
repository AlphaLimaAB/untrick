// Builds the static site into dist/. Uses only Node built-ins (no npm install needed to deploy).
// Usage: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePage, privacyPage } from '../src/templates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const site = readJson('content/site.json');

// Replace {name}, {company}, {orgNr}, {address} in every string of a content tree.
function fill(value) {
  if (typeof value === 'string') {
    return value
      .replaceAll('{name}', site.name)
      .replaceAll('{company}', site.company.name)
      .replaceAll('{orgNr}', site.company.orgNr)
      .replaceAll('{address}', site.company.address);
  }
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
  }
  return value;
}

const homePath = (lang) => (lang === site.defaultLanguage ? '/' : `/${lang}/`);
const privacyPath = (lang, t) => `${homePath(lang)}${t.privacy.slug}/`;

function write(path, html) {
  const file = join(dist, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'src/assets'), join(dist, 'assets'), { recursive: true });

const texts = Object.fromEntries(site.languages.map((lang) => [lang, fill(readJson(`content/${lang}.json`))]));
for (const lang of site.languages) texts[lang].privacyPath = privacyPath(lang, texts[lang]);

const pages = [];
for (const lang of site.languages) {
  const t = texts[lang];
  const altLang = site.languages.find((l) => l !== lang);
  const alt = texts[altLang];

  const home = homePath(lang);
  write(home, homePage({ site, t, lang, pagePath: home, altPath: homePath(altLang), altLang }));
  pages.push(home);

  const priv = privacyPath(lang, t);
  write(priv, privacyPage({ site, t, lang, pagePath: priv, altPath: privacyPath(altLang, alt), altLang }));
  pages.push(priv);
}

writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n${site.baseUrl ? `Sitemap: ${site.baseUrl}/sitemap.xml\n` : ''}`);
if (site.baseUrl) {
  const urls = pages.map((p) => `  <url><loc>${site.baseUrl}${p}</loc></url>`).join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}

console.log(`Built ${pages.length} pages into dist/: ${pages.join(', ')}`);
