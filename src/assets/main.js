// Menu and the three-step scan request. No cookies, no tracking.
//
// Without JavaScript every step shows at once and the form posts straight to the endpoint.
// With JavaScript the steps show one at a time and the last step posts with fetch.
//
// Forminit form: inputs are named fi-{type}-{name}. Rules: https://forminit.com/setup.md
// We post directly to Forminit's endpoint (no third-party script on the page). Field names,
// success check (submission hashId), error codes and the in-flight lock follow Forminit's setup guide.
(function () {
  // Close the menu with Escape.
  const menu = document.querySelector('.menu');
  if (menu) {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }

  const form = document.getElementById('scan-form');
  if (!form) return;
  form.noValidate = true; // we validate per step and show our own messages

  const d = form.dataset;
  const endpoint = d.endpoint || '';
  const provider = d.provider || 'json';
  const steps = Array.from(form.querySelectorAll('.step'));
  const err = document.getElementById('form-error');
  const thanks = document.getElementById('thanks');
  const urlInput = document.getElementById('url');
  const emailInput = document.getElementById('email');
  const consent = document.getElementById('consent');
  const match = document.getElementById('match');
  const mismatch = document.getElementById('mismatch');
  let current = 1;
  let sending = false;

  // Forminit names the failing field in fieldName or as the first quoted word of message.
  const FIELD_ERRORS = { 'sender.email': d.errorEmail, website: d.errorUrl };
  function errorText(body, status) {
    const field = body && (body.fieldName || (/['"]([^'"]+)['"]/.exec(body.message || '') || [])[1]);
    if (field && FIELD_ERRORS[field]) return FIELD_ERRORS[field];
    if (status === 429 || (body && body.error === 'TOO_MANY_REQUESTS')) return d.errorWait;
    return d.errorNetwork;
  }

  function normaliseUrl(value) {
    let url = String(value || '').trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      const parsed = new URL(url);
      return parsed.hostname.includes('.') ? parsed.toString() : null;
    } catch (e) {
      return null;
    }
  }
  const host = (url) => (url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : '');
  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

  function showError(message, field) {
    steps[current - 1].appendChild(err); // right under the step's button
    err.textContent = message;
    err.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }
  function clearError() {
    err.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function show(step, push) {
    current = step;
    clearError();
    steps.forEach((s) => s.classList.toggle('is-active', Number(s.dataset.step) === step));
    if (push) history.pushState({ step: step }, '');
    window.scrollTo(0, 0);
    const first = steps[step - 1].querySelector('input');
    if (step > 1 && first) first.focus();
  }

  // The browser's back button moves one step back.
  history.replaceState({ step: 1 }, '');
  window.addEventListener('popstate', function (event) {
    if (!form.hidden) show((event.state && event.state.step) || 1, false);
  });
  form.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));

  // Tell the visitor straight away whether the email belongs to the website.
  function checkMatch() {
    const site = host(normaliseUrl(urlInput.value));
    const email = emailInput.value.trim();
    const domain = (email.split('@')[1] || '').toLowerCase();
    const ok = validEmail(email) && site && (domain === site || site.endsWith('.' + domain) || domain.endsWith('.' + site));
    match.hidden = !ok;
    mismatch.hidden = !validEmail(email) || ok;
  }
  emailInput.addEventListener('input', checkMatch);

  function buildRequest(fd) {
    if (provider === 'forminit') {
      return { method: 'POST', body: fd, headers: { Accept: 'application/json' } };
    }
    // Generic JSON endpoint (for example our own API later).
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        url: fd.get('fi-url-website'),
        email: fd.get('fi-sender-email'),
        lang: fd.get('fi-text-language'),
        consent: fd.get('fi-checkbox-consent'),
        checkout: fd.get('fi-checkbox-checkout') === 'yes',
        testorder: fd.get('fi-checkbox-testorder') === 'yes'
      })
    };
  }

  async function send() {
    const fd = new FormData(form); // before anything is disabled
    fd.set('fi-url-website', normaliseUrl(urlInput.value)); // Forminit requires a full https:// address
    fd.set('fi-sender-email', emailInput.value.trim());
    fd.append('fi-text-language', document.documentElement.lang);

    const button = steps[2].querySelector('button[type=submit]');
    clearError(); // before the flag: nothing that can throw sits between the flag and try
    sending = true;
    button.disabled = true;
    try {
      if (!endpoint) {
        console.info('Demo mode: form endpoint not set in content/site.json');
      } else {
        const response = await fetch(endpoint, buildRequest(fd));
        let body = null;
        try { body = await response.json(); } catch (e) { body = null; }
        const hashId = body && ((body.submission && body.submission.hashId) || body.hashId);
        const ok = provider === 'forminit' ? response.ok && typeof hashId === 'string' : response.ok;
        if (!ok) {
          console.error('Form submission failed:', response.status, body);
          showError(errorText(body, response.status));
          return; // keep the visitor's input
        }
      }
      const testLine = thanks.querySelector('[data-if-testorder]');
      if (testLine) testLine.hidden = !document.getElementById('testorder').checked;
      form.hidden = true;
      thanks.hidden = false;
      window.scrollTo(0, 0);
      thanks.focus();
    } catch (e) {
      console.error('Form submission failed:', e);
      showError(d.errorNetwork);
    } finally {
      sending = false;
      button.disabled = false;
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) return;
    if (current === 1) {
      if (!normaliseUrl(urlInput.value)) return showError(d.errorUrl, urlInput);
      checkMatch();
      return show(2, true);
    }
    if (current === 2) {
      if (!validEmail(emailInput.value)) return showError(d.errorEmail, emailInput);
      if (!consent.checked) return showError(d.errorConsent, consent);
      return show(3, true);
    }
    send();
  });
})();
