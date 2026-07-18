'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'collager_lfm_session';

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
      if (separator > 0) cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1));
      return cookies;
    }, {});
}

function sessionSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeSession(session, secret) {
  const payload = Buffer.from(JSON.stringify({ key: session.key, name: session.name, issuedAt: Date.now() })).toString('base64url');
  return `${payload}.${sessionSignature(payload, secret)}`;
}

function decodeSession(value, secret) {
  if (!value || !secret) return null;
  const [payload, signature] = String(value).split('.');
  if (!payload || !signature) return null;
  const expected = sessionSignature(payload, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.key && session.name ? session : null;
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
  if (!response.ok || payload.error) {
    const error = new Error(payload.message || `Last.fm respondeu ${response.status}.`);
    error.code = Number(payload.error || response.status);
    throw error;
  }
  return payload;
}

module.exports = { callLastfmWrite, clearSessionCookie, getApiCredentials, readSession, setSessionCookie };
