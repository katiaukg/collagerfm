'use strict';

const PAGE_REQUEST = 'collager-lastfm-extension-request';
const PAGE_RESPONSE = 'collager-lastfm-extension-response';
const PAGE_READY = 'collager-lastfm-extension-ready';
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
  if (action !== 'ping' && action !== 'deleteScrobble' && action !== 'deleteObsession') return;

  chrome.runtime.sendMessage({ channel: 'collager-lastfm', action, payload: event.data.payload || {} })
    .then(result => {
      if (result?.__error) throw new Error(result.__error);
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

notifyReady();
document.addEventListener('DOMContentLoaded', notifyReady, { once: true });
