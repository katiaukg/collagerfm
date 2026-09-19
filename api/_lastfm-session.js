'use strict';

const crypto = require('crypto');
const { noteLastfmRateLimit, reserveGlobalSlot } = require('./_lastfm-resilience');

const COOKIE_NAME = 'collager_lfm_session';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function getApiCredentials() {
  return {
    apiKey: String(process.env.LASTFM_API_KEY || '').trim(),
    apiSecret: String(process.env.LASTFM_API_SECRET || '').trim(),
  };
}

function parseCookies(request) {
  return String(request.headers?.cookie || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator > 0) {
        try { cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1)); }
        catch (_) { /* Ignore malformed cookies instead of failing the request. */ }
      }
      return cookies;
    }, Object.create(null));
}

function sessionEncryptionKey(secret) {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const key = String(process.env.SESSION_SECRET || secret || '');
  if (!key) throw new Error('Session secret is not configured.');
  return crypto.createHash('sha256').update(`collager:session:v2:${key}`).digest();
}

function encodeSession(session, secret) {
  const contents = {
    key: session.key,
    name: session.name,
    issuedAt: Number(session.issuedAt) || Date.now(),
  };
  const lastScrobbleAt = Math.floor(Number(session.lastScrobbleAt));
  if (Number.isFinite(lastScrobbleAt) && lastScrobbleAt > 0) contents.lastScrobbleAt = lastScrobbleAt;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(contents), 'utf8'), cipher.final()]);
  return ['v2', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

function decodeSession(value, secret) {
  if (!value || String(value).length > 4096) return null;
  try {
    const parts = String(value).split('.');
    if (parts.length !== 4 || parts[0] !== 'v2') return null;
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionEncryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    const session = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8'));
    const age = Date.now() - Number(session.issuedAt);
    if (!Number.isFinite(age) || age < -60000 || age >= SESSION_TTL_MS) return null;
    return typeof session.key === 'string' && session.key.length <= 128 && session.key
      && typeof session.name === 'string' && session.name.length <= 100 && session.name ? session : null;
  } catch (_) {
    return null;
  }
}

function readSession(request) {
  const { apiSecret } = getApiCredentials();
  return decodeSession(parseCookies(request)[COOKIE_NAME], apiSecret);
}

function isHttps(request) {
  return String(request.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setSessionCookie(request, response, session) {
  const { apiSecret } = getApiCredentials();
  const value = encodeSession(session, apiSecret);
  const secure = isHttps(request) ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${secure}`);
}

function clearSessionCookie(request, response) {
  const secure = isHttps(request) ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function signLastfmParams(params, secret) {
  const signatureText = Object.keys(params)
    .filter(key => key !== 'format' && key !== 'callback')
    .sort()
    .map(key => `${key}${params[key]}`)
    .join('') + secret;
  return crypto.createHash('md5').update(signatureText, 'utf8').digest('hex');
}

async function callLastfmWrite(params) {
  const { apiKey, apiSecret } = getApiCredentials();
  if (!apiKey || !apiSecret) throw new Error('LASTFM_API_KEY e LASTFM_API_SECRET precisam estar configuradas no servidor.');
  const signed = { ...params, api_key: apiKey };
  signed.api_sig = signLastfmParams(signed, apiSecret);
  signed.format = 'json';
  await reserveGlobalSlot();
  const response = await fetch('https://ws.audioscrobbler.com/2.0/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'CollagerFM/1.0 (interactive collage generator)',
    },
    body: new URLSearchParams(signed).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (Number(payload.error || 0) === 29 || response.status === 429) await noteLastfmRateLimit(60000);
  if (!response.ok || payload.error) {
    const error = new Error(payload.message || `Last.fm respondeu ${response.status}.`);
    error.code = Number(payload.error || response.status);
    throw error;
  }
  return payload;
}

module.exports = { callLastfmWrite, clearSessionCookie, getApiCredentials, parseCookies, readSession, setSessionCookie };
