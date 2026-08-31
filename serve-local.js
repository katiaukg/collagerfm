const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const root = __dirname;

function loadLocalEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadLocalEnv(path.join(root, '.env.local'));

const obsessionsApi = require('./api/obsessions');
const lastfmAuthApi = require('./api/lastfm-auth');
const lastfmApi = require('./api/lastfm');
const lastfmWriteApi = require('./api/lastfm-write');
const discordBugApi = require('./api/discord-bug');

const musicBrainzCache = new Map();
const fanartMusicCache = new Map();
const lastfmApiCache = new Map();
const LASTFM_CACHE_TTL = 60 * 1000;
const LASTFM_RECENT_CACHE_TTL = 2 * 1000;
const LASTFM_ALLOWED_METHODS = new Set([
  'album.getinfo',
  'artist.getinfo',
  'track.getinfo',
  'track.search',
  'user.getinfo',
  'user.getlovedtracks',
  'user.getrecenttracks',
  'user.gettopalbums',
  'user.gettopartists',
  'user.gettoptracks',
]);

const defaultLastfmApiKey = String(process.env.LASTFM_API_KEY || '').trim();
const youtubeMusicApiKey = String(process.env.YOUTUBE_MUSIC_API_KEY || '').trim();
const youtubeMusicClientVersion = String(process.env.YOUTUBE_MUSIC_CLIENT_VERSION || '1.20250519.01.00').trim();
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

function handleObsessions(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1:8767'}`);
  const headers = {};
  let statusCode = 200;
  const adapter = {
    status(value) { statusCode = value; return adapter; },
    setHeader(name, value) { headers[name] = value; },
    send(body) {
      const data = Buffer.from(String(body));
      response.writeHead(statusCode, { ...headers, 'Content-Length': data.length });
      response.end(data);
    },
  };
  return obsessionsApi({
    method: request.method,
    headers: { ...request.headers, 'x-forwarded-proto': 'http' },
    query: Object.fromEntries(requestUrl.searchParams),
  }, adapter);
}

function readJsonBody(request, response, callback) {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => {
    if (body.length < 32768) body += chunk;
  });
  request.on('end', () => {
    try { callback(JSON.parse(body || '{}')); }
    catch (error) { sendJson(response, 400, { error: `Requisicao invalida: ${error.message}` }); }
  });
}

function requestJson(options) {
  return new Promise((resolve, reject) => {
    const upstream = https.request({ ...options, method: 'GET', timeout: 15000 }, upstreamResponse => {
      const chunks = [];
      upstreamResponse.on('data', chunk => chunks.push(chunk));
      upstreamResponse.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload;
        try { payload = text ? JSON.parse(text) : {}; }
        catch (_) { payload = { error: text || 'Resposta invalida.' }; }
        resolve({ status: upstreamResponse.statusCode || 502, payload });
      });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', reject);
    upstream.end();
  });
}

async function handleLastfm(request, response) {
  readJsonBody(request, response, async body => {
    try {
      if (!defaultLastfmApiKey) {
        return sendJson(response, 503, {
          error: 'A chave padrao do Last.fm nao esta configurada no servidor.',
          fallbackRequired: true,
        });
      }

      const source = body && typeof body.params === 'object' ? body.params : {};
      const method = String(source.method || '').trim().toLowerCase();
      if (!LASTFM_ALLOWED_METHODS.has(method)) {
        return sendJson(response, 403, { error: 'Metodo do Last.fm nao permitido.' });
      }

      const allowedParams = new Set([
        'album', 'artist', 'autocorrect', 'extended', 'from', 'lang', 'limit',
        'method', 'page', 'period', 'to', 'track', 'user',
      ]);
      const params = new URLSearchParams();
      Object.entries(source).forEach(([key, value]) => {
        if (allowedParams.has(key) && value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });
      params.set('method', method);
      params.set('api_key', defaultLastfmApiKey);
      params.set('format', 'json');

      const cacheKey = params.toString().replace(/api_key=[^&]+&?/, '');
      const cached = lastfmApiCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) return sendJson(response, 200, cached.payload);
      if (cached) lastfmApiCache.delete(cacheKey);

      const result = await requestJson({
        hostname: 'ws.audioscrobbler.com',
        path: `/2.0/?${params.toString()}`,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CollagerFM/1.0 (collage generator)',
        },
      });
      const lastfmError = Number(result.payload?.error || 0);
      const fallbackRequired = [10, 26, 29].includes(lastfmError)
        || [401, 403, 429].includes(result.status);
      if (result.status < 200 || result.status >= 300 || fallbackRequired) {
        return sendJson(response, result.status >= 400 ? result.status : 502, {
          ...result.payload,
          fallbackRequired,
        });
      }
      if (!lastfmError) {
        const ttl = method === 'user.getrecenttracks' ? LASTFM_RECENT_CACHE_TTL : LASTFM_CACHE_TTL;
        lastfmApiCache.set(cacheKey, { expires: Date.now() + ttl, payload: result.payload });
      }
      sendJson(response, 200, result.payload);
    } catch (error) {
      sendJson(response, 502, {
        error: `Falha ao consultar o Last.fm: ${error.message}`,
        fallbackRequired: true,
      });
    }
  });
}

function invokeServerless(handler, request, response, body = undefined) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1:8767'}`);
  request.headers = { ...request.headers, 'x-forwarded-proto': 'http' };
  request.query = Object.fromEntries(requestUrl.searchParams);
  if (body !== undefined) request.body = body;
  let statusCode = 200;
  const headers = {};
  const adapter = {
    status(value) { statusCode = value; return adapter; },
    setHeader(name, value) { headers[name] = value; },
    send(value = '') {
      const data = Buffer.from(String(value));
      response.writeHead(statusCode, { ...headers, 'Content-Length': data.length });
      response.end(data);
    },
    end(value = '') { adapter.send(value); },
  };
  Promise.resolve(handler(request, adapter)).catch(error => {
    if (!response.headersSent) sendJson(response, 500, { error: error.message });
  });
}

function handleServerlessPost(handler, request, response) {
  readJsonBody(request, response, body => invokeServerless(handler, request, response, body));
}

async function searchMusicBrainz(pathname) {
  if (musicBrainzCache.has(pathname)) return musicBrainzCache.get(pathname);
  const pending = requestJson({
      hostname: 'musicbrainz.org',
      path: pathname,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollagerFM/1.0 (local collage generator)',
      },
    }).then(result => {
      if (result.status < 200 || result.status >= 300) throw new Error(`MusicBrainz respondeu ${result.status}`);
      return result.payload;
    }).catch(error => {
      musicBrainzCache.delete(pathname);
      throw error;
    });
  musicBrainzCache.set(pathname, pending);
  return pending;
}

function sortFanartImages(images) {
  return (Array.isArray(images) ? images : [])
    .filter(image => image && image.url)
    .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
    .map(image => {
      const url = String(image.url).replace(/^http:\/\//i, 'https://');
      return {
        id: String(image.id || url),
        url,
        preview: `${url}/preview`,
        type: image.type || '',
        likes: Number(image.likes || 0),
        width: Number(image.width || 0),
        height: Number(image.height || 0),
      };
    });
}

async function fetchFanartMusic(artistMbid, apiKey) {
  const cacheKey = `${artistMbid}|${apiKey}`;
  if (fanartMusicCache.has(cacheKey)) return fanartMusicCache.get(cacheKey);
  const encodedId = encodeURIComponent(artistMbid);
  const encodedKey = encodeURIComponent(apiKey);
  const pending = (async () => {
    let result = await requestJson({
      hostname: 'webservice.fanart.tv',
      path: `/v3.2/music/${encodedId}?api_key=${encodedKey}`,
      headers: { Accept: 'application/json' },
    });
    if (result.status === 401) {
      result = await requestJson({
        hostname: 'webservice.fanart.tv',
        path: `/v3.2/music/${encodedId}?client_key=${encodedKey}`,
        headers: { Accept: 'application/json' },
      });
    }
    if (result.status < 200 || result.status >= 300) {
      const message = result.payload?.error || result.payload?.message || `Fanart.tv respondeu ${result.status}`;
      const error = new Error(message);
      error.status = result.status;
      throw error;
    }
    return result.payload;
  })().catch(error => {
    fanartMusicCache.delete(cacheKey);
    throw error;
  });
  fanartMusicCache.set(cacheKey, pending);
  return pending;
}

async function handleFanart(request, response) {
  readJsonBody(request, response, async body => {
    try {
      const apiKey = String(body.apiKey || '').trim();
      const artist = String(body.artist || '').trim();
      const album = String(body.album || '').trim();
      if (!apiKey) return sendJson(response, 400, { error: 'Informe a chave da Fanart.tv.' });
      if (!artist) return sendJson(response, 400, { error: 'Artista nao informado.' });

      let artistMbid = String(body.artistMbid || '').trim();
      if (!artistMbid) {
        const query = encodeURIComponent(`artist:"${artist.replace(/"/g, '')}"`);
        const search = await searchMusicBrainz(`/ws/2/artist/?query=${query}&fmt=json&limit=5`);
        artistMbid = search.artists?.[0]?.id || '';
      }
      if (!artistMbid) return sendJson(response, 404, { error: 'Artista nao encontrado no MusicBrainz.' });

      const data = await fetchFanartMusic(artistMbid, apiKey);
      const artistImages = [
        ...(data.artistthumb || []).map(image => ({ ...image, type: 'Artist Thumb' })),
        ...(data.artistbackground || []).map(image => ({ ...image, type: 'Background' })),
      ];

      let albumMbid = String(body.albumMbid || '').trim();
      if (album && !albumMbid) {
        const query = encodeURIComponent(`releasegroup:"${album.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`);
        const search = await searchMusicBrainz(`/ws/2/release-group/?query=${query}&fmt=json&limit=5`);
        albumMbid = search['release-groups']?.[0]?.id || '';
      }
      const albums = Array.isArray(data.albums)
        ? data.albums
        : Object.entries(data.albums || {}).map(([release_group_id, value]) => ({ release_group_id, ...value }));
      const matchedAlbum = albumMbid
        ? albums.find(entry => String(entry.release_group_id || '').toLowerCase() === albumMbid.toLowerCase())
        : null;
      const albumCovers = (matchedAlbum?.albumcover || []).map(image => ({ ...image, type: 'Album Cover' }));

      sendJson(response, 200, {
        artistMbid,
        albumMbid,
        artistImages: sortFanartImages(artistImages),
        albumCovers: sortFanartImages(albumCovers),
      });
    } catch (error) {
      sendJson(response, error.status || 502, { error: `Falha na Fanart.tv: ${error.message}` });
    }
  });
}

function handleYoutubeMusic(request, response) {
  if (!youtubeMusicApiKey) {
    return sendJson(response, 503, { error: 'YouTube Music nao configurado no servidor.' });
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => {
    if (body.length < 16384) body += chunk;
  });
  request.on('end', () => {
    try {
      const query = String(JSON.parse(body || '{}').query || '').trim();
      if (!query) return sendJson(response, 400, { error: 'Busca vazia.' });
      const payload = Buffer.from(JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: youtubeMusicClientVersion,
            hl: 'pt-BR',
            gl: 'BR',
          },
        },
        query,
      }));
      const upstream = https.request({
        hostname: 'music.youtube.com',
        path: `/youtubei/v1/search?prettyPrint=false&key=${encodeURIComponent(youtubeMusicApiKey)}`,
        method: 'POST',
        headers: {
          'Content-Length': payload.length,
          'Content-Type': 'application/json',
          'Origin': 'https://music.youtube.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36',
        },
        timeout: 15000,
      }, upstreamResponse => {
        const chunks = [];
        upstreamResponse.on('data', chunk => chunks.push(chunk));
        upstreamResponse.on('end', () => {
          const result = Buffer.concat(chunks);
          response.writeHead(upstreamResponse.statusCode || 502, {
            'Cache-Control': 'no-store',
            'Content-Length': result.length,
            'Content-Type': 'application/json; charset=utf-8',
          });
          response.end(result);
        });
      });
      upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
      upstream.on('error', error => sendJson(response, 502, { error: `Falha no YouTube Music: ${error.message}` }));
      upstream.end(payload);
    } catch (error) {
      sendJson(response, 400, { error: `Requisicao invalida: ${error.message}` });
    }
  });
}

function handleFanartImage(request, response) {
  try {
    const requestUrl = new URL(request.url, 'http://127.0.0.1:8767');
    const target = new URL(requestUrl.searchParams.get('url') || '');
    if (target.protocol !== 'https:' || target.hostname !== 'assets.fanart.tv') {
      response.writeHead(403);
      return response.end('Forbidden');
    }

    const pipeImage = (imageUrl, redirects = 0) => {
      const upstream = https.get(imageUrl, {
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          Referer: 'https://fanart.tv/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36',
        },
        timeout: 15000,
      }, upstreamResponse => {
        const status = upstreamResponse.statusCode || 500;
        const location = upstreamResponse.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
          upstreamResponse.resume();
          const redirected = new URL(location, imageUrl);
          if (redirected.protocol !== 'https:') {
            response.writeHead(403);
            return response.end('Unsafe image redirect');
          }
          return pipeImage(redirected, redirects + 1);
        }
        if (status >= 400) {
          response.writeHead(status);
          upstreamResponse.resume();
          return response.end('Image unavailable');
        }
        response.writeHead(200, {
          'Cache-Control': 'public, max-age=86400',
          'Content-Type': upstreamResponse.headers['content-type'] || 'image/jpeg',
        });
        upstreamResponse.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end('Image proxy failed');
      });
    };
    pipeImage(target);
  } catch (_) {
    response.writeHead(400);
    response.end('Invalid image URL');
  }
}

const LASTFM_IMAGE_HOSTS = [
  /(^|\.)lastfm\.freetls\.fastly\.net$/i,
  /(^|\.)userserve-ak\.last\.fm$/i,
  /(^|\.)img\d*-ak\.lst\.fm$/i,
  /(^|\.)lastfm-img\d*\.akamaized\.net$/i,
];

function isAllowedLastfmImageUrl(url) {
  return url.protocol === 'https:' && LASTFM_IMAGE_HOSTS.some(pattern => pattern.test(url.hostname));
}

function handleLastfmImage(request, response) {
  try {
    const requestUrl = new URL(request.url, 'http://127.0.0.1:8767');
    const target = new URL(requestUrl.searchParams.get('url') || '');
    if (!isAllowedLastfmImageUrl(target)) {
      response.writeHead(400);
      return response.end('Invalid Last.fm image URL');
    }

    const pipeImage = (imageUrl, redirects = 0) => {
      const upstream = https.get(imageUrl, {
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          'User-Agent': 'CollagerFM/1.0 (image proxy)',
        },
        timeout: 15000,
      }, upstreamResponse => {
        const status = upstreamResponse.statusCode || 500;
        const location = upstreamResponse.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
          upstreamResponse.resume();
          const redirected = new URL(location, imageUrl);
          if (!isAllowedLastfmImageUrl(redirected)) {
            response.writeHead(403);
            return response.end('Unsafe image redirect');
          }
          return pipeImage(redirected, redirects + 1);
        }
        const contentType = String(upstreamResponse.headers['content-type'] || '');
        if (status >= 400 || !contentType.toLowerCase().startsWith('image/')) {
          response.writeHead(status >= 400 ? status : 502);
          upstreamResponse.resume();
          return response.end('Last.fm image unavailable');
        }
        response.writeHead(200, {
          'Cache-Control': 'public, max-age=86400',
          'Content-Type': contentType,
        });
        upstreamResponse.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end('Last.fm image proxy failed');
      });
    };
    pipeImage(target);
  } catch (_) {
    response.writeHead(400);
    response.end('Invalid Last.fm image URL');
  }
}

http.createServer((request, response) => {
  if (request.method === 'POST' && request.url.split('?')[0] === '/api/discord-bug') {
    return handleServerlessPost(discordBugApi, request, response);
  }
  if (request.url.split('?')[0] === '/api/lastfm-auth') {
    if (request.method === 'POST') return handleServerlessPost(lastfmAuthApi, request, response);
    return invokeServerless(lastfmAuthApi, request, response);
  }
  if (request.method === 'POST' && request.url.split('?')[0] === '/api/lastfm-write') {
    return handleServerlessPost(lastfmWriteApi, request, response);
  }
  if (request.method === 'GET' && request.url.split('?')[0] === '/api/obsessions') {
    return handleObsessions(request, response);
  }
  if (request.url.split('?')[0] === '/api/lastfm') {
    if (request.method === 'POST') return handleServerlessPost(lastfmApi, request, response);
    return invokeServerless(lastfmApi, request, response);
  }
  if (request.method === 'POST' && request.url.split('?')[0] === '/api/youtube-music') {
    return handleYoutubeMusic(request, response);
  }
  if (request.method === 'POST' && request.url.split('?')[0] === '/api/fanart') {
    return handleFanart(request, response);
  }
  if (request.method === 'GET' && request.url.split('?')[0] === '/api/fanart-image') {
    return handleFanartImage(request, response);
  }
  if (request.method === 'GET' && request.url.split('?')[0] === '/api/lastfm-image') {
    return handleLastfmImage(request, response);
  }
  const pathname = decodeURIComponent(request.url.split('?')[0]);
  const file = path.resolve(root, `.${pathname === '/' ? '/lastfm-collage.html' : pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }
  const basename = path.basename(file).toLowerCase();
  if (basename.startsWith('.') || basename === 'serve-local.js') {
    response.writeHead(403);
    return response.end('Forbidden');
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      return response.end('Not found');
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    });
    response.end(data);
  });
}).listen(8767, '127.0.0.1');
