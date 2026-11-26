// Content and policy checks. Fails (exit 1) on errors, prints warnings for launch blockers.
// Usage: node scripts/check-content.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const errors = [];
const warnings = [];

const site = readJson('content/site.json');
const texts = Object.fromEntries(site.languages.map((l) => [l, readJson(`content/${l}.json`)]));

// 1. Every language must have exactly the same structure, and no empty texts.
function shape(value, path, lang, other) {
  if (Array.isArray(value)) {
    if (!Array.isArray(other)) return errors.push(`${lang}: ${path} is a list but not in the other language`);
    if (value.length !== other.length) errors.push(`${path}: lists differ in length between languages`);
    value.forEach((v, i) => shape(v, `${path}[${i}]`, lang, other[i]));
  } else if (value && typeof value === 'object') {
    if (!other || typeof other !== 'object') return errors.push(`${lang}: ${path} missing in the other language`);
    for (const key of Object.keys(value)) {
      if (!(key in other)) errors.push(`${path}.${key} exists in ${lang} but is missing in the other language`);
      else shape(value[key], `${path}.${key}`, lang, other[key]);
    }
  } else if (typeof value === 'string' && value.trim() === '') {
    errors.push(`${lang}: ${path} is empty`);
  }
}
const [a, b] = site.languages;
shape(texts[a], 'content', a, texts[b]);
shape(texts[b], 'content', b, texts[a]);

// 2. Only known placeholders may be used in text.
const allowed = new Set(['{name}', '{company}', '{orgNr}', '{address}']);
for (const [lang, t] of Object.entries(texts)) {
  for (const m of JSON.stringify(t).matchAll(/\{[a-zA-Z]+\}/g)) {
    if (!allowed.has(m[0])) errors.push(`${lang}: unknown placeholder ${m[0]}`);
  }
}

// 3. Practise what we sell: no cookies, trackers or pre-ticked boxes in our own code.
const forbidden = [
  [/document\.cookie/, 'sets or reads cookies'],
  [/googletagmanager|google-analytics|gtag\(|fbq\(|connect\.facebook\.net|hotjar/i, 'adds third-party tracking'],
  [/<input[^>]*type="checkbox"[^>]*\schecked/i, 'pre-ticks a checkbox (a dark pattern)']
];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js|html|css)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const [re, why] of forbidden) if (re.test(text)) errors.push(`${p.replace(root + '/', '')} ${why}`);
    }
  }
}
walk(join(root, 'src'));

// 4. Launch blockers (warnings only, so work can continue before launch).
if (!site.form.endpoint) warnings.push('content/site.json: form.endpoint is empty – the form runs in demo mode');
if (!site.baseUrl) warnings.push('content/site.json: baseUrl is empty – no canonical links or sitemap');
if (!site.contactEmail) warnings.push('content/site.json: contactEmail is empty');
for (const [lang, t] of Object.entries(texts)) {
  if (t.privacy.draftNotice) warnings.push(`${lang}: privacy policy is still marked as a draft`);
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} content error(s).`);
  process.exit(1);
}
console.log(`Content OK (${site.languages.join(', ')}), ${warnings.length} launch warning(s).`);
