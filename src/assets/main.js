// Scan request form. Configuration comes from data attributes that the build writes from content/site.json.
// No cookies, no tracking.
//
// Forminit form: inputs are named fi-{type}-{name}. Rules: https://forminit.com/setup.md
// We post directly to Forminit's endpoint (no third-party script on the page). Field names,
// success check (submission hashId), error codes and the in-flight lock follow Forminit's setup guide.
(function () {
  const form = document.getElementById('scan-form');
  if (!form) return;

  const endpoint = form.dataset.endpoint || '';
  const provider = form.dataset.provider || 'json';
  const err = document.getElementById('form-error');
  const thanks = document.getElementById('thanks');
  const button = form.querySelector('button[type=submit]');
  let sending = false;

  // One message per field Forminit validates, in the page's language.
  // Keys are Forminit's field names: sender.<name> for fi-sender-*, else the {name} of fi-{type}-{name}.
  const FIELD_ERRORS = {
    'sender.email': form.dataset.errorEmail,
    website: form.dataset.errorUrl
  };

  // Forminit names the failing field in fieldName or, today, as the first quoted word of message.
  function errorText(body, status) {
    const field = body && (body.fieldName || (/['"]([^'"]+)['"]/.exec(body.message || '') || [])[1]);
    if (field && FIELD_ERRORS[field]) return FIELD_ERRORS[field];
    if (status === 429 || (body && body.error === 'TOO_MANY_REQUESTS')) return form.dataset.errorWait;
    return form.dataset.errorNetwork;
  }

  function normaliseUrl(value) {
    let url = String(value || '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { return new URL(url).toString(); } catch (e) { return null; }
  }

  function showError(message) {
    err.textContent = message;
    err.hidden = false;
  }

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
        consent: fd.get('fi-checkbox-consent')
      })
    };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (sending) return;

    const fd = new FormData(form); // before anything is disabled
    const url = normaliseUrl(fd.get('fi-url-website'));
    const email = String(fd.get('fi-sender-email') || '').trim();
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!url || !okEmail || fd.get('fi-checkbox-consent') !== 'yes') {
      showError(form.dataset.errorInvalid);
      return;
    }
    fd.set('fi-url-website', url); // Forminit requires a full https:// address
    fd.set('fi-sender-email', email);
    fd.append('fi-text-language', document.documentElement.lang);

    err.hidden = true; // before the flag: nothing that can throw sits between the flag and try
    sending = true;
    button.disabled = true;
    try {
      if (!endpoint) {
        // Demo mode: no endpoint configured yet.
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
      form.hidden = true;
      thanks.hidden = false;
      thanks.focus();
    } catch (e) {
      console.error('Form submission failed:', e);
      showError(form.dataset.errorNetwork);
    } finally {
      sending = false;
      button.disabled = false;
    }
  });
})();
