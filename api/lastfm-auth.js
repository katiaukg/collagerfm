'use strict';

const { callLastfmWrite, clearSessionCookie, getApiCredentials, readSession, setSessionCookie } = require('./_lastfm-session');

function requestUrl(request) {
  const proto = String(request.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '').split(',')[0].trim();
  return new URL(request.url || '/api/lastfm-auth', `${proto}://${host}`);
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.status(status);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', contentType);
  response.send(contentType.startsWith('application/json') ? JSON.stringify(body) : String(body));
}

function sendPopupResult(response, origin, status, result) {
  const message = JSON.stringify({ type: 'collager-lastfm-auth', ...result });
  const label = result.ok
    ? 'Last.fm autorizado. Esta janela pode ser fechada.'
    : `Não foi possível autorizar o Last.fm: ${result.error || 'erro desconhecido.'}`;
  const html = `<!doctype html><meta charset="utf-8"><title>Autorização do Last.fm</title><style>body{background:#111;color:#fff;font:15px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}</style><p>${label.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])}</p><script>if(window.opener)window.opener.postMessage(${message},${JSON.stringify(origin)});setTimeout(()=>window.close(),450);<\/script>`;
  return send(response, status, html, 'text/html; charset=utf-8');
}

module.exports = async function handler(request, response) {
  const url = requestUrl(request);
  const action = String(request.query?.action || url.searchParams.get('action') || 'status');
  const { apiKey, apiSecret } = getApiCredentials();

  if (request.method === 'POST' && action === 'disconnect') {
    clearSessionCookie(request, response);
    return send(response, 200, { connected: false });
  }
  if (request.method !== 'GET') return send(response, 405, { error: 'Metodo nao permitido.' });
  if (action === 'status') {
    const session = readSession(request);
    return send(response, 200, {
      configured: Boolean(apiKey && apiSecret),
      connected: Boolean(session),
      username: session?.name || '',
    });
  }
  if (!apiKey || !apiSecret) return send(response, 503, {
    error: 'Configure LASTFM_API_KEY e LASTFM_API_SECRET no servidor para autorizar a escrita no Last.fm.',
  });

  if (action === 'start') {
    try {
      await callLastfmWrite({ method: 'auth.getToken' });
    } catch (error) {
      return sendPopupResult(response, url.origin, 502, {
        ok: false,
        error: error.message || 'A aplicação não pôde ser validada pelo Last.fm.',
      });
    }
    const callback = `${url.origin}/api/lastfm-auth?action=callback`;
    response.status(302);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Location', `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callback)}`);
    return response.end();
  }

  if (action === 'callback') {
    const token = String(request.query?.token || url.searchParams.get('token') || '').trim();
    if (!token) return send(response, 400, 'Autorizacao cancelada ou token ausente.', 'text/plain; charset=utf-8');
    try {
      const payload = await callLastfmWrite({ method: 'auth.getSession', token });
      const session = payload.session;
      setSessionCookie(request, response, session);
      return sendPopupResult(response, url.origin, 200, { ok: true, username: session.name });
    } catch (error) {
      return sendPopupResult(response, url.origin, 502, {
        ok: false,
        error: error.message || 'Não foi possível concluir a autorização.',
      });
    }
  }
  return send(response, 400, { error: 'Acao invalida.' });
};
