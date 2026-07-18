'use strict';

const { callLastfmWrite, readSession } = require('./_lastfm-session');

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

function originalParams(original, sessionKey) {
  const artist = cleanMetadata(original?.artist);
  const track = cleanMetadata(original?.track);
  const timestamp = Math.floor(Number(original?.timestamp));
  if (!artist || !track || !Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Este scrobble nao possui artista, faixa e horario validos.');
  return { artist, track, timestamp: String(timestamp), sk: sessionKey };
}

async function removeScrobble(original, sessionKey) {
  return callLastfmWrite({ method: 'library.removeScrobble', ...originalParams(original, sessionKey) });
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
    if (body.action === 'delete') {
      await removeScrobble(body.original, session.key);
      return send(response, 200, { deleted: true, username: session.name });
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
        await removeScrobble(body.original, session.key);
      }

      try {
        const scrobble = await callLastfmWrite({ method: 'track.scrobble', artist, track, album, timestamp: original.timestamp, sk: session.key });
        const accepted = Number(scrobble?.scrobbles?.['@attr']?.accepted || 0);
        if (!accepted) {
          const ignored = scrobble?.scrobbles?.scrobble?.ignoredMessage;
          throw new Error(ignored?.['#text'] || 'O Last.fm nao aceitou o scrobble editado.');
        }
      } catch (error) {
        if (body.deleteOriginal !== false) {
          try {
            await callLastfmWrite({
              method: 'track.scrobble',
              artist: original.artist,
              track: original.track,
              album: cleanMetadata(body.original?.album),
              timestamp: original.timestamp,
              sk: session.key,
            });
          } catch (_) {
            return send(response, 409, {
              error: `O scrobble antigo foi removido, mas a edicao e a restauracao falharam: ${error.message}`,
              added: false,
              deleted: true,
              restorationFailed: true,
            });
          }
        }
        throw error;
      }
      return send(response, 200, { replaced: true, added: true, deleted: body.deleteOriginal !== false, username: session.name });
    }
    return send(response, 400, { error: 'Acao invalida.' });
  } catch (error) {
    const legacyUnavailable = Number(error.code) === 3 || /invalid method|does not exist/i.test(error.message);
    return send(response, legacyUnavailable ? 501 : 502, {
      error: legacyUnavailable ? 'O Last.fm nao disponibilizou a remocao deste scrobble pela API. A edicao nao foi simulada.' : error.message,
      code: error.code || 0,
    });
  }
};
