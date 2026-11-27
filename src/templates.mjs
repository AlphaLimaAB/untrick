// HTML templates. Layout only: all visible text comes from content/<lang>.json.
// Every text value passes through esc() so content files can never inject HTML.

export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Hand-drawn marker shapes (decoration only, hidden from screen readers).
const CIRCLE = '<svg aria-hidden="true" focusable="false" viewBox="0 0 300 90" preserveAspectRatio="none"><path d="M150 6 C 60 4, 6 20, 8 46 C 10 74, 90 86, 168 84 C 250 82, 296 62, 292 38 C 288 14, 220 4, 120 10" stroke="#E0301E" stroke-width="5" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
const UNDERLINE = '<svg aria-hidden="true" focusable="false" viewBox="0 0 120 20" preserveAspectRatio="none"><path d="M3 12 C 40 6, 80 5, 117 10" stroke="#E0301E" stroke-width="5" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
const ICON_MENU = '<svg class="i-open" aria-hidden="true" focusable="false" width="26" height="20" viewBox="0 0 26 20"><path d="M1 2h24M1 10h24M1 18h24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
const ICON_CLOSE = '<svg class="i-close" aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 22 22"><path d="M2 2l18 18M20 2L2 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';

const marked = (before, mark, after, shape = CIRCLE, cls = 'mark') =>
  `${esc(before)}<span class="${cls}">${esc(mark)}${shape}</span>${esc(after)}`;

function layout({ site, t, lang, title, description, body, paths, alt, page }) {
  const canonical = site.baseUrl ? `<link rel="canonical" href="${esc(site.baseUrl + paths[page])}">` : '';
  const alternates = site.baseUrl
    ? `<link rel="alternate" hreflang="${lang}" href="${esc(site.baseUrl + paths[page])}">\n<link rel="alternate" hreflang="${alt.lang}" href="${esc(site.baseUrl + alt.paths[page])}">`
    : '';
  const contact = site.contactEmail ? `<a href="mailto:${esc(site.contactEmail)}">${esc(t.menu.contact)}</a>` : '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical}
${alternates}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/archivo-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css">
<script>document.documentElement.classList.add('js');</script>
</head>
<body>
<a class="skip" href="#main">${esc(t.ui.skip)}</a>
<header class="top">
  <details class="menu">
    <summary aria-label="${esc(t.ui.menu)}">${ICON_MENU}${ICON_CLOSE}</summary>
    <nav class="menu-panel" aria-label="${esc(t.ui.menu)}">
      <a href="${paths.home}">${esc(t.menu.cta)}</a>
      <a href="${paths.how}">${esc(t.menu.how)}</a>
      <a href="${paths.pricing}">${esc(t.menu.pricing)}</a>
      <a href="${paths.faq}">${esc(t.menu.faq)}</a>
      ${contact}
      <a class="lang" href="${alt.paths[page]}" hreflang="${alt.lang}" lang="${alt.lang}">${esc(t.ui.otherLanguage)}</a>
    </nav>
  </details>
  <a class="logo" href="${paths.home}"><span class="un">un${UNDERLINE}</span>trick</a>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <p>${esc(t.footer.serviceBy)} ${esc(site.company.name)} · ${esc(t.footer.orgNr)} ${esc(site.company.orgNr)} · <a href="${paths.privacy}">${esc(t.footer.privacy)}</a></p>
</footer>
<script src="/assets/main.js" defer></script>
</body>
</html>
`;
}

function progress(t, step, back = true) {
  return `
    <div class="progress">
      ${back ? `<button type="button" class="back" data-back aria-label="${esc(t.ui.back)}">←</button>` : ''}
      <span class="bar"><span class="w${step === 2 ? 33 : 66}"></span></span>
      <span class="count">${esc(t.ui.step)} ${step} ${esc(t.ui.of)} 3</span>
    </div>`;
}

const ICON_YES = '<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 20 20"><path d="M3 10.5l4.5 4.5L17 5" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Free vs monitoring vs enterprise. done = shown after a request, so the free column is already taken.
function compareTable({ t, paths, bookHref, contactHref, done }) {
  const c = t.compare;
  const cell = (v) => (v === 'yes'
    ? `<span class="yes">${ICON_YES}<span class="vh">${esc(c.yes)}</span></span>`
    : v === 'no' ? `<span class="no" aria-hidden="true">–</span><span class="vh">${esc(c.no)}</span>` : esc(v));
  const col = (i) => (c.plans[i].featured ? ' class="featured"' : '');
  const head = c.plans.map((p, i) => `
        <th scope="col"${col(i)}><span class="plan-name">${p.featured ? `<span class="mark line">${esc(p.name)}${UNDERLINE}</span>` : esc(p.name)}</span><span class="plan-price">${esc(p.price)}</span><span class="plan-tag">${esc(p.tagline)}</span></th>`).join('');
  const rows = c.rows.map((r) => `
      <tr>
        <th scope="row">${esc(r.label)}</th>${r.values.map((v, i) => `<td${col(i)}>${cell(v)}</td>`).join('')}
      </tr>`).join('');
  const free = done
    ? `<span class="taken">${ICON_YES} ${esc(c.freeDone)}</span>`
    : `<a class="btn btn-line" href="${paths.home}">${esc(c.freeCta)}</a>`;
  const ctas = [free, `<a class="btn" href="${bookHref}">${esc(c.monitorCta)}</a>`, `<a class="btn btn-line" href="${contactHref}">${esc(c.enterpriseCta)}</a>`];
  return `
  <section class="table-wrap" aria-label="${esc(c.title)}" tabindex="0">
    <table class="compare">
      <thead>
      <tr>
        <td></td>${head}
      </tr>
      </thead>
      <tbody>${rows}
      </tbody>
      <tfoot>
      <tr>
        <td></td>${ctas.map((x, i) => `<td${col(i)}>${x}</td>`).join('')}
      </tr>
      </tfoot>
    </table>
  </section>`;
}

const links = (site, t) => ({
  bookHref: site.bookingUrl
    ? esc(site.bookingUrl)
    : `mailto:${esc(site.contactEmail)}?subject=${encodeURIComponent(t.flow.bookSubject)}`,
  contactHref: `mailto:${esc(site.contactEmail)}?subject=${encodeURIComponent(t.compare.enterpriseSubject)}`
});

export function homePage({ site, t, lang, paths, alt }) {
  const s = t.start;
  const f = t.flow;
  const { bookHref, contactHref } = links(site, t);
  const body = `
<form id="scan-form" class="flow" action="${esc(site.form.endpoint)}" method="post"
  data-endpoint="${esc(site.form.endpoint)}"
  data-provider="${esc(site.form.provider)}"
  data-error-url="${esc(f.errorUrl)}"
  data-error-email="${esc(f.errorEmail)}"
  data-error-consent="${esc(f.errorConsent)}"
  data-error-wait="${esc(f.errorWait)}"
  data-error-network="${esc(f.errorNetwork)}">

  <section class="step start is-active" data-step="1" aria-labelledby="t-start">
    <h1 id="t-start" class="headline">${marked(s.titleBefore, s.titleMark, s.titleAfter)}</h1>
    <div class="search">
      <label class="vh" for="url">${esc(s.urlLabel)}</label>
      <input id="url" name="fi-url-website" type="text" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="${esc(s.urlPlaceholder)}" required>
      <button class="btn" type="submit">${esc(s.submit)}</button>
    </div>
    <p class="note">${esc(s.note)}</p>
  </section>

  <section class="step panel" data-step="2" aria-labelledby="t-email">${progress(t, 2)}
    <h2 id="t-email" class="title">${esc(f.emailTitle)}</h2>
    <label class="field-label" for="email">${esc(f.emailLabel)}</label>
    <input id="email" name="fi-sender-email" type="email" autocomplete="email" placeholder="${esc(f.emailPlaceholder)}" required>
    <p class="match" id="match" hidden>✓ ${esc(f.match)}</p>
    <p class="mismatch" id="mismatch" hidden>${esc(f.mismatch)}</p>
    <div class="consent">
      <input id="consent" name="fi-checkbox-consent" type="checkbox" value="yes" required>
      <label for="consent">${esc(f.consent)} <a href="${paths.privacy}">${esc(f.privacyLink)}</a></label>
    </div>
    <button class="btn" type="submit">${esc(f.next)}</button>
  </section>

  <section class="step panel" data-step="3" aria-labelledby="t-extras">${progress(t, 3)}
    <h2 id="t-extras" class="title">${esc(f.extrasTitle)}</h2>
    <p class="muted">${esc(f.extrasIntro)}</p>
    <div class="option">
      <label for="checkout"><b>${esc(f.checkoutTitle)}</b> <span>${esc(f.checkoutBody)}</span></label>
      <input id="checkout" name="fi-checkbox-checkout" type="checkbox" value="yes">
    </div>
    <div class="option">
      <label for="testorder"><b>${esc(f.testTitle)}</b> <span>${esc(f.testBody)}</span></label>
      <input id="testorder" name="fi-checkbox-testorder" type="checkbox" value="yes">
    </div>
    <button class="btn" type="submit">${esc(f.submit)}</button>
  </section>

  <p class="error" id="form-error" role="alert" hidden></p>
</form>

<section class="done" id="thanks" tabindex="-1" aria-labelledby="t-done" hidden>
<div class="panel">
  <h2 id="t-done" class="title">${marked(f.doneTitleBefore, f.doneTitleMark, f.doneTitleAfter, UNDERLINE, 'mark line')}</h2>
  <ol class="timeline">
    <li><span class="dot on"></span><span><b>${esc(f.doneNow)}</b> · ${esc(f.doneNowBody)}</span></li>
    <li><span class="dot"></span><span><b>${esc(f.done24)}</b> · ${esc(f.done24Body)}</span></li>
    <li data-if-testorder><span class="dot"></span><span><b>${esc(f.doneTest)}</b> · ${esc(f.doneTestBody)}</span></li>
  </ol>
  <div class="book">
    <p>${esc(f.bookText)}</p>
    <a class="btn btn-yellow" href="${bookHref}">${esc(f.bookButton)}</a>
  </div>
</div>
<div class="compare-block">
  <h3>${esc(t.compare.title)}</h3>
  <p class="muted">${esc(t.compare.intro)}</p>${compareTable({ t, paths, bookHref, contactHref, done: true })}
</div>
</section>`;

  return layout({ site, t, lang, paths, alt, page: 'home', title: t.meta.title, description: t.meta.description, body });
}

const cta = (t, paths) => `<p class="cta"><a class="btn" href="${paths.home}">${esc(t.pages.cta)}</a></p>`;

export function howPage({ site, t, lang, paths, alt }) {
  const steps = t.how.steps
    .map((x, i) => `
    <li><span class="num">${i + 1}</span><div><h2>${esc(x.title)}</h2><p>${esc(x.body)}</p></div></li>`)
    .join('');
  const checks = t.checks.items
    .map((x) => `
    <li>
      <h3>${esc(x.title)} <span class="tag ${x.status === 'now' ? 'now' : 'soon'}">${esc(x.status === 'now' ? t.checks.tagNow : t.checks.tagSoon)}</span></h3>
      <p>${esc(x.body)}</p>
    </li>`)
    .join('');
  const body = `
<div class="page">
  <h1>${esc(t.menu.how)}</h1>
  <ol class="steps-list">${steps}
  </ol>
  <h2>${esc(t.checks.title)}</h2>
  <p class="muted">${esc(t.checks.intro)}</p>
  <ul class="checks">${checks}
  </ul>
  ${cta(t, paths)}
</div>`;
  return layout({ site, t, lang, paths, alt, page: 'how', title: `${t.menu.how} – ${site.name}`, description: t.checks.intro, body });
}

export function pricingPage({ site, t, lang, paths, alt }) {
  const { bookHref, contactHref } = links(site, t);
  const body = `
<div class="page wide">
  <h1>${esc(t.compare.title)}</h1>
  <p class="muted lead">${esc(t.compare.intro)}</p>${compareTable({ t, paths, bookHref, contactHref, done: false })}
</div>`;
  return layout({ site, t, lang, paths, alt, page: 'pricing', title: `${t.menu.pricing} – ${site.name}`, description: t.compare.intro, body });
}

export function faqPage({ site, t, lang, paths, alt }) {
  const items = t.faq.items
    .map((x) => `
  <details>
    <summary>${esc(x.q)}</summary>
    <p>${esc(x.a)}</p>
  </details>`)
    .join('');
  const body = `
<div class="page faq">
  <h1>${esc(t.faq.title)}</h1>${items}
  ${cta(t, paths)}
</div>`;
  return layout({ site, t, lang, paths, alt, page: 'faq', title: `${t.faq.title} – ${site.name}`, description: t.faq.title, body });
}

export function privacyPage({ site, t, lang, paths, alt }) {
  const p = t.privacy;
  const sections = p.sections
    .map((s) => `
  <h2>${esc(s.heading)}</h2>
  <p>${esc(s.body)}</p>`)
    .join('');
  const body = `
<div class="page legal">
  <h1>${esc(p.title)}</h1>
  <p class="notice">${esc(p.draftNotice)}</p>${sections}
</div>`;
  return layout({ site, t, lang, paths, alt, page: 'privacy', title: `${p.title} – ${site.name}`, description: p.title, body });
}
