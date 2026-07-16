let cachedConfig = null;

async function getYoutubeMusicConfig() {
  if (cachedConfig && cachedConfig.expires > Date.now()) return cachedConfig;
  const home = await fetch('https://music.youtube.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/138.0 Safari/537.36' },
    signal: AbortSignal.timeout(10000),
  });
  if (!home.ok) throw new Error(`YouTube Music respondeu ${home.status}`);
  const html = await home.text();
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || '';
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || '';
  if (!apiKey || !clientVersion) throw new Error('Configuracao do YouTube Music indisponivel.');
  cachedConfig = { apiKey, clientVersion, expires: Date.now() + 30 * 60 * 1000 };
  return cachedConfig;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo nao permitido.' });
  }
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
    const query = String(body.query || '').trim();
    if (!query) return response.status(400).json({ error: 'Busca vazia.' });
    const config = await getYoutubeMusicConfig();
    const url = new URL('https://music.youtube.com/youtubei/v1/search');
    url.searchParams.set('prettyPrint', 'false');
    url.searchParams.set('key', config.apiKey);
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://music.youtube.com',
        'User-Agent': 'Mozilla/5.0 Chrome/138.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: config.clientVersion,
            hl: 'pt-BR',
            gl: 'BR',
          },
        },
        query,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => ({}));
    response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return response.status(upstream.status).json(payload);
  } catch (error) {
    return response.status(502).json({ error: `Falha no YouTube Music: ${error.message}` });
  }
};
