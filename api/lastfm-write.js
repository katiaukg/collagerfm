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
        const accepted = Number(scrobble?.scrobbles?.['@attr']?.accepted || 0);
        if (!accepted) {
          const ignored = scrobble?.scrobbles?.scrobble?.ignoredMessage;
          throw new Error(ignored?.['#text'] || 'O Last.fm nao aceitou o scrobble editado.');
        }
      } catch (error) {
        throw error;
      }
      return send(response, 200, { replaced: false, added: true, deleted: false, username: session.name });
    }
    return send(response, 400, { error: 'Acao invalida.' });
  } catch (error) {
    return send(response, error.statusCode || 502, {
      error: error.message,
      code: error.code || 0,
    });
  }
};
