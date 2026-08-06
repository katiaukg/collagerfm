(function () {
  'use strict';

  const supportedLocales = ['pt-BR', 'en-US'];
  const storageKey = 'collagerfm-language';
  const localeCache = new Map();
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  const translatedAttributes = ['aria-label', 'data-tooltip', 'data-placeholder', 'placeholder', 'title'];
  let currentLocale = 'en-US';
  let currentMessages = { strings: {}, patterns: [] };
  let observer = null;

  function preferredLocale() {
    const saved = localStorage.getItem(storageKey);
    if (supportedLocales.includes(saved)) return saved;
    return 'en-US';
  }

  async function loadLocale(locale) {
    if (localeCache.has(locale)) return localeCache.get(locale);
    const response = await fetch(`./locales/${locale}.json?v=20260803-2`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Não foi possível carregar o idioma ${locale}.`);
    const messages = await response.json();
    localeCache.set(locale, messages);
    return messages;
  }

  function templateRegex(template) {
    const names = [];
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([\w]+)\\\}/g, (_, name) => {
      names.push(name);
      return ['count', 'current', 'total', 'page', 'position'].includes(name) ? '(\\d+)' : '(.+?)';
    });
    return { names, regex: new RegExp(`^${escaped}$`, 'u') };
  }

  function translate(source) {
    if (!source) return source;
    const exact = currentMessages.strings?.[source];
    if (typeof exact === 'string') return exact;
    for (const pattern of currentMessages.patterns || []) {
      const compiled = pattern._compiled || (pattern._compiled = templateRegex(pattern.source));
      const match = source.match(compiled.regex);
      if (!match) continue;
      const values = Object.fromEntries(compiled.names.map((name, index) => [name, match[index + 1]]));
      return pattern.target.replace(/\{([\w]+)\}/g, (_, name) => translate(values[name] ?? ''));
    }
    return source;
  }

  function shouldIgnore(element) {
    return !element || Boolean(element.closest('script, style, noscript, canvas, [data-i18n-skip]'));
  }

  function translateTextNode(node) {
    const element = node.parentElement;
    if (shouldIgnore(element)) return;
    const raw = node.nodeValue || '';
    const visible = raw.trim();
    if (!visible) return;
    let state = textState.get(node);
    if (!state) {
      state = { source: visible, last: visible };
      textState.set(node, state);
    } else if (visible !== state.last) {
      state.source = visible;
    }
    const rendered = translate(state.source);
    state.last = rendered;
    if (visible !== rendered) node.nodeValue = raw.replace(visible, rendered);
  }

  function translateElementAttributes(element) {
    if (shouldIgnore(element)) return;
    let states = attributeState.get(element);
    if (!states) {
      states = new Map();
      attributeState.set(element, states);
    }
    translatedAttributes.forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const visible = element.getAttribute(attribute) || '';
      let state = states.get(attribute);
      if (!state) {
        state = { source: visible, last: visible };
        states.set(attribute, state);
      } else if (visible !== state.last) {
        state.source = visible;
      }
      const rendered = translate(state.source);
      state.last = rendered;
      if (visible !== rendered) element.setAttribute(attribute, rendered);
    });
  }

  function applyTo(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateElementAttributes(node);
      node = walker.nextNode();
    }
  }

  async function setLocale(locale) {
    const normalized = supportedLocales.includes(locale) ? locale : 'en-US';
    currentMessages = await loadLocale(normalized);
    currentLocale = normalized;
    localStorage.setItem(storageKey, normalized);
    document.documentElement.lang = normalized;
    applyTo(document.body);
    document.dispatchEvent(new CustomEvent('collager:language-changed', { detail: { locale: normalized } }));
    return normalized;
  }

  async function init() {
    try {
      await setLocale(preferredLocale());
    } catch (error) {
      console.warn(error);
      currentLocale = 'en-US';
    }
    observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        if (mutation.type === 'attributes') translateElementAttributes(mutation.target);
        mutation.addedNodes.forEach(applyTo);
      });
    });
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes,
      subtree: true,
    });
  }

  window.collagerI18n = {
    get locale() { return currentLocale; },
    get supportedLocales() { return [...supportedLocales]; },
    ready: init(),
    setLocale,
    t: translate,
    apply: applyTo,
  };
  window.t = translate;
})();
