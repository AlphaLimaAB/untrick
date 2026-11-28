// Untrick customer mode, command line. Run on the Pi:
//   docker exec untrick-scanner node admin.mjs <command> ...
// Commands are listed by `node admin.mjs help`.
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { dataDir, openStore, day, siteIdFor, RULES, OPEN, TZ } from './store.mjs';

const HELP = `Untrick customer mode

  sites [--tsv]                         List customer sites (--tsv: rows for the tracker's Sites sheet)
  add <url> [--id ID] [--company NAME] [--plan Monitoring|Enterprise] [--every DAYS] [--status Onboarding|Active]
                                        Add a site. A baseline scan runs within a minute.
  set <site> <url|company|plan|status|every|notes> <value>
  scan <site>                           Scan now (within a minute), outside the night window too
  scans <site> [N]                      The last N scans (default 10)
  register [site] [--tsv]               The findings register (--tsv: rows for the tracker's Register sheet)
  record <site> <rule> <place> <pass|fail|observation|unknown> [--severity S] [--saw TEXT] [--evidence REF]
                                        Record a manual result, for example from a checkout walk-through
  finding <site> <rule> <place> <status|severity|notes> <value>
                                        Change a finding by hand, for example status "Accepted risk"
  alerts [DAYS]                         What needs attention from the last DAYS days (default 7)
  summary <site> <YYYY-MM> [--lang sv|en]
                                        Monthly summary in Markdown for the customer report
  prices <site> [url]                   Our price history (daily prices of tracked product pages)
  pages <site>                          Terms pages we keep snapshots of, and when they last changed
  backup                                Consistent copy of the database to data/backup/ (keeps 30)

Sites can be set to several markets (used by the monthly enforcement watch):
  set <site> markets SE,NO,DK,FI
`;

const DATA = dataDir();
if (!DATA) {
  console.error('Customer mode is off: no writable data folder is mounted at /data.');
  process.exit(1);
}
const store = openStore(DATA);

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    flags[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  } else args.push(rest[i]);
}

const fail = (msg) => { console.error(msg); process.exit(1); };
const need = (n, usage) => { if (args.length < n) fail(`Usage: ${usage}`); };
const siteOrFail = (id) => store.site(id) || fail(`No site "${id}". Run: node admin.mjs sites`);
const tsv = (rows) => rows.map((r) => r.map((v) => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
const table = (rows) => {
  if (!rows.length) return '(none)';
  const widths = rows[0].map((_, i) => Math.min(60, Math.max(...rows.map((r) => String(r[i] ?? '').length))));
  return rows.map((r) => r.map((v, i) => String(v ?? '').slice(0, 60).padEnd(widths[i])).join('  ')).join('\n');
};
const latestScore = (id) => (store.lastScans(id, 5).find((s) => s.status === 'done') || {}).score ?? '';

// Start of a month in Stockholm time, as an ISO string.
function monthStart(y, m) {
  const guess = new Date(Date.UTC(y, m - 1, 1));
  const off = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(guess)
    .find((p) => p.type === 'timeZoneName').value.match(/([+-])(\d\d):(\d\d)/);
  const minutes = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0;
  return new Date(guess.getTime() - minutes * 60000).toISOString();
}

switch (cmd) {
  case 'sites': {
    const rows = store.sites();
    if (flags.tsv) {
      console.log(tsv(rows.map((s) => [s.id, s.url, s.company, s.plan, s.status, day(s.created), s.every_days, day(s.last_scan), '', latestScore(s.id)])));
    } else {
      console.log(table([['Site', 'URL', 'Company', 'Plan', 'Status', 'Every', 'Last scan', 'Next scan', 'Score', 'Open', 'Markets', 'Campaign'],
        ...rows.map((s) => [s.id, s.url, s.company, s.plan, s.status, s.every_days, day(s.last_scan), s.scan_requested ? 'within a minute' : day(s.next_scan),
          latestScore(s.id), store.register(s.id).filter((f) => OPEN.includes(f.status)).length, s.markets,
          s.campaign_until && s.campaign_until > new Date().toISOString() ? 'until ' + day(s.campaign_until) : ''])]));
    }
    break;
  }
  case 'add': {
    need(1, 'add <url> [--id ID] [--company NAME] [--plan P] [--every DAYS] [--status S]');
    let url = args[0].trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const host = new URL(url).hostname;
    const id = flags.id || siteIdFor(host);
    if (store.site(id)) fail(`Site "${id}" already exists.`);
    const s = store.addSite({ id, url, company: flags.company || '', plan: flags.plan || 'Monitoring', status: flags.status || 'Onboarding', everyDays: Number(flags.every || 7) });
    console.log(`Added ${s.id} (${s.url}), status ${s.status}. The baseline scan runs within a minute.`);
    if (s.status !== 'Active') console.log(`Weekly scans start when you run: node admin.mjs set ${s.id} status Active`);
    break;
  }
  case 'set': {
    need(3, 'set <site> <field> <value>');
    siteOrFail(args[0]);
    const s = store.setSite(args[0], args[1], args.slice(2).join(' '));
    console.log(`${s.id}: ${args[1]} = ${args.slice(2).join(' ')}`);
    break;
  }
  case 'scan': {
    need(1, 'scan <site>');
    siteOrFail(args[0]);
    store.requestScan(args[0]);
    console.log(`${args[0]} will be scanned within a minute. Check with: node admin.mjs scans ${args[0]} 1`);
    break;
  }
  case 'scans': {
    need(1, 'scans <site> [N]');
    siteOrFail(args[0]);
    console.log(table([['Started', 'Status', 'Score', 'HTTP', 'Evidence'],
      ...store.lastScans(args[0], Number(args[1] || 10)).map((s) => [s.started.slice(0, 16).replace('T', ' ') + 'Z', s.status + (s.reason ? ` (${s.reason})` : ''), s.score ?? '', s.http_status ?? '', s.evidence || ''])]));
    break;
  }
  case 'register': {
    const id = args[0] || null;
    if (id) siteOrFail(id);
    const rows = store.register(id);
    if (flags.tsv) {
      // Same columns as the tracker's Register sheet: Site ID, Rule, Where, Status, Severity, What we saw, First seen, Last seen, Fixed on, Evidence, Source, Notes
      console.log(tsv(rows.map((f) => [f.site_id, f.rule, f.place, f.status, f.severity, f.latest, day(f.first_seen), day(f.last_seen), day(f.fixed_on), f.evidence, f.source, f.notes])));
    } else {
      console.log(table([['Site', 'Rule', 'Where', 'Status', 'Severity', 'First seen', 'Last seen', 'Fixed on', 'What we saw'],
        ...rows.map((f) => [f.site_id, f.rule, f.place, f.status, f.severity, day(f.first_seen), day(f.last_seen), day(f.fixed_on), f.latest])]));
    }
    break;
  }
  case 'record': {
    need(4, 'record <site> <rule> <place> <pass|fail|observation|unknown> [--severity S] [--saw TEXT] [--evidence REF]');
    const [site, rule, place, result] = args;
    siteOrFail(site);
    const status = store.recordManual({ siteId: site, rule: rule.toUpperCase(), place, result, severity: flags.severity, latest: flags.saw || '', evidence: flags.evidence || null });
    console.log(`${site} ${rule.toUpperCase()} (${place}): ${status || 'no finding (nothing to record)'}`);
    break;
  }
  case 'finding': {
    need(5, 'finding <site> <rule> <place> <status|severity|notes> <value>');
    const [site, rule, place, field, ...value] = args;
    store.setFinding({ siteId: site, rule: rule.toUpperCase(), place, field, value: value.join(' ') });
    console.log(`${site} ${rule.toUpperCase()} (${place}): ${field} = ${value.join(' ')}`);
    break;
  }
  case 'alerts': {
    const days = Number(args[0] || 7);
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const now = new Date().toISOString();
    const lines = [];
    for (const e of store.eventsFor(null, from, now)) {
      if (e.to_status === 'New') lines.push(`${day(e.at)}  ${e.site_id}  NEW ${e.rule} (${e.place})`);
      if (e.to_status === 'Reopened') lines.push(`${day(e.at)}  ${e.site_id}  REOPENED ${e.rule} (${e.place}): it was fixed, now it is back`);
      if (e.to_status === 'Fixed') lines.push(`${day(e.at)}  ${e.site_id}  fixed ${e.rule} (${e.place})`);
      if (e.to_status === 'Terms changed') lines.push(`${day(e.at)}  ${e.site_id}  TERMS CHANGED ${e.place} (${e.note})`);
      if (e.to_status === 'Campaign detected') lines.push(`${day(e.at)}  ${e.site_id}  CAMPAIGN: ${e.note}`);
    }
    for (const s of store.sites()) {
      if (s.status === 'Ended') continue;
      if (s.failures >= 3) lines.push(`now         ${s.id}  SCAN FAILING ${s.failures} times in a row: check the site or our access`);
      if (s.status === 'Active' && s.next_scan && Date.parse(s.next_scan) < Date.now() - 2 * 86400000) lines.push(`now         ${s.id}  OVERDUE: next scan was ${day(s.next_scan)}. Is the scanner running?`);
      const [a, b] = store.lastScans(s.id, 5).filter((x) => x.status === 'done');
      if (a && b && a.started >= from && b.score - a.score >= 10) lines.push(`${day(a.started)}  ${s.id}  SCORE DROP ${b.score} -> ${a.score}`);
    }
    console.log(lines.length ? lines.join('\n') : `Nothing in the last ${days} days.`);
    break;
  }
  case 'summary': {
    need(2, 'summary <site> <YYYY-MM> [--lang sv|en]');
    const s = siteOrFail(args[0]);
    const [y, m] = args[1].split('-').map(Number);
    if (!y || !m) fail('Month as YYYY-MM, for example 2026-12');
    const from = monthStart(y, m);
    const to = monthStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
    const sv = (flags.lang || 'sv') === 'sv';
    const t = sv
      ? { title: 'Månadssammanfattning', scans: 'Skanningar', score: 'Untrick-poäng', none: 'Inga', fixed: 'Åtgärdat den här månaden', added: 'Nytt den här månaden', back: 'Har kommit tillbaka', open: 'Fortfarande öppet', accepted: 'Accepterad risk', since: 'sedan', days: 'dagar', evidence: 'Bevis (daterade skärmbilder) finns för varje skanning.', failed: 'misslyckades', terms: 'Ändrade villkor', campaigns: 'Kampanjer vi bevakade dagligen', draft: 'Utkast: "Det vi såg" är på engelska och skrivs om i rapporten.' }
      : { title: 'Monthly summary', scans: 'Scans', score: 'Untrick score', none: 'None', fixed: 'Fixed this month', added: 'New this month', back: 'Came back', open: 'Still open', accepted: 'Accepted risk', since: 'since', days: 'days', evidence: 'Evidence (dated screenshots) is kept for every scan.', failed: 'failed', terms: 'Terms that changed', campaigns: 'Campaigns we watched daily', draft: '' };
    const scans = store.scansFor(s.id, from, to);
    const done = scans.filter((x) => x.status === 'done');
    const events = store.eventsFor(s.id, from, to);
    const reg = store.register(s.id);
    const name = (rule) => (RULES[rule] ? `${rule} ${sv ? RULES[rule].sv : RULES[rule].title}` : rule);
    const list = (items) => (items.length ? items.map((x) => `- ${x}`).join('\n') : `- ${t.none}`);
    const out = [
      `## ${t.title} – ${s.company || s.id} – ${args[1]}`,
      '',
      `**${t.scans}:** ${done.length}` + (scans.length > done.length ? ` (+${scans.length - done.length} ${t.failed})` : ''),
      `**${t.score}:** ${done.length ? done.map((x) => `${day(x.started)}: ${x.score}`).join(' · ') : t.none}`,
      '',
      `### ${t.fixed}`,
      list(events.filter((e) => e.to_status === 'Fixed').map((e) => `${name(e.rule)} (${e.place}), ${day(e.at)}`)),
      '',
      `### ${t.added}`,
      list(events.filter((e) => e.to_status === 'New').map((e) => `${name(e.rule)} (${e.place}), ${day(e.at)}`)),
      '',
      `### ${t.back}`,
      list(events.filter((e) => e.to_status === 'Reopened').map((e) => `${name(e.rule)} (${e.place}), ${day(e.at)}`)),
      '',
      `### ${t.terms}`,
      list(events.filter((e) => e.to_status === 'Terms changed').map((e) => `${e.place}, ${day(e.at)} (${e.note})`)),
      '',
      `### ${t.campaigns}`,
      list(events.filter((e) => e.to_status === 'Campaign detected').map((e) => `${day(e.at)}: ${e.note}`)),
      '',
      `### ${t.open}`,
      list(reg.filter((f) => OPEN.includes(f.status) && f.first_seen < to).map((f) =>
        `**${f.severity}** ${name(f.rule)} (${f.place}), ${t.since} ${day(f.first_seen)} (${Math.max(0, Math.round((Date.parse(to < new Date().toISOString() ? to : new Date().toISOString()) - Date.parse(f.first_seen)) / 86400000))} ${t.days}): ${f.latest}`)),
      '',
      `### ${t.accepted}`,
      list(reg.filter((f) => f.status === 'Accepted risk').map((f) => `${name(f.rule)} (${f.place})${f.notes ? ': ' + f.notes : ''}`)),
      '',
      `_${t.evidence}_`
    ];
    if (t.draft) console.error(t.draft);
    console.log(out.join('\n'));
    break;
  }
  case 'prices': {
    need(1, 'prices <site> [url]');
    siteOrFail(args[0]);
    const rows = store.priceHistory(args[0], args[1]);
    console.log(table([['Day', 'Price', 'Shown as was', 'URL'], ...rows.slice(-200).map((r) => [r.day, r.price, r.was ?? '', args[1] ? '' : new URL(r.url).pathname.slice(0, 50)])]));
    break;
  }
  case 'pages': {
    need(1, 'pages <site>');
    siteOrFail(args[0]);
    console.log(table([['Kind', 'First seen', 'Last seen', 'Last changed', 'URL'], ...store.pagesFor(args[0]).map((p) => [p.kind, day(p.first_seen), day(p.last_seen), day(p.changed_at), p.url])]));
    break;
  }
  case 'backup': {
    // A consistent snapshot while the scanner keeps running. The evidence files never change, so they are copied as they are.
    const dir = path.join(DATA, 'backup');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `untrick-${day(new Date().toISOString())}.sqlite`);
    if (existsSync(file)) rmSync(file);
    store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = readdirSync(dir).filter((f) => /^untrick-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().slice(0, -30);
    for (const f of old) rmSync(path.join(dir, f));
    console.log(`backup/${path.basename(file)}`);
    break;
  }
  default:
    console.log(HELP);
}
