'use strict';

const PAGE_REQUEST = 'collager-lastfm-extension-request';
const PAGE_RESPONSE = 'collager-lastfm-extension-response';
const PAGE_READY = 'collager-lastfm-extension-ready';
const PAGE_PROGRESS = 'collager-lastfm-extension-progress';
const PAGE_RESTORE_REQUEST = 'collager-lastfm-extension-restore-request';
const PAGE_RESTORE_RESPONSE = 'collager-lastfm-extension-restore-response';
const HISTORY_STORAGE_KEY = 'collager.fm.extension-history.v2';
const HISTORY_LIMIT = 60;
const ALLOWED_ORIGINS = new Set([
  'https://collagerfm.vercel.app',
  'http://127.0.0.1:8767',
  'http://localhost:8767',
]);
const ACTION_TITLES = {
  deleteScrobble: 'Scrobble excluído',
  deleteObsession: 'Obsessão excluída',
  setObsession: 'Obsessão atualizada',
};
const EXTENSION_ICON_PATH = 'M254.5 43.33C262.33 45.83 270.17 48.33 278 50.83C277.5 58.31 271.24 65.77 265.11 69.61C262.89 71.01 256.04 72.92 255 74.5C258.03 82.25 259.68 86.47 260.99 94.84C261.84 100.29 260.13 105.74 259.06 110.9C254.8 131.45 231.91 140.16 213.82 142.99C207 144.06 199 144.06 192.18 142.99C189.7 142.6 186.71 141.29 184.22 141.41C180.52 141.57 176.57 146.82 175.4 149.9C174.59 152 174.65 154.36 174.99 156.51C176.22 164.34 183.5 165.06 190.17 165.67C217.06 168.11 265.87 156.75 273.06 194.1C274.06 199.29 273.85 204.02 273.01 209.18C271.83 216.42 267.93 222.55 262.77 227.6C252.05 238.11 235.3 241.13 221.18 243.34C193.85 247.62 152.57 246.74 134.51 221.99C125.33 209.41 118.38 190.06 114.06 175.1C111.45 166.06 106.62 153.99 98.66 148.18C91.08 142.65 83.15 140.67 73.83 140.67C68.5 140.67 63.38 141.71 58.56 144.06C33.54 156.28 33.07 204.99 55.89 219.61C67.63 227.15 85.86 225.22 97.45 217.95C101.6 215.35 105.39 212.25 109.5 209.67C112.44 217.06 115.39 224.44 118.33 231.83C108.61 241.56 92.81 243.03 80.18 245.01C62.17 247.83 35.42 242.71 23.33 227.5C6.98 206.91 5.3 172.56 17.18 149.34C30.93 122.47 63.08 116.69 90.51 120.99C102.85 122.92 117.31 126.87 125.67 137.17C132.52 145.61 138.88 155.32 141.94 165.9C143.22 170.35 146.95 183.06 149.5 186.33C155.67 184.39 161.83 182.44 168 180.5C152.56 177.18 147.18 159.34 156.18 147.01C160.62 140.93 167.81 141.02 171 137.83C170.18 136.26 163.26 132.92 161.34 131.82C155.22 128.31 148.75 119.61 147.06 112.77C145.53 106.55 143.98 99.75 145.01 93.18C149.11 67 167.11 56.81 191.49 52.99C198.57 51.88 206.67 51.56 213.82 52.68C221.13 53.82 228.13 55.4 235.1 58.06C237.33 58.91 241.48 62.62 243.77 62.27C251.69 61.07 251.43 47.28 254.5 43.33ZM196.56 71.06C190.98 72.14 185.42 73.69 180.83 77.33C168.82 86.88 169.74 110.53 182.01 119.49C188.49 124.22 196.03 125.33 203.83 125.33C208.56 125.33 214.14 124.7 218.44 122.6C235.01 114.51 237.7 93.05 226.67 79.17C220.91 71.93 205.1 69.42 196.56 71.06ZM186.23 188.4C179.69 189.65 173 190.05 167.34 194.18C159.65 199.79 158.11 213.48 166.34 219.49C181 230.18 209.75 227.76 226.56 224.4C234.1 222.89 242.91 219.7 245.94 211.77C246.8 209.52 247 207.58 247 205.17C247 183.41 215.61 188.33 201.17 188.33C196.45 188.33 190.86 187.5 186.23 188.4Z';

const activeOperations = new Map();
const pendingRestores = new Map();
let historyEntries = [];
let historyIndex = 0;
let historyUi = null;

function isAllowedPage() {
  return ALLOWED_ORIGINS.has(location.origin);
}

if (isAllowedPage()) {
  try { localStorage.removeItem('collager.fm.extension-history.v1'); } catch (_) {}
}

function clean(value, maximum = 500) {
  return String(value || '').trim().slice(0, maximum);
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storageGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, result => resolve(result?.[key]));
  });
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

async function loadHistory() {
  const saved = await storageGet(HISTORY_STORAGE_KEY).catch(() => []);
  historyEntries = Array.isArray(saved) ? saved.slice(0, HISTORY_LIMIT) : [];
  renderHistory();
}

async function persistHistory() {
  await storageSet({ [HISTORY_STORAGE_KEY]: historyEntries.slice(0, HISTORY_LIMIT) }).catch(() => {});
}

function operationTarget(payload = {}) {
  const context = payload.historyContext || {};
  const edited = context.edited || {};
  const artist = clean(edited.artist || payload.artist);
  const track = clean(edited.track || payload.track);
  return artist && track ? `${artist} — ${track}` : track || clean(payload.username);
}

function buildHistoryEntry(operation, ok, result = {}, error = '') {
  const payload = operation.payload || {};
  const context = payload.historyContext || {};
  const metadataEdit = context.kind === 'metadataEdit';
  const title = metadataEdit
    ? (ok ? 'Edição salva' : 'Edição incompleta')
    : (ACTION_TITLES[operation.action] || 'Ação da extensão');
  const message = ok
    ? (
        metadataEdit
          ? 'O scrobble corrigido foi salvo e o registro original foi removido.'
          : (operation.events.at(-1) || `${title} com sucesso.`)
      )
    : clean(error || 'A extensão não concluiu esta ação.');
  return {
    id: randomId(),
    timestamp: Date.now(),
    action: metadataEdit ? 'metadataEdit' : operation.action,
    title,
    target: operationTarget(payload),
    message,
    ok: Boolean(ok),
    events: operation.events.slice(-8),
    payload: metadataEdit
      ? {
          username: clean(payload.username, 100),
          original: context.original || {},
          edited: context.edited || {},
        }
      : {
          username: clean(payload.username, 100),
          artist: clean(payload.artist),
          track: clean(payload.track),
          album: clean(payload.album),
          timestamp: Math.floor(Number(payload.timestamp) || 0),
        },
    result: result || {},
    restoredAt: 0,
  };
}

async function addHistoryEntry(entry) {
  historyEntries.unshift(entry);
  historyEntries = historyEntries.slice(0, HISTORY_LIMIT);
  historyIndex = 0;
  await persistHistory();
  renderHistory();
}

function canRestoreEntry(entry) {
  if (!entry?.ok || entry.action !== 'deleteScrobble' || entry.restoredAt) return false;
  const timestamp = Math.floor(Number(entry.payload?.timestamp));
  const age = Math.floor(Date.now() / 1000) - timestamp;
  return timestamp > 0 && age >= -300 && age <= 14 * 24 * 60 * 60;
}

function formatDate(timestamp) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(timestamp));
  } catch (_) {
    return '';
  }
}

function renderHistory() {
  if (!historyUi) return;
  const total = historyEntries.length;
  historyIndex = total ? Math.max(0, Math.min(historyIndex, total - 1)) : 0;
  const entry = total ? historyEntries[historyIndex] : null;
  historyUi.empty.hidden = Boolean(entry);
  historyUi.content.hidden = !entry;
  historyUi.title.textContent = entry?.title || 'Nenhuma ação registrada';
  historyUi.position.textContent = total ? `${historyIndex + 1} de ${total}` : '0 de 0';
  historyUi.older.disabled = !entry || historyIndex >= total - 1;
  historyUi.newer.disabled = !entry || historyIndex <= 0;
  historyUi.clear.disabled = !total;
  if (!entry) return;
  historyUi.time.textContent = formatDate(entry.timestamp);
  historyUi.target.textContent = entry.target || '';
  historyUi.target.hidden = !entry.target;
  historyUi.message.textContent = entry.restoredAt
    ? 'Este scrobble foi recolocado no Last.fm.'
    : entry.message;
  historyUi.events.innerHTML = '';
  (entry.events || []).forEach(text => {
    const row = document.createElement('div');
    row.className = 'event';
    row.textContent = text;
    historyUi.events.appendChild(row);
  });
  historyUi.restore.hidden = !canRestoreEntry(entry);
  historyUi.restore.disabled = pendingRestores.has(entry.id);
  historyUi.restore.textContent = pendingRestores.has(entry.id)
    ? 'RECOLOCANDO...'
    : 'RECOLOCAR SCROBBLE';
}

function mountHistoryUi() {
  if (!isAllowedPage() || historyUi || !document.documentElement) return;
  const host = document.createElement('div');
  host.id = 'collager-extension-history-root';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      button { font: inherit; }
      .launcher {
        position: fixed; top: 1rem; right: 1rem; z-index: 2147483645;
        width: 2.75rem; height: 2.75rem; display: grid; place-items: center;
        padding: 0; border: 1px solid #ef4444; border-radius: 50%;
        background: #ef444426; color: #fff; box-shadow: 0 .6rem 1.7rem #0009;
        cursor: pointer;
      }
      .launcher svg { width: 1.45rem; height: 1.45rem; fill: currentColor; }
      .panel {
        position: fixed; top: 4.25rem; right: 1rem; z-index: 2147483646;
        width: min(23rem, calc(100vw - 2rem)); display: none; overflow: hidden;
        border: 1px solid #ffffff24; border-radius: 8px; background: #171717fa;
        color: #e8e8e8; box-shadow: 0 1rem 3rem #000d;
        font: 500 .75rem/1.45 Inter, system-ui, sans-serif;
      }
      .panel.open { display: block; }
      .head, .nav { display: flex; align-items: center; gap: .55rem; }
      .head { padding: .75rem; border-bottom: 1px solid #ffffff12; }
      .badge {
        width: 1.9rem; height: 1.9rem; flex: 0 0 1.9rem; display: grid;
        place-items: center; border: 1px solid #ef4444; border-radius: 50%;
        background: #ef444426; color: #fff;
      }
      .badge svg { width: 1rem; height: 1rem; fill: currentColor; }
      .heading { min-width: 0; flex: 1; }
      .heading small { display: block; color: #888; font-size: .56rem; font-weight: 800; text-transform: uppercase; }
      .title { display: block; overflow: hidden; color: #fff; font-size: .78rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
      .icon {
        width: 2rem; height: 2rem; flex: 0 0 2rem; display: grid; place-items: center;
        padding: 0; border: 1px solid #ffffff18; border-radius: 6px;
        background: #ffffff08; color: #aaa; cursor: pointer;
      }
      .icon:disabled { opacity: .3; cursor: default; }
      .icon svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .body { padding: .8rem; }
      .empty { padding: 1.2rem .5rem; color: #888; text-align: center; }
      .time { color: #777; font-size: .58rem; }
      .target { margin-top: .45rem; color: #ddd; font-size: .68rem; font-weight: 700; }
      .message { margin-top: .55rem; color: #fff; font-size: .7rem; }
      .events { display: flex; flex-direction: column; gap: .25rem; margin-top: .65rem; color: #8c8c8c; font-size: .64rem; }
      .event::before { content: '•'; margin-right: .35rem; color: #ef4444; }
      .restore {
        width: 100%; margin-top: .8rem; padding: .65rem; border: 1px solid #22c55e88;
        border-radius: 6px; background: #123d24; color: #8af0ad;
        font-size: .68rem; font-weight: 800; cursor: pointer;
      }
      .nav { justify-content: space-between; padding: .65rem .8rem; border-top: 1px solid #ffffff12; }
      .position { min-width: 4rem; color: #888; font-size: .62rem; text-align: center; }
      .clear { color: #ff8f98; }
      @media (max-width: 47.999rem) {
        .launcher { top: auto; right: .75rem; bottom: calc(5.2rem + env(safe-area-inset-bottom, 0px)); }
        .panel {
          top: 50%; right: .75rem; left: .75rem; width: auto;
          max-height: calc(100dvh - 8rem); transform: translateY(-50%);
        }
      }
    </style>
    <button class="launcher" type="button" aria-label="Abrir histórico da extensão" title="Histórico da extensão" aria-expanded="false">
      <svg viewBox="0 0 294 294" aria-hidden="true"><path d="${EXTENSION_ICON_PATH}"/></svg>
    </button>
    <section class="panel" role="dialog" aria-modal="false" aria-hidden="true">
      <div class="head">
        <span class="badge" aria-hidden="true"><svg viewBox="0 0 294 294"><path d="${EXTENSION_ICON_PATH}"/></svg></span>
        <div class="heading"><small>Histórico da extensão</small><strong class="title">Nenhuma ação registrada</strong></div>
        <button class="icon clear" type="button" aria-label="Excluir histórico" title="Excluir histórico">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>
        </button>
        <button class="icon close" type="button" aria-label="Fechar" title="Fechar">
          <svg viewBox="0 0 24 24"><path d="m18 6-12 12M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="body">
        <div class="empty">A extensão ainda não registrou nenhuma ação.</div>
        <div class="content" hidden>
          <div class="time"></div><div class="target"></div><div class="message"></div><div class="events"></div>
          <button class="restore" type="button" hidden>RECOLOCAR SCROBBLE</button>
        </div>
      </div>
      <div class="nav">
        <button class="icon older" type="button" aria-label="Ação anterior"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
        <span class="position">0 de 0</span>
        <button class="icon newer" type="button" aria-label="Ação seguinte"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </section>`;
  document.documentElement.appendChild(host);
  const find = selector => root.querySelector(selector);
  historyUi = {
    host,
    launcher: find('.launcher'),
    panel: find('.panel'),
    title: find('.title'),
    clear: find('.clear'),
    close: find('.close'),
    empty: find('.empty'),
    content: find('.content'),
    time: find('.time'),
    target: find('.target'),
    message: find('.message'),
    events: find('.events'),
    restore: find('.restore'),
    older: find('.older'),
    newer: find('.newer'),
    position: find('.position'),
  };
  historyUi.launcher.addEventListener('click', () => {
    const open = !historyUi.panel.classList.contains('open');
    historyUi.panel.classList.toggle('open', open);
    historyUi.panel.setAttribute('aria-hidden', String(!open));
    historyUi.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      historyIndex = 0;
      renderHistory();
    }
  });
  historyUi.close.addEventListener('click', () => {
    historyUi.panel.classList.remove('open');
    historyUi.panel.setAttribute('aria-hidden', 'true');
    historyUi.launcher.setAttribute('aria-expanded', 'false');
  });
  historyUi.older.addEventListener('click', () => {
    if (historyIndex < historyEntries.length - 1) historyIndex += 1;
    renderHistory();
  });
  historyUi.newer.addEventListener('click', () => {
    if (historyIndex > 0) historyIndex -= 1;
    renderHistory();
  });
  historyUi.clear.addEventListener('click', async () => {
    if (!historyEntries.length || !window.confirm('Deseja excluir todo o histórico da extensão?')) return;
    historyEntries = [];
    historyIndex = 0;
    await persistHistory();
    renderHistory();
  });
  historyUi.restore.addEventListener('click', () => {
    const entry = historyEntries[historyIndex];
    if (!canRestoreEntry(entry) || pendingRestores.has(entry.id)) return;
    if (!window.confirm('Recolocar este scrobble no Last.fm com os dados e horário originais?')) return;
    const requestId = randomId();
    pendingRestores.set(entry.id, requestId);
    renderHistory();
    window.postMessage({
      type: PAGE_RESTORE_REQUEST,
      requestId,
      entryId: entry.id,
      scrobble: entry.payload,
    }, location.origin);
  });
  loadHistory();
}

function notifyReady() {
  if (!isAllowedPage()) return;
  window.postMessage({ type: PAGE_READY, version: chrome.runtime.getManifest().version }, location.origin);
}

window.addEventListener('message', event => {
  if (!isAllowedPage() || event.source !== window || event.origin !== location.origin) return;

  if (event.data?.type === PAGE_RESTORE_RESPONSE) {
    const entry = historyEntries.find(candidate => candidate.id === event.data.entryId);
    if (!entry) return;
    pendingRestores.delete(entry.id);
    if (event.data.ok) {
      entry.restoredAt = Date.now();
      entry.events = [...(entry.events || []), 'Scrobble recolocado com sucesso.'];
      persistHistory();
    } else {
      entry.events = [...(entry.events || []), clean(event.data.error || 'Não foi possível recolocar o scrobble.')];
    }
    renderHistory();
    return;
  }

  if (event.data?.type !== PAGE_REQUEST || typeof event.data.requestId !== 'string') return;
  const requestId = event.data.requestId;
  const action = event.data.action;
  if (action !== 'ping' && action !== 'deleteScrobble' && action !== 'deleteObsession' && action !== 'setObsession') return;
  const operation = {
    action,
    payload: event.data.payload || {},
    events: [],
  };
  if (action !== 'ping') activeOperations.set(requestId, operation);

  chrome.runtime.sendMessage({
    channel: 'collager-lastfm',
    requestId,
    action,
    payload: operation.payload,
  })
    .then(result => {
      if (result?.__error) {
        if (action !== 'ping') {
          addHistoryEntry(buildHistoryEntry(operation, false, {}, result.__error));
          activeOperations.delete(requestId);
        }
        window.postMessage({
          type: PAGE_RESPONSE,
          requestId,
          ok: false,
          error: result.__error,
          openUrl: result.__openUrl || '',
        }, location.origin);
        return;
      }
      if (action !== 'ping') {
        addHistoryEntry(buildHistoryEntry(operation, true, result));
        activeOperations.delete(requestId);
      }
      window.postMessage({ type: PAGE_RESPONSE, requestId, ok: true, result }, location.origin);
    })
    .catch(error => {
      if (action !== 'ping') {
        addHistoryEntry(buildHistoryEntry(operation, false, {}, error?.message));
        activeOperations.delete(requestId);
      }
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
  const operation = activeOperations.get(message.requestId);
  const progressMessage = clean(message.message);
  if (operation && progressMessage && operation.events.at(-1) !== progressMessage) {
    operation.events.push(progressMessage);
  }
  window.postMessage({
    type: PAGE_PROGRESS,
    requestId: message.requestId,
    phase: message.phase || '',
    message: progressMessage,
    progress: Number(message.progress) || 0,
  }, location.origin);
  return undefined;
});

mountHistoryUi();
document.addEventListener('DOMContentLoaded', mountHistoryUi, { once: true });
notifyReady();
document.addEventListener('DOMContentLoaded', notifyReady, { once: true });
