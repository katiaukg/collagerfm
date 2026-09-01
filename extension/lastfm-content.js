'use strict';

if (!globalThis.__collagerLastfmContentInstalled) {
  globalThis.__collagerLastfmContentInstalled = true;

  const TEMPORARY_UNAVAILABLE_MESSAGE = 'Site está temporariamente inacessível.';

  function temporaryUnavailableError(message = TEMPORARY_UNAVAILABLE_MESSAGE) {
    const error = new Error(message);
    error.code = 'LASTFM_TEMPORARILY_UNAVAILABLE';
    error.retryable = true;
    error.retryAfterMs = 60000;
    error.temporaryUnavailable = true;
    return error;
  }

  function isTemporarilyUnavailable(status, body = '') {
    const text = String(body || '').toLocaleLowerCase();
    return status === 502
      || status === 503
      || status === 504
      || text.includes('temporarily unavailable')
      || text.includes('please enjoy a cup of tea');
  }

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
        const timeoutError = new Error('O Last.fm demorou demais para responder.');
        timeoutError.code = 'LASTFM_REQUEST_TIMEOUT';
        timeoutError.retryable = true;
        throw timeoutError;
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
    if (isTemporarilyUnavailable(response.status, html)) throw temporaryUnavailableError();
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
    const responseText = await response.text();
    if (isTemporarilyUnavailable(response.status, responseText)) {
      return {
        ok: false,
        code: 'LASTFM_TEMPORARILY_UNAVAILABLE',
        retryable: true,
        retryAfterMs: 60000,
        temporaryUnavailable: true,
        error: TEMPORARY_UNAVAILABLE_MESSAGE,
      };
    }
    if (!response.ok) {
      return { ok: false, error: `O Last.fm respondeu ${response.status} ao excluir o scrobble.` };
    }
    let result = null;
    try { result = JSON.parse(responseText); } catch (_) {}
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

  function normalizeObsessionMetadata(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();
  }

  async function confirmCurrentObsession(username, artist, track) {
    const expectedArtist = normalizeObsessionMetadata(artist);
    const expectedTrack = normalizeObsessionMetadata(track);
    const profilePath = `/user/${encodeLastfmPath(username)}/obsessions`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 900));
      const separator = profilePath.includes('?') ? '&' : '?';
      const response = await timedFetch(`${profilePath}${separator}_collager_verify=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'text/html',
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) continue;
      const profileDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
      const latest = profileDocument.querySelector('.obsession-history-item');
      const currentTrack = normalizeObsessionMetadata(
        latest?.querySelector('.obsession-history-item-heading')?.textContent,
      );
      const currentArtist = normalizeObsessionMetadata(
        latest?.querySelector('.obsession-history-item-artist')?.textContent,
      );
      if (currentTrack === expectedTrack && currentArtist === expectedArtist) return true;
    }
    return false;
  }

  function describeForm(form) {
    return [
      form.getAttribute('action'),
      form.getAttribute('aria-label'),
      form.textContent,
      ...Array.from(form.querySelectorAll('button,input,textarea')).map(control => [
        control.getAttribute('name'), control.getAttribute('value'), control.getAttribute('title'), control.textContent,
      ].join(' ')),
    ].join(' ').toLocaleLowerCase();
  }

  function findObsessionForm(pageDocument, responseUrl = '') {
    const responseLooksLikeObsessionFlow = (() => {
      try {
        return /\/obsessions?(?:\/|$)|set[-_]?obsession/i.test(new URL(responseUrl || location.href).pathname);
      } catch (_) {
        return false;
      }
    })();
    return Array.from(pageDocument.querySelectorAll('form[action]')).find(candidate => {
      const descriptor = describeForm(candidate);
      return !/\bdelete\b|excluir/.test(descriptor)
        && (/obsession/.test(descriptor) || responseLooksLikeObsessionFlow);
    }) || null;
  }

  function findObsessionModalUrl(pageDocument, baseUrl) {
    const trigger = Array.from(pageDocument.querySelectorAll('[data-open-modal],a[href]')).find(candidate => {
      const descriptor = [
        candidate.getAttribute('data-open-modal'),
        candidate.getAttribute('href'),
        candidate.getAttribute('aria-label'),
        candidate.textContent,
      ].join(' ').toLocaleLowerCase();
      return /obsession/.test(descriptor) && !/\bdelete\b|excluir/.test(descriptor);
    });
    const target = trigger?.getAttribute('data-open-modal') || trigger?.getAttribute('href');
    if (!target) return '';
    const url = new URL(target, baseUrl || location.origin);
    if (url.origin !== location.origin || /\/login(?:\/|\?|$)|\/join(?:\/|\?|$)/i.test(url.pathname)) return '';
    return url.pathname + url.search;
  }

  async function fetchLastfmModal(path) {
    return timedFetch(path, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'text/html, */*; q=0.01',
        'Cache-Control': 'no-cache',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
  }

  function appendFormControl(body, control, blankTextareas = false) {
    if (!control.name || control.disabled) return;
    const type = String(control.type || '').toLowerCase();
    if ((type === 'checkbox' || type === 'radio') && !control.checked) return;
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return;
    if (control.tagName === 'SELECT' && control.multiple) {
      Array.from(control.options).filter(option => option.selected).forEach(option => body.append(control.name, option.value));
      return;
    }
    const isOptionalObsessionNote = control.tagName === 'TEXTAREA'
      && (blankTextareas || /note|comment|thought|review|reason|message|content/i.test(control.name));
    body.append(control.name, isOptionalObsessionNote ? '' : (control.value || ''));
  }

  async function submitLastfmForm(form, baseUrl, username, { blankTextareas = false } = {}) {
    const body = new URLSearchParams();
    form.querySelectorAll('input[name],select[name],textarea[name]')
      .forEach(control => appendFormControl(body, control, blankTextareas));
    if (!body.get('csrfmiddlewaretoken')) {
      const csrf = cookieValue('csrftoken') || await csrfToken(username);
      if (csrf) body.set('csrfmiddlewaretoken', csrf);
    }
    const submitControl = Array.from(form.querySelectorAll('button[name],input[type="submit"][name]'))
      .find(control => !/cancel|back|voltar|cancelar/i.test(`${control.value || ''} ${control.textContent || ''}`));
    if (submitControl) body.set(submitControl.name, submitControl.value || '');

    const action = new URL(form.getAttribute('action') || baseUrl, baseUrl || location.origin);
    if (action.origin !== location.origin) throw new Error('Endereco da obsessao invalido.');
    const method = String(form.getAttribute('method') || 'POST').toUpperCase();
    const options = {
      method,
      credentials: 'include',
      redirect: 'follow',
      headers: {
        Accept: 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };
    if (method === 'GET') {
      body.forEach((value, key) => action.searchParams.append(key, value));
    } else {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      options.body = body.toString();
    }
    return timedFetch(action.pathname + action.search, options);
  }

  async function setObsession(payload) {
    const username = String(payload?.username || '').trim();
    const artist = String(payload?.artist || '').trim();
    const track = String(payload?.track || '').trim();
    const reason = String(payload?.reason || '').trim().slice(0, 1000);
    if (!username || !artist || !track) return { ok: false, error: 'Dados da faixa invalidos.' };
    const csrf = cookieValue('csrftoken') || await csrfToken(username);
    if (!csrf) {
      return {
        ok: false,
        authRequired: true,
        error: 'Entre na sua conta no Last.fm nesta aba e tente novamente.',
      };
    }

    // Current obsessions are a private website action, not a public API method.
    const body = new URLSearchParams({
      csrfmiddlewaretoken: csrf,
      artist_name: artist,
      name: track,
      reason,
      ajax: '1',
    });
    const profilePath = `/user/${encodeLastfmPath(username)}`;
    const response = await timedFetch(`${profilePath}/obsessions`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'follow',
      headers: {
        Accept: 'text/html, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      referrer: new URL(profilePath, location.origin).href,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    if (response.status === 403) {
      return { ok: false, authRequired: true, error: 'Sua sessão do Last.fm expirou. Entre novamente e repita a operação.' };
    }
    if (response.status === 406 || response.status === 429) {
      return { ok: false, error: 'O Last.fm limitou esta ação temporariamente. Aguarde alguns segundos e tente novamente.' };
    }
    if (!response.ok) return { ok: false, error: `O Last.fm respondeu ${response.status} ao definir a obsessão.` };

    const confirmed = await confirmCurrentObsession(username, artist, track);
    if (!confirmed) {
      return {
        ok: false,
        error: 'O Last.fm recebeu a solicitação, mas a faixa não apareceu como obsessão no perfil.',
      };
    }
    return { ok: true, obsessionSet: true, verified: true };
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
      .catch(error => sendResponse({
        ok: false,
        error: error?.message || fallbackError,
        code: error?.code || '',
        retryable: Boolean(error?.retryable),
        retryAfterMs: Number(error?.retryAfterMs) || 0,
        temporaryUnavailable: Boolean(error?.temporaryUnavailable),
      }));
    return true;
  });
}
