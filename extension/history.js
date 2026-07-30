'use strict';

const HISTORY_STORAGE_KEY = 'collager.fm.extension-history.v2';
const RULES_STORAGE_KEY = 'collager.fm.metadata-rules.v1';

let historyEntries = [];
let metadataRules = [];
const pendingControls = new Set();
const COLLAGER_TAB_PATTERNS = [
  'https://collagerfm.vercel.app/*',
  'http://127.0.0.1/*',
  'http://localhost/*',
];

function clean(value, maximum = 500) {
  return String(value || '').trim().slice(0, maximum);
}

function formatDate(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value));
  } catch (_) {
    return '';
  }
}

function ruleLabel(rule) {
  const source = rule?.original || rule?.edited || {};
  const artist = clean(source.artist);
  const track = clean(source.track);
  return artist && track ? `${artist} — ${track}` : track || artist || 'Metadata sem nome';
}

function ruleAlbum(rule) {
  return clean(rule?.original?.album || rule?.edited?.album);
}

function hasCorrection(rule) {
  const original = rule?.original || {};
  const edited = rule?.edited || {};
  return ['artist', 'track', 'album'].some(field =>
    clean(original[field]).toLocaleLowerCase() !== clean(edited[field]).toLocaleLowerCase()
  );
}

function correctionDescription(rule) {
  const original = rule?.original || {};
  const edited = rule?.edited || {};
  const before = [original.artist, original.track, original.album].map(value => clean(value)).filter(Boolean).join(' · ');
  const after = [edited.artist, edited.track, edited.album].map(value => clean(value)).filter(Boolean).join(' · ');
  return before && after && before !== after ? `${before} → ${after}` : after || before;
}

function activationDate(rule, field) {
  return formatDate(
    field === 'deleteFutureScrobbles'
      ? Number(rule?.deleteFutureStartedAt || rule?.createdAt || 0)
      : Number(rule?.createdAt || 0)
  );
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function queryCollagerTabs() {
  return new Promise(resolve => {
    chrome.tabs.query({ url: COLLAGER_TAB_PATTERNS }, tabs => {
      void chrome.runtime.lastError;
      resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

function sendTabControl(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const failed = Boolean(chrome.runtime.lastError);
      resolve(!failed && Boolean(response?.accepted));
    });
  });
}

async function sendRuleControl(action, key, field, enabled) {
  const tabs = await queryCollagerTabs();
  if (!tabs.length) return false;
  const responses = await Promise.all(tabs.map(tab => sendTabControl(tab.id, {
    channel: 'collager-lastfm-history-control',
    action,
    key,
    field,
    enabled: Boolean(enabled),
  })));
  return responses.some(Boolean);
}

async function persistRuleControl(key, field, enabled, removeOperation = false) {
  const index = metadataRules.findIndex(rule => rule?.key === key);
  if (index < 0) return;
  const rule = { ...metadataRules[index] };
  if (field === 'applyMetadataCorrection') {
    rule.applyMetadataCorrection = removeOperation ? false : Boolean(enabled);
    if (removeOperation) rule.correctionConfigured = false;
  } else {
    rule.deleteFutureScrobbles = removeOperation ? false : Boolean(enabled);
    if (removeOperation) {
      rule.deletionConfigured = false;
      rule.deleteFutureStartedAt = 0;
    }
  }
  if (!rule.correctionConfigured && !rule.deletionConfigured) metadataRules.splice(index, 1);
  else metadataRules[index] = rule;
  await storageSet({ [RULES_STORAGE_KEY]: metadataRules });
  render();
}

function emptyCard(message) {
  return element('div', 'empty', message);
}

function renderHistoryCard(entry) {
  const card = element('article', 'card');
  const head = element('div', 'card-head');
  const title = element('h3', '', clean(entry?.title) || 'Ação da extensão');
  const state = element('span', `state${entry?.ok ? '' : ' off'}`, entry?.ok ? 'Concluída' : 'Incompleta');
  head.append(title, state);
  const time = element('time', '', formatDate(entry?.timestamp));
  const target = element('div', 'detail', clean(entry?.target));
  const message = element('p', 'message', entry?.restoredAt ? 'Este scrobble foi recolocado no Last.fm.' : clean(entry?.message));
  card.append(head, time);
  if (target.textContent) card.append(target);
  card.append(message);
  const events = element('div', 'events');
  (entry?.events || []).forEach(text => events.append(element('div', 'event', clean(text))));
  if (events.childElementCount) card.append(events);
  return card;
}

function renderRuleCard(rule, field, description) {
  const card = element('article', 'card');
  const head = element('div', 'card-head');
  const title = element('h3', '', ruleLabel(rule));
  const active = Boolean(rule?.[field]);
  const pendingKey = `${rule.key}|${field}`;
  const actions = element('div', 'rule-actions');
  const toggleLabel = element('label', `rule-toggle${active ? '' : ' off'}`);
  const toggle = element('input');
  toggle.type = 'checkbox';
  toggle.checked = active;
  toggle.disabled = pendingControls.has(pendingKey);
  toggle.dataset.key = rule.key;
  toggle.dataset.field = field;
  toggle.setAttribute('aria-label', `Ativar ou desativar ${ruleLabel(rule)}`);
  toggleLabel.append(toggle, element('span', '', active ? 'Ativada' : 'Desativada'));
  const remove = element('button', 'remove-operation', '×');
  remove.type = 'button';
  remove.disabled = pendingControls.has(pendingKey);
  remove.dataset.key = rule.key;
  remove.dataset.field = field;
  remove.setAttribute('aria-label', `Excluir operação de ${ruleLabel(rule)}`);
  remove.title = 'Excluir operação';
  actions.append(toggleLabel, remove);
  head.append(title, actions);
  card.append(head);
  const detail = element('div', 'detail', description(rule));
  if (detail.textContent) card.append(detail);
  const album = ruleAlbum(rule);
  const since = activationDate(rule, field);
  const meta = element('span', 'meta', [
    album ? `Álbum: ${album}` : '',
    since ? `Ativa desde ${since}` : '',
  ].filter(Boolean).join(' · '));
  if (meta.textContent) card.append(meta);
  return card;
}

function renderList(name, items, renderer, emptyMessage) {
  const list = document.querySelector(`[data-list="${name}"]`);
  const count = document.querySelector(`[data-count="${name}"]`);
  count.textContent = String(items.length);
  list.replaceChildren(...(items.length ? items.map(renderer) : [emptyCard(emptyMessage)]));
}

function render() {
  const changed = metadataRules.filter(rule => rule?.correctionConfigured && hasCorrection(rule));
  const deleted = metadataRules.filter(rule => rule?.deletionConfigured);
  renderList('history', historyEntries, renderHistoryCard, 'A extensão ainda não registrou nenhuma ação.');
  renderList(
    'changed',
    changed,
    rule => renderRuleCard(rule, 'applyMetadataCorrection', correctionDescription),
    'Nenhuma correção automática foi configurada.'
  );
  renderList(
    'deleted',
    deleted,
    rule => renderRuleCard(rule, 'deleteFutureScrobbles', candidate => `Mesmo metadata de ${ruleLabel(candidate)}`),
    'Nenhuma exclusão automática foi configurada.'
  );
}

function load() {
  chrome.storage.local.get([HISTORY_STORAGE_KEY, RULES_STORAGE_KEY], result => {
    historyEntries = Array.isArray(result?.[HISTORY_STORAGE_KEY]) ? result[HISTORY_STORAGE_KEY] : [];
    metadataRules = Array.isArray(result?.[RULES_STORAGE_KEY]) ? result[RULES_STORAGE_KEY] : [];
    render();
  });
}

document.querySelector('.tabs').addEventListener('click', event => {
  const tab = event.target.closest('.tab[data-view]');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button === tab));
  document.querySelectorAll('.view').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tab.dataset.view);
  });
});

document.querySelector('main').addEventListener('change', async event => {
  const toggle = event.target.closest('input[data-key][data-field]');
  if (!toggle) return;
  const key = toggle.dataset.key;
  const field = toggle.dataset.field;
  const pendingKey = `${key}|${field}`;
  const enabled = toggle.checked;
  pendingControls.add(pendingKey);
  render();
  const accepted = await sendRuleControl('toggleRule', key, field, enabled);
  if (accepted) {
    await persistRuleControl(key, field, enabled);
  } else {
    window.alert('Abra o collager.fm em outra aba para alterar esta regra.');
  }
  pendingControls.delete(pendingKey);
  render();
});

document.querySelector('main').addEventListener('click', async event => {
  const remove = event.target.closest('.remove-operation[data-key][data-field]');
  if (!remove) return;
  const key = remove.dataset.key;
  const field = remove.dataset.field;
  const rule = metadataRules.find(candidate => candidate?.key === key);
  if (!rule) return;
  const kind = field === 'applyMetadataCorrection' ? 'alteração automática' : 'exclusão automática';
  if (!window.confirm(`Deseja excluir a operação de ${kind} para ${ruleLabel(rule)}?`)) return;
  const pendingKey = `${key}|${field}`;
  pendingControls.add(pendingKey);
  render();
  const accepted = await sendRuleControl('deleteRule', key, field, false);
  if (accepted) {
    await persistRuleControl(key, field, false, true);
  } else {
    window.alert('Abra o collager.fm em outra aba para excluir esta regra.');
  }
  pendingControls.delete(pendingKey);
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[HISTORY_STORAGE_KEY]) historyEntries = Array.isArray(changes[HISTORY_STORAGE_KEY].newValue) ? changes[HISTORY_STORAGE_KEY].newValue : [];
  if (changes[RULES_STORAGE_KEY]) metadataRules = Array.isArray(changes[RULES_STORAGE_KEY].newValue) ? changes[RULES_STORAGE_KEY].newValue : [];
  render();
});

load();
