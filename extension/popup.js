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
  }
});

chrome.storage.local.get(PANEL_PLACEMENT_STORAGE_KEY, result => selectPlacement(result?.[PANEL_PLACEMENT_STORAGE_KEY]));
