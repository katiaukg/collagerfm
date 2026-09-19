'use strict';

const { parseJsonBody, requireSameOrigin, rateLimit } = require('./_security');

const DEFAULT_CHANNEL_ID = '1533262608134705292';
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_MAX_REPORTS = 5;

function sendJson(response, status, payload) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.send(JSON.stringify(payload));
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
  let body;
  try { requireSameOrigin(request); body = parseJsonBody(request); }
  catch (error) { return sendJson(response, error.statusCode || 400, { error: error.message }); }

  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const channelId = String(process.env.DISCORD_BUG_CHANNEL_ID || DEFAULT_CHANNEL_ID).trim();
  if (!botToken || !/^\d{17,20}$/.test(channelId)) {
    return sendJson(response, 503, { error: 'Bug reporting is not configured.' });
  }

  for (const key of ['title', 'details', 'requester', 'page', 'website']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') return sendJson(response, 400, { error: 'Invalid bug report.' });
  }
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();
  const requester = String(body.requester || '').trim();
  const page = String(body.page || '').trim().slice(0, 1000);
  if (String(body.website || '').trim()) return sendJson(response, 200, { ok: true });
  if (!title || !details || title.length > 100 || details.length > 1800 || requester.length > 80) {
    return sendJson(response, 400, { error: 'Invalid bug report.' });
  }

  try {
    await rateLimit(request, 'discord', RATE_LIMIT_MAX_REPORTS, RATE_LIMIT_WINDOW_SECONDS * 1000);

    const fields = [];
    if (requester) fields.push({ name: 'Requested by', value: requester, inline: true });
    if (page) fields.push({ name: 'Page', value: page });
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
    if (error.statusCode) return sendJson(response, error.statusCode, { error: error.message });
    console.error('Discord bug report error:', error.message);
    return sendJson(response, 502, { code: 'discord_connection_failed', error: 'Could not send the bug report.' });
  }
};
