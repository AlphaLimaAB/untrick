// Builds the static site into dist/. Uses only Node built-ins (no npm install needed to deploy).
// Usage: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePage, howPage, pricingPage, faqPage, contactPage, privacyPage } from '../src/templates.mjs';

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
const pathsFor = (lang, t) => {
  const home = homePath(lang);
  return {
    home,
    how: `${home}${t.pages.how.slug}/`,
    pricing: `${home}${t.pages.pricing.slug}/`,
    faq: `${home}${t.pages.faq.slug}/`,
    contact: `${home}${t.contact.slug}/`,
    privacy: `${home}${t.privacy.slug}/`
  };
};

function write(path, html) {
  const file = join(dist, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'src/assets'), join(dist, 'assets'), { recursive: true });

const texts = Object.fromEntries(site.languages.map((lang) => [lang, fill(readJson(`content/${lang}.json`))]));
const allPaths = Object.fromEntries(site.languages.map((lang) => [lang, pathsFor(lang, texts[lang])]));
const templates = { home: homePage, how: howPage, pricing: pricingPage, faq: faqPage, contact: contactPage, privacy: privacyPage };

const pages = [];
for (const lang of site.languages) {
  const altLang = site.languages.find((l) => l !== lang);
  const args = { site, t: texts[lang], lang, paths: allPaths[lang], alt: { lang: altLang, paths: allPaths[altLang] } };
  for (const [page, render] of Object.entries(templates)) {
    write(allPaths[lang][page], render(args));
    pages.push(allPaths[lang][page]);
  }
}

writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n${site.baseUrl ? `Sitemap: ${site.baseUrl}/sitemap.xml\n` : ''}`);
if (site.baseUrl) {
  const urls = pages.map((p) => `  <url><loc>${site.baseUrl}${p}</loc></url>`).join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}

console.log(`Built ${pages.length} pages into dist/: ${pages.join(', ')}`);
