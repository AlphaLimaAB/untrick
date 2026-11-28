// Untrick instant check.
// A few automatic checks of a shop's public front page, run in a headless browser.
// Runs in Docker on Anton's Raspberry Pi, published through Tailscale Funnel.
//
// Safety, in layers:
//  - only http(s) on ports 80/443, no credentials in the URL
//  - every request the browser makes is checked: hosts that resolve to private,
//    loopback, link-local, CGNAT/Tailscale or multicast addresses are blocked
//  - the container's network is also blocked from the home network by the host firewall
//  - one scan at a time, a short queue, per-IP rate limit, hard timeouts
//  - results are only returned when the email's domain matches the scanned site
//  - nothing personal is stored; instant-check scans are forgotten after two hours
//
// Customer mode (only when a writable /data folder is mounted): sites of paying customers are
// scanned on a schedule, results and dated evidence are stored, and a findings register is kept.
// It has no HTTP endpoints; Anton manages it with `docker exec untrick-scanner node admin.mjs`.
import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { dataDir, openStore, day, localHour } from './store.mjs';
import { deepScan, priceRound, inSalesSeason } from './deep.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = Number(process.env.PORT || 8090);
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://untrick.eu,https://www.untrick.eu').split(',');
const RATE_PER_HOUR = Number(process.env.RATE_PER_HOUR || 10);
const MAX_QUEUE = 8;
const KEEP_MS = 2 * 3600 * 1000;
const NAV_TIMEOUT = 20000;
const SCAN_TIMEOUT = 60000;
const DEEP_TIMEOUT = 240000; // scheduled customer scans also visit product and terms pages
const DATA = dataDir();
const store = DATA ? openStore(DATA) : null;
// Scheduled scans run at night, Stockholm time (a range like "1-6" means 01:00 to 06:59).
const [WIN_FROM, WIN_TO] = (process.env.SCAN_HOURS || '1-6').split('-').map(Number);
const USER_AGENT = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 UntrickCheck/1.0 (+https://untrick.eu)';

// ---------- address checks ----------
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
];
const v4num = (ip) => ip.split('.').reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;
function blockedV4(ip) {
  const n = v4num(ip);
  return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4num(base) >>> (32 - bits)));
}
function blockedIp(ip) {
  if (net.isIPv4(ip)) return blockedV4(ip);
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedV4(mapped[1]);
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') ||
    x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff') || x.startsWith('fd7a:115c:a1e0'); // last = Tailscale
}
const hostCache = new Map();
async function safeHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.ts.net') || h.endsWith('.lan')) return false;
  if (net.isIP(h)) return !blockedIp(h);
  const cached = hostCache.get(h);
  if (cached && cached.until > Date.now()) return cached.ok;
  let ok = false;
  try {
    const addrs = await lookup(h, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !blockedIp(a.address));
  } catch (e) {
    ok = false;
  }
  hostCache.set(h, { ok, until: Date.now() + 5 * 60 * 1000 });
  return ok;
}
function normaliseUrl(value) {
  let s = String(value || '').trim();
  if (!s || s.length > 300) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (u.port && !['80', '443'].includes(u.port)) return null;
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    return u;
  } catch (e) {
    return null;
  }
}
const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');
function emailMatches(email, host) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  const site = bareHost(host);
  return !!domain && (domain === site || site.endsWith('.' + domain) || domain.endsWith('.' + site));
}

// ---------- the checks ----------
const ACCEPT = /\b(acceptera|godkänn|godkänna|tillåt|accept(era)?( all(a)?)?|allow( all)?|agree|jag förstår|ok)\b/i;
const REJECT = /\b(neka|avvisa|avböj|avvisa alla|neka alla|bara nödvändiga|endast nödvändiga|reject|decline|deny|refuse|only necessary|necessary only|essential only)\b/i;
const WITHDRAW = /ångra|ångerrätt|ångerknapp|withdraw|right of withdrawal|cancel (your )?(order|contract|purchase)/i;
const STATEMENT = /tillgänglighetsredogörelse|tillgänglighetsinformation|(webbplatsens|sajtens|digital|om) tillgänglighet|^tillgänglighet$|accessibility/i;
const GREEN = [
  'miljövänlig', 'miljövänliga', 'miljövänligt', 'klimatvänlig', 'klimatvänliga', 'klimatvänligt', 'klimatsmart', 'klimatsmarta',
  'klimatneutral', 'klimatneutrala', 'klimatneutralt', 'koldioxidneutral', 'co2-neutral', 'klimatkompenserad', 'klimatkompenserade',
  'naturvänlig', 'grönare val', 'eco-friendly', 'environmentally friendly', 'climate neutral', 'carbon neutral', 'climate positive',
  'klimatpositiv', 'nettonoll', 'net zero'
];
const ORGNR = /\b(org\.?\s?nr\.?|organisationsnummer|reg\.?\s?no\.?|company (reg|number))[^0-9]{0,12}\d{6}-?\d{4}\b|\b\d{6}-\d{4}\b/i;

function pageFacts() {
  // Runs inside the page. Looks into open shadow roots too (many cookie banners live there).
  const roots = [document];
  for (let i = 0; i < roots.length && roots.length < 200; i++) {
    roots[i].querySelectorAll('*').forEach((e) => { if (e.shadowRoot) roots.push(e.shadowRoot); });
  }
  const all = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 &&
      r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const label = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const clickables = all('button, a, [role=button], input[type=button], input[type=submit]');
  const text = [document.body ? document.body.innerText : '']
    .concat(roots.slice(1).map((r) => (r.host && r.host.innerText) || [...r.children].map((c) => c.innerText || '').join(' ')))
    .join('\n');
  const anchors = all('a').slice(0, 3000);
  return {
    buttons: clickables.filter(visible).map(label).filter(Boolean).slice(0, 300),
    links: anchors.map(label).filter(Boolean),
    anchors: anchors.map((a) => ({ href: a.href || '', text: label(a) })).filter((a) => /^https?:/.test(a.href)),
    struck: all('del, s, strike').filter((e) => /\d/.test(e.textContent || '')).length,
    text: text.slice(0, 400000)
  };
}

// Tracking that starts before the visitor has made a cookie choice (we never click anything).
const PIXELS = [
  [/^https?:\/\/(www\.)?facebook\.com\/tr/i, 'Meta Pixel'], [/analytics\.tiktok\.com\/api/i, 'TikTok Pixel'],
  [/bat\.bing\.com\/action/i, 'Microsoft Ads'], [/px\.ads\.linkedin\.com/i, 'LinkedIn Insight'],
  [/ct\.pinterest\.com/i, 'Pinterest Tag'], [/\.clarity\.ms\/collect/i, 'Microsoft Clarity'],
  [/(in|vc|vars)\.hotjar\.(com|io)/i, 'Hotjar'], [/tr\.snapchat\.com/i, 'Snap Pixel'],
  [/googleads\.g\.doubleclick\.net|googleadservices\.com\/pagead\/conversion/i, 'Google Ads'],
  [/\.criteo\.(com|net)/i, 'Criteo'], [/track\.adform\.net/i, 'Adform']
];
const GA_BEACON = /(google-analytics\.com|analytics\.google\.com)\/(g\/)?collect/i;
const TRACKING_COOKIES = /^(_ga|_ga_\w+|_gid|_gcl_au|_gcl_aw|_fbp|_fbc|_ttp|_uetsid|_uetvid|_clck|_clsk|_hjSessionUser_\d+|_hjSession_\d+|_pin_unauth|_scid|IDE|test_cookie|li_sugr|bcookie|MUID|ANONCHK)$/;
const CHAT = [
  [/widget\.intercom\.io|js\.intercomcdn\.com/i, 'Intercom'], [/static\.zdassets\.com/i, 'Zendesk'], [/code\.tidio\.co/i, 'Tidio'],
  [/js\.driftt\.com/i, 'Drift'], [/cdn\.livechatinc\.com/i, 'LiveChat'], [/client\.crisp\.chat/i, 'Crisp'],
  [/js\.usemessages\.com/i, 'HubSpot chat'], [/gorgias\.chat/i, 'Gorgias'], [/userlike/i, 'Userlike'], [/giosg\.com/i, 'Giosg'],
  [/boost\.ai/i, 'boost.ai'], [/kindly\.ai|kindlycdn\.com/i, 'Kindly'], [/ebi\.ai/i, 'ebi.ai'], [/freshchat/i, 'Freshchat'],
  [/embedded_svc|embeddedservice/i, 'Salesforce chat'], [/trengo/i, 'Trengo'], [/voiceflow\.com/i, 'Voiceflow'],
  [/chatbase\.co/i, 'Chatbase'], [/ada\.support|ada\.cx/i, 'Ada'], [/zowie\.ai/i, 'Zowie']
];
const ODR_HREF = /ec\.europa\.eu\/(consumers\/)?odr/i;
const ODR_TEXT = /\bODR\b|tvistlösning online|online dispute resolution|online-tvisteløsning/i;

function trackingCheck(requests, cookies) {
  const pixels = [...new Set(PIXELS.filter(([re]) => requests.some((u) => re.test(u))).map(([, name]) => name))];
  const tracked = [...new Set(cookies.map((c) => c.name).filter((n) => TRACKING_COOKIES.test(n)))].slice(0, 8);
  const ga = requests.filter((u) => GA_BEACON.test(u));
  const gaFull = ga.some((u) => !/[?&]gcs=G100/.test(u)); // G100 = analytics and ads storage both denied (Consent Mode)
  if (gaFull) pixels.unshift('Google Analytics');
  const result = pixels.length || tracked.length ? 'problem' : ga.length ? 'check' : 'ok';
  return { rule: 'UT-21', area: 'cookies', result, detail: { trackers: pixels, cookies: tracked, googlePings: ga.length > 0 && !gaFull } };
}

async function runChecks(page, net = { requests: [], cookies: [] }) {
  const frames = page.frames();
  const facts = { buttons: [], links: [], anchors: [], struck: 0, text: '' };
  for (const f of frames) {
    try {
      const r = await f.evaluate(pageFacts);
      facts.buttons.push(...r.buttons);
      facts.links.push(...r.links);
      facts.anchors.push(...r.anchors);
      facts.struck += r.struck;
      facts.text += '\n' + r.text;
    } catch (e) { /* cross-origin frame gone or blocked */ }
  }
  const checks = [];

  // UT-10 cookie banner: can visitors reject as easily as accept, on the first screen?
  const accept = facts.buttons.find((t) => ACCEPT.test(t) && !REJECT.test(t));
  const reject = facts.buttons.find((t) => REJECT.test(t));
  checks.push({
    rule: 'UT-10', area: 'cookies',
    result: accept && reject ? 'ok' : accept ? 'problem' : 'unknown',
    detail: { accept: accept || null, reject: reject || null }
  });

  // UT-01 withdrawal link visible somewhere on the page
  const withdraw = facts.links.find((t) => WITHDRAW.test(t));
  checks.push({ rule: 'UT-01', area: 'withdrawal', result: withdraw ? 'check' : 'problem', detail: { link: withdraw || null } });

  // UT-12 accessibility: automatic WCAG 2.1 AA errors on the front page
  let a11y = null;
  try {
    await page.evaluate(AXE);
    a11y = await page.evaluate(async () => {
      const res = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations']
      });
      const count = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of res.violations) count[v.impact || 'minor'] += v.nodes.length;
      const top = res.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .sort((a, b) => b.nodes.length - a.nodes.length)
        .slice(0, 3)
        .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
      return { count, top };
    });
  } catch (e) { a11y = null; }
  const serious = a11y ? a11y.count.critical + a11y.count.serious : null;
  checks.push({
    rule: 'UT-12', area: 'accessibility',
    result: a11y === null ? 'unknown' : serious > 0 ? 'problem' : 'ok',
    detail: a11y ? { serious, moderate: a11y.count.moderate + a11y.count.minor, top: a11y.top } : {}
  });

  // UT-13 accessibility information published
  const statement = facts.links.find((t) => STATEMENT.test(t));
  checks.push({ rule: 'UT-13', area: 'accessibility', result: statement ? 'ok' : 'problem', detail: { link: statement || null } });

  // UT-14/15 generic environmental claims and offsetting claims
  const lower = facts.text.toLowerCase();
  const words = [...new Set(GREEN.filter((w) => new RegExp('(^|[^a-zåäö])' + w.replace(/[-]/g, '\\-') + '([^a-zåäö]|$)', 'i').test(lower)))].slice(0, 5);
  checks.push({ rule: 'UT-14', area: 'green', result: words.length ? 'check' : 'ok', detail: { words } });

  // UT-17 company information (organisation number) on the page
  checks.push({ rule: 'UT-17', area: 'company', result: ORGNR.test(facts.text) ? 'ok' : 'check', detail: {} });

  // UT-21 tracking before consent (also part of the cookie area)
  checks.push(trackingCheck(net.requests, net.cookies));

  // UT-20 chat widgets: shown only when one is found; a person checks that it says it is an AI
  const chats = [...new Set(CHAT.filter(([re]) => net.requests.some((u) => re.test(u))).map(([, name]) => name))];
  if (chats.length) checks.push({ rule: 'UT-20', area: 'terms', result: 'check', detail: { vendors: chats } });

  // UT-22 link to the closed EU ODR platform (shown only when found)
  const odr = facts.anchors.find((a) => ODR_HREF.test(a.href) || ODR_TEXT.test(a.text));
  if (odr) checks.push({ rule: 'UT-22', area: 'terms', result: 'check', detail: { link: odr.text || odr.href, where: 'Front page' } });

  const counted = checks.filter((c) => c.result !== 'unknown');
  const points = counted.reduce((n, c) => n + (c.result === 'ok' ? 1 : c.result === 'check' ? 0.5 : 0), 0);
  const score = counted.length ? Math.round((100 * points) / counted.length) : null;
  return { checks, score, facts };
}

// ---------- browser ----------
let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  return browser;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function saveEvidence(page, dir) {
  // A dated picture of what the visitor saw: the first screen (cookie banner) and the page from the top.
  mkdirSync(path.join(DATA, dir), { recursive: true });
  const first = await page.screenshot({ type: 'png' });
  const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 6000)).catch(() => 900);
  const full = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true, clip: { x: 0, y: 0, width: 1280, height: Math.max(height, 900) } });
  writeFileSync(path.join(DATA, dir, 'first-screen.png'), first);
  writeFileSync(path.join(DATA, dir, 'full-page.jpg'), full);
  return { 'first-screen.png': sha256(first), 'full-page.jpg': sha256(full) };
}

async function newContext() {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: USER_AGENT, locale: 'sv-SE', viewport: { width: 1280, height: 900 }, bypassCSP: true,
    serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true
  });
  await context.route('**/*', async (route) => {
    try {
      const u = new URL(route.request().url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (!['http:', 'https:'].includes(u.protocol)) return route.abort();
      if (u.port && !['80', '443'].includes(u.port)) return route.abort();
      if (['media', 'websocket', 'eventsource'].includes(route.request().resourceType())) return route.abort();
      if (!(await safeHost(u.hostname))) return route.abort('blockedbyclient');
      return route.continue();
    } catch (e) {
      return route.abort();
    }
  });
  return context;
}

async function scanUrl(url, evidenceDir = null, deep = null) {
  const context = await newContext();
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => { if (requests.length < 3000) requests.push(r.url()); });
  try {
    const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500); // let cookie banners appear
    const finalUrl = new URL(page.url());
    if (!(await safeHost(finalUrl.hostname))) throw new Error('blocked redirect');
    const files = evidenceDir ? await saveEvidence(page, evidenceDir) : null;
    const cookies = await context.cookies().catch(() => []);
    const { checks, score, facts } = await runChecks(page, { requests, cookies });
    const out = { status: 'done', httpStatus: response ? response.status() : null, finalHost: finalUrl.hostname, finalUrl: finalUrl.toString(), checks, score, files };
    if (deep) out.deep = await deep(context, finalUrl, facts, evidenceDir);
    return out;
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------- queue ----------
// One scan at a time. Jobs are instant checks from the website or scheduled customer scans.
const scans = new Map();
const queue = [];
const queuedSites = new Set();
let running = false;
const publicQueued = () => queue.filter((j) => j.kind === 'public').length;
const withTimeout = (p, ms = SCAN_TIMEOUT) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
const failReason = (e) => (/timeout/i.test(e.message) ? 'timeout' : /blocked/i.test(e.message) ? 'blocked' : 'unreachable');

async function runPublic(id) {
  const s = scans.get(id);
  if (!s) return;
  s.status = 'running';
  try {
    Object.assign(s, await withTimeout(scanUrl(s.url)));
  } catch (e) {
    s.status = 'failed';
    s.reason = failReason(e);
    throw e;
  }
  return `${s.url.hostname} ${s.status}`;
}

async function runScheduled(siteId) {
  try {
    return await scanSite(siteId);
  } finally {
    queuedSites.delete(siteId); // only now, so the scheduler does not queue the site twice
  }
}

async function scanSite(siteId) {
  const site = store.site(siteId);
  if (!site) return;
  const scanId = randomUUID();
  const started = new Date().toISOString();
  const dir = path.posix.join('evidence', siteId, `${day(started)}_${scanId.slice(0, 8)}`);
  let result;
  let error = null;
  const url = normaliseUrl(site.url);
  try {
    if (!url || !(await safeHost(url.hostname))) throw new Error('blocked');
    result = await withTimeout(scanUrl(url, dir, (ctx, finalUrl, facts, ev) => deepScan(ctx, finalUrl, facts, ev, DATA)), DEEP_TIMEOUT);
  } catch (e) {
    error = e;
    result = { status: 'failed', reason: failReason(e) };
  }
  let evidence = null;
  let hash = null;
  if (result.files) {
    const record = JSON.stringify({ scanId, siteId, url: site.url, finalUrl: result.finalUrl, started, finished: new Date().toISOString(),
      httpStatus: result.httpStatus, score: result.score, checks: result.checks, files: result.files, userAgent: USER_AGENT }, null, 2);
    writeFileSync(path.join(DATA, dir, 'result.json'), record);
    evidence = dir;
    hash = sha256(record);
  }
  const changes = store.recordScan({ scanId, siteId, started, result, evidence, sha256: hash, salesSeason: inSalesSeason(), dataDir: DATA });
  if (error) throw error;
  const register = changes.filter((c) => c.status).map((c) => `${c.rule}:${c.status}`).join(' ');
  return `${siteId} scheduled ${result.status} score=${result.score} ${register}`;
}

// Daily price round for one site: today's prices of its tracked product pages, then the 30-day check.
async function runPrices(siteId) {
  try {
    const urls = store.trackedProducts(siteId);
    const at = new Date().toISOString();
    const dir = path.posix.join('evidence', siteId, `${day(at)}_prices`);
    let results = [];
    if (urls.length) {
      const context = await newContext();
      try {
        results = await withTimeout(priceRound(context, urls, dir, DATA), DEEP_TIMEOUT);
      } finally {
        await context.close().catch(() => {});
      }
    }
    const changes = store.recordPriceRound({ siteId, results, at, evidenceDir: dir });
    return `${siteId} prices ${results.length}/${urls.length} read, ${changes.length} reduced prices checked`;
  } finally {
    queuedSites.delete('prices:' + siteId);
  }
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  const t0 = Date.now();
  let line;
  try {
    line = job.kind === 'public' ? await runPublic(job.id) : job.kind === 'prices' ? await runPrices(job.siteId) : await runScheduled(job.siteId);
  } catch (e) {
    line = `${job.kind} ${job.id || job.siteId} failed ${failReason(e)}`;
    if (browser) { await browser.close().catch(() => {}); browser = null; }
  }
  if (line) console.log(`${new Date().toISOString()} scan ${line} ${Date.now() - t0}ms`);
  running = false;
  setImmediate(pump);
}

// Every minute: queue customer sites that are due (night window) or that Anton asked to scan now.
if (store) {
  setInterval(() => {
    try {
      const h = localHour();
      const inWindow = WIN_FROM <= WIN_TO ? h >= WIN_FROM && h <= WIN_TO : h >= WIN_FROM || h <= WIN_TO;
      for (const site of store.dueSites(new Date(), inWindow)) {
        if (queuedSites.has(site.id)) continue;
        queuedSites.add(site.id);
        queue.push({ kind: 'scheduled', siteId: site.id });
      }
      if (inWindow) {
        for (const site of store.priceDueSites(day(new Date().toISOString()))) {
          if (queuedSites.has('prices:' + site.id)) continue;
          queuedSites.add('prices:' + site.id);
          queue.push({ kind: 'prices', siteId: site.id });
        }
      }
      setImmediate(pump);
    } catch (e) {
      console.error('scheduler', e.message);
    }
  }, 60000).unref();
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of scans) if (now - s.created > KEEP_MS) scans.delete(id);
  for (const [ip, list] of hits) { const keep = list.filter((t) => now - t < 3600000); if (keep.length) hits.set(ip, keep); else hits.delete(ip); }
}, 60000).unref();

const hits = new Map();
function allow(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (list.length >= RATE_PER_HOUR) return false;
  list.push(now);
  hits.set(ip, list);
  return true;
}

// ---------- HTTP ----------
function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin && ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/scan/, '') || '/';
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin'
    });
    return res.end();
  }
  if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, queue: publicQueued(), running }, origin);

  if (req.method === 'POST' && path === '/') {
    if (origin && !ORIGINS.includes(origin)) return send(res, 403, { error: 'origin' }, origin);
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return send(res, 413, { error: 'too_large' }, origin); }
    let url;
    try { url = normaliseUrl(JSON.parse(raw).url); } catch (e) { url = null; }
    if (!url) return send(res, 400, { error: 'url' }, origin);
    if (!(await safeHost(url.hostname))) return send(res, 400, { error: 'url' }, origin);
    if (!allow(ip)) return send(res, 429, { error: 'rate' }, origin);
    if (publicQueued() >= MAX_QUEUE) return send(res, 503, { error: 'busy' }, origin);
    const id = randomUUID();
    scans.set(id, { id, url, created: Date.now(), status: 'queued' });
    // Instant checks go ahead of scheduled scans: someone is waiting on the website.
    const firstScheduled = queue.findIndex((j) => j.kind !== 'public');
    queue.splice(firstScheduled === -1 ? queue.length : firstScheduled, 0, { kind: 'public', id });
    setImmediate(pump);
    return send(res, 202, { id, status: 'queued' }, origin);
  }

  const m = path.match(/^\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && m) {
    const s = scans.get(m[1]);
    if (!s) return send(res, 404, { error: 'not_found' }, origin);
    const email = new URL(req.url, 'http://x').searchParams.get('email');
    const out = { id: s.id, status: s.status, host: s.url.hostname };
    if (s.status === 'done' || s.status === 'failed') {
      if (!emailMatches(email, s.url.hostname)) {
        out.verified = false; // results only for people who work for the site
      } else {
        Object.assign(out, { verified: true, reason: s.reason, checks: s.checks, score: s.score });
      }
    }
    return send(res, 200, out, origin);
  }
  return send(res, 404, { error: 'not_found' }, origin);
});

server.listen(PORT, '0.0.0.0', () => console.log(`untrick-scanner listening on ${PORT}, customer mode ${store ? 'on (' + DATA + ')' : 'off'}`));
process.on('SIGTERM', async () => { if (browser) await browser.close().catch(() => {}); process.exit(0); });
