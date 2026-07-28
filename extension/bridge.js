'use strict';

const PAGE_REQUEST = 'collager-lastfm-extension-request';
const PAGE_RESPONSE = 'collager-lastfm-extension-response';
const PAGE_READY = 'collager-lastfm-extension-ready';
const PAGE_PROGRESS = 'collager-lastfm-extension-progress';
const ALLOWED_ORIGINS = new Set([
  'https://collagerfm.vercel.app',
  'http://127.0.0.1:8767',
  'http://localhost:8767',
]);

function isAllowedPage() {
  return ALLOWED_ORIGINS.has(location.origin);
}

function notifyReady() {
  if (!isAllowedPage()) return;
  window.postMessage({ type: PAGE_READY, version: chrome.runtime.getManifest().version }, location.origin);
}

window.addEventListener('message', event => {
  if (!isAllowedPage() || event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type !== PAGE_REQUEST || typeof event.data.requestId !== 'string') return;
  const requestId = event.data.requestId;
  const action = event.data.action;
  if (action !== 'ping' && action !== 'deleteScrobble' && action !== 'deleteObsession' && action !== 'setObsession') return;

  chrome.runtime.sendMessage({
    channel: 'collager-lastfm',
    requestId,
    action,
    payload: event.data.payload || {},
  })
    .then(result => {
      if (result?.__error) {
        window.postMessage({
          type: PAGE_RESPONSE,
          requestId,
          ok: false,
          error: result.__error,
          openUrl: result.__openUrl || '',
        }, location.origin);
        return;
      }
      window.postMessage({ type: PAGE_RESPONSE, requestId, ok: true, result }, location.origin);
    })
    .catch(error => {
      window.postMessage({
        type: PAGE_RESPONSE,
        requestId,
        ok: false,
        error: error?.message || 'A extensao nao concluiu a operacao.',
      }, location.origin);
    });
});

chrome.runtime.onMessage.addListener(message => {
  if (!isAllowedPage() || message?.channel !== 'collager-lastfm-progress'
      || typeof message.requestId !== 'string') return undefined;
  window.postMessage({
    type: PAGE_PROGRESS,
    requestId: message.requestId,
    phase: message.phase || '',
    message: message.message || '',
    progress: Number(message.progress) || 0,
  }, location.origin);
  return undefined;
});

notifyReady();
document.addEventListener('DOMContentLoaded', notifyReady, { once: true });
