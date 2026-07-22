'use strict';

const crypto = require('crypto');

const memoryCache = new Map();
const inFlightRequests = new Map();
const queueStatusMemory = new Map();
let localNextRequestAt = 0;
let localBackoffUntil = 0;

const CACHE_PREFIX = 'collager:lastfm:cache:v1:';
const LOCK_PREFIX = 'collager:lastfm:lock:v1:';
const QUEUE_KEY = 'collager:lastfm:queue:v1';
const JOB_QUEUE_KEY = 'collager:lastfm:job-queue:v1';
const JOB_LEASE_PREFIX = 'collager:lastfm:job-lease:v1:';
const BACKOFF_KEY = 'collager:lastfm:backoff:v1';
const STATUS_PREFIX = 'collager:lastfm:status:v1:';
const DEFAULT_INTERVAL_MS = 1100;
const DEFAULT_MAX_QUEUE_WAIT_MS = 12000;

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
}

function numberFromEnv(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function redisCredentials() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

async function redisCommand(command) {
  const credentials = redisCredentials();
  if (!credentials) return { enabled: false, result: null };
  const response = await fetch(credentials.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || `Redis respondeu ${response.status}.`);
  return { enabled: true, result: payload.result };
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeCacheKey(params) {
  return Object.entries(params || {})
    .filter(([key, value]) => key !== 'api_key' && key !== 'format' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [String(key).toLowerCase(), String(value)])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function cacheTtlForMethod(method) {
  const normalized = String(method || '').toLowerCase();
  if (normalized === 'user.getrecenttracks') return 5000;
  if (normalized === 'user.getinfo') return 5 * 60 * 1000;
  if (normalized.startsWith('user.gettop')) return 2 * 60 * 1000;
  return 10 * 60 * 1000;
}

async function readCache(cacheKey) {
  const now = Date.now();
  const memoryEntry = memoryCache.get(cacheKey);
  if (memoryEntry?.expires > now) return memoryEntry.payload;
  if (memoryEntry) memoryCache.delete(cacheKey);

  try {
    const stored = await redisCommand(['GET', `${CACHE_PREFIX}${hashKey(cacheKey)}`]);
    if (!stored.enabled || !stored.result) return null;
    const entry = typeof stored.result === 'string' ? JSON.parse(stored.result) : stored.result;
    if (!entry || entry.expires <= now || entry.payload === undefined) return null;
    memoryCache.set(cacheKey, entry);
    return entry.payload;
  } catch (_) {
    return null;
  }
}

async function writeCache(cacheKey, payload, ttlMs) {
  const entry = { expires: Date.now() + ttlMs, payload };
  memoryCache.set(cacheKey, entry);
  try {
    await redisCommand([
      'SET',
      `${CACHE_PREFIX}${hashKey(cacheKey)}`,
      JSON.stringify(entry),
      'PX',
      ttlMs,
    ]);
  } catch (_) {
    // O cache em memoria continua valido quando o Redis estiver indisponivel.
  }
}

function cleanRequestId(value) {
  const normalized = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(normalized) ? normalized : '';
}

async function setQueueStatus(requestId, status) {
  const id = cleanRequestId(requestId);
  if (!id) return;
  const entry = { ...status, updatedAt: Date.now(), persistent: Boolean(redisCredentials()) };
  queueStatusMemory.set(id, { expires: Date.now() + 60000, payload: entry });
  try { await redisCommand(['SET', `${STATUS_PREFIX}${id}`, JSON.stringify(entry), 'EX', 60]); }
  catch (_) { /* o status local ainda pode ser consultado na mesma instancia */ }
}

function currentQueueStatus(entry) {
  if (!entry || entry.state !== 'queued') return entry;
  const intervalMs = Math.max(250, Number(entry.intervalMs) || DEFAULT_INTERVAL_MS);
  const waitUntil = Number(entry.waitUntil) || (Number(entry.updatedAt) + Math.max(0, Number(entry.waitMs) || 0));
  const remainingMs = Math.max(0, waitUntil - Date.now());
  if (!remainingMs) return { ...entry, state: 'running', position: 0, waitMs: 0 };
  return {
    ...entry,
    position: Math.max(1, Math.ceil(remainingMs / intervalMs)),
    waitMs: remainingMs,
  };
}

async function getQueueStatus(requestId) {
  const id = cleanRequestId(requestId);
  if (!id) return null;
  const memory = queueStatusMemory.get(id);
  if (memory?.expires > Date.now()) return currentQueueStatus(memory.payload);
  if (memory) queueStatusMemory.delete(id);
  try {
    const stored = await redisCommand(['GET', `${STATUS_PREFIX}${id}`]);
    if (!stored.enabled || !stored.result) return null;
    const entry = typeof stored.result === 'string' ? JSON.parse(stored.result) : stored.result;
    return currentQueueStatus(entry);
  } catch (_) {
    return null;
  }
}

async function releaseDistributedLock(lockKey, token) {
  const script = 'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end';
  try { await redisCommand(['EVAL', script, '1', lockKey, token]); }
  catch (_) { /* a trava expira automaticamente */ }
}

async function acquireDistributedLock(cacheKey) {
  if (!redisCredentials()) return { enabled: false, acquired: true, key: '', token: '' };
  const key = `${LOCK_PREFIX}${hashKey(cacheKey)}`;
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const response = await redisCommand(['SET', key, token, 'NX', 'PX', 20000]);
    return { enabled: response.enabled, acquired: response.result === 'OK', key, token };
  } catch (_) {
    return { enabled: false, acquired: true, key: '', token: '' };
  }
}

async function waitForDistributedResult(cacheKey, maximumWaitMs = 15000) {
  const deadline = Date.now() + maximumWaitMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const cached = await readCache(cacheKey);
    if (cached !== null) return cached;
  }
  return null;
}

async function reserveGlobalSlot(requestId = '', queueGroup = '') {
  const intervalMs = numberFromEnv('LASTFM_MIN_INTERVAL_MS', DEFAULT_INTERVAL_MS, 250, 10000);
  const maximumWaitMs = numberFromEnv('LASTFM_MAX_QUEUE_WAIT_MS', DEFAULT_MAX_QUEUE_WAIT_MS, 1000, 25000);
  const ownerLeaseMs = numberFromEnv('LASTFM_QUEUE_OWNER_LEASE_MS', 8000, 1000, 30000);
  const owner = cleanRequestId(queueGroup);
  const now = Date.now();
  const credentials = redisCredentials();

  if (credentials) {
    const script = [
      'local now=tonumber(ARGV[1])',
      'local interval=tonumber(ARGV[2])',
      'local maxwait=tonumber(ARGV[3])',
      'local ttl=tonumber(ARGV[4])',
      'local owner=ARGV[5]',
      'local ownerlease=tonumber(ARGV[6])',
      'local leaseprefix=ARGV[7]',
      'if owner~="" then',
      'redis.call("ZADD",KEYS[3],"NX",now,owner)',
      'redis.call("SET",leaseprefix..owner,"1","PX",ownerlease)',
      'end',
      'local jobs=redis.call("ZRANGE",KEYS[3],0,-1)',
      'for i=1,#jobs do',
      'if redis.call("EXISTS",leaseprefix..jobs[i])==0 then redis.call("ZREM",KEYS[3],jobs[i]) end',
      'end',
      'redis.call("PEXPIRE",KEYS[3],86400000)',
      'if owner~="" then',
      'local rank=redis.call("ZRANK",KEYS[3],owner)',
      'if rank and rank>0 then return {-2,rank+1,1000} end',
      'end',
      'local next=tonumber(redis.call("GET",KEYS[1]) or "0")',
      'local backoff=tonumber(redis.call("GET",KEYS[2]) or "0")',
      'local slot=math.max(now,next,backoff)',
      'local wait=slot-now',
      'if wait>maxwait then return {-1,wait} end',
      'redis.call("SET",KEYS[1],slot+interval,"PX",ttl)',
      'return {slot,wait,0}',
    ].join(';');
    try {
      const reserved = await redisCommand([
        'EVAL', script, '3', QUEUE_KEY, BACKOFF_KEY, JOB_QUEUE_KEY,
        String(now), String(intervalMs), String(maximumWaitMs), String(Math.max(60000, maximumWaitMs + intervalMs)),
        owner, String(ownerLeaseMs), JOB_LEASE_PREFIX,
      ]);
      const result = Array.isArray(reserved.result) ? reserved.result.map(Number) : [];
      if (result[0] === -2) {
        const queuePosition = Math.max(1, result[1] || 1);
        const retryAfterMs = Math.max(500, result[2] || 1000);
        await setQueueStatus(requestId, {
          state: 'queued',
          position: queuePosition,
          waitMs: retryAfterMs,
          waitUntil: Date.now() + retryAfterMs,
          intervalMs,
        });
        const error = new Error('Outra collage esta concluindo as consultas ao Last.fm.');
        error.code = 'LASTFM_QUEUE_BUSY';
        error.retryAfterMs = retryAfterMs;
        error.queuePosition = queuePosition;
        throw error;
      }
      if (result[0] === -1) {
        const error = new Error('A fila do Last.fm esta cheia. Tente novamente em alguns segundos.');
        error.code = 'LASTFM_QUEUE_BUSY';
        error.retryAfterMs = result[1] || intervalMs;
        throw error;
      }
      const position = result[1] > 100 ? Math.max(1, Math.ceil(result[1] / intervalMs)) : 0;
      const waitMs = result[1] || 0;
      await setQueueStatus(requestId, {
        state: position ? 'queued' : 'running',
        position,
        waitMs,
        waitUntil: Date.now() + waitMs,
        intervalMs,
      });
      await sleep(waitMs);
      await setQueueStatus(requestId, { state: 'running', position: 0, waitMs: 0 });
      return;
    } catch (error) {
      if (error.code === 'LASTFM_QUEUE_BUSY') throw error;
      // Se o Redis falhar, a instancia ainda usa a fila local.
    }
  }

  const slot = Math.max(now, localNextRequestAt, localBackoffUntil);
  const waitMs = slot - now;
  if (waitMs > maximumWaitMs) {
    const error = new Error('A fila do Last.fm esta cheia. Tente novamente em alguns segundos.');
    error.code = 'LASTFM_QUEUE_BUSY';
    error.retryAfterMs = waitMs;
    throw error;
  }
  localNextRequestAt = slot + intervalMs;
  const position = waitMs > 100 ? Math.max(1, Math.ceil(waitMs / intervalMs)) : 0;
  await setQueueStatus(requestId, {
    state: position ? 'queued' : 'running',
    position,
    waitMs,
    waitUntil: Date.now() + waitMs,
    intervalMs,
  });
  await sleep(waitMs);
  await setQueueStatus(requestId, { state: 'running', position: 0, waitMs: 0 });
}

async function noteLastfmRateLimit(backoffMs = 60000) {
  const duration = Math.max(5000, Math.min(5 * 60 * 1000, Number(backoffMs) || 60000));
  const until = Date.now() + duration;
  localBackoffUntil = Math.max(localBackoffUntil, until);
  try { await redisCommand(['SET', BACKOFF_KEY, String(until), 'PX', duration]); }
  catch (_) { /* o recuo local ainda protege esta instancia */ }
}

async function releaseQueueOwner(queueGroup = '') {
  const owner = cleanRequestId(queueGroup);
  if (!owner || !redisCredentials()) return false;
  const script = [
    'local removed=redis.call("ZREM",KEYS[1],ARGV[1])',
    'redis.call("DEL",ARGV[2]..ARGV[1])',
    'return removed',
  ].join(';');
  try {
    const released = await redisCommand(['EVAL', script, '1', JOB_QUEUE_KEY, owner, JOB_LEASE_PREFIX]);
    return Number(released.result) > 0;
  } catch (_) {
    return false;
  }
}

async function renewQueueOwner(queueGroup = '') {
  const owner = cleanRequestId(queueGroup);
  if (!owner || !redisCredentials()) return false;
  const ownerLeaseMs = numberFromEnv('LASTFM_QUEUE_OWNER_LEASE_MS', 8000, 1000, 30000);
  const script = [
    'if redis.call("ZSCORE",KEYS[1],ARGV[1]) then',
    'redis.call("PEXPIRE",ARGV[3]..ARGV[1],ARGV[2])',
    'return 1',
    'end',
    'return 0',
  ].join(';');
  try {
    const renewed = await redisCommand(['EVAL', script, '1', JOB_QUEUE_KEY, owner, String(ownerLeaseMs), JOB_LEASE_PREFIX]);
    return Number(renewed.result) > 0;
  } catch (_) {
    return false;
  }
}

async function resilientCachedRequest(params, fetcher, ttlMs = cacheTtlForMethod(params?.method), options = {}) {
  const requestId = cleanRequestId(options.requestId);
  const cacheKey = normalizeCacheKey(params);
  const cached = await readCache(cacheKey);
  if (cached !== null) {
    await setQueueStatus(requestId, { state: 'done', position: 0, cache: 'HIT' });
    return { payload: cached, cache: 'HIT' };
  }
  if (inFlightRequests.has(cacheKey)) {
    await setQueueStatus(requestId, { state: 'deduplicated', position: 1, waitMs: 0 });
    const shared = await inFlightRequests.get(cacheKey);
    await setQueueStatus(requestId, { state: 'done', position: 0, cache: 'DEDUPED' });
    return { ...shared, cache: 'DEDUPED' };
  }

  const pending = (async () => {
    const lock = await acquireDistributedLock(cacheKey);
    if (lock.enabled && !lock.acquired) {
      await setQueueStatus(requestId, { state: 'deduplicated', position: 1, waitMs: 0 });
      const shared = await waitForDistributedResult(cacheKey);
      if (shared !== null) {
        await setQueueStatus(requestId, { state: 'done', position: 0, cache: 'DEDUPED' });
        return { payload: shared, cache: 'DEDUPED' };
      }
    }

    try {
      const secondCheck = await readCache(cacheKey);
      if (secondCheck !== null) {
        await setQueueStatus(requestId, { state: 'done', position: 0, cache: 'HIT' });
        return { payload: secondCheck, cache: 'HIT' };
      }
      await reserveGlobalSlot(requestId, options.queueGroup);
      const payload = await fetcher();
      await writeCache(cacheKey, payload, ttlMs);
      await setQueueStatus(requestId, { state: 'done', position: 0, cache: 'MISS' });
      return { payload, cache: 'MISS' };
    } finally {
      if (lock.enabled && lock.acquired) await releaseDistributedLock(lock.key, lock.token);
    }
  })().catch(async error => {
    await setQueueStatus(requestId, { state: 'error', position: 0, message: error.message || 'Falha na fila.' });
    throw error;
  }).finally(() => inFlightRequests.delete(cacheKey));

  inFlightRequests.set(cacheKey, pending);
  return pending;
}

module.exports = {
  cacheTtlForMethod,
  getQueueStatus,
  normalizeCacheKey,
  noteLastfmRateLimit,
  releaseQueueOwner,
  renewQueueOwner,
  redisConfigured: () => Boolean(redisCredentials()),
  reserveGlobalSlot,
  resilientCachedRequest,
};
