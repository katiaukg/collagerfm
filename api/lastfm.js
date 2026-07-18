'use strict';

const ALLOWED_METHODS = new Set([
  'album.getinfo',
  'artist.getinfo',
  'track.getinfo',
  'user.getinfo',
  'user.getrecenttracks',
  'user.gettopalbums',
  'user.gettopartists',
  'user.gettoptracks',
]);

const ALLOWED_PARAMS = new Set([
  'album', 'artist', 'autocorrect', 'extended', 'from', 'lang', 'limit',
  'method', 'page', 'period', 'to', 'track', 'user',
]);

const CACHE_TTL = 60 * 1000;
const RECENT_TRACKS_CACHE_TTL = 2 * 1000;
const responseCache = new Map();

function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') {
    try { return JSON.parse(request.body); }
    catch (_) { return {}; }
  }
  return {};
}

function getSameOrigin(request) {
  const host = String(request.headers.host || '').trim();
  if (!host) return '';
  const proto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

function isOriginAllowed(request) {
  const origin = String(request.headers.origin || '').trim();
  if (!origin || origin === getSameOrigin(request)) return true;
  const configured = String(process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return configured.includes(origin);
}

function applyCors(request, response) {
  const origin = String(request.headers.origin || '').trim();
  if (origin && isOriginAllowed(request)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Vary', 'Origin');
  }
}

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.send(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
  applyCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Metodo nao permitido.' });
  if (!isOriginAllowed(request)) return sendJson(response, 403, { error: 'Origem nao permitida.' });

  const apiKey = String(process.env.LASTFM_API_KEY || '').trim();
  if (!apiKey) {
    return sendJson(response, 503, {
      error: 'A chave padrao do Last.fm nao esta configurada no servidor.',
      fallbackRequired: true,
    });
  }

  try {
    const body = getRequestBody(request);
    const source = body && typeof body.params === 'object' ? body.params : {};
    const method = String(source.method || '').trim().toLowerCase();
    if (!ALLOWED_METHODS.has(method)) return sendJson(response, 403, { error: 'Metodo do Last.fm nao permitido.' });

    const params = new URLSearchParams();
    Object.entries(source).forEach(([key, value]) => {
      if (ALLOWED_PARAMS.has(key) && value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    params.set('method', method);
    params.set('api_key', apiKey);
    params.set('format', 'json');

    const cacheKey = params.toString().replace(/api_key=[^&]+&?/, '');
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return sendJson(response, 200, cached.payload);
    if (cached) responseCache.delete(cacheKey);

    const upstream = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollagerFM/1.0 (collage generator)',
      },
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json();
    const lastfmError = Number(payload?.error || 0);
    const fallbackRequired = [10, 26, 29].includes(lastfmError)
      || [401, 403, 429].includes(upstream.status);
    if (!upstream.ok || fallbackRequired) {
      return sendJson(response, upstream.ok ? 502 : upstream.status, {
        ...payload,
        fallbackRequired,
      });
    }
    if (!lastfmError) {
      const ttl = method === 'user.getrecenttracks' ? RECENT_TRACKS_CACHE_TTL : CACHE_TTL;
      responseCache.set(cacheKey, { expires: Date.now() + ttl, payload });
    }
    return sendJson(response, 200, payload);
  } catch (error) {
    return sendJson(response, 502, {
      error: `Falha ao consultar o Last.fm: ${error.message}`,
      fallbackRequired: true,
    });
  }
};
