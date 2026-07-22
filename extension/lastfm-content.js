'use strict';

if (!globalThis.__collagerLastfmContentInstalled) {
  globalThis.__collagerLastfmContentInstalled = true;

  function cookieValue(name) {
    const prefix = `${name}=`;
    const part = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return part ? decodeURIComponent(part.slice(prefix.length)) : '';
  }

  async function csrfToken(username) {
    const fromCookie = cookieValue('csrftoken');
    if (fromCookie) return fromCookie;
    const response = await fetch(`/user/${encodeURIComponent(username)}/library`, { credentials: 'include' });
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
    const response = await fetch(`/user/${encodeURIComponent(username)}/library/delete`, {
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

  chrome.runtime.onMessage.addListener(message => {
    if (message?.channel !== 'collager-lastfm-page' || message.action !== 'deleteScrobble') return undefined;
    return deleteScrobble(message.payload).catch(error => ({ ok: false, error: error?.message || 'Falha ao excluir o scrobble.' }));
  });
}
