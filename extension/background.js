'use strict';

const ALLOWED_PAGE_PREFIXES = [
  'https://collagerfm.vercel.app/',
  'http://127.0.0.1:8767/',
  'http://localhost:8767/',
];

let operationQueue = Promise.resolve();
let queuedOperationCount = 0;

function clean(value, maximum = 500) {
  return String(value || '').trim().slice(0, maximum);
}

function actionError(message, openUrl = '') {
  const error = new Error(message);
  error.openUrl = clean(openUrl, 1000);
  return error;
}

function validateDeletePayload(payload) {
  const username = clean(payload?.username, 100);
  const artist = clean(payload?.artist);
  const track = clean(payload?.track);
  const timestamp = Math.floor(Number(payload?.timestamp));
  if (!username || !artist || !track || !Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('O scrobble nao possui usuario, artista, faixa e horario validos.');
  }
  return { username, artist, track, timestamp };
}

function validateObsessionPayload(payload) {
  const username = clean(payload?.username, 100);
  const rawUrl = clean(payload?.url, 1000);
  let url;
  try { url = new URL(rawUrl, 'https://www.last.fm'); }
  catch (_) { throw new Error('O endereco desta obsessao e invalido.'); }
  const match = url.pathname.match(/^\/user\/([^/]+)\/obsessions\/(\d+)\/?$/i);
  if (url.origin !== 'https://www.last.fm' || !match) throw new Error('O endereco desta obsessao e invalido.');
  const pathUsername = decodeURIComponent(match[1]);
  if (username && pathUsername.toLocaleLowerCase() !== username.toLocaleLowerCase()) {
    throw new Error('A obsessao nao pertence ao usuario informado.');
  }
  return { username: username || pathUsername, url: url.href, obsessionId: match[2] };
}

function validateTrackActionPayload(payload) {
  const username = clean(payload?.username, 100);
  const artist = clean(payload?.artist);
  const track = clean(payload?.track);
  if (!username || !artist || !track) {
    throw new Error('Informe usuario, artista e faixa para definir a obsessao.');
  }
  return { username, artist, track };
}

function waitForTab(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('O Last.fm demorou demais para abrir.'));
    }, timeoutMs);
    function finish() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') finish();
    }).catch(() => {});
  });
}

async function sendToLastfmTab(tabId, action, payload) {
  const send = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error('O Last.fm demorou demais para concluir esta ação.');
      error.code = 'COLLAGER_ACTION_TIMEOUT';
      reject(error);
    }, 30000);
    chrome.tabs.sendMessage(tabId, { channel: 'collager-lastfm-page', action, payload })
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
  try {
    return await send();
  } catch (error) {
    if (error?.code === 'COLLAGER_ACTION_TIMEOUT') throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lastfm-content.js'] });
    return send();
  }
}

async function deleteScrobble(payload, report = () => {}) {
  report('validating', 'Conferindo os dados do scrobble...', 12);
  const safe = validateDeletePayload(payload);
  const userUrl = `https://www.last.fm/user/${encodeURIComponent(safe.username)}/library`;
  report('locating', 'Procurando uma sessão aberta do Last.fm...', 24);
  const tabs = await chrome.tabs.query({ url: 'https://www.last.fm/*' });
  let tab = tabs.find(candidate => candidate.status === 'complete') || tabs[0];
  let created = false;
  if (!tab) {
    report('opening', 'Abrindo o Last.fm em segundo plano...', 36);
    tab = await chrome.tabs.create({ url: userUrl, active: false });
    created = true;
  } else {
    report('opening', 'Sessão do Last.fm localizada.', 36);
  }
  report('waiting', 'Aguardando o Last.fm ficar pronto...', 48);
  try {
    await waitForTab(tab.id);
    report('working', 'Localizando e excluindo o registro...', 68);
    const result = await sendToLastfmTab(tab.id, 'deleteScrobble', safe);
    if (!result?.ok) {
      throw actionError(result?.error || 'O Last.fm nao confirmou a exclusao.', userUrl);
    }
    report('confirming', 'Exclusão confirmada pelo Last.fm.', 90);
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    report('done', 'Scrobble excluído com sucesso.', 100);
    return { deleted: true, username: safe.username, timestamp: safe.timestamp };
  } catch (error) {
    if (!error.openUrl) error.openUrl = userUrl;
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}

async function deleteObsession(payload, report = () => {}) {
  report('validating', 'Conferindo os dados da obsessão...', 12);
  const safe = validateObsessionPayload(payload);
  report('locating', 'Procurando uma sessão aberta do Last.fm...', 24);
  const tabs = await chrome.tabs.query({ url: 'https://www.last.fm/*' });
  let tab = tabs.find(candidate => candidate.status === 'complete') || tabs[0];
  let created = false;
  if (!tab) {
    report('opening', 'Abrindo a obsessão em segundo plano...', 36);
    tab = await chrome.tabs.create({ url: safe.url, active: false });
    created = true;
  } else {
    report('opening', 'Sessão do Last.fm localizada.', 36);
  }
  report('waiting', 'Aguardando o Last.fm ficar pronto...', 48);
  try {
    await waitForTab(tab.id);
    report('working', 'Localizando e excluindo a obsessão...', 68);
    const result = await sendToLastfmTab(tab.id, 'deleteObsession', safe);
    if (!result?.ok) {
      throw actionError(result?.error || 'O Last.fm nao confirmou a exclusao da obsessao.', safe.url);
    }
    report('confirming', 'Exclusão confirmada pelo Last.fm.', 90);
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    report('done', 'Obsessão excluída com sucesso.', 100);
    return { deleted: true, username: safe.username, obsessionId: safe.obsessionId };
  } catch (error) {
    if (!error.openUrl) error.openUrl = safe.url;
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}

async function setObsession(payload, report = () => {}) {
  report('validating', 'Conferindo a faixa escolhida...', 12);
  const safe = validateTrackActionPayload(payload);
  const trackUrl = `https://www.last.fm/music/${encodeURIComponent(safe.artist)}/_/${encodeURIComponent(safe.track)}`;
  report('locating', 'Procurando uma sessão aberta do Last.fm...', 24);
  const tabs = await chrome.tabs.query({ url: 'https://www.last.fm/*' });
  let tab = tabs.find(candidate => candidate.status === 'complete') || tabs[0];
  let created = false;
  if (!tab) {
    report('opening', 'Abrindo a faixa em segundo plano...', 36);
    tab = await chrome.tabs.create({ url: trackUrl, active: false });
    created = true;
  } else {
    report('opening', 'Sessão do Last.fm localizada.', 36);
  }
  report('waiting', 'Aguardando o Last.fm ficar pronto...', 48);
  try {
    await waitForTab(tab.id);
    report('working', 'Enviando a nova obsessão...', 68);
    const result = await sendToLastfmTab(tab.id, 'setObsession', { ...safe, trackUrl });
    if (!result?.ok) {
      throw actionError(result?.error || 'O Last.fm nao confirmou a nova obsessao.', trackUrl);
    }
    report('confirming', 'Alteração confirmada pelo Last.fm.', 90);
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    report('done', 'Obsessão atualizada com sucesso.', 100);
    return { obsessionSet: true, username: safe.username, artist: safe.artist, track: safe.track };
  } catch (error) {
    if (!error.openUrl) error.openUrl = trackUrl;
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}

function enqueue(operation, report = () => {}) {
  queuedOperationCount += 1;
  const queuePosition = queuedOperationCount;
  report(
    'queued',
    queuePosition > 1
      ? `Aguardando a vez da extensão — posição ${queuePosition}.`
      : 'Preparando a extensão...',
    7
  );
  const run = async () => {
    report('starting', 'A extensão começou a operação.', 9);
    try {
      return await operation();
    } finally {
      queuedOperationCount = Math.max(0, queuedOperationCount - 1);
    }
  };
  const result = operationQueue.then(run, run);
  operationQueue = result.catch(() => {}).then(() => new Promise(resolve => {
    setTimeout(resolve, 5000 + Math.floor(Math.random() * 5001));
  }));
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderUrl = sender.tab?.url || '';
  if (message?.channel !== 'collager-lastfm' || !ALLOWED_PAGE_PREFIXES.some(prefix => senderUrl.startsWith(prefix))) {
    sendResponse({ __error: 'Origem nao autorizada.' });
    return false;
  }
  const senderTabId = sender.tab?.id;
  const requestId = clean(message.requestId, 200);
  const report = (phase, statusMessage, progress) => {
    if (senderTabId == null || !requestId) return;
    chrome.tabs.sendMessage(senderTabId, {
      channel: 'collager-lastfm-progress',
      requestId,
      phase,
      message: statusMessage,
      progress,
    }).catch(() => {});
  };
  const operation = message.action === 'ping'
    ? Promise.resolve({ available: true, version: chrome.runtime.getManifest().version })
    : message.action === 'openHistory'
      ? chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }).then(() => ({ opened: true }))
    : message.action === 'deleteScrobble'
      ? enqueue(() => deleteScrobble(message.payload, report), report)
    : message.action === 'deleteObsession'
      ? enqueue(() => deleteObsession(message.payload, report), report)
      : message.action === 'setObsession'
        ? enqueue(() => setObsession(message.payload, report), report)
      : Promise.reject(new Error('Acao nao permitida.'));
  operation.then(sendResponse).catch(error => {
    report('error', error?.message || 'A extensão não concluiu a operação.', 98);
    sendResponse({
      __error: error?.message || 'A extensao nao concluiu a operacao.',
      __openUrl: error?.openUrl || '',
    });
  });
  return true;
});
