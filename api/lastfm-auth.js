'use strict';

const crypto = require('crypto');
const { callLastfmWrite, clearSessionCookie, getApiCredentials, parseCookies, readSession, setSessionCookie } = require('./_lastfm-session');
const { requestOrigin, requireSameOrigin, jsonForScript, securityHeaders, rateLimit } = require('./_security');
const AUTH_COOKIE = 'collager_lfm_auth_state';

function authCookie(request, value, maxAge = 600) {
  return `${AUTH_COOKIE}=${value}; Path=/api/lastfm-auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${requestOrigin(request).startsWith('https:') ? '; Secure' : ''}`;
}

function requestUrl(request) {
  return new URL(request.url || '/api/lastfm-auth', requestOrigin(request));
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.status(status);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', contentType);
  response.send(contentType.startsWith('application/json') ? JSON.stringify(body) : String(body));
}

function sendPopupResult(response, origin, status, result, locale) {
  const message = jsonForScript({ type: 'collager-lastfm-auth', ...result });
  const portuguese = locale === 'pt-BR';
  const title = portuguese ? 'Autorização do Last.fm' : 'Last.fm authorization';
  const label = result.ok
    ? (portuguese ? 'Last.fm autorizado. Esta janela pode ser fechada.' : 'Last.fm authorized. You can close this window.')
    : (portuguese ? 'Não foi possível autorizar o Last.fm. Tente novamente.' : 'Could not authorize Last.fm. Please try again.');
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${title}</title><style>body{background:#111;color:#fff;font:15px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}</style><p>${label}</p><script>if(window.opener)window.opener.postMessage(${message},${JSON.stringify(origin)});setTimeout(()=>window.close(),450);<\/script></html>`;
  return send(response, status, html, 'text/html; charset=utf-8');
}

module.exports = async function handler(request, response) {
  securityHeaders(response);
  let url;
  try { url = requestUrl(request); }
  catch (error) { return send(response, error.statusCode || 400, { error: error.message }); }
  const action = String(request.query?.action || url.searchParams.get('action') || 'status');
  const locale = (request.query?.locale || url.searchParams.get('locale')) === 'pt-BR' ? 'pt-BR' : 'en-US';
  const { apiKey, apiSecret } = getApiCredentials();

  if (request.method === 'POST' && action === 'disconnect') {
    try { requireSameOrigin(request); }
    catch (error) { return send(response, error.statusCode, { error: error.message }); }
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
      await rateLimit(request, 'auth', 30, 600000);
      await callLastfmWrite({ method: 'auth.getToken' });
    } catch (error) {
      return sendPopupResult(response, url.origin, error.statusCode || 502, {
        ok: false,
        error: error.message || 'A aplicação não pôde ser validada pelo Last.fm.',
      }, locale);
    }
    const state = `${Date.now()}.${crypto.randomBytes(32).toString('hex')}`;
    response.setHeader('Set-Cookie', authCookie(request, state));
    const callback = `${url.origin}/api/lastfm-auth?action=callback&locale=${locale}&state=${state}`;
    response.status(302);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Location', `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callback)}`);
    return response.end();
  }

  if (action === 'callback') {
    const state = String(request.query?.state || url.searchParams.get('state') || '');
    const expected = parseCookies(request)[AUTH_COOKIE] || '';
    const age = Date.now() - Number(state.split('.')[0]);
    if (!/^\d{13}\.[a-f0-9]{64}$/.test(state) || age < 0 || age > 600000
      || state.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      return sendPopupResult(response, url.origin, 403, { ok: false, error: locale === 'pt-BR' ? 'Autorização expirada. Inicie a conexão novamente.' : 'Authorization expired. Start the connection again.' }, locale);
    }
    response.setHeader('Set-Cookie', authCookie(request, '', 0));
    const token = String(request.query?.token || url.searchParams.get('token') || '').trim();
    if (!/^[a-zA-Z0-9]{16,128}$/.test(token)) return send(response, 400, locale === 'pt-BR' ? 'Autorização cancelada ou token ausente.' : 'Authorization canceled or token missing.', 'text/plain; charset=utf-8');
    try {
      await rateLimit(request, 'auth', 30, 600000);
      const payload = await callLastfmWrite({ method: 'auth.getSession', token });
      const session = payload.session;
      setSessionCookie(request, response, session);
      const sessionHeader = response.getHeader?.('Set-Cookie');
      if (sessionHeader) response.setHeader('Set-Cookie', [sessionHeader, authCookie(request, '', 0)]);
      return sendPopupResult(response, url.origin, 200, { ok: true, username: session.name }, locale);
    } catch (error) {
      return sendPopupResult(response, url.origin, error.statusCode || 502, {
        ok: false,
        error: error.message || 'Não foi possível concluir a autorização.',
      }, locale);
    }
  }
  return send(response, 400, { error: 'Acao invalida.' });
};
