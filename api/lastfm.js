'use strict';

const {
  cacheTtlForMethod,
  getQueueStatus,
  noteLastfmRateLimit,
  releaseQueueOwner,
  renewQueueOwner,
  redisConfigured,
  resilientCachedRequest,
} = require('./_lastfm-resilience');

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
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
  if (request.method === 'GET' && String(request.query?.action || '') === 'queue-status') {
    if (!isOriginAllowed(request)) return sendJson(response, 403, { error: 'Origem nao permitida.' });
    const queueStatus = await getQueueStatus(request.query?.requestId);
    return sendJson(response, 200, queueStatus || { state: 'pending', position: 0 });
  }
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Metodo nao permitido.' });
  if (!isOriginAllowed(request)) return sendJson(response, 403, { error: 'Origem nao permitida.' });

  const body = getRequestBody(request);
  if (String(body.action || '') === 'queue-release') {
    const released = await releaseQueueOwner(body.queueGroup);
    return sendJson(response, 200, { released });
  }
  if (String(body.action || '') === 'queue-heartbeat') {
    const renewed = await renewQueueOwner(body.queueGroup);
    return sendJson(response, 200, { renewed });
  }

  const apiKey = String(process.env.LASTFM_API_KEY || '').trim();
  if (!apiKey) {
    return sendJson(response, 503, {
      error: 'A chave padrao do Last.fm nao esta configurada no servidor.',
      fallbackRequired: true,
    });
  }

  try {
    const requestId = String(body.requestId || '').trim();
    const queueGroup = String(body.queueGroup || '').trim();
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

    const resilientParams = Object.fromEntries(params);
    delete resilientParams.api_key;
    delete resilientParams.format;
    const result = await resilientCachedRequest(resilientParams, async () => {
      const upstream = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CollagerFM/1.0 (collage generator)',
        },
        signal: AbortSignal.timeout(15000),
      });
      const payload = await upstream.json().catch(() => ({}));
      const lastfmError = Number(payload?.error || 0);
      if (lastfmError === 29 || upstream.status === 429) await noteLastfmRateLimit(60000);
      if (!upstream.ok || lastfmError) {
        const error = new Error(payload.message || `Last.fm respondeu ${upstream.status}.`);
        error.code = lastfmError || upstream.status;
        error.status = upstream.ok ? 502 : upstream.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }, cacheTtlForMethod(method), { requestId, queueGroup });
    response.setHeader('X-Collager-Cache', result.cache);
    response.setHeader('X-Collager-Persistent-Cache', redisConfigured() ? 'enabled' : 'disabled');
    return sendJson(response, 200, result.payload);
  } catch (error) {
    if (error.code === 'LASTFM_QUEUE_BUSY') {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((error.retryAfterMs || 1000) / 1000))));
      return sendJson(response, 429, {
        error: error.message,
        retryable: true,
        retryAfterMs: error.retryAfterMs || 1000,
        position: error.queuePosition || 1,
      });
    }
    const lastfmCode = Number(error.code || 0);
    const fallbackRequired = [10, 26].includes(lastfmCode) || [401, 403].includes(Number(error.status || 0));
    const retryable = lastfmCode === 29 || Number(error.status || 0) === 429;
    return sendJson(response, 502, {
      ...(error.payload || {}),
      error: error.message || 'Falha ao consultar o Last.fm.',
      fallbackRequired,
      retryable,
      code: lastfmCode,
    });
  }
};
