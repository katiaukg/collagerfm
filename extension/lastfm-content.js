'use strict';

if (!globalThis.__collagerLastfmContentInstalled) {
  globalThis.__collagerLastfmContentInstalled = true;

  async function timedFetch(input, init = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const sourceSignal = init.signal;
    const abortFromSource = () => controller.abort(sourceSignal?.reason);
    if (sourceSignal?.aborted) abortFromSource();
    else sourceSignal?.addEventListener('abort', abortFromSource, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !sourceSignal?.aborted) {
        throw new Error('O Last.fm demorou demais para responder.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    }
  }

  function cookieValue(name) {
    const prefix = `${name}=`;
    const part = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return part ? decodeURIComponent(part.slice(prefix.length)) : '';
  }

  async function csrfToken(username) {
    const fromCookie = cookieValue('csrftoken');
    if (fromCookie) return fromCookie;
    const response = await timedFetch(`/user/${encodeURIComponent(username)}/library`, { credentials: 'include' });
    const html = await response.text();
    const documentCopy = new DOMParser().parseFromString(html, 'text/html');
    return documentCopy.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
  }

  async function deleteScrobble(payload) {
    const username = String(payload?.username || '').trim();
    const artist = String(payload?.artist || '').trim();
    const track = String(payload?.track || '').trim();
    const timestamp = Math.floor(Number(payload?.timestamp));
    if (!username || !artist || !track || !Number.isFinite(timestamp) || timestamp <= 0) {
      return { ok: false, error: 'Dados do scrobble invalidos.' };
    }

    const csrf = await csrfToken(username);
    if (!csrf) {
      return {
        ok: false,
        authRequired: true,
        error: 'Entre na sua conta no Last.fm nesta aba e tente novamente.',
      };
    }

    const form = new URLSearchParams({
      csrfmiddlewaretoken: csrf,
      artist_name: artist,
      track_name: track,
      timestamp: String(timestamp),
      ajax: '1',
    });
    const response = await timedFetch(`/user/${encodeURIComponent(username)}/library/delete`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form.toString(),
      referrer: `https://www.last.fm/user/${encodeURIComponent(username)}`,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });

    if (response.status === 403) {
      return { ok: false, authRequired: true, error: 'Sua sessao do Last.fm expirou. Entre novamente e repita a operacao.' };
    }
    if (response.status === 406 || response.status === 429) {
      return { ok: false, error: 'O Last.fm limitou as exclusoes temporariamente. Aguarde alguns segundos e tente novamente.' };
    }
    if (!response.ok) {
      return { ok: false, error: `O Last.fm respondeu ${response.status} ao excluir o scrobble.` };
    }
    const result = await response.json().catch(() => null);
    if (result?.result !== true) return { ok: false, error: 'O Last.fm nao confirmou a exclusao do scrobble.' };
    return { ok: true, deleted: true };
  }

  async function deleteObsession(payload) {
    let url;
    try { url = new URL(String(payload?.url || ''), location.origin); }
    catch (_) { return { ok: false, error: 'Endereco da obsessao invalido.' }; }
    if (url.origin !== location.origin || !/^\/user\/[^/]+\/obsessions\/\d+\/?$/i.test(url.pathname)) {
      return { ok: false, error: 'Endereco da obsessao invalido.' };
    }

    const pageResponse = await timedFetch(url.pathname, { credentials: 'include' });
    if (pageResponse.status === 403) {
      return { ok: false, authRequired: true, error: 'Sua sessao do Last.fm expirou. Entre novamente e repita a operacao.' };
    }
    if (!pageResponse.ok) return { ok: false, error: `O Last.fm respondeu ${pageResponse.status} ao abrir a obsessao.` };
    const pageHtml = await pageResponse.text();
    const pageDocument = new DOMParser().parseFromString(pageHtml, 'text/html');
    const form = pageDocument.querySelector('form[action][data-confirm-title="Delete this obsession"]')
      || pageDocument.querySelector('form[action] input[name="action"][value="delete"]')?.closest('form');
    const csrf = form?.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
    if (!form || !csrf) {
      return { ok: false, authRequired: true, error: 'Entre na conta dona desta obsessao no Last.fm e tente novamente.' };
    }

    const body = new URLSearchParams({ csrfmiddlewaretoken: csrf, action: 'delete' });
    const response = await timedFetch(form.getAttribute('action') || url.pathname, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
      redirect: 'follow',
    });
    if (response.status === 403) {
      return { ok: false, authRequired: true, error: 'Sua sessao do Last.fm expirou. Entre novamente e repita a operacao.' };
    }
    if (response.status === 406 || response.status === 429) {
      return { ok: false, error: 'O Last.fm limitou a exclusao temporariamente. Aguarde alguns segundos e tente novamente.' };
    }
    if (!response.ok) return { ok: false, error: `O Last.fm respondeu ${response.status} ao excluir a obsessao.` };
    const resultHtml = await response.text();
    const resultDocument = new DOMParser().parseFromString(resultHtml, 'text/html');
    const deleteFormStillPresent = resultDocument.querySelector('form[action] input[name="action"][value="delete"]');
    if (deleteFormStillPresent && new URL(response.url).pathname.replace(/\/$/, '') === url.pathname.replace(/\/$/, '')) {
      return { ok: false, error: 'O Last.fm manteve a obsessao depois da tentativa de exclusao.' };
    }
    return { ok: true, deleted: true };
  }

  function encodeLastfmPath(value) {
    return encodeURIComponent(String(value || '').trim()).replace(/%20/g, '+');
  }

  async function setObsession(payload) {
    const username = String(payload?.username || '').trim();
    const artist = String(payload?.artist || '').trim();
    const track = String(payload?.track || '').trim();
    if (!username || !artist || !track) return { ok: false, error: 'Dados da faixa invalidos.' };
    const trackPath = `/music/${encodeLastfmPath(artist)}/_/${encodeLastfmPath(track)}`;
    const pageResponse = await timedFetch(trackPath, { credentials: 'include' });
    if (pageResponse.status === 403) {
      return { ok: false, authRequired: true, error: 'Entre na sua conta no Last.fm e tente novamente.' };
    }
    if (!pageResponse.ok) return { ok: false, error: `O Last.fm respondeu ${pageResponse.status} ao abrir a faixa.` };
    const pageDocument = new DOMParser().parseFromString(await pageResponse.text(), 'text/html');
    const forms = Array.from(pageDocument.querySelectorAll('form[action]'));
    const form = forms.find(candidate => {
      const descriptor = [
        candidate.getAttribute('action'),
        candidate.getAttribute('aria-label'),
        candidate.textContent,
        ...Array.from(candidate.querySelectorAll('button,input')).map(control => [
          control.getAttribute('name'), control.getAttribute('value'), control.getAttribute('title'), control.textContent,
        ].join(' ')),
      ].join(' ').toLocaleLowerCase();
      return /obsession/.test(descriptor) && !/\bdelete\b|excluir/.test(descriptor);
    });
    if (!form) {
      return {
        ok: false,
        manualActionRequired: true,
        error: 'O Last.fm não exibiu o controle de obsessão. A página da faixa foi aberta para você concluir a ação.',
      };
    }

    const body = new URLSearchParams();
    form.querySelectorAll('input[name],select[name],textarea[name]').forEach(control => {
      if ((control.type === 'checkbox' || control.type === 'radio') && !control.checked) return;
      body.append(control.name, control.value || '');
    });
    if (!body.get('csrfmiddlewaretoken')) {
      const csrf = cookieValue('csrftoken') || await csrfToken(username);
      if (csrf) body.set('csrfmiddlewaretoken', csrf);
    }
    const submitControl = Array.from(form.querySelectorAll('button[name],input[type="submit"][name]'))
      .find(control => /obsession/i.test(`${control.value || ''} ${control.textContent || ''}`));
    if (submitControl) body.set(submitControl.name, submitControl.value || '');

    const action = new URL(form.getAttribute('action') || trackPath, location.origin);
    const response = await timedFetch(action.pathname + action.search, {
      method: String(form.getAttribute('method') || 'POST').toUpperCase(),
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
      redirect: 'follow',
    });
    if (response.status === 403) {
      return { ok: false, authRequired: true, error: 'Sua sessão do Last.fm expirou. Entre novamente e repita a operação.' };
    }
    if (response.status === 406 || response.status === 429) {
      return { ok: false, error: 'O Last.fm limitou esta ação temporariamente. Aguarde alguns segundos e tente novamente.' };
    }
    if (!response.ok) return { ok: false, error: `O Last.fm respondeu ${response.status} ao definir a obsessão.` };
    return { ok: true, obsessionSet: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.channel !== 'collager-lastfm-page') return undefined;
    let operation;
    let fallbackError;
    if (message.action === 'deleteScrobble') {
      operation = deleteScrobble(message.payload);
      fallbackError = 'Falha ao excluir o scrobble.';
    } else if (message.action === 'deleteObsession') {
      operation = deleteObsession(message.payload);
      fallbackError = 'Falha ao excluir a obsessao.';
    } else if (message.action === 'setObsession') {
      operation = setObsession(message.payload);
      fallbackError = 'Falha ao definir a obsessao.';
    } else {
      return false;
    }
    operation
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || fallbackError }));
    return true;
  });
}
