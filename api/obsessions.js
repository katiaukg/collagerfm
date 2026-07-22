'use strict';

const crypto = require('crypto');

const CACHE_TTL = 5 * 60 * 1000;
const STALE_CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'collager:obsessions:v1:';
const responseCache = new Map();
const LASTFM_PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Referer: 'https://www.last.fm/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};

function redisCredentials() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

async function redisCommand(command) {
  const credentials = redisCredentials();
  if (!credentials) return null;
  const response = await fetch(credentials.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || `Redis respondeu ${response.status}.`);
  return payload.result;
}

function persistentCacheKey(cacheKey) {
  const hash = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');
  return `${CACHE_PREFIX}${hash}`;
}

async function readPersistentCache(cacheKey) {
  try {
    const stored = await redisCommand(['GET', persistentCacheKey(cacheKey)]);
    if (!stored) return null;
    const entry = typeof stored === 'string' ? JSON.parse(stored) : stored;
    return entry?.payload && Number(entry.savedAt) ? entry : null;
  } catch (_) {
    return null;
  }
}

async function writePersistentCache(cacheKey, payload) {
  try {
    await redisCommand(['SET', persistentCacheKey(cacheKey), JSON.stringify({ savedAt: Date.now(), payload }), 'PX', STALE_CACHE_TTL]);
  } catch (_) {
    // A resposta em memória continua útil quando o Redis estiver indisponível.
  }
}

function getSameOrigin(request) {
  const host = String(request.headers.host || '').trim();
  if (!host) return '';
  const proto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

function isOriginAllowed(request) {
  const origin = String(request.headers.origin || '').trim();
  if (!origin || origin === 'null' || origin === getSameOrigin(request)) return true;
  return String(process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .includes(origin);
}

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.send(JSON.stringify(payload));
}

function decodeHtml(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase())
      ? named[entity.toLowerCase()]
      : match;
  });
}

function cleanText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(value, pattern) {
  return pattern.exec(value)?.[1] || '';
}

function parseDateIso(dateText) {
  const normalized = String(dateText || '')
    .replace(/^Sept\./i, 'Sep.')
    .replace(/^(\w+)\./, '$1');
  const timestamp = Date.parse(`${normalized} 00:00:00 UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function parseObsessions(html) {
  const items = [];
  const itemPattern = /<li\b[^>]*class="[^"]*obsession-history-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = itemPattern.exec(html))) {
    const block = match[1];
    const name = cleanText(firstMatch(block, /<h3\b[^>]*class="[^"]*obsession-history-item-heading[^"]*"[^>]*>([\s\S]*?)<\/h3>/i));
    const artistBlock = firstMatch(block, /<p\b[^>]*class="[^"]*obsession-history-item-artist[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const artist = cleanText(firstMatch(artistBlock, /<a\b[^>]*>([\s\S]*?)<\/a>/i) || artistBlock);
    const dateBlock = firstMatch(block, /<p\b[^>]*class="[^"]*obsession-history-item-date[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const date = cleanText(firstMatch(dateBlock, /<a\b[^>]*>([\s\S]*?)<\/a>/i) || dateBlock);
    const image = decodeHtml(firstMatch(block, /background-image:[\s\S]*?url\((https?:\/\/[^)]+)\)/i)).trim();
    const trackUrl = decodeHtml(firstMatch(block, /data-track-url="([^"]+)"/i)).trim();
    if (!name || !artist) continue;
    items.push({
      name,
      artist,
      date,
      dateIso: parseDateIso(date),
      image,
      trackUrl,
    });
  }
  return items;
}

async function fetchPage(user, page) {
  const suffix = page > 1 ? `?page=${page}` : '';
  const url = `https://www.last.fm/user/${encodeURIComponent(user)}/obsessions${suffix}`;
  let upstream;
  const retryHeaders = [
    LASTFM_PAGE_HEADERS,
    { ...LASTFM_PAGE_HEADERS, Cookie: 'lfmanon=1; not_first_visit=1' },
    {
      ...LASTFM_PAGE_HEADERS,
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: `lfmanon=${Math.random().toString(36).slice(2)}; not_first_visit=1`,
    },
  ];
  for (let attempt = 0; attempt < retryHeaders.length; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 250 + Math.round(Math.random() * 350)));
    upstream = await fetch(url, {
      headers: retryHeaders[attempt],
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 406 && upstream.status !== 600) break;
  }
  if (!upstream.ok) {
    let message = `Last.fm respondeu ${upstream.status}.`;
    if (upstream.status === 404) message = 'Usuario ou pagina de obsessoes nao encontrada.';
    if (upstream.status === 406 || upstream.status === 600) {
      message = 'O Last.fm recusou temporariamente a pagina de obsessoes. Tente novamente em instantes.';
    }
    const error = new Error(message);
    error.status = upstream.status;
    throw error;
  }
  return upstream.text();
}

module.exports = async function handler(request, response) {
  const requestOrigin = String(request.headers.origin || '').trim();
  if (requestOrigin === 'null') response.setHeader('Access-Control-Allow-Origin', 'null');
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'Metodo nao permitido.' });
  if (!isOriginAllowed(request)) return sendJson(response, 403, { error: 'Origem nao permitida.' });

  const user = String(request.query?.user || '').trim();
  const limit = Math.max(1, Math.min(500, Number.parseInt(request.query?.limit, 10) || 50));
  if (!user || user.length > 64) return sendJson(response, 400, { error: 'Usuario invalido.' });

  const cacheKey = `${user.toLowerCase()}|${limit}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return sendJson(response, 200, cached.payload);
  const persistent = await readPersistentCache(cacheKey);
  if (persistent && persistent.savedAt + CACHE_TTL > Date.now()) {
    responseCache.set(cacheKey, { expires: persistent.savedAt + CACHE_TTL, payload: persistent.payload });
    return sendJson(response, 200, persistent.payload);
  }

  try {
    const obsessions = [];
    const seen = new Set();
    for (let page = 1; page <= 50 && obsessions.length < limit; page++) {
      let html;
      try {
        html = await fetchPage(user, page);
      } catch (error) {
        if (error.status === 404 && page === 1) break;
        if (obsessions.length) break;
        throw error;
      }
      const pageItems = parseObsessions(html);
      if (!pageItems.length) break;
      let added = 0;
      pageItems.forEach(item => {
        const key = `${item.name}|${item.artist}|${item.date}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        obsessions.push(item);
        added++;
      });
      const nextPage = page + 1;
      const hasNextPage = html.includes(`?page=${nextPage}`) || html.includes(`&page=${nextPage}`);
      if (!added || !hasNextPage) break;
    }
    const payload = { obsessions: obsessions.slice(0, limit) };
    responseCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, payload });
    await writePersistentCache(cacheKey, payload);
    return sendJson(response, 200, payload);
  } catch (error) {
    const stalePayload = cached?.payload || persistent?.payload;
    if (stalePayload) {
      return sendJson(response, 200, { ...stalePayload, stale: true });
    }
    return sendJson(response, error.status || 502, { error: `Falha ao consultar obsessoes: ${error.message}` });
  }
};
