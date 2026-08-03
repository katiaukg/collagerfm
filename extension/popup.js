'use strict';

const PANEL_PLACEMENT_STORAGE_KEY = 'collager.fm.extension-panel-placement.v1';
const links = {
  collager: 'https://collagerfm.vercel.app/',
  'history-manual': chrome.runtime.getURL('history.html?view=history&mode=manual'),
  'history-automatic': chrome.runtime.getURL('history.html?view=history&mode=automatic'),
  changed: chrome.runtime.getURL('history.html?view=changed'),
  deleted: chrome.runtime.getURL('history.html?view=deleted'),
};

function selectPlacement(value) {
  const placement = ['bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(value) ? value : 'bottom-left';
  document.querySelectorAll('[data-placement]').forEach(button => button.classList.toggle('active', button.dataset.placement === placement));
}

function updateLanguageName() {
  const label = document.querySelector('[data-language-name]');
  if (label) label.textContent = ExtI18n.locale === 'en-US' ? 'English' : 'Português';
}

document.addEventListener('click', event => {
  const link = event.target.closest('[data-link]');
  if (link) {
    chrome.tabs.create({ url: links[link.dataset.link] });
    window.close();
    return;
  }
  const placement = event.target.closest('[data-placement]');
  if (placement) {
    selectPlacement(placement.dataset.placement);
    chrome.storage.local.set({ [PANEL_PLACEMENT_STORAGE_KEY]: placement.dataset.placement });
    return;
  }
  if (event.target.closest('[data-language]')) {
    ExtI18n.setLocale(ExtI18n.locale === 'en-US' ? 'pt-BR' : 'en-US');
    updateLanguageName();
  }
});

ExtI18n.init().then(() => {
  ExtI18n.apply();
  updateLanguageName();
  chrome.storage.local.get(PANEL_PLACEMENT_STORAGE_KEY, result => selectPlacement(result?.[PANEL_PLACEMENT_STORAGE_KEY]));
});
