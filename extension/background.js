'use strict';

const ALLOWED_PAGE_PREFIXES = [
  'https://collagerfm.vercel.app/',
  'http://127.0.0.1:8767/',
  'http://localhost:8767/',
];

let operationQueue = Promise.resolve();

function clean(value, maximum = 500) {
  return String(value || '').trim().slice(0, maximum);
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

async function sendToLastfmTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, { channel: 'collager-lastfm-page', action: 'deleteScrobble', payload });
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lastfm-content.js'] });
    return chrome.tabs.sendMessage(tabId, { channel: 'collager-lastfm-page', action: 'deleteScrobble', payload });
  }
}

async function deleteScrobble(payload) {
  const safe = validateDeletePayload(payload);
  const userUrl = `https://www.last.fm/user/${encodeURIComponent(safe.username)}/library`;
  const tabs = await chrome.tabs.query({ url: 'https://www.last.fm/*' });
  let tab = tabs.find(candidate => candidate.status === 'complete') || tabs[0];
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: userUrl, active: false });
    created = true;
  }
  await waitForTab(tab.id);

  try {
    const result = await sendToLastfmTab(tab.id, safe);
    if (!result?.ok) {
      if (result?.authRequired) await chrome.tabs.update(tab.id, { active: true });
      throw new Error(result?.error || 'O Last.fm nao confirmou a exclusao.');
    }
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
    return { deleted: true, username: safe.username, timestamp: safe.timestamp };
  } catch (error) {
    if (created) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    throw error;
  }
}

function enqueue(operation) {
  const result = operationQueue.then(operation, operation);
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
  const operation = message.action === 'ping'
    ? Promise.resolve({ available: true, version: chrome.runtime.getManifest().version })
    : message.action === 'deleteScrobble'
      ? enqueue(() => deleteScrobble(message.payload))
      : Promise.reject(new Error('Acao nao permitida.'));
  operation.then(sendResponse).catch(error => sendResponse({ __error: error?.message || 'A extensao nao concluiu a operacao.' }));
  return true;
});
