// Customer mode: the deeper look behind the front page.
//  - product pages: product safety details (UT-19) and prices for the price history (UT-03)
//  - terms pages: a snapshot every scan, so changes are logged, and the closed ODR link (UT-22)
//  - campaign signals: sales words and many struck-through prices on the front page
// Read-only, like a visitor: no clicks on buy buttons, no forms, no logins.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PAGE_TIMEOUT = 15000;
const MAX_PRODUCTS = 5;
const MAX_CANDIDATES = 10;
const MAX_TERMS = 4;

const TERMS = [
  [/köpvillkor|allmänna villkor|villkor|terms|conditions|kjøpsvilkår|vilkår|handelsbetingelser|toimitusehdot|ehdot/i, 'terms'],
  [/retur|returns|ångerrätt|reklamation|angrerett|fortrydelse|palautus/i, 'returns'],
  [/integritet|privacy|personuppgift|personvern|persondata|tietosuoja/i, 'privacy'],
  [/leverans|frakt|shipping|delivery|levering|toimitus/i, 'delivery']
];
const PRODUCT_PATH = /\/(p|product|products|produkt|produkter|tuote|vare|artikel|item)\/|[-_/]p[-_]?\d{3,}|\/\d{5,}|-\d{5,}(\.html)?$/i;
const CAMPAIGN_WORDS = /black\s?(friday|week)|cyber\s?monday|singles\s?day|mellandagsrea|julrea|sommarrea|vinterrea|mega\s?sale|\bsale\b|\brea\b|kampanj|udsalg|\balennus|tarjous/i;
const MANUFACTURER = /tillverkare|manufacturer|producent|produsent|producenten|hersteller|valmistaja|ansvarig person|responsible person|ansvarlig person|vastuuhenkilö|eu-representant/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export function parsePrice(text) {
  const m = String(text || '').replace(/ /g, ' ').match(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(kr|:-|sek|nok|dkk|€|eur)?/i);
  if (!m) return null;
  const whole = Number(m[1].replace(/[ .]/g, ''));
  const value = whole + (m[2] ? Number(m[2]) / (m[2].length === 1 ? 10 : 100) : 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Runs inside a product page.
function productFacts() {
  const out = { isProduct: false, name: '', price: null, currency: '', wasTexts: [], text: '' };
  const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
  const seen = [];
  const walk = (x) => {
    if (!x || typeof x !== 'object' || seen.length > 200) return;
    seen.push(x);
    if (Array.isArray(x)) return x.forEach(walk);
    const type = [].concat(x['@type'] || []).join(' ');
    if (/\bProduct\b/i.test(type) && !out.isProduct) {
      out.isProduct = true;
      out.name = String(x.name || '').slice(0, 120);
      const offers = [].concat(x.offers || []).flatMap((o) => (o && o.offers ? [].concat(o.offers) : [o]));
      const offer = offers.find((o) => o && (o.price || o.lowPrice));
      if (offer) {
        out.price = Number(String(offer.price || offer.lowPrice).replace(',', '.'));
        out.currency = String(offer.priceCurrency || '');
      }
    }
    Object.values(x).forEach(walk);
  };
  for (const b of blocks) { try { walk(JSON.parse(b.textContent)); } catch (e) { /* bad JSON-LD */ } }
  const og = document.querySelector('meta[property="og:type"]');
  if (!out.isProduct && og && /product/i.test(og.content || '')) out.isProduct = true;
  if (out.price == null) {
    const m = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"]');
    if (m) out.price = Number(String(m.content || '').replace(',', '.')) || null;
  }
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  out.wasTexts = [...document.querySelectorAll('del, s, strike, [class*="old" i], [class*="was" i], [class*="strike" i], [class*="before" i], [class*="original" i], [class*="ordinarie" i], [class*="compare" i], [class*="regular" i]')]
    .filter((e) => visible(e) && /\d/.test(e.textContent || '') && (e.textContent || '').length < 40)
    .slice(0, 10).map((e) => e.textContent.trim());
  out.text = (document.body ? document.body.textContent : '').replace(/\s+/g, ' ').slice(0, 300000); // includes closed tabs
  return out;
}

export async function readProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
  await page.waitForTimeout(1200);
  const f = await page.evaluate(productFacts);
  if (!f.isProduct) return null;
  const price = Number.isFinite(f.price) && f.price > 0 ? f.price : null;
  const was = f.wasTexts.map(parsePrice).find((v) => v && price && v > price * 1.01) || null;
  const label = MANUFACTURER.exec(f.text);
  const contact = label ? EMAIL.test(f.text.slice(label.index, label.index + 500)) : false;
  return { url, name: f.name, price, was, currency: f.currency, gpsr: { label: !!label, contact } };
}

const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

export async function deepScan(context, finalUrl, facts, evidenceDir, dataDir) {
  const host = finalUrl.hostname;
  const anchors = facts.anchors.filter((a) => { try { return sameSite(new URL(a.href).hostname, host); } catch (e) { return false; } });
  const page = await context.newPage();
  const out = { products: [], terms: [], campaign: null };
  try {
    // Terms pages
    const termLinks = [];
    for (const [re, kind] of TERMS) {
      const a = anchors.find((x) => re.test(x.text) && !termLinks.some((t) => t.url === x.href.split('#')[0]));
      if (a) termLinks.push({ url: a.href.split('#')[0], kind });
    }
    for (const t of termLinks.slice(0, MAX_TERMS)) {
      try {
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
        await page.waitForTimeout(800);
        const r = await page.evaluate(() => ({
          text: (document.querySelector('main') || document.body).innerText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200000),
          odr: [...document.querySelectorAll('a')].some((a) => /ec\.europa\.eu\/(consumers\/)?odr/i.test(a.href)) ||
            /tvistlösning online|online dispute resolution|ec\.europa\.eu\/(consumers\/)?odr/i.test(document.body.innerText)
        }));
        out.terms.push({ ...t, text: r.text, odr: r.odr });
      } catch (e) { /* page did not load: skip */ }
    }

    // Product pages: likely product links first, then other links from the front page
    const urls = [...new Set(anchors.map((a) => a.href.split('#')[0]))].filter((u) => u !== finalUrl.toString());
    const candidates = [...urls.filter((u) => PRODUCT_PATH.test(new URL(u).pathname)), ...urls.filter((u) => !PRODUCT_PATH.test(new URL(u).pathname))]
      .slice(0, MAX_CANDIDATES);
    for (const u of candidates) {
      if (out.products.length >= MAX_PRODUCTS) break;
      try {
        const p = await readProduct(page, u);
        if (!p) continue;
        if (evidenceDir) {
          mkdirSync(path.join(dataDir, evidenceDir), { recursive: true });
          writeFileSync(path.join(dataDir, evidenceDir, `product-${out.products.length + 1}.jpg`), await page.screenshot({ type: 'jpeg', quality: 55 }));
        }
        out.products.push(p);
      } catch (e) { /* skip */ }
    }
  } finally {
    await page.close().catch(() => {});
  }

  // Campaign signals on the front page
  const words = (facts.text.match(new RegExp(CAMPAIGN_WORDS.source, 'gi')) || []).map((w) => w.toLowerCase());
  const strong = words.some((w) => !/^(sale|rea|kampanj|udsalg|alennus|tarjous)$/.test(w.trim()));
  out.campaign = { active: strong || facts.struck >= 8 || (words.length >= 3 && facts.struck >= 3), words: [...new Set(words)].slice(0, 5), struck: facts.struck };
  return out;
}

// Daily price round: visit the tracked product pages of one site and read today's price.
export async function priceRound(context, urls, evidenceDir, dataDir) {
  const page = await context.newPage();
  const out = [];
  try {
    for (const u of urls) {
      try {
        const p = await readProduct(page, u);
        if (!p || !p.price) continue;
        if (p.was && evidenceDir) {
          // Evidence of the price as shown, kept only when a reduced price is displayed
          mkdirSync(path.join(dataDir, evidenceDir), { recursive: true });
          writeFileSync(path.join(dataDir, evidenceDir, `price-${out.length + 1}.jpg`), await page.screenshot({ type: 'jpeg', quality: 55 }));
          p.evidence = `${evidenceDir}/price-${out.length + 1}.jpg`;
        }
        out.push(p);
      } catch (e) { /* skip */ }
    }
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

// Big sales periods, when every customer is scanned daily (dates in Stockholm time).
export function inSalesSeason(d = new Date()) {
  const y = d.getUTCFullYear();
  const md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  // Black Friday = the fourth Friday of November; Black Week = the Monday before it to Cyber Monday
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const bf = 1 + ((5 - nov1 + 7) % 7) + 21;
  const bwStart = 1100 + bf - 4;
  const bwEnd = bf + 3 > 30 ? 1200 + (bf + 3 - 30) : 1100 + bf + 3;
  return (md >= 1108 && md <= 1112) || (md >= bwStart && md <= bwEnd) || md >= 1226 || md <= 106;
}
