'use strict';

const PAGE_REQUEST = 'collager-lastfm-extension-request';
const PAGE_RESPONSE = 'collager-lastfm-extension-response';
const PAGE_READY = 'collager-lastfm-extension-ready';
const PAGE_PROGRESS = 'collager-lastfm-extension-progress';
const PAGE_RESTORE_REQUEST = 'collager-lastfm-extension-restore-request';
const PAGE_RESTORE_RESPONSE = 'collager-lastfm-extension-restore-response';
const PAGE_RULES_REQUEST = 'collager-lastfm-metadata-rules-request';
const PAGE_RULES_SYNC = 'collager-lastfm-metadata-rules-sync';
const PAGE_RULE_TOGGLE_REQUEST = 'collager-lastfm-metadata-rule-toggle-request';
const PAGE_RULE_TOGGLE_RESPONSE = 'collager-lastfm-metadata-rule-toggle-response';
const PAGE_RULE_DELETE_REQUEST = 'collager-lastfm-metadata-rule-delete-request';
const PAGE_RULE_DELETE_RESPONSE = 'collager-lastfm-metadata-rule-delete-response';
const HISTORY_STORAGE_KEY = 'collager.fm.extension-history.v2';
const RULES_STORAGE_KEY = 'collager.fm.metadata-rules.v1';
const HISTORY_LIMIT = 60;
const COMPACT_RULES_PER_PAGE = 2;
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
let metadataRules = [];
let metadataRulesLoaded = false;
let pendingMetadataRulesSync = null;
let historyView = 'history';
const pendingRuleToggles = new Map();
const pendingRuleDeletes = new Map();
const ruleSectionPages = { changed: 0, deleted: 0 };
let historyPanelPositionFrame = 0;

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

async function loadMetadataRules() {
  const saved = await storageGet(RULES_STORAGE_KEY).catch(() => []);
  metadataRules = Array.isArray(pendingMetadataRulesSync)
    ? pendingMetadataRulesSync
    : (Array.isArray(saved) ? saved : []);
  pendingMetadataRulesSync = null;
  metadataRulesLoaded = true;
  await persistMetadataRules();
  renderRuleSettings();
}

async function persistHistory() {
  await storageSet({ [HISTORY_STORAGE_KEY]: historyEntries.slice(0, HISTORY_LIMIT) }).catch(() => {});
}

async function persistMetadataRules() {
  await storageSet({ [RULES_STORAGE_KEY]: metadataRules }).catch(() => {});
}

function operationTarget(payload = {}) {
  const context = payload.historyContext || {};
  const original = context.original || payload.original || {};
  const edited = context.edited || payload.edited || {};
  const originalArtist = clean(original.artist || payload.artist);
  const originalTrack = clean(original.track || payload.track);
  const editedArtist = clean(edited.artist);
  const editedTrack = clean(edited.track);
  const before = originalArtist && originalTrack
    ? `${originalArtist} — ${originalTrack}`
    : originalTrack || originalArtist;
  const after = editedArtist && editedTrack
    ? `${editedArtist} — ${editedTrack}`
    : editedTrack || editedArtist;
  if (before && after && before !== after) return `${before} → ${after}`;
  return after || before || clean(payload.username);
}

function buildHistoryEntry(operation, ok, result = {}, error = '') {
  const payload = operation.payload || {};
  const context = payload.historyContext || {};
  const metadataEdit = context.kind === 'metadataEdit'
    || context.kind === 'automaticMetadataEdit';
  const automaticMetadataEdit = context.kind === 'automaticMetadataEdit';
  const title = metadataEdit
    ? (
        automaticMetadataEdit
          ? (ok ? 'Correção automática aplicada' : 'Correção automática incompleta')
          : (ok ? 'Edição salva' : 'Edição incompleta')
      )
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
  if (historyView === 'history') {
    historyUi.title.textContent = entry?.title || 'Nenhuma ação registrada';
  }
  historyUi.position.textContent = total ? `${historyIndex + 1} de ${total}` : '0 de 0';
  historyUi.older.disabled = !entry || historyIndex >= total - 1;
  historyUi.newer.disabled = !entry || historyIndex <= 0;
  historyUi.clear.disabled = !total;
  if (!entry) {
    scheduleHistoryPanelPosition();
    return;
  }
  historyUi.time.textContent = formatDate(entry.timestamp);
  const currentTarget = operationTarget(entry.payload) || entry.target || '';
  historyUi.target.textContent = currentTarget;
  historyUi.target.hidden = !currentTarget;
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
  scheduleHistoryPanelPosition();
}

function metadataRuleLabel(rule) {
  const source = rule?.original || rule?.edited || {};
  const artist = clean(source.artist);
  const track = clean(source.track);
  return artist && track ? `${artist} — ${track}` : track || artist || 'Metadata sem nome';
}

function metadataRuleAlbum(rule) {
  return clean(rule?.original?.album || rule?.edited?.album);
}

function metadataRuleEditDescription(rule) {
  const original = rule?.original || {};
  const edited = rule?.edited || {};
  const before = [original.artist, original.track, original.album].map(value => clean(value)).join(' · ');
  const after = [edited.artist, edited.track, edited.album].map(value => clean(value)).join(' · ');
  return before && after && before !== after ? `${before} → ${after}` : after || before;
}

function metadataRuleHasCorrection(rule) {
  const original = rule?.original || {};
  const edited = rule?.edited || {};
  return ['artist', 'track', 'album'].some(field =>
    clean(original[field]).toLocaleLowerCase() !== clean(edited[field]).toLocaleLowerCase()
  );
}

function metadataRuleActivation(rule, field) {
  const activatedAt = field === 'deleteFutureScrobbles'
    ? Number(rule?.deleteFutureStartedAt || rule?.createdAt || 0)
    : Number(rule?.createdAt || 0);
  if (!activatedAt) return '';
  try {
    return `Ativa desde ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(activatedAt))}`;
  } catch (_) {
    return '';
  }
}

function buildRuleRow(rule, field, description) {
  const row = document.createElement('div');
  row.className = 'rule-row';
  const copy = document.createElement('span');
  copy.className = 'rule-copy';
  const title = document.createElement('strong');
  title.textContent = metadataRuleLabel(rule);
  const detail = document.createElement('span');
  detail.textContent = description(rule);
  const album = metadataRuleAlbum(rule);
  const activation = metadataRuleActivation(rule, field);
  const meta = document.createElement('small');
  meta.textContent = [album ? `Álbum: ${album}` : '', activation].filter(Boolean).join(' · ');
  copy.append(title, detail);
  if (meta.textContent) copy.append(meta);
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = Boolean(rule?.[field]);
  toggle.disabled = pendingRuleToggles.has(`${rule.key}|${field}`);
  toggle.dataset.key = rule.key;
  toggle.dataset.field = field;
  toggle.setAttribute('aria-label', `Ativar ou desativar ${metadataRuleLabel(rule)}`);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'rule-remove';
  remove.dataset.key = rule.key;
  remove.dataset.field = field;
  remove.disabled = pendingRuleDeletes.has(`${rule.key}|${field}`);
  remove.setAttribute('aria-label', `Excluir operação de ${metadataRuleLabel(rule)}`);
  remove.title = 'Excluir operação';
  remove.textContent = '×';
  const controls = document.createElement('span');
  controls.className = 'rule-controls';
  controls.append(toggle, remove);
  row.append(copy, controls);
  return row;
}

function renderRuleSection(container, pagination, rules, field, emptyMessage, description, sectionKey) {
  container.innerHTML = '';
  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'rules-empty';
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    pagination.hidden = true;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(rules.length / COMPACT_RULES_PER_PAGE));
  const page = Math.max(0, Math.min(ruleSectionPages[sectionKey] || 0, totalPages - 1));
  ruleSectionPages[sectionKey] = page;
  const start = page * COMPACT_RULES_PER_PAGE;
  rules.slice(start, start + COMPACT_RULES_PER_PAGE)
    .forEach(rule => container.appendChild(buildRuleRow(rule, field, description)));
  pagination.hidden = totalPages <= 1;
  pagination.querySelector('.rule-page-position').textContent = `${page + 1} de ${totalPages}`;
  pagination.querySelector('[data-rule-page="-1"]').disabled = page <= 0;
  pagination.querySelector('[data-rule-page="1"]').disabled = page >= totalPages - 1;
  pagination.dataset.section = sectionKey;
}

function renderRuleSettings() {
  if (!historyUi?.changedRules || !historyUi?.deletedRules) return;
  const now = Date.now();
  metadataRules = metadataRules.filter(rule => !Number(rule?.expiresAt) || Number(rule.expiresAt) > now);
  const changed = metadataRules.filter(rule => rule?.correctionConfigured && metadataRuleHasCorrection(rule));
  const deleted = metadataRules.filter(rule => rule?.deletionConfigured);
  renderRuleSection(
    historyUi.changedRules,
    historyUi.changedPagination,
    changed,
    'applyMetadataCorrection',
    'Nenhuma correção automática foi configurada.',
    metadataRuleEditDescription,
    'changed'
  );
  renderRuleSection(
    historyUi.deletedRules,
    historyUi.deletedPagination,
    deleted,
    'deleteFutureScrobbles',
    'Nenhuma exclusão automática foi configurada.',
    rule => `Mesmo metadata de ${metadataRuleLabel(rule)}`,
    'deleted'
  );
  scheduleHistoryPanelPosition();
}

function setHistoryView(view) {
  if (!historyUi) return;
  historyView = view === 'rules' ? 'rules' : 'history';
  const rulesOpen = historyView === 'rules';
  historyUi.historyView.hidden = rulesOpen;
  historyUi.rulesView.hidden = !rulesOpen;
  historyUi.nav.hidden = rulesOpen;
  historyUi.clear.hidden = rulesOpen;
  historyUi.settings.classList.toggle('active', rulesOpen);
  if (rulesOpen) {
    historyUi.kicker.textContent = 'Configurações da extensão';
    historyUi.title.textContent = 'Regras automáticas';
    renderRuleSettings();
    window.postMessage({ type: PAGE_RULES_REQUEST }, location.origin);
  } else {
    historyUi.kicker.textContent = 'Histórico da extensão';
    renderHistory();
  }
  scheduleHistoryPanelPosition();
}

function requestRuleToggle(key, field, enabled) {
  const pendingKey = `${key}|${field}`;
  if (!key || pendingRuleToggles.has(pendingKey)) return false;
  const requestId = randomId();
  pendingRuleToggles.set(pendingKey, requestId);
  const rule = metadataRules.find(candidate => candidate.key === key);
  if (!rule) {
    pendingRuleToggles.delete(pendingKey);
    return false;
  }
  if (rule) rule[field] = Boolean(enabled);
  renderRuleSettings();
  window.postMessage({
    type: PAGE_RULE_TOGGLE_REQUEST,
    requestId,
    key,
    field,
    enabled: Boolean(enabled),
  }, location.origin);
  return true;
}

function requestRuleDelete(key, field, confirmUser = true) {
  const pendingKey = `${key}|${field}`;
  if (!key || pendingRuleDeletes.has(pendingKey)) return false;
  const rule = metadataRules.find(candidate => candidate.key === key);
  if (!rule) return false;
  const operation = field === 'applyMetadataCorrection' ? 'alteração automática' : 'exclusão automática';
  if (confirmUser && !window.confirm(`Deseja excluir a operação de ${operation} para ${metadataRuleLabel(rule)}?`)) {
    return false;
  }
  const requestId = randomId();
  pendingRuleDeletes.set(pendingKey, requestId);
  renderRuleSettings();
  window.postMessage({
    type: PAGE_RULE_DELETE_REQUEST,
    requestId,
    key,
    field,
  }, location.origin);
  return true;
}

function historyVisibleViewport() {
  const viewport = window.visualViewport;
  const left = Number(viewport?.offsetLeft || 0);
  const top = Number(viewport?.offsetTop || 0);
  const width = Math.max(1, Number(viewport?.width || innerWidth || 1));
  const height = Math.max(1, Number(viewport?.height || innerHeight || 1));
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

function clampHistoryLauncher(ui = historyUi) {
  if (!ui?.launcher) return;
  const launcher = ui.launcher;
  const viewport = historyVisibleViewport();
  const rect = launcher.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(rect.width || launcher.offsetWidth || 44, Math.max(1, viewport.width - margin * 2));
  const height = Math.min(rect.height || launcher.offsetHeight || 44, Math.max(1, viewport.height - margin * 2));
  const left = Math.max(
    viewport.left + margin,
    Math.min(viewport.right - width - margin, rect.left),
  );
  const top = Math.max(
    viewport.top + margin,
    Math.min(viewport.bottom - height - margin, rect.top),
  );

  launcher.style.left = `${left}px`;
  launcher.style.top = `${top}px`;
  launcher.style.right = 'auto';
  launcher.style.bottom = 'auto';
}

function positionHistoryPanel(ui = historyUi) {
  if (!ui?.launcher) return;
  clampHistoryLauncher(ui);
  if (!ui.panel?.classList.contains('open')) return;
  const panel = ui.panel;
  const viewport = historyVisibleViewport();
  const launcherRect = ui.launcher.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 8;
  const gap = 10;
  const panelWidth = Math.min(panelRect.width, Math.max(0, viewport.width - margin * 2));
  const panelHeight = Math.min(panelRect.height, Math.max(0, viewport.height - margin * 2));
  panel.style.maxWidth = `${Math.max(0, viewport.width - margin * 2)}px`;
  panel.style.maxHeight = `${Math.max(0, viewport.height - margin * 2)}px`;
  const candidates = [
    {
      placement: 'bottom-left',
      left: launcherRect.right - panelWidth,
      top: launcherRect.bottom + gap,
    },
    {
      placement: 'top-left',
      left: launcherRect.right - panelWidth,
      top: launcherRect.top - gap - panelHeight,
    },
    {
      placement: 'top-right',
      left: launcherRect.left,
      top: launcherRect.top - gap - panelHeight,
    },
    {
      placement: 'bottom-right',
      left: launcherRect.left,
      top: launcherRect.bottom + gap,
    },
  ];
  const fits = candidate =>
    candidate.left >= viewport.left + margin
    && candidate.top >= viewport.top + margin
    && candidate.left + panelWidth <= viewport.right - margin
    && candidate.top + panelHeight <= viewport.bottom - margin;
  const overflow = candidate =>
    Math.max(0, viewport.left + margin - candidate.left)
    + Math.max(0, viewport.top + margin - candidate.top)
    + Math.max(0, candidate.left + panelWidth - (viewport.right - margin))
    + Math.max(0, candidate.top + panelHeight - (viewport.bottom - margin));
  const selected = candidates.find(fits)
    || candidates.reduce((best, candidate) => overflow(candidate) < overflow(best) ? candidate : best);
  const minLeft = viewport.left + margin;
  const minTop = viewport.top + margin;
  const maxLeft = Math.max(minLeft, viewport.right - panelWidth - margin);
  const maxTop = Math.max(minTop, viewport.bottom - panelHeight - margin);

  panel.style.left = `${Math.max(minLeft, Math.min(maxLeft, selected.left))}px`;
  panel.style.top = `${Math.max(minTop, Math.min(maxTop, selected.top))}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  panel.dataset.placement = selected.placement;
}

function scheduleHistoryPanelPosition(ui = historyUi) {
  if (!ui?.launcher) return;
  cancelAnimationFrame(historyPanelPositionFrame);
  historyPanelPositionFrame = requestAnimationFrame(() => {
    historyPanelPositionFrame = 0;
    positionHistoryPanel(ui);
  });
}

function installLauncherDrag(ui) {
  let drag = null;
  let suppressClick = false;
  const launcher = ui.launcher;

  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    launcher.setPointerCapture(event.pointerId);
  });

  launcher.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.moved = true;
    launcher.classList.add('dragging');
    const width = launcher.offsetWidth || 44;
    const height = launcher.offsetHeight || 44;
    const viewport = historyVisibleViewport();
    const left = Math.max(
      viewport.left + 8,
      Math.min(viewport.right - width - 8, drag.left + deltaX),
    );
    const top = Math.max(
      viewport.top + 8,
      Math.min(viewport.bottom - height - 8, drag.top + deltaY),
    );
    launcher.style.left = `${left}px`;
    launcher.style.top = `${top}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
    scheduleHistoryPanelPosition(ui);
    event.preventDefault();
  });

  const finish = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    suppressClick = drag.moved;
    launcher.classList.remove('dragging');
    if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
    drag = null;
    scheduleHistoryPanelPosition(ui);
    setTimeout(() => { suppressClick = false; }, 0);
  };
  launcher.addEventListener('pointerup', finish);
  launcher.addEventListener('pointercancel', finish);
  return () => suppressClick;
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
        cursor: grab; touch-action: none; user-select: none;
      }
      .launcher.dragging { cursor: grabbing; }
      .launcher svg { width: 1.45rem; height: 1.45rem; fill: currentColor; }
      .panel {
        position: fixed; top: 0; left: 0; z-index: 2147483646;
        width: min(23rem, calc(100vw - 2rem)); display: none; overflow: hidden;
        max-height: calc(100dvh - 1rem);
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
      .icon.active { border-color: #ef444488; background: #ef444420; color: #fff; }
      .icon svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .icon[hidden], .history-view[hidden], .rules-view[hidden], .nav[hidden] { display: none !important; }
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
      .rules-view { max-height: min(67vh, 34rem); overflow: auto; padding: .8rem; }
      .rules-section + .rules-section { margin-top: 1rem; }
      .rules-section h3 {
        margin: 0 0 .5rem; color: #fff; font-size: .65rem;
        letter-spacing: .04em; text-transform: uppercase;
      }
      .rules-list { display: flex; flex-direction: column; gap: .45rem; }
      .rule-row {
        display: flex; align-items: center; justify-content: space-between; gap: .7rem;
        padding: .65rem; border: 1px solid #ffffff14; border-radius: 6px;
        background: #ffffff05;
      }
      .rule-copy { min-width: 0; display: flex; flex-direction: column; gap: .12rem; }
      .rule-copy strong { overflow-wrap: anywhere; color: #fff; font-size: .68rem; }
      .rule-copy > span { overflow-wrap: anywhere; color: #aaa; font-size: .61rem; }
      .rule-copy small { color: #777; font-size: .55rem; }
      .rule-controls {
        flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: .35rem;
      }
      .rule-row input {
        width: 1rem; height: 1rem; flex: 0 0 1rem; margin: 0;
        accent-color: #22c55e; cursor: pointer;
      }
      .rule-remove {
        width: 1.25rem; height: 1.25rem; display: grid; place-items: center;
        padding: 0; border: 1px solid #ef444466; border-radius: 4px;
        background: #ef444414; color: #ff8f98; font-size: 1rem; line-height: 1;
        cursor: pointer;
      }
      .rule-remove:disabled { opacity: .35; cursor: default; }
      .rule-pagination {
        display: flex; align-items: center; justify-content: center; gap: .5rem;
        padding-top: .5rem;
      }
      .rule-pagination[hidden] { display: none !important; }
      .rule-page-button {
        width: 1.65rem; height: 1.65rem; display: grid; place-items: center;
        padding: 0; border: 1px solid #ffffff18; border-radius: 5px;
        background: #ffffff08; color: #bbb; cursor: pointer;
      }
      .rule-page-button:disabled { opacity: .25; cursor: default; }
      .rule-page-position { min-width: 3.2rem; color: #888; font-size: .58rem; text-align: center; }
      .rule-page-button svg {
        width: .85rem; height: .85rem; fill: none; stroke: currentColor;
        stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
      }
      .rules-empty {
        padding: .75rem; border: 1px dashed #ffffff16; border-radius: 6px;
        color: #777; font-size: .62rem; text-align: center;
      }
      @media (max-width: 47.999rem) {
        .launcher {
          top: auto; right: auto; left: .75rem;
          bottom: calc(5.2rem + env(safe-area-inset-bottom, 0px));
        }
        .panel {
          width: min(23rem, calc(100vw - 1.5rem));
          max-height: calc(100dvh - 1rem);
        }
      }
    </style>
    <button class="launcher" type="button" aria-label="Abrir histórico da extensão" title="Histórico da extensão" aria-expanded="false">
      <svg viewBox="0 0 294 294" aria-hidden="true"><path d="${EXTENSION_ICON_PATH}"/></svg>
    </button>
    <section class="panel" role="dialog" aria-modal="false" aria-hidden="true">
      <div class="head">
        <span class="badge" aria-hidden="true"><svg viewBox="0 0 294 294"><path d="${EXTENSION_ICON_PATH}"/></svg></span>
        <div class="heading"><small class="kicker">Histórico da extensão</small><strong class="title">Nenhuma ação registrada</strong></div>
        <button class="icon open-full" type="button" aria-label="Abrir visão completa" title="Abrir visão completa">
          <svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>
        </button>
        <button class="icon clear" type="button" aria-label="Excluir histórico" title="Excluir histórico">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>
        </button>
        <button class="icon settings" type="button" aria-label="Gerenciar regras automáticas" title="Gerenciar regras automáticas">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.38.35.72.66 1 .3.27.68.4 1.08.4H21v4h-.09c-.4 0-.78.13-1.08.4-.3.28-.52.62-.65 1Z"/></svg>
        </button>
        <button class="icon close" type="button" aria-label="Fechar" title="Fechar">
          <svg viewBox="0 0 24 24"><path d="m18 6-12 12M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="history-view">
        <div class="body">
          <div class="empty">A extensão ainda não registrou nenhuma ação.</div>
          <div class="content" hidden>
            <div class="time"></div><div class="target"></div><div class="message"></div><div class="events"></div>
            <button class="restore" type="button" hidden>RECOLOCAR SCROBBLE</button>
          </div>
        </div>
      </div>
      <div class="rules-view" hidden>
        <section class="rules-section">
          <h3>Alterados</h3>
          <div class="rules-list changed-rules"></div>
          <div class="rule-pagination changed-pagination" hidden>
            <button class="rule-page-button" type="button" data-rule-page="-1" aria-label="Página anterior"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
            <span class="rule-page-position">1 de 1</span>
            <button class="rule-page-button" type="button" data-rule-page="1" aria-label="Próxima página"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
          </div>
        </section>
        <section class="rules-section">
          <h3>Apagados</h3>
          <div class="rules-list deleted-rules"></div>
          <div class="rule-pagination deleted-pagination" hidden>
            <button class="rule-page-button" type="button" data-rule-page="-1" aria-label="Página anterior"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
            <span class="rule-page-position">1 de 1</span>
            <button class="rule-page-button" type="button" data-rule-page="1" aria-label="Próxima página"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
          </div>
        </section>
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
    kicker: find('.kicker'),
    title: find('.title'),
    openFull: find('.open-full'),
    settings: find('.settings'),
    clear: find('.clear'),
    close: find('.close'),
    historyView: find('.history-view'),
    rulesView: find('.rules-view'),
    changedRules: find('.changed-rules'),
    deletedRules: find('.deleted-rules'),
    changedPagination: find('.changed-pagination'),
    deletedPagination: find('.deleted-pagination'),
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
    nav: find('.nav'),
  };
  const launcherWasDragged = installLauncherDrag(historyUi);
  historyUi.launcher.addEventListener('click', () => {
    if (launcherWasDragged()) return;
    const open = !historyUi.panel.classList.contains('open');
    historyUi.panel.classList.toggle('open', open);
    historyUi.panel.setAttribute('aria-hidden', String(!open));
    historyUi.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      historyIndex = 0;
      setHistoryView('history');
      renderHistory();
      scheduleHistoryPanelPosition(historyUi);
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
  historyUi.settings.addEventListener('click', () => {
    setHistoryView(historyView === 'rules' ? 'history' : 'rules');
  });
  historyUi.openFull.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      channel: 'collager-lastfm',
      action: 'openHistory',
      requestId: randomId(),
    }, response => {
      if (!chrome.runtime.lastError && response?.opened) return;
      window.open(chrome.runtime.getURL('history.html'), '_blank', 'noopener');
    });
  });
  historyUi.rulesView.addEventListener('change', event => {
    const toggle = event.target.closest('input[data-key][data-field]');
    if (!toggle) return;
    requestRuleToggle(toggle.dataset.key, toggle.dataset.field, toggle.checked);
  });
  historyUi.rulesView.addEventListener('click', event => {
    const remove = event.target.closest('.rule-remove[data-key][data-field]');
    if (remove) {
      requestRuleDelete(remove.dataset.key, remove.dataset.field);
      return;
    }
    const pageButton = event.target.closest('[data-rule-page]');
    const pagination = pageButton?.closest('.rule-pagination[data-section]');
    if (!pageButton || !pagination || pageButton.disabled) return;
    const section = pagination.dataset.section;
    ruleSectionPages[section] = Math.max(
      0,
      Number(ruleSectionPages[section] || 0) + Number(pageButton.dataset.rulePage || 0)
    );
    renderRuleSettings();
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
  window.addEventListener('resize', () => scheduleHistoryPanelPosition(historyUi), { passive: true });
  window.visualViewport?.addEventListener('resize', () => scheduleHistoryPanelPosition(historyUi), { passive: true });
  window.visualViewport?.addEventListener('scroll', () => scheduleHistoryPanelPosition(historyUi), { passive: true });
  scheduleHistoryPanelPosition(historyUi);
  loadHistory();
  loadMetadataRules().finally(() => {
    window.postMessage({ type: PAGE_RULES_REQUEST }, location.origin);
  });
}

function notifyReady() {
  if (!isAllowedPage()) return;
  window.postMessage({ type: PAGE_READY, version: chrome.runtime.getManifest().version }, location.origin);
}

window.addEventListener('message', event => {
  if (!isAllowedPage() || event.source !== window || event.origin !== location.origin) return;

  if (event.data?.type === PAGE_RULES_SYNC) {
    const incomingRules = Array.isArray(event.data.rules) ? event.data.rules : [];
    if (!metadataRulesLoaded) {
      pendingMetadataRulesSync = incomingRules;
      return;
    }
    metadataRules = incomingRules;
    persistMetadataRules();
    renderRuleSettings();
    return;
  }

  if (event.data?.type === PAGE_RULE_TOGGLE_RESPONSE) {
    const pendingEntry = Array.from(pendingRuleToggles.entries())
      .find(([, requestId]) => requestId === event.data.requestId);
    if (pendingEntry) pendingRuleToggles.delete(pendingEntry[0]);
    if (!event.data.ok) window.postMessage({ type: PAGE_RULES_REQUEST }, location.origin);
    renderRuleSettings();
    return;
  }

  if (event.data?.type === PAGE_RULE_DELETE_RESPONSE) {
    const pendingEntry = Array.from(pendingRuleDeletes.entries())
      .find(([, requestId]) => requestId === event.data.requestId);
    if (pendingEntry) pendingRuleDeletes.delete(pendingEntry[0]);
    window.postMessage({ type: PAGE_RULES_REQUEST }, location.origin);
    return;
  }

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
          code: result.__code || '',
          retryable: Boolean(result.__retryable),
          retryAfterMs: Number(result.__retryAfterMs) || 0,
          temporaryUnavailable: Boolean(result.__temporaryUnavailable),
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isAllowedPage()) return undefined;
  if (message?.channel === 'collager-lastfm-history-control') {
    const key = clean(message.key, 1000);
    const field = clean(message.field, 100);
    const validField = field === 'applyMetadataCorrection' || field === 'deleteFutureScrobbles';
    const accepted = validField && (
      message.action === 'toggleRule'
        ? requestRuleToggle(key, field, Boolean(message.enabled))
        : message.action === 'deleteRule'
          ? requestRuleDelete(key, field, false)
          : false
    );
    sendResponse?.({ accepted: Boolean(accepted) });
    return false;
  }
  if (message?.channel !== 'collager-lastfm-progress'
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
