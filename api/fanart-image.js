const ALLOWED_HOST = 'assets.fanart.tv';

function safeTarget(value) {
  const target = new URL(value);
  if (target.protocol !== 'https:' || target.hostname !== ALLOWED_HOST) throw new Error('Forbidden');
  return target;
}

async function fetchImage(target, redirects = 0) {
  const upstream = await fetch(target, {
    redirect: 'manual',
    headers: {
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: 'https://fanart.tv/',
      'User-Agent': 'CollagerFM/1.0 (https://github.com/katiaukg/collagerfm)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location') && redirects < 4) {
    return fetchImage(safeTarget(new URL(upstream.headers.get('location'), target).href), redirects + 1);
  }
  return upstream;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method Not Allowed');
  }
  try {
    const target = safeTarget(String(request.query?.url || ''));
    const upstream = await fetchImage(target);
    if (!upstream.ok) return response.status(upstream.status).send('Image unavailable');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) return response.status(415).send('Unsupported content');
    response.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    response.setHeader('Content-Type', contentType);
    return response.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    return response.status(error.message === 'Forbidden' ? 403 : 502).send(error.message);
  }
};
