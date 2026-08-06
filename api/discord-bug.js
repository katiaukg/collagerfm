'use strict';

const crypto = require('crypto');

const DEFAULT_CHANNEL_ID = '1533262608134705292';
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_MAX_REPORTS = 5;
const memoryRateLimit = new Map();

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.send(JSON.stringify(payload));
}

function clientAddress(request) {
  const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(request.socket?.remoteAddress || 'unknown');
}

function redisCredentials() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

async function consumeRateLimit(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  const credentials = redisCredentials();
  if (credentials) {
    try {
      const key = `collager:discord-bugs:v1:${hash}`;
      const script = 'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return n';
      const redisResponse = await fetch(credentials.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['EVAL', script, '1', key, String(RATE_LIMIT_WINDOW_SECONDS)]),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await redisResponse.json().catch(() => ({}));
      if (!redisResponse.ok || payload.error) throw new Error('Rate limit unavailable');
      return Number(payload.result) <= RATE_LIMIT_MAX_REPORTS;
    } catch (error) {
      console.warn('Redis bug-report rate limit unavailable:', error.message);
    }
  }

  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const recent = (memoryRateLimit.get(hash) || []).filter(timestamp => now - timestamp < windowMs);
  recent.push(now);
  memoryRateLimit.set(hash, recent);
  return recent.length <= RATE_LIMIT_MAX_REPORTS;
}

function sameOriginRequest(request) {
  const origin = String(request.headers?.origin || '').trim();
  if (!origin) return true;
  try {
    const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '').trim();
    const allowedOrigin = String(process.env.ALLOWED_ORIGIN || '').trim();
    return new URL(origin).host === host || (allowedOrigin && origin === allowedOrigin);
  } catch (_) {
    return false;
  }
}

function discordConfigurationError(status) {
  if (status === 401) return { code: 'discord_token_invalid', message: 'Discord bot token is invalid.' };
  if (status === 403) return { code: 'discord_permission_denied', message: 'Discord bot does not have permission to send messages.' };
  if (status === 404) return { code: 'discord_channel_unavailable', message: 'Discord bug channel was not found.' };
  if (status === 429) return { code: 'discord_rate_limited', message: 'Discord is temporarily rate limiting bug reports.' };
  return { code: 'discord_request_failed', message: 'Discord rejected the bug report.' };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }
  if (!sameOriginRequest(request)) return sendJson(response, 403, { error: 'Origin not allowed.' });

  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const channelId = String(process.env.DISCORD_BUG_CHANNEL_ID || DEFAULT_CHANNEL_ID).trim();
  if (!botToken || !/^\d{17,20}$/.test(channelId)) {
    return sendJson(response, 503, { error: 'Bug reporting is not configured.' });
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();
  const page = String(body.page || '').trim().slice(0, 1000);
  if (String(body.website || '').trim()) return sendJson(response, 200, { ok: true });
  if (!title || !details || title.length > 100 || details.length > 1800) {
    return sendJson(response, 400, { error: 'Invalid bug report.' });
  }

  try {
    if (!await consumeRateLimit(clientAddress(request))) {
      return sendJson(response, 429, { error: 'Too many reports. Please try again later.' });
    }

    const fields = page ? [{ name: 'Page', value: page }] : [];
    const discordResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `Bug: ${title}`,
          description: details,
          color: 0xed1b24,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'collager.fm bug report' },
        }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!discordResponse.ok) {
      const discordError = await discordResponse.text().catch(() => '');
      console.error('Discord bug report failed:', discordResponse.status, discordError.slice(0, 500));
      return sendJson(response, 502, discordConfigurationError(discordResponse.status));
    }
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error('Discord bug report error:', error.message);
    return sendJson(response, 502, { code: 'discord_connection_failed', error: 'Could not send the bug report.' });
  }
};
