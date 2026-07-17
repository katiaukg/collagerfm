'use strict';

const ALLOWED_ENDPOINT = /^search\/(artist|album|track)$/;
const CACHE_TTL = 10 * 60 * 1000;
const responseCache = new Map();

function sendJson(response, status, payload, cache = false) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader(
    'Cache-Control',
    cache ? 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600' : 'no-store',
  );
  response.send(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Metodo nao permitido.' });
  }

  const endpoint = String(request.query?.endpoint || '').trim().toLowerCase();
  const query = String(request.query?.q || '').trim();
  const limit = Math.max(1, Math.min(10, Number(request.query?.limit) || 1));
  if (!ALLOWED_ENDPOINT.test(endpoint)) {
    return sendJson(response, 400, { error: 'Endpoint da Deezer nao permitido.' });
  }
  if (!query || query.length > 300) {
    return sendJson(response, 400, { error: 'Busca da Deezer invalida.' });
  }

  const cacheKey = `${endpoint}|${query.toLocaleLowerCase()}|${limit}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return sendJson(response, 200, cached.payload, true);
  if (cached) responseCache.delete(cacheKey);

  try {
    const upstreamUrl = new URL(`https://api.deezer.com/${endpoint}`);
    upstreamUrl.searchParams.set('q', query);
    upstreamUrl.searchParams.set('limit', String(limit));
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollagerFM/1.0 (collage generator)',
      },
      signal: AbortSignal.timeout(12000),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || payload?.error) {
      return sendJson(response, upstream.ok ? 502 : upstream.status, {
        error: payload?.error || { message: `Deezer respondeu ${upstream.status}.` },
      });
    }
    responseCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, payload });
    return sendJson(response, 200, payload, true);
  } catch (error) {
    return sendJson(response, 502, { error: `Falha ao consultar a Deezer: ${error.message}` });
  }
};
