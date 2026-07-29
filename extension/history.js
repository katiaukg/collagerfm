'use strict';

const HISTORY_STORAGE_KEY = 'collager.fm.extension-history.v2';
const RULES_STORAGE_KEY = 'collager.fm.metadata-rules.v1';

let historyEntries = [];
let metadataRules = [];

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
  const state = element('span', `state${active ? '' : ' off'}`, active ? 'Ativada' : 'Desativada');
  head.append(title, state);
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[HISTORY_STORAGE_KEY]) historyEntries = Array.isArray(changes[HISTORY_STORAGE_KEY].newValue) ? changes[HISTORY_STORAGE_KEY].newValue : [];
  if (changes[RULES_STORAGE_KEY]) metadataRules = Array.isArray(changes[RULES_STORAGE_KEY].newValue) ? changes[RULES_STORAGE_KEY].newValue : [];
  render();
});

load();
