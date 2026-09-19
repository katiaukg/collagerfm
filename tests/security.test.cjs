'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(file, dependencies = {}, environment = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, URL, URLSearchParams, AbortSignal,
    setTimeout, clearTimeout, console, process: { env: environment },
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name),
    fetch: async () => { throw new Error('Unexpected network access'); },
    ...globals,
  }, { filename });
  return module.exports;
}

function response() {
  return {
    code: 200, headers: {}, body: '',
    status(code) { this.code = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; },
    send(body) { this.body = body; return this; },
    json(body) { return this.send(JSON.stringify(body)); },
    end(body = '') { return this.send(body); },
  };
}
const headers = { host: '127.0.0.1:8767', origin: 'http://127.0.0.1:8767', 'content-type': 'application/json' };
const security = load('api/_security.js');

test('JSON accepts literal international metadata without evaluating markup', () => {
  const body = { artist: 'ポルカドットスティングレイ', track: '<script>alert(1)</script>' };
  assert.equal(security.parseJsonBody({ headers, body }).track, body.track);
});

test('JSON rejects oversized, deep, malformed, array and prototype payloads', () => {
  for (const body of ['{', '[]', '{"__proto__":{"admin":true}}', '{"a":{"constructor":{}}}',
    JSON.stringify({ details: 'x'.repeat(33000) }), '{"a":'.repeat(15) + '1' + '}'.repeat(15)]) {
    assert.throws(() => security.parseJsonBody({ headers, body }));
  }
  assert.throws(() => security.parseJsonBody({ headers: { 'content-type': 'text/plain' }, body: '{}' }), { statusCode: 415 });
});

test('origin checks reject missing origin, hostile host and forged forwarded host', () => {
  security.requireSameOrigin({ headers });
  for (const changed of [{ origin: undefined }, { origin: 'https://evil.invalid' },
    { host: 'evil.invalid', origin: 'http://evil.invalid' },
    { origin: 'https://evil.invalid', 'x-forwarded-host': 'evil.invalid' }]) {
    assert.throws(() => security.requireSameOrigin({ headers: { ...headers, ...changed } }));
  }
});

test('session is encrypted, expires on the server and rejects tampering', () => {
  const sessions = load('api/_lastfm-session.js', { './_lastfm-resilience': {} }, { LASTFM_API_SECRET: 'test-only-secret' });
  const res = response();
  const session = { key: 'test-session-key', name: 'test-user' };
  sessions.setSessionCookie({ headers }, res, session);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  assert(!cookie.includes('test-session-key'));
  assert.equal(sessions.readSession({ headers: { cookie } }).name, session.name);
  assert.equal(sessions.readSession({ headers: { cookie: cookie.replace('v2.', 'v1.') } }), null);
  assert.equal(sessions.readSession({ headers: { cookie: 'collager_lfm_session=%ZZ' } }), null);
  sessions.setSessionCookie({ headers }, res, { ...session, issuedAt: Date.now() - 91 * 86400000 });
  assert.equal(sessions.readSession({ headers: { cookie: res.headers['Set-Cookie'].split(';')[0] } }), null);
  sessions.setSessionCookie({ headers }, res, session);
  const parts = res.headers['Set-Cookie'].split(';')[0].split('.');
  parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
  assert.equal(sessions.readSession({ headers: { cookie: parts.join('.') } }), null);
});

test('auth requires matching fresh browser state and escapes script data', async () => {
  let calls = 0;
  const sessions = load('api/_lastfm-session.js', { './_lastfm-resilience': {} }, { LASTFM_API_SECRET: 'test-only-secret' });
  const auth = load('api/lastfm-auth.js', {
    './_security': { ...security, rateLimit: async () => {} },
    './_lastfm-session': { ...sessions, getApiCredentials: () => ({ apiKey: 'test', apiSecret: 'test' }),
      callLastfmWrite: async () => { calls++; return { session: { key: 'test', name: '</script><script>alert(1)</script>' } }; } },
  });
  const bad = response();
  await auth({ method: 'GET', headers, url: '/api/lastfm-auth?action=callback&token=1234567890123456' }, bad);
  assert.equal(bad.code, 403);
  assert.equal(calls, 0);
  const start = response();
  await auth({ method: 'GET', headers, url: '/api/lastfm-auth?action=start' }, start);
  const redirect = new URL(start.headers.Location);
  const callback = new URL(redirect.searchParams.get('cb'));
  callback.searchParams.set('token', '1234567890123456');
  const success = response();
  await auth({ method: 'GET', headers: { ...headers, cookie: start.headers['Set-Cookie'].split(';')[0] }, url: callback.pathname + callback.search }, success);
  assert.equal(success.code, 200);
  assert(!success.body.includes('</script><script>alert'));
  assert(success.body.includes('\\u003c/script>'));
  assert.equal(success.headers['Set-Cookie'].length, 2);
});

test('image download rejects SVG and enforces size before buffering entire response', async () => {
  await assert.rejects(security.readImageBytes(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })), { statusCode: 415 });
  await assert.rejects(security.readImageBytes(new Response('12345', { headers: { 'content-type': 'image/png' } }), 4), { statusCode: 413 });
  const bytes = await security.readImageBytes(new Response('123', { headers: { 'content-type': 'image/png' } }), 4);
  assert.equal(bytes.toString(), '123');
});

test('image proxy rejects off-host redirects before fetching the destination', async () => {
  let calls = 0;
  const handler = load('api/fanart-image.js', { './_security': security }, {}, {
    fetch: async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } }); },
  });
  const res = response();
  await handler({ method: 'GET', query: { url: 'https://assets.fanart.tv/image.jpg' } }, res);
  assert.equal(res.code, 403);
  assert.equal(calls, 1);
});

test('distributed cooldown admits one concurrent instance and fails closed on Redis failure', async () => {
  const environment = { VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'test' };
  let reserved = false;
  const fetch = async () => {
    const result = reserved ? [0, 30000] : [1, 30000];
    reserved = true;
    return { ok: true, json: async () => ({ result }) };
  };
  const a = load('api/_lastfm-resilience.js', {}, environment, { fetch });
  const b = load('api/_lastfm-resilience.js', {}, environment, { fetch });
  const results = await Promise.all([a.reserveScrobbleCooldown('user'), b.reserveScrobbleCooldown('USER')]);
  assert.equal(results.filter(result => result.reserved).length, 1);
  const failure = load('api/_lastfm-resilience.js', {}, environment);
  await assert.rejects(failure.reserveScrobbleCooldown('user'), { statusCode: 503 });
});

test('alternative scrobble routes cannot bypass the account cooldown', async () => {
  let writes = 0;
  const handler = load('api/lastfm-write.js', {
    './_security': { ...security, rateLimit: async () => {} },
    './_lastfm-resilience': load('api/_lastfm-resilience.js'),
    './_lastfm-session': {
      readSession: () => ({ key: 'test', name: 'user' }), setSessionCookie: () => {},
      callLastfmWrite: async () => { writes++; return { scrobbles: { '@attr': { accepted: 1 } } }; },
    },
  });
  const original = { artist: 'Artist', track: 'Track', timestamp: Math.floor(Date.now() / 1000) };
  const bodies = [{ action: 'scrobble', ...original }, { action: 'restore', original },
    { action: 'replace', deleteOriginal: false, original, edited: { artist: 'Artist', track: 'Edited' } }];
  const results = await Promise.all(bodies.map(async body => {
    const res = response(); await handler({ method: 'POST', headers, body }, res); return res.code;
  }));
  assert.deepEqual(results, [200, 429, 429]);
  assert.equal(writes, 1);
});

test('obsession access challenge returns 503 and is not cached as an empty history', async () => {
  let calls = 0;
  const handler = load('api/obsessions.js', { './_security': { rateLimit: async () => {} } }, {}, {
    fetch: async () => { calls++; return new Response('<title>Client Challenge</title>'); },
  });
  for (let i = 0; i < 2; i++) {
    const res = response();
    await handler({ method: 'GET', headers: {}, query: { user: 'test-user' } }, res);
    assert.equal(res.code, 503);
    assert(!JSON.parse(res.body).obsessions);
  }
  assert.equal(calls, 2);
});

test('request rate limit rejects requests beyond the local budget', async () => {
  const guard = load('api/_security.js');
  await guard.rateLimit({ headers }, 'test', 1);
  await assert.rejects(guard.rateLimit({ headers }, 'test', 1), { statusCode: 429 });
});

test('invalid Redis counters fail closed', async () => {
  const guard = load('api/_security.js', {}, { UPSTASH_REDIS_REST_URL: 'https://redis.invalid', UPSTASH_REDIS_REST_TOKEN: 'test' }, {
    fetch: async () => ({ ok: true, json: async () => ({ result: null }) }),
  });
  await assert.rejects(guard.rateLimit({ headers }, 'test', 1), { statusCode: 503 });
});

test('YouTube proxy retains the configured local credentials without scraping configuration', async () => {
  const requests = [];
  const handler = load('api/youtube-music.js', { './_security': { ...security, rateLimit: async () => {} } },
    { YOUTUBE_MUSIC_API_KEY: 'test-key', YOUTUBE_MUSIC_CLIENT_VERSION: 'test-version' }, {
      fetch: async (url, options) => { requests.push({ url: String(url), options }); return new Response('{}'); },
    });
  const res = response();
  await handler({ method: 'POST', headers, body: { query: 'test song' } }, res);
  assert.equal(res.code, 200);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).searchParams.get('key'), 'test-key');
});
