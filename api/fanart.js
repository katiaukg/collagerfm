const USER_AGENT = 'CollagerFM/1.0 (https://github.com/katiaukg/collagerfm)';

function sortImages(images) {
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function searchMusicBrainz(resource, query) {
  const url = new URL(`https://musicbrainz.org/ws/2/${resource}/`);
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '5');
  const { response, payload } = await fetchJson(url);
  if (!response.ok) throw new Error(`MusicBrainz respondeu ${response.status}`);
  return payload;
}

async function fetchFanart(artistMbid, apiKey) {
  const url = new URL(`https://webservice.fanart.tv/v3.2/music/${encodeURIComponent(artistMbid)}`);
  url.searchParams.set('api_key', apiKey);
  let result = await fetchJson(url);
  if (result.response.status === 401) {
    url.searchParams.delete('api_key');
    url.searchParams.set('client_key', apiKey);
    result = await fetchJson(url);
  }
  if (!result.response.ok) {
    const message = result.payload?.error || result.payload?.message || `Fanart.tv respondeu ${result.response.status}`;
    const error = new Error(message);
    error.status = result.response.status;
    throw error;
  }
  return result.payload;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
    const apiKey = String(body.apiKey || '').trim();
    const artist = String(body.artist || '').trim();
    const album = String(body.album || '').trim();
    if (!apiKey) return response.status(400).json({ error: 'Informe a chave da Fanart.tv.' });
    if (!artist) return response.status(400).json({ error: 'Artista nao informado.' });

    let artistMbid = String(body.artistMbid || '').trim();
    if (!artistMbid) {
      const search = await searchMusicBrainz('artist', `artist:"${artist.replace(/"/g, '')}"`);
      artistMbid = search.artists?.[0]?.id || '';
    }
    if (!artistMbid) return response.status(404).json({ error: 'Artista nao encontrado no MusicBrainz.' });

    const data = await fetchFanart(artistMbid, apiKey);
    const artistImages = [
      ...(data.artistthumb || []).map(image => ({ ...image, type: 'Artist Thumb' })),
      ...(data.artistbackground || []).map(image => ({ ...image, type: 'Background' })),
    ];

    let albumMbid = String(body.albumMbid || '').trim();
    if (album && !albumMbid) {
      const search = await searchMusicBrainz('release-group', `releasegroup:"${album.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`);
      albumMbid = search['release-groups']?.[0]?.id || '';
    }
    const albums = Array.isArray(data.albums)
      ? data.albums
      : Object.entries(data.albums || {}).map(([release_group_id, value]) => ({ release_group_id, ...value }));
    const matchedAlbum = albumMbid
      ? albums.find(entry => String(entry.release_group_id || '').toLowerCase() === albumMbid.toLowerCase())
      : null;
    const albumCovers = (matchedAlbum?.albumcover || []).map(image => ({ ...image, type: 'Album Cover' }));

    response.setHeader('Cache-Control', 'private, no-store');
    return response.status(200).json({
      artistMbid,
      albumMbid,
      artistImages: sortImages(artistImages),
      albumCovers: sortImages(albumCovers),
    });
  } catch (error) {
    return response.status(error.status || 502).json({ error: `Falha na Fanart.tv: ${error.message}` });
  }
};
