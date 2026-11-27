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

function layout({ site, t, lang, title, description, body, pagePath, altPath, altLang, assetPrefix }) {
  const canonical = site.baseUrl ? `<link rel="canonical" href="${esc(site.baseUrl + pagePath)}">` : '';
  const alternates = site.baseUrl
    ? `<link rel="alternate" hreflang="${lang}" href="${esc(site.baseUrl + pagePath)}">\n<link rel="alternate" hreflang="${altLang}" href="${esc(site.baseUrl + altPath)}">`
    : '';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical}
${alternates}
<link rel="icon" href="${assetPrefix}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assetPrefix}assets/styles.css">
</head>
<body>
<a class="skip" href="#main">${lang === 'sv' ? 'Hoppa till innehållet' : 'Skip to content'}</a>
<div class="wrap">
<header>
  <a class="logo" href="${pagePath.startsWith('/en') ? '/en/' : '/'}">${esc(site.name)}</a>
  <a class="lang-link" href="${altPath}" hreflang="${altLang}" lang="${altLang}">${esc(t.nav.otherLanguage)}</a>
</header>
<main id="main">
${body}
</main>
<footer>
  <p>${esc(t.footer.serviceBy)} ${esc(site.company.name)} · ${esc(t.footer.orgNr)} ${esc(site.company.orgNr)} · ${esc(site.company.address)}</p>
  <p>${site.contactEmail ? `<a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a> · ` : ''}<a href="${t.privacyPath}">${esc(t.footer.privacy)}</a></p>
</footer>
</div>
<script src="${assetPrefix}assets/main.js" defer></script>
</body>
</html>
`;
}

export function homePage({ site, t, lang, pagePath, altPath, altLang }) {
  const f = t.form;
  const checks = t.checks.items
    .map((item) => `
    <div class="card check">
      <span class="tag ${item.status === 'now' ? 'now' : 'soon'}">${esc(item.status === 'now' ? t.checks.tagNow : t.checks.tagSoon)}</span>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.body)}</p>
    </div>`)
    .join('');
  const steps = t.how.steps
    .map((s) => `
    <li class="step">
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.body)}</p>
    </li>`)
    .join('');
  const plans = t.pricing.plans
    .map((p) => `
    <div class="card${p.featured ? ' featured' : ''}">
      <h3>${esc(p.name)}</h3>
      <div class="amount">${esc(p.price)}</div>
      <ul>${p.features.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>`)
    .join('');
  const faq = t.faq.items
    .map((x) => `
  <details>
    <summary>${esc(x.q)}</summary>
    <p>${esc(x.a)}</p>
  </details>`)
    .join('');

  const body = `
<div class="hero">
  <div>
    <span class="eyebrow">${esc(t.hero.eyebrow)}</span>
    <h1>${esc(t.hero.title)}</h1>
    <p class="lede">${esc(t.hero.lede)}</p>
  </div>
  <div class="card" id="scan">
    <form id="scan-form" novalidate
      data-endpoint="${esc(site.form.endpoint)}"
      data-provider="${esc(site.form.provider)}"
      data-error-invalid="${esc(f.errorInvalid)}"
      data-error-network="${esc(f.errorNetwork)}"
      data-error-email="${esc(f.errorEmail)}"
      data-error-url="${esc(f.errorUrl)}"
      data-error-wait="${esc(f.errorWait)}">
      <label for="url">${esc(f.urlLabel)}</label>
      <input id="url" name="fi-url-website" type="url" inputmode="url" autocomplete="url" placeholder="${esc(f.urlPlaceholder)}" required>
      <label for="email">${esc(f.emailLabel)}</label>
      <input id="email" name="fi-sender-email" type="email" autocomplete="email" placeholder="${esc(f.emailPlaceholder)}" required>
      <div class="consent">
        <input id="consent" name="fi-checkbox-consent" type="checkbox" value="yes" required>
        <label for="consent">${esc(f.consent)} <a href="${t.privacyPath}">${esc(f.privacyLink)}</a></label>
      </div>
      <div class="consent">
        <input id="checkout" name="fi-checkbox-checkout" type="checkbox" value="yes">
        <label for="checkout">${esc(f.checkoutConsent)}</label>
      </div>
      <button class="btn" type="submit">${esc(f.submit)}</button>
      <p class="fine error" id="form-error" role="alert" hidden></p>
      <p class="fine">${esc(f.note)}</p>
    </form>
    <div class="thanks" id="thanks" tabindex="-1" aria-live="polite" hidden>
      <h2>${esc(f.thanksTitle)}</h2>
      <p>${esc(f.thanksBody)}</p>
    </div>
  </div>
</div>

<section>
  <h2>${esc(t.checks.title)}</h2>
  <p class="sub">${esc(t.checks.intro)}</p>
  <div class="grid">${checks}
  </div>
</section>

<section>
  <h2>${esc(t.how.title)}</h2>
  <ol class="steps">${steps}
  </ol>
</section>

<section>
  <h2>${esc(t.pricing.title)}</h2>
  <p class="sub">${esc(t.pricing.intro)}</p>
  <div class="price">${plans}
  </div>
</section>

<section>
  <h2>${esc(t.faq.title)}</h2>${faq}
</section>`;

  return layout({
    site, t, lang, pagePath, altPath, altLang,
    title: t.meta.title,
    description: t.meta.description,
    body,
    assetPrefix: '/'
  });
}

export function privacyPage({ site, t, lang, pagePath, altPath, altLang }) {
  const p = t.privacy;
  const sections = p.sections
    .map((s) => `
  <h2>${esc(s.heading)}</h2>
  <p>${esc(s.body)}</p>`)
    .join('');
  const body = `
<div class="legal">
  <h1>${esc(p.title)}</h1>
  <p class="notice">${esc(p.draftNotice)}</p>${sections}
</div>`;
  return layout({
    site, t, lang, pagePath, altPath, altLang,
    title: `${p.title} – ${site.name}`,
    description: p.title,
    body,
    assetPrefix: '/'
  });
}
