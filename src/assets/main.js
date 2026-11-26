// Scan request form. Configuration comes from data attributes that the build writes from content/site.json.
// No cookies, no tracking.
(function () {
  const form = document.getElementById('scan-form');
  if (!form) return;

  const endpoint = form.dataset.endpoint || '';
  const provider = form.dataset.provider || 'json';
  const err = document.getElementById('form-error');
  const thanks = document.getElementById('thanks');
  const button = form.querySelector('button[type=submit]');

  function normaliseUrl(value) {
    let url = value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { return new URL(url).toString(); } catch (e) { return null; }
  }

  function showError(message) {
    err.textContent = message;
    err.hidden = false;
  }

  function buildRequest(data) {
    if (provider === 'forminit') {
      // Forminit expects FormData with fi-{blockType}-{fieldName} names.
      const fd = new FormData();
      fd.append('fi-sender-email', data.email);
      fd.append('fi-url-website', data.url);
      fd.append('fi-text-language', data.lang);
      fd.append('fi-text-consent', data.consent);
      return { method: 'POST', body: fd, headers: { Accept: 'application/json' } };
    }
    // Generic JSON endpoint (for example our own API later).
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data)
    };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    err.hidden = true;

    const url = normaliseUrl(form.elements.url.value);
    const email = form.elements.email.value.trim();
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!url || !okEmail || !form.elements.consent.checked) {
      showError(form.dataset.errorInvalid);
      return;
    }

    const data = {
      url: url,
      email: email,
      lang: document.documentElement.lang,
      consent: 'yes ' + new Date().toISOString()
    };

    button.disabled = true;
    try {
      if (endpoint) {
        const response = await fetch(endpoint, buildRequest(data));
        if (!response.ok) throw new Error('status ' + response.status);
      } else {
        // Demo mode: no endpoint configured yet.
        console.info('Demo mode: form endpoint not set in content/site.json', data);
      }
      form.hidden = true;
      thanks.hidden = false;
      thanks.focus();
    } catch (e) {
      showError(form.dataset.errorNetwork);
    } finally {
      button.disabled = false;
    }
  });
})();
