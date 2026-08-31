'use strict';

const { callLastfmWrite, readSession } = require('./_lastfm-session');
const MAX_REPLACEMENT_AGE_SECONDS = 14 * 24 * 60 * 60;

function bodyOf(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  try { return JSON.parse(request.body || '{}'); } catch (_) { return {}; }
}

function sameOrigin(request) {
  const origin = String(request.headers?.origin || '').trim();
  if (!origin) return true;
  const proto = String(request.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '').split(',')[0].trim();
  return origin === `${proto}://${host}`;
}

function send(response, status, payload) {
  response.status(status);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.send(JSON.stringify(payload));
}

function cleanMetadata(value) { return String(value || '').trim().slice(0, 500); }

function optionalPositiveInteger(value, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : 0;
}

function scrobbleTimestamp(value) {
  const now = Math.floor(Date.now() / 1000);
  const timestamp = value === undefined || value === null || value === ''
    ? now
    : Math.floor(Number(value));
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Informe um horário válido para o scrobble.');
  const age = now - timestamp;
  if (age < -300) throw new Error('O horário do scrobble não pode estar no futuro.');
  if (age > MAX_REPLACEMENT_AGE_SECONDS) {
    const error = new Error('O Last.fm aceita scrobbles enviados somente por aproximadamente 14 dias.');
    error.statusCode = 422;
    error.code = 'scrobble_too_old';
    throw error;
  }
  return String(timestamp);
}

function assertAcceptedScrobble(payload, fallbackMessage) {
  const accepted = Number(payload?.scrobbles?.['@attr']?.accepted || 0);
  if (accepted) return;
  const scrobble = Array.isArray(payload?.scrobbles?.scrobble)
    ? payload.scrobbles.scrobble[0]
    : payload?.scrobbles?.scrobble;
  const ignored = scrobble?.ignoredMessage;
  throw new Error(ignored?.['#text'] || fallbackMessage);
}

function originalParams(original, sessionKey) {
  const artist = cleanMetadata(original?.artist);
  const track = cleanMetadata(original?.track);
  const timestamp = Math.floor(Number(original?.timestamp));
  if (!artist || !track || !Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Este scrobble nao possui artista, faixa e horario validos.');
  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (age < -300 || age > MAX_REPLACEMENT_AGE_SECONDS) {
    const error = new Error('O Last.fm aceita reenviar scrobbles somente por aproximadamente 14 dias.');
    error.statusCode = 422;
    error.code = 'scrobble_too_old';
    throw error;
  }
  return { artist, track, timestamp: String(timestamp), sk: sessionKey };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'Metodo nao permitido.' });
  if (!sameOrigin(request)) return send(response, 403, { error: 'Origem nao permitida.' });
  const session = readSession(request);
  if (!session) return send(response, 401, { error: 'Autorize sua conta do Last.fm para continuar.', authRequired: true });

  const body = bodyOf(request);
  const requestedUser = cleanMetadata(body.username);
  if (requestedUser && requestedUser.toLocaleLowerCase() !== session.name.toLocaleLowerCase()) {
    return send(response, 403, { error: `A sessao autorizada pertence a ${session.name}, nao a ${requestedUser}.` });
  }

  try {
    if (body.action === 'love') {
      const artist = cleanMetadata(body.artist);
      const track = cleanMetadata(body.track);
      if (!artist || !track) throw new Error('Informe faixa e artista para curtir.');
      await callLastfmWrite({ method: 'track.love', artist, track, sk: session.key });
      return send(response, 200, { loved: true, username: session.name, artist, track });
    }
    if (body.action === 'unlove') {
      const artist = cleanMetadata(body.artist);
      const track = cleanMetadata(body.track);
      if (!artist || !track) throw new Error('Informe faixa e artista para remover das curtidas.');
      await callLastfmWrite({ method: 'track.unlove', artist, track, sk: session.key });
      return send(response, 200, { loved: false, username: session.name, artist, track });
    }
    if (body.action === 'scrobble') {
      const artist = cleanMetadata(body.artist);
      const track = cleanMetadata(body.track);
      const album = cleanMetadata(body.album);
      const albumArtist = cleanMetadata(body.albumArtist);
      const duration = optionalPositiveInteger(body.duration, 24 * 60 * 60);
      const timestamp = scrobbleTimestamp(body.timestamp);
      if (!artist || !track) throw new Error('Informe faixa e artista para adicionar o scrobble.');
      const params = { method: 'track.scrobble', artist, track, timestamp, sk: session.key };
      if (album) params.album = album;
      if (albumArtist) params.albumArtist = albumArtist;
      if (duration) params.duration = String(duration);
      const payload = await callLastfmWrite(params);
      assertAcceptedScrobble(payload, 'O Last.fm não aceitou o novo scrobble.');
      return send(response, 200, {
        scrobbled: true,
        username: session.name,
        artist,
        track,
        album,
        timestamp: Number(timestamp),
      });
    }
    if (body.action === 'nowPlaying') {
      const artist = cleanMetadata(body.artist);
      const track = cleanMetadata(body.track);
      const album = cleanMetadata(body.album);
      const albumArtist = cleanMetadata(body.albumArtist);
      const duration = optionalPositiveInteger(body.duration, 24 * 60 * 60);
      if (!artist || !track) throw new Error('Informe faixa e artista para atualizar o tocando agora.');
      const params = { method: 'track.updateNowPlaying', artist, track, sk: session.key };
      if (album) params.album = album;
      if (albumArtist) params.albumArtist = albumArtist;
      if (duration) params.duration = String(duration);
      await callLastfmWrite(params);
      return send(response, 200, {
        nowPlaying: true,
        username: session.name,
        artist,
        track,
        album,
      });
    }
    if (body.action === 'delete') {
      return send(response, 501, {
        error: 'O Last.fm não oferece exclusão de scrobble na API pública. Abra o histórico no Last.fm para excluir este registro manualmente.',
        unsupported: true,
        manualActionRequired: true,
      });
    }
    if (body.action === 'replace') {
      const original = originalParams(body.original, session.key);
      const artist = cleanMetadata(body.edited?.artist);
      const track = cleanMetadata(body.edited?.track);
      const album = cleanMetadata(body.edited?.album);
      if (!artist || !track) throw new Error('Informe faixa e artista para salvar a edicao.');
      const metadataChanged = artist !== original.artist || track !== original.track || album !== cleanMetadata(body.original?.album);
      if (!metadataChanged) return send(response, 200, { replaced: false, unchanged: true, username: session.name });

      if (body.deleteOriginal !== false) {
        return send(response, 501, {
          error: 'O Last.fm não oferece edição nem exclusão de scrobble na API pública. A correção continua salva somente no collager.fm.',
          unsupported: true,
          manualActionRequired: true,
        });
      }

      try {
        const scrobble = await callLastfmWrite({ method: 'track.scrobble', artist, track, album, timestamp: original.timestamp, sk: session.key });
        assertAcceptedScrobble(scrobble, 'O Last.fm nao aceitou o scrobble editado.');
      } catch (error) {
        throw error;
      }
      return send(response, 200, { replaced: false, added: true, deleted: false, username: session.name });
    }
    if (body.action === 'restore') {
      const source = body.scrobble || body.original || {};
      const original = originalParams(source, session.key);
      const album = cleanMetadata(source.album);
      const scrobble = await callLastfmWrite({
        method: 'track.scrobble',
        artist: original.artist,
        track: original.track,
        album,
        timestamp: original.timestamp,
        sk: session.key,
      });
      assertAcceptedScrobble(scrobble, 'O Last.fm nao aceitou recolocar este scrobble.');
      return send(response, 200, {
        restored: true,
        username: session.name,
        artist: original.artist,
        track: original.track,
        timestamp: Number(original.timestamp),
      });
    }
    return send(response, 400, { error: 'Acao invalida.' });
  } catch (error) {
    return send(response, error.statusCode || 502, {
      error: error.message,
      code: error.code || 0,
    });
  }
};
