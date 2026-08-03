'use strict';

const HISTORY_STORAGE_KEY = 'collager.fm.extension-history.v2';
const RULES_STORAGE_KEY = 'collager.fm.metadata-rules.v1';
const COLLAGER_TAB_PATTERNS = ['https://collagerfm.vercel.app/*', 'http://127.0.0.1/*', 'http://localhost/*'];
let historyEntries = [];
let metadataRules = [];
let historyMode = 'all';
const pendingControls = new Set();
const xt = value => ExtI18n.t(value);

function clean(value, maximum = 500) { return String(value || '').trim().slice(0, maximum); }
function formatDate(timestamp) {
  try {
    return timestamp ? new Intl.DateTimeFormat(ExtI18n.locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(Number(timestamp))) : '';
  } catch (_) { return ''; }
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function entryMode(entry) {
  if (entry?.mode === 'automatic' || /^(Correção automática|Automatic correction)/i.test(clean(entry?.title))) return 'automatic';
  return 'manual';
}
function coverNode(url) {
  const cover = element('div', 'cover');
  const safeUrl = clean(url, 2000);
  if (safeUrl) {
    const image = document.createElement('img');
    image.src = safeUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.remove(); cover.textContent = '♪'; }, { once: true });
    cover.appendChild(image);
  } else cover.textContent = '♪';
  return cover;
}
function ruleLabel(rule) {
  const source = rule?.original || rule?.edited || {};
  const artist = clean(source.artist);
  const track = clean(source.track);
  return artist && track ? `${artist} — ${track}` : track || artist || xt('Metadata sem nome');
}
function ruleAlbum(rule) { return clean(rule?.original?.album || rule?.edited?.album); }
function hasCorrection(rule) {
  const original = rule?.original || {};
  const edited = rule?.edited || {};
  return ['artist', 'track', 'album'].some(field => clean(original[field]).toLocaleLowerCase() !== clean(edited[field]).toLocaleLowerCase());
}
function correctionDescription(rule) {
  const original = rule?.original || {};
  const edited = rule?.edited || {};
  const before = [original.artist, original.track, original.album].map(value => clean(value)).filter(Boolean).join(' · ');
  const after = [edited.artist, edited.track, edited.album].map(value => clean(value)).filter(Boolean).join(' · ');
  return before && after && before !== after ? `${before} → ${after}` : after || before;
}
function activationDate(rule, field) {
  return formatDate(field === 'deleteFutureScrobbles' ? Number(rule?.deleteFutureStartedAt || rule?.createdAt || 0) : Number(rule?.createdAt || 0));
}
function storageSet(values) {
  return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve();
  }));
}
function queryCollagerTabs() {
  return new Promise(resolve => chrome.tabs.query({ url: COLLAGER_TAB_PATTERNS }, tabs => {
    void chrome.runtime.lastError;
    resolve(Array.isArray(tabs) ? tabs : []);
  }));
}
function sendTabControl(tabId, message) {
  return new Promise(resolve => chrome.tabs.sendMessage(tabId, message, response => {
    const failed = Boolean(chrome.runtime.lastError);
    resolve(!failed && Boolean(response?.accepted));
  }));
}
async function sendRuleControl(action, key, field, enabled) {
  const tabs = await queryCollagerTabs();
  const responses = await Promise.all(tabs.map(tab => sendTabControl(tab.id, {
    channel: 'collager-lastfm-history-control', action, key, field, enabled: Boolean(enabled),
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
    if (removeOperation) { rule.deletionConfigured = false; rule.deleteFutureStartedAt = 0; }
  }
  if (!rule.correctionConfigured && !rule.deletionConfigured) metadataRules.splice(index, 1);
  else metadataRules[index] = rule;
  await storageSet({ [RULES_STORAGE_KEY]: metadataRules });
  render();
}
function emptyCard(message) { return element('div', 'empty', xt(message)); }
function cardShell(coverUrl) {
  const card = element('article', 'card');
  const layout = element('div', 'card-layout');
  const copy = element('div', 'card-copy');
  layout.append(coverNode(coverUrl), copy);
  card.append(layout);
  return { card, copy };
}
function renderHistoryCard(entry) {
  const { card, copy } = cardShell(entry?.coverUrl);
  const head = element('div', 'card-head');
  head.append(
    element('h3', '', xt(clean(entry?.title) || 'Ação da extensão')),
    element('span', `state${entry?.ok ? '' : ' off'}`, xt(entry?.ok ? 'Concluída' : 'Erro'))
  );
  copy.append(head, element('time', '', formatDate(entry?.timestamp)));
  const target = element('div', 'detail', clean(entry?.target));
  if (target.textContent) copy.append(target);
  copy.append(element('p', 'message', xt(entry?.restoredAt ? 'Este scrobble foi recolocado no Last.fm.' : clean(entry?.message))));
  copy.append(element('span', 'history-kind', xt(entryMode(entry) === 'automatic' ? 'Automático' : 'Manual')));
  return card;
}
function renderRuleCard(rule, field, description) {
  const { card, copy } = cardShell(rule?.coverUrl);
  const head = element('div', 'card-head');
  const active = Boolean(rule?.[field]);
  const pendingKey = `${rule.key}|${field}`;
  const actions = element('div', 'rule-actions');
  const toggleLabel = element('label', `rule-toggle${active ? '' : ' off'}`);
  const toggle = element('input');
  toggle.type = 'checkbox'; toggle.checked = active; toggle.disabled = pendingControls.has(pendingKey);
  toggle.dataset.key = rule.key; toggle.dataset.field = field;
  toggle.setAttribute('aria-label', xt(`Ativar ou desativar ${ruleLabel(rule)}`));
  toggleLabel.append(toggle, element('span', '', xt(active ? 'Ativada' : 'Desativada')));
  const remove = element('button', 'remove-operation', '×');
  remove.type = 'button'; remove.disabled = pendingControls.has(pendingKey);
  remove.dataset.key = rule.key; remove.dataset.field = field;
  remove.setAttribute('aria-label', xt(`Excluir operação de ${ruleLabel(rule)}`));
  actions.append(toggleLabel, remove);
  head.append(element('h3', '', ruleLabel(rule)), actions);
  copy.append(head);
  const detail = element('div', 'detail', description(rule));
  if (detail.textContent) copy.append(detail);
  const album = ruleAlbum(rule);
  const since = activationDate(rule, field);
  const meta = element('span', 'meta', [album ? xt(`Álbum: ${album}`) : '', since ? xt(`Ativa desde ${since}`) : ''].filter(Boolean).join(' · '));
  if (meta.textContent) copy.append(meta);
  return card;
}
function renderList(name, items, renderer, emptyMessage) {
  const list = document.querySelector(`[data-list="${name}"]`);
  document.querySelector(`[data-count="${name}"]`).textContent = String(items.length);
  list.replaceChildren(...(items.length ? items.map(renderer) : [emptyCard(emptyMessage)]));
}
function render() {
  const visibleHistory = historyEntries.filter(entry => historyMode === 'all' || entryMode(entry) === historyMode);
  const changed = metadataRules.filter(rule => rule?.correctionConfigured && hasCorrection(rule));
  const deleted = metadataRules.filter(rule => rule?.deletionConfigured);
  renderList('history', visibleHistory, renderHistoryCard, 'A extensão ainda não registrou nenhuma ação neste filtro.');
  renderList('changed', changed, rule => renderRuleCard(rule, 'applyMetadataCorrection', correctionDescription), 'Nenhuma correção automática foi configurada.');
  renderList('deleted', deleted, rule => renderRuleCard(rule, 'deleteFutureScrobbles', candidate => xt(`Mesmo metadata de ${ruleLabel(candidate)}`)), 'Nenhuma exclusão automática foi configurada.');
}
function selectView(view) {
  const target = ['history', 'changed', 'deleted'].includes(view) ? view : 'history';
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.view === target));
  document.querySelectorAll('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === target));
}
function load() {
  chrome.storage.local.get([HISTORY_STORAGE_KEY, RULES_STORAGE_KEY], result => {
    historyEntries = Array.isArray(result?.[HISTORY_STORAGE_KEY]) ? result[HISTORY_STORAGE_KEY] : [];
    metadataRules = Array.isArray(result?.[RULES_STORAGE_KEY]) ? result[RULES_STORAGE_KEY] : [];
    render();
  });
}

const params = new URLSearchParams(location.search);
historyMode = ['manual', 'automatic', 'all'].includes(params.get('mode')) ? params.get('mode') : 'all';
document.querySelectorAll('[data-history-mode]').forEach(button => button.classList.toggle('active', button.dataset.historyMode === historyMode));
selectView(params.get('view'));

document.querySelector('.tabs').addEventListener('click', event => {
  const tab = event.target.closest('.tab[data-view]');
  if (tab) selectView(tab.dataset.view);
});
document.querySelector('.history-filter').addEventListener('click', event => {
  const button = event.target.closest('[data-history-mode]');
  if (!button) return;
  historyMode = button.dataset.historyMode;
  document.querySelectorAll('[data-history-mode]').forEach(candidate => candidate.classList.toggle('active', candidate === button));
  render();
});
document.querySelector('.clear-history').addEventListener('click', () => {
  const menu = document.querySelector('.clear-menu');
  menu.hidden = !menu.hidden;
});
document.querySelector('.clear-menu').addEventListener('click', async event => {
  const button = event.target.closest('[data-clear-scope]');
  if (!button) return;
  const scope = button.dataset.clearScope;
  const label = xt(scope === 'manual' ? 'manual' : scope === 'automatic' ? 'automático' : 'completo');
  if (!window.confirm(xt(`Deseja excluir o histórico ${label} da extensão?`))) return;
  historyEntries = scope === 'all' ? [] : historyEntries.filter(entry => entryMode(entry) !== scope);
  await storageSet({ [HISTORY_STORAGE_KEY]: historyEntries });
  document.querySelector('.clear-menu').hidden = true;
  render();
});
document.querySelector('main').addEventListener('change', async event => {
  const toggle = event.target.closest('input[data-key][data-field]');
  if (!toggle) return;
  const { key, field } = toggle.dataset;
  const pendingKey = `${key}|${field}`;
  pendingControls.add(pendingKey); render();
  const accepted = await sendRuleControl('toggleRule', key, field, toggle.checked);
  if (accepted) await persistRuleControl(key, field, toggle.checked);
  else window.alert(xt('Abra o collager.fm em outra aba para alterar esta regra.'));
  pendingControls.delete(pendingKey); render();
});
document.querySelector('main').addEventListener('click', async event => {
  const remove = event.target.closest('.remove-operation[data-key][data-field]');
  if (!remove) return;
  const { key, field } = remove.dataset;
  const rule = metadataRules.find(candidate => candidate?.key === key);
  if (!rule) return;
  const kind = xt(field === 'applyMetadataCorrection' ? 'alteração automática' : 'exclusão automática');
  if (!window.confirm(xt(`Deseja excluir a operação de ${kind} para ${ruleLabel(rule)}?`))) return;
  const pendingKey = `${key}|${field}`;
  pendingControls.add(pendingKey); render();
  const accepted = await sendRuleControl('deleteRule', key, field, false);
  if (accepted) await persistRuleControl(key, field, false, true);
  else window.alert(xt('Abra o collager.fm em outra aba para excluir esta regra.'));
  pendingControls.delete(pendingKey); render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[HISTORY_STORAGE_KEY]) historyEntries = Array.isArray(changes[HISTORY_STORAGE_KEY].newValue) ? changes[HISTORY_STORAGE_KEY].newValue : [];
  if (changes[RULES_STORAGE_KEY]) metadataRules = Array.isArray(changes[RULES_STORAGE_KEY].newValue) ? changes[RULES_STORAGE_KEY].newValue : [];
  if (changes[ExtI18n.STORAGE_KEY]) {
    ExtI18n.setLocale(changes[ExtI18n.STORAGE_KEY].newValue, false);
    ExtI18n.apply();
  }
  render();
});
ExtI18n.init().then(() => {
  ExtI18n.apply();
  load();
});
