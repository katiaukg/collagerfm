'use strict';

const ALLOWED_HOSTS = [
  /(^|\.)lastfm\.freetls\.fastly\.net$/i,
  /(^|\.)userserve-ak\.last\.fm$/i,
  /(^|\.)img\d*-ak\.lst\.fm$/i,
  /(^|\.)lastfm-img\d*\.akamaized\.net$/i,
];

function isAllowedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ALLOWED_HOSTS.some(pattern => pattern.test(url.hostname));
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.status(405).send('Method not allowed');
    return;
  }

  const source = Array.isArray(request.query?.url) ? request.query.url[0] : request.query?.url;
  if (!isAllowedUrl(source)) {
    response.status(400).send('Invalid Last.fm image URL');
    return;
  }

  try {
    let currentUrl = source;
    let upstream;
    for (let redirects = 0; redirects <= 5; redirects++) {
      upstream = await fetch(currentUrl, {
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          'User-Agent': 'CollagerFM/1.0 (image proxy)',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const next = new URL(upstream.headers.get('location') || '', currentUrl).href;
      if (!isAllowedUrl(next)) {
        response.status(403).send('Unsafe Last.fm image redirect');
        return;
      }
      currentUrl = next;
    }
    if (!upstream || [301, 302, 303, 307, 308].includes(upstream.status)) {
      response.status(508).send('Too many Last.fm image redirects');
      return;
    }
    const contentType = String(upstream.headers.get('content-type') || '');
    if (!upstream.ok || !contentType.toLowerCase().startsWith('image/')) {
      response.status(upstream.ok ? 502 : upstream.status).send('Last.fm image unavailable');
      return;
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > 12 * 1024 * 1024) {
      response.status(413).send('Image too large');
      return;
    }
    response.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    response.setHeader('Content-Type', contentType);
    response.status(200).send(bytes);
  } catch (error) {
    response.status(502).send(`Last.fm image proxy failed: ${error.message}`);
  }
};
