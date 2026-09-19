'use strict';
const crypto = require('crypto');
const requestWindows = new Map();

const MAX_BODY_BYTES = 32768;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function requestOrigin(request) {
  const local = !process.env.VERCEL;
  const proto = local ? 'http' : 'https';
  const host = String(request.headers?.host || '');
  if (!/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host)) throw httpError(400, 'Invalid host.');
  const origin = new URL(`${proto}://${host}`).origin;
  if (local && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
    throw httpError(403, 'Host not allowed.');
  }
  return origin;
}

function requireSameOrigin(request) {
  const origin = String(request.headers?.origin || '');
  if (origin !== requestOrigin(request) || request.headers?.['sec-fetch-site'] === 'cross-site') {
    throw httpError(403, 'Origin not allowed.');
  }
}

function parseJsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers?.['content-type'] || ''))) {
    throw httpError(415, 'Content-Type must be application/json.');
  }
  let body;
  try {
    const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BODY_BYTES) throw httpError(413, 'Request too large.');
    body = JSON.parse(raw);
  } catch (error) {
    if (error.statusCode) throw error;
    throw httpError(400, 'Invalid JSON.');
  }
  let entries = 0;
  function validate(value, depth) {
    if (++entries > 1000 || depth > 12) throw httpError(400, 'JSON is too complex.');
    if (typeof value === 'string' && (value.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) {
      throw httpError(400, 'Invalid text field.');
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw httpError(400, 'Invalid object key.');
        validate(child, depth + 1);
      }
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Expected a JSON object.');
  validate(body, 0);
  return body;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

async function rateLimit(request, scope, limit, windowMs = 60000) {
  const address = process.env.VERCEL
    ? String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
    : String(request.socket?.remoteAddress || 'local');
  const key = `collager:requests:v1:${scope}:${crypto.createHash('sha256').update(address || 'unknown').digest('hex')}`;
  const now = Date.now();
  for (const [entryKey, entry] of requestWindows) if (entry.until <= now) requestWindows.delete(entryKey);
  const entry = requestWindows.get(key) || { count: 0, until: now + windowMs };
  entry.count++;
  if (requestWindows.size >= 10000 && !requestWindows.has(key)) throw httpError(503, 'Please try again later.');
  requestWindows.set(key, entry);
  if (entry.count > limit) throw httpError(429, 'Too many requests. Please try again later.');
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (process.env.VERCEL && ['auth', 'write', 'discord'].includes(scope)) throw httpError(503, 'Please try again later.');
    return;
  }
  try {
    const result = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', 'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("PEXPIRE",KEYS[1],ARGV[1]) end; return n', '1', key, String(windowMs)]),
      signal: AbortSignal.timeout(5000),
    });
    const payload = await result.json();
    if (!result.ok || payload.error || !Number.isInteger(Number(payload.result)) || Number(payload.result) < 1) throw httpError(503, 'Please try again later.');
    if (Number(payload.result) > limit) throw httpError(429, 'Too many requests. Please try again later.');
  } catch (error) {
    throw httpError(error.statusCode || 503, error.statusCode === 429 ? 'Too many requests. Please try again later.' : 'Please try again later.');
  }
}

async function readImageBytes(upstream, limit = 12 * 1024 * 1024) {
  const type = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type)) {
    await upstream.body?.cancel();
    throw httpError(415, 'Unsupported image type.');
  }
  if (Number(upstream.headers.get('content-length')) > limit) {
    await upstream.body?.cancel();
    throw httpError(413, 'Image too large.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of upstream.body) {
    length += chunk.length;
    if (length > limit) throw httpError(413, 'Image too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { MAX_BODY_BYTES, httpError, requestOrigin, requireSameOrigin, parseJsonBody, jsonForScript, securityHeaders, readImageBytes, rateLimit };
