// Untrick customer mode: stored sites, scans, the findings register and its history.
// Used by server.mjs (scheduled scans) and admin.mjs (Anton's command line).
// Nothing personal is stored here: sites, rules, results, dates and evidence paths only.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, accessSync, constants, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const TZ = 'Europe/Stockholm';

// What an automatic result means for the register, per rule.
// "problem" and "check" open a finding with this default severity; null means the result counts as a pass.
// Severities are proposals: change one with `admin.mjs set <site> <rule> severity <High|Medium|Low|Observation>`.
export const RULES = {
  'UT-01': { title: 'Withdrawal information reachable from the front page', sv: 'Information om ångerrätt nås från startsidan', problem: 'High', check: null },
  'UT-10': { title: 'Cookie banner: reject as easy as accept', sv: 'Kakbanner: lika lätt att neka som att godkänna', problem: 'High', check: 'Medium' },
  'UT-12': { title: 'Automatic WCAG 2.1 AA errors (serious or critical)', sv: 'Automatiska WCAG 2.1 AA-fel (allvarliga)', problem: 'Medium', check: 'Low' },
  'UT-13': { title: 'Accessibility statement published', sv: 'Tillgänglighetsredogörelse publicerad', problem: 'Medium', check: 'Low' },
  'UT-14': { title: 'Generic environmental claims', sv: 'Generella miljöpåståenden', problem: 'Medium', check: 'Observation' },
  'UT-17': { title: 'Organisation number shown', sv: 'Organisationsnummer visas', problem: 'Low', check: 'Low' },
  'UT-03': { title: 'Reduced price based on the lowest price in the last 30 days', sv: 'Rabatt räknad från lägsta priset senaste 30 dagarna', problem: 'High', check: 'Medium' },
  'UT-19': { title: 'Product safety details on product pages (GPSR)', sv: 'Produktsäkerhetsuppgifter på produktsidor (GPSR)', problem: 'Medium', check: 'Observation' },
  'UT-20': { title: 'Chatbot says it is an AI', sv: 'Chattboten talar om att den är en AI', problem: 'Medium', check: 'Observation' },
  'UT-21': { title: 'No tracking before cookie consent', sv: 'Ingen spårning innan samtycke', problem: 'High', check: 'Low' },
  'UT-22': { title: 'Terms up to date (no link to the closed ODR platform)', sv: 'Aktuella villkor (ingen länk till den nedlagda ODR-plattformen)', problem: 'Low', check: 'Low' }
};
export const OPEN = ['New', 'Open', 'Reopened'];
export const STATUSES = ['New', 'Open', 'Fixed', 'Reopened', 'Accepted risk'];
export const SEVERITIES = ['High', 'Medium', 'Low', 'Observation'];
export const SITE_STATUSES = ['Onboarding', 'Active', 'Paused', 'Ended'];
export const AUTO_WHERE = 'Front page';

export function dataDir() {
  const dir = process.env.DATA_DIR || '/data';
  try {
    accessSync(dir, constants.W_OK);
    return dir;
  } catch (e) {
    return null; // customer mode off: no writable data folder
  }
}

export const day = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso)) : '');
export const localHour = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d)) % 24;
export const siteIdFor = (host) => host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Describe a check's result in one plain line for the register's "What we saw" column.
export function describe(check) {
  const d = check.detail || {};
  switch (check.rule) {
    case 'UT-01': return d.link ? `Link found: "${d.link}". Content not checked automatically.` : 'No link about the right of withdrawal on the front page.';
    case 'UT-10': return d.accept && d.reject ? `Accept "${d.accept}" and reject "${d.reject}" both on the first screen.` : d.accept ? `Accept "${d.accept}" on the first screen, no reject button there.` : 'No cookie banner buttons found.';
    case 'UT-12': return d.serious == null ? 'Accessibility test did not run.' : `${d.serious} serious or critical WCAG errors on the front page` + (d.top && d.top.length ? ` (most: ${d.top.map((t) => `${t.id} ×${t.nodes}`).join(', ')}).` : '.');
    case 'UT-13': return d.link ? `Link found: "${d.link}".` : 'No link to an accessibility statement on the front page.';
    case 'UT-14': return d.words && d.words.length ? `Words seen: ${d.words.join(', ')}. Check that each claim is specific and proven.` : 'No generic environmental words seen.';
    case 'UT-17': return check.result === 'ok' ? 'Organisation number shown.' : 'No organisation number found on the front page.';
    case 'UT-19': return d.missing && d.missing.length ? `Of ${d.checked} product pages, ${d.missing.length} show neither manufacturer contact details nor a product safety section: ${d.missing.slice(0, 3).join(', ')}. Confirm by hand.` : `All ${d.checked} sampled product pages show manufacturer details or a product safety section.`;
    case 'UT-20': return `Chat widget found (${(d.vendors || []).join(', ')}). Check that it tells visitors they are talking to an AI.`;
    case 'UT-21': return check.result === 'ok' ? 'No tracking started before a cookie choice.' : check.result === 'check' ? 'Only Google measurement without cookies (Consent Mode) before a choice.' : `Started before any cookie choice: ${[...(d.trackers || []), ...(d.cookies || []).map((c) => 'cookie ' + c)].join(', ')}.`;
    case 'UT-22': return `Link to the EU ODR platform (closed 20 July 2025) on ${d.where || 'the site'}: "${d.link}". Remove it.`;
    default: return '';
  }
}

export function openStore(dir) {
  mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'untrick.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT 'Monitoring',
      status TEXT NOT NULL DEFAULT 'Onboarding', every_days INTEGER NOT NULL DEFAULT 7, created TEXT NOT NULL,
      last_scan TEXT, next_scan TEXT, scan_requested INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), started TEXT NOT NULL, finished TEXT,
      kind TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, url TEXT, final_host TEXT, http_status INTEGER, score INTEGER,
      checks TEXT, evidence TEXT, evidence_sha256 TEXT
    );
    CREATE TABLE IF NOT EXISTS findings (
      site_id TEXT NOT NULL REFERENCES sites(id), rule TEXT NOT NULL, place TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL,
      latest TEXT NOT NULL DEFAULT '', first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, fixed_on TEXT, evidence TEXT, source TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', PRIMARY KEY (site_id, rule, place)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, rule TEXT, place TEXT, at TEXT NOT NULL,
      from_status TEXT, to_status TEXT NOT NULL, scan_id TEXT, source TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS pages (
      site_id TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, changed_at TEXT, PRIMARY KEY (site_id, url)
    );
    CREATE TABLE IF NOT EXISTS products (
      site_id TEXT NOT NULL, url TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (site_id, url)
    );
    CREATE TABLE IF NOT EXISTS prices (
      site_id TEXT NOT NULL, url TEXT NOT NULL, day TEXT NOT NULL, price REAL NOT NULL, was REAL, evidence TEXT,
      PRIMARY KEY (site_id, url, day)
    );
    CREATE INDEX IF NOT EXISTS scans_site ON scans(site_id, started);
    CREATE INDEX IF NOT EXISTS events_site ON events(site_id, at);
  `);
  for (const col of ['campaign_until TEXT', 'last_prices TEXT', "markets TEXT NOT NULL DEFAULT 'SE'"]) {
    try { db.exec(`ALTER TABLE sites ADD COLUMN ${col}`); } catch (e) { /* already there */ }
  }
  const q = (sql) => db.prepare(sql);

  function site(id) {
    return q('SELECT * FROM sites WHERE id = ?').get(id) || null;
  }

  // The register rule. outcome: 'fail' | 'pass' | 'unknown'. Unknown never changes a status.
  function apply({ siteId, rule, place, outcome, severity, latest, evidence, source, scanId, at }) {
    const row = q('SELECT * FROM findings WHERE site_id = ? AND rule = ? AND place = ?').get(siteId, rule, place);
    const event = (from, to, note = '') =>
      q('INSERT INTO events (site_id, rule, place, at, from_status, to_status, scan_id, source, note) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(siteId, rule, place, at, from, to, scanId || null, source, note);
    if (outcome === 'unknown') return row ? row.status : null;
    if (outcome === 'fail') {
      if (!row) {
        q(`INSERT INTO findings (site_id, rule, place, status, severity, latest, first_seen, last_seen, evidence, source)
           VALUES (?,?,?,?,?,?,?,?,?,?)`).run(siteId, rule, place, 'New', severity, latest, at, at, evidence || null, source);
        event(null, 'New');
        return 'New';
      }
      let next = row.status;
      if (row.status === 'New' || row.status === 'Reopened') next = 'Open';
      if (row.status === 'Fixed') next = 'Reopened';
      q('UPDATE findings SET status = ?, latest = ?, last_seen = ?, evidence = COALESCE(?, evidence), source = ?, fixed_on = CASE WHEN ? = \'Reopened\' THEN NULL ELSE fixed_on END WHERE site_id = ? AND rule = ? AND place = ?')
        .run(next, latest, at, evidence || null, source, next, siteId, rule, place);
      if (next !== row.status) event(row.status, next);
      return next;
    }
    // pass
    if (!row || row.status === 'Fixed') return row ? row.status : null;
    q('UPDATE findings SET status = \'Fixed\', fixed_on = ?, latest = ?, last_seen = ?, evidence = COALESCE(?, evidence), source = ? WHERE site_id = ? AND rule = ? AND place = ?')
      .run(at, latest, at, evidence || null, source, siteId, rule, place);
    event(row.status, 'Fixed');
    return 'Fixed';
  }

  return {
    db,
    site,
    sites: () => q('SELECT * FROM sites ORDER BY id').all(),

    addSite({ id, url, company = '', plan = 'Monitoring', status = 'Onboarding', everyDays = 7, notes = '' }) {
      const now = new Date().toISOString();
      q(`INSERT INTO sites (id, url, company, plan, status, every_days, created, notes, scan_requested) VALUES (?,?,?,?,?,?,?,?,1)`)
        .run(id, url, company, plan, status, everyDays, now, notes);
      return site(id);
    },

    setSite(id, field, value) {
      const allowed = { url: 'url', company: 'company', plan: 'plan', status: 'status', every: 'every_days', notes: 'notes', markets: 'markets' };
      if (!allowed[field]) throw new Error(`unknown field ${field}`);
      if (field === 'status' && !SITE_STATUSES.includes(value)) throw new Error(`status must be one of ${SITE_STATUSES.join(', ')}`);
      q(`UPDATE sites SET ${allowed[field]} = ? WHERE id = ?`).run(field === 'every' ? Number(value) : field === 'markets' ? value.toUpperCase().replace(/[^A-Z,]/g, '') : value, id);
      return site(id);
    },

    requestScan: (id) => q('UPDATE sites SET scan_requested = 1 WHERE id = ?').run(id),

    // Sites to scan now: asked for explicitly, or active and due inside the night window.
    dueSites(now, inWindow) {
      return q(`SELECT * FROM sites WHERE status != 'Ended' AND (scan_requested = 1 OR (status = 'Active' AND ? AND (next_scan IS NULL OR next_scan <= ?)))`)
        .all(inWindow ? 1 : 0, now.toISOString());
    },

    // Store a finished automatic scan and update the register.
    recordScan({ scanId, siteId, started, result, evidence, sha256, salesSeason = false, dataDir = null }) {
      const at = new Date().toISOString();
      const s = site(siteId);
      db.exec('BEGIN');
      try {
        q(`INSERT INTO scans (id, site_id, started, finished, kind, status, reason, url, final_host, http_status, score, checks, evidence, evidence_sha256)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(scanId, siteId, started, at, 'scheduled', result.status, result.reason || null, s.url,
          result.finalHost || null, result.httpStatus || null, result.score ?? null, JSON.stringify(result.checks || []), evidence || null, sha256 || null);
        const changes = [];
        if (result.status === 'done') {
          for (const c of result.checks) {
            const r = RULES[c.rule];
            if (!r) continue;
            const severity = c.result === 'unknown' ? null : r[c.result === 'ok' ? 'none' : c.result] || null;
            const outcome = c.result === 'unknown' ? 'unknown' : severity ? 'fail' : 'pass';
            const status = apply({ siteId, rule: c.rule, place: AUTO_WHERE, outcome, severity, latest: describe(c), evidence, source: 'Scheduled scan', scanId, at });
            changes.push({ rule: c.rule, result: c.result, status });
          }
          // UT-22 on the front page: a pass when no ODR link is seen there now
          if (!result.checks.some((c) => c.rule === 'UT-22')) {
            apply({ siteId, rule: 'UT-22', place: AUTO_WHERE, outcome: 'pass', latest: 'No ODR link on the front page.', evidence, source: 'Scheduled scan', scanId, at });
          }
          let campaign = false;
          if (result.deep) campaign = this.recordDeep({ siteId, scanId, at, deep: result.deep, evidence, dataDir, apply });
          const until = campaign ? new Date(Date.now() + 7 * 86400000).toISOString() : s.campaign_until;
          const intense = salesSeason || (until && until > at);
          const next = new Date(Date.now() + (intense ? 1 : s.every_days) * 86400000).toISOString();
          q('UPDATE sites SET last_scan = ?, next_scan = ?, scan_requested = 0, failures = 0, campaign_until = ? WHERE id = ?').run(at, next, until || null, siteId);
        } else {
          // Try again tomorrow; after three failures in a row the site is flagged in alerts.
          const next = new Date(Date.now() + 86400000).toISOString();
          q('UPDATE sites SET next_scan = ?, scan_requested = 0, failures = failures + 1 WHERE id = ?').run(next, siteId);
          q('INSERT INTO events (site_id, at, to_status, scan_id, source, note) VALUES (?,?,?,?,?,?)')
            .run(siteId, at, 'Scan failed', scanId, 'Scheduled scan', result.reason || '');
        }
        db.exec('COMMIT');
        return changes;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    // Product pages, terms pages and campaign signals from a scheduled scan. Returns true when a campaign is running.
    recordDeep({ siteId, scanId, at, deep, evidence, dataDir, apply: applyFn }) {
      const s = site(siteId);
      // UT-19 product safety details, one finding for the sampled product pages
      if (deep.products.length) {
        const missing = deep.products.filter((p) => !(p.gpsr.label && p.gpsr.contact) && !p.gpsr.section).map((p) => new URL(p.url).pathname.slice(0, 60));
        const c = { rule: 'UT-19', result: missing.length ? 'check' : 'ok', detail: { checked: deep.products.length, missing } };
        applyFn({ siteId, rule: 'UT-19', place: 'Product pages', outcome: missing.length ? 'fail' : 'pass', severity: RULES['UT-19'].check, latest: describe(c), evidence, source: 'Scheduled scan', scanId, at });
      }
      for (const p of deep.products) {
        q(`INSERT INTO products (site_id, url, name, currency, first_seen, last_seen) VALUES (?,?,?,?,?,?)
           ON CONFLICT(site_id, url) DO UPDATE SET name = excluded.name, currency = excluded.currency, last_seen = excluded.last_seen`)
          .run(siteId, p.url, p.name || '', p.currency || '', at, at);
        if (p.price) this.recordPrice({ siteId, url: p.url, day: day(at), price: p.price, was: p.was, evidence });
      }
      // Keep the 30 most recently seen products per site
      q(`DELETE FROM products WHERE site_id = ? AND url NOT IN (SELECT url FROM products WHERE site_id = ? ORDER BY last_seen DESC LIMIT 30)`).run(siteId, siteId);

      // Terms pages: snapshot, change log and UT-22
      let odr = null;
      for (const t of deep.terms) {
        const hash = createHash('sha256').update(t.text).digest('hex');
        const old = q('SELECT * FROM pages WHERE site_id = ? AND url = ?').get(siteId, t.url);
        if (!old) {
          q('INSERT INTO pages (site_id, url, kind, hash, text, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)').run(siteId, t.url, t.kind, hash, t.text, at, at);
        } else if (old.hash !== hash) {
          const before = new Set(old.text.split('\n').map((l) => l.trim()).filter(Boolean));
          const after = new Set(t.text.split('\n').map((l) => l.trim()).filter(Boolean));
          const added = [...after].filter((l) => !before.has(l)).length;
          const removed = [...before].filter((l) => !after.has(l)).length;
          q('UPDATE pages SET hash = ?, text = ?, last_seen = ?, changed_at = ?, kind = ? WHERE site_id = ? AND url = ?').run(hash, t.text, at, at, t.kind, siteId, t.url);
          q('INSERT INTO events (site_id, rule, place, at, to_status, scan_id, source, note) VALUES (?,?,?,?,?,?,?,?)')
            .run(siteId, null, t.url, at, 'Terms changed', scanId, 'Scheduled scan', `${t.kind}: ${added} lines added, ${removed} removed`);
        } else {
          q('UPDATE pages SET last_seen = ? WHERE site_id = ? AND url = ?').run(at, siteId, t.url);
        }
        if (evidence && dataDir) writeFileSync(path.join(dataDir, evidence, `terms-${t.kind}.txt`), `${t.url}\n${at}\n\n${t.text}`);
        if (t.odr && !odr) odr = t;
      }
      if (deep.terms.length) {
        const c = { rule: 'UT-22', result: odr ? 'check' : 'ok', detail: { link: 'ODR', where: odr ? `the ${odr.kind} page` : '' } };
        applyFn({ siteId, rule: 'UT-22', place: 'Terms pages', outcome: odr ? 'fail' : 'pass', severity: RULES['UT-22'].check,
          latest: odr ? describe(c) : 'No ODR link in the terms pages.', evidence, source: 'Scheduled scan', scanId, at });
      }

      // Campaign: log the start once, so it shows in alerts
      const running = s.campaign_until && s.campaign_until > at;
      if (deep.campaign && deep.campaign.active && !running) {
        q('INSERT INTO events (site_id, at, to_status, scan_id, source, note) VALUES (?,?,?,?,?,?)')
          .run(siteId, at, 'Campaign detected', scanId, 'Scheduled scan', `daily scans for 7 days (${deep.campaign.words.join(', ') || deep.campaign.struck + ' reduced prices'})`);
      }
      return !!(deep.campaign && deep.campaign.active);
    },

    recordPrice({ siteId, url, day: d, price, was, evidence }) {
      q(`INSERT INTO prices (site_id, url, day, price, was, evidence) VALUES (?,?,?,?,?,?)
         ON CONFLICT(site_id, url, day) DO UPDATE SET price = excluded.price, was = excluded.was, evidence = COALESCE(excluded.evidence, evidence)`)
        .run(siteId, url, d, price, was || null, evidence || null);
    },

    trackedProducts: (siteId) => q('SELECT url FROM products WHERE site_id = ? ORDER BY last_seen DESC LIMIT 20').all(siteId).map((r) => r.url),
    priceDueSites: (today) => q(`SELECT * FROM sites WHERE status = 'Active' AND (last_prices IS NULL OR last_prices < ?)`).all(today),

    // Daily price round. UT-03 per product: a reduced price must not use a reference price above the
    // lowest price we recorded in the 30 days before. Needs at least 20 days of our own history.
    recordPriceRound({ siteId, results, at, evidenceDir }) {
      const today = day(at);
      const from = day(new Date(Date.parse(at) - 30 * 86400000).toISOString());
      const out = [];
      db.exec('BEGIN');
      try {
        for (const p of results) {
          this.recordPrice({ siteId, url: p.url, day: today, price: p.price, was: p.was, evidence: p.evidence });
          if (!p.was) continue;
          const hist = q('SELECT day, price FROM prices WHERE site_id = ? AND url = ? AND day >= ? AND day < ? ORDER BY price, day').all(siteId, p.url, from, today);
          if (hist.length < 20) continue; // not enough of our own history yet
          const low = hist[0];
          const place = 'Product ' + new URL(p.url).pathname.slice(0, 70);
          const fail = p.was > low.price * 1.01;
          const status = apply({ siteId, rule: 'UT-03', place, outcome: fail ? 'fail' : 'pass', severity: RULES['UT-03'].problem,
            latest: fail ? `Shown as reduced from ${p.was} to ${p.price}, but we recorded ${low.price} on ${low.day}, within the 30 days before.` : `Reference price ${p.was} is not above the lowest price we recorded in the last 30 days (${low.price}).`,
            evidence: p.evidence || evidenceDir, source: 'Price history', at });
          out.push({ url: p.url, status });
        }
        q('UPDATE sites SET last_prices = ? WHERE id = ?').run(today, siteId);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return out;
    },

    pagesFor: (siteId) => q('SELECT url, kind, first_seen, last_seen, changed_at FROM pages WHERE site_id = ? ORDER BY kind').all(siteId),
    priceHistory: (siteId, url) => q('SELECT url, day, price, was FROM prices WHERE site_id = ? AND (? IS NULL OR url = ?) ORDER BY url, day').all(siteId, url || null, url || null),

    // A result Anton or the agent recorded by hand (checkout, terms, product pages and so on).
    recordManual({ siteId, rule, place, result, severity, latest, evidence }) {
      if (!site(siteId)) throw new Error(`no site ${siteId}`);
      const outcome = { pass: 'pass', fail: 'fail', observation: 'fail', unknown: 'unknown' }[result];
      if (!outcome) throw new Error('result must be pass, fail, observation or unknown');
      if (outcome === 'fail' && !SEVERITIES.includes(severity || (result === 'observation' ? 'Observation' : ''))) throw new Error(`severity must be one of ${SEVERITIES.join(', ')}`);
      return apply({ siteId, rule, place, outcome, severity: severity || 'Observation', latest: latest || '', evidence, source: 'Manual scan', at: new Date().toISOString() });
    },

    setFinding({ siteId, rule, place, field, value }) {
      const row = q('SELECT * FROM findings WHERE site_id = ? AND rule = ? AND place = ?').get(siteId, rule, place);
      if (!row) throw new Error('no such finding');
      const at = new Date().toISOString();
      if (field === 'status') {
        if (!STATUSES.includes(value)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
        q('UPDATE findings SET status = ?, fixed_on = CASE WHEN ? = \'Fixed\' THEN ? ELSE fixed_on END WHERE site_id = ? AND rule = ? AND place = ?')
          .run(value, value, at, siteId, rule, place);
        q('INSERT INTO events (site_id, rule, place, at, from_status, to_status, source) VALUES (?,?,?,?,?,?,?)')
          .run(siteId, rule, place, at, row.status, value, 'Manual change');
      } else if (field === 'severity') {
        if (!SEVERITIES.includes(value)) throw new Error(`severity must be one of ${SEVERITIES.join(', ')}`);
        q('UPDATE findings SET severity = ? WHERE site_id = ? AND rule = ? AND place = ?').run(value, siteId, rule, place);
      } else if (field === 'notes') {
        q('UPDATE findings SET notes = ? WHERE site_id = ? AND rule = ? AND place = ?').run(value, siteId, rule, place);
      } else throw new Error('field must be status, severity or notes');
    },

    register: (siteId) => q(`SELECT * FROM findings WHERE (? IS NULL OR site_id = ?)
      ORDER BY site_id, CASE status WHEN 'Reopened' THEN 0 WHEN 'New' THEN 1 WHEN 'Open' THEN 2 WHEN 'Accepted risk' THEN 3 ELSE 4 END,
      CASE severity WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Low' THEN 2 ELSE 3 END, rule`).all(siteId || null, siteId || null),

    scansFor: (siteId, from, to) => q('SELECT * FROM scans WHERE site_id = ? AND started >= ? AND started < ? ORDER BY started').all(siteId, from, to),
    lastScans: (siteId, n) => q('SELECT * FROM scans WHERE site_id = ? ORDER BY started DESC LIMIT ?').all(siteId, n),
    eventsFor: (siteId, from, to) => q('SELECT * FROM events WHERE (? IS NULL OR site_id = ?) AND at >= ? AND at < ? ORDER BY at').all(siteId || null, siteId || null, from, to)
  };
}
