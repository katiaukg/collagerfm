'use strict';

(() => {
  const store = window.CollagerLocalStore;
  const toggle = document.getElementById('local-session-enabled');
  const status = document.getElementById('local-workspace-status');
  const usage = document.getElementById('local-workspace-usage');
  const exportButton = document.getElementById('local-backup-export');
  const preferenceKey = 'collager-resume-session-v1';
  const covers = new Map();
  const decodedCovers = new Map();
  const editedKeys = new Set();
  const pendingCovers = new Set();
  const imageBlobs = new WeakMap();
  let baseline = new Map();
  let loaded = false;
  let restoring = true;
  let awaitingLiveRefresh = false;
  let session = null;
  let saveTimer;
  let saveVersion = 0;
  let writeQueue = Promise.resolve();

  function coverKey(item, type) {
    const normalize = value => String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    const artist = item?.artist?.name || item?.artist?.['#text'] || '';
    return JSON.stringify(type === 'artists'
      ? [type, normalize(item?.name)]
      : [type, normalize(artist), normalize(item?.name)]);
  }

  function setStatus(message, error = false) {
    status.textContent = uiText(message);
    status.style.color = error ? '#ff8b8b' : '';
    status.dataset.message = message;
  }

  function updateUsage() {
    const bytes = [...covers.values()].reduce((total, cover) => total + cover.blob.size, 0) + (session?.bytes || 0);
    const unit = bytes < 1048576 ? 'KB' : 'MB';
    const size = new Intl.NumberFormat(document.documentElement.lang || 'pt-BR', { maximumFractionDigits: 1 }).format(bytes / (unit === 'KB' ? 1024 : 1048576));
    usage.textContent = `${uiText('Capas preservadas')}: ${covers.size} · ${size} ${unit}`;
    exportButton.disabled = !covers.size && !session;
  }

  const ready = store.covers().then(records => {
    records.forEach(record => { if (record.blob instanceof Blob) covers.set(record.key, record); });
    baseline = new Map(covers);
    loaded = true;
    updateUsage();
  }).catch(() => {
    loaded = true;
    setStatus('Não foi possível acessar o armazenamento local.', true);
  });

  function imageBlob(image) {
    if (!image || !image.naturalWidth) return Promise.resolve(null);
    if (!imageBlobs.has(image)) imageBlobs.set(image, new Promise(resolve => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        canvas.toBlob(resolve, 'image/png');
      } catch { resolve(null); }
    }));
    return imageBlobs.get(image);
  }

  async function decode(blob) {
    const url = URL.createObjectURL(blob);
    const image = await loadImage(url);
    if (!image) { URL.revokeObjectURL(url); return null; }
    imageBlobs.set(image, Promise.resolve(blob));
    return image;
  }

  function forgetLegacyReferences(item, type) {
    const key = coverKey(item, type);
    Object.values(collageMemories).forEach(memory => {
      if (memory?.context?.type === type) {
        memory.images = (memory.images || []).filter(saved => coverKey(saved.item, type) !== key);
      }
    });
    persistCollageMemories();
  }

  async function rememberCover(item, type, image, originalBlob) {
    const key = coverKey(item, type);
    pendingCovers.add(key);
    try {
      await ready;
      const blob = originalBlob?.type?.startsWith('image/') ? originalBlob : await imageBlob(image);
      if (!blob) { setStatus('Não foi possível preservar esta capa.', true); return false; }
      const record = { key, type, item: snapshotMemoryItem(item, type), blob, updatedAt: Date.now() };
      covers.set(key, record);
      decodedCovers.set(key, { record, image });
      imageBlobs.set(image, Promise.resolve(blob));
      editedKeys.add(key);
      forgetLegacyReferences(item, type);
      try {
        await store.putCover(record);
        setStatus('Capa preservada neste navegador.');
      } catch { setStatus('Não foi possível salvar a capa. Ela ficará apenas nesta sessão.', true); }
      updateUsage();
      scheduleSave();
      return true;
    } finally { pendingCovers.delete(key); }
  }

  async function forgetCover(item, type) {
    await ready;
    const key = coverKey(item, type);
    await store.deleteCover(key).catch(() => setStatus('Não foi possível atualizar o armazenamento local.', true));
    covers.delete(key);
    decodedCovers.delete(key);
    editedKeys.add(key);
    forgetLegacyReferences(item, type);
    allFetchedItems.forEach((candidate, index) => {
      if (coverKey(candidate, type) !== key) return;
      delete customImages[index];
      delete customImageRefs[index];
      poolImageCache.delete(index);
    });
    updateUsage();
    scheduleSave();
  }

  async function applyCovers(items, type) {
    await ready;
    await Promise.all(items.map(async item => {
      const key = coverKey(item, type);
      const record = covers.get(key);
      if (!record || pendingCovers.has(key)) return;
      let cached = decodedCovers.get(key);
      if (cached?.record !== record) {
        cached = { record, pending: decode(record.blob).catch(() => null) };
        decodedCovers.set(key, cached);
      }
      const image = cached.image || await cached.pending;
      cached.image = image;
      const index = allFetchedItems.indexOf(item);
      if (!image || index < 0 || covers.get(key) !== record || pendingCovers.has(key)) return;
      customImages[index] = image;
      customImageRefs[index] = { kind: 'preserved' };
      poolImageCache.set(index, image);
    }));
  }

  async function restoreCovers(snapshot) {
    await ready;
    const target = snapshot ? new Map(snapshot) : baseline;
    for (const key of editedKeys) {
      const previous = target.get(key);
      if (previous === covers.get(key)) continue;
      if (previous) { await store.putCover(previous); covers.set(key, previous); }
      else { await store.deleteCover(key); covers.delete(key); }
      decodedCovers.delete(key);
    }
    updateUsage();
  }

  function safeSettings(settings) {
    const blocked = /(?:api.?key|token|secret|password|client.?id)/i;
    const accountFields = new Set(['username', 'desktop-menu-username', 'mobile-quick-username']);
    const allowedFields = new Set(scanFormFields().map(field => field.id));
    const allowedJsKeys = new Set(Object.keys(getTimelineSettingsSnapshot().jsState));
    return {
      fields: (settings.fields || []).filter(field => allowedFields.has(field.id)
        && !PRIVATE_SETTINGS_FIELD_IDS.has(field.id) && !blocked.test(field.id) && !accountFields.has(field.id)),
      buttonGroups: (settings.buttonGroups || []).filter(group => SETTINGS_BUTTON_GROUPS.some(definition => definition.id === group.id)),
      jsState: Object.fromEntries(Object.entries(settings.jsState || {}).filter(([key]) => allowedJsKeys.has(key))),
    };
  }

  async function captureSession() {
    const snapshot = captureTimelineSnapshot();
    snapshot.settings = safeSettings(snapshot.settings);
    const runtime = snapshot.runtime;
    const serializeImages = async entries => (await Promise.all(entries.map(async ([index, image]) => {
      const blob = await imageBlob(image);
      return blob ? [Number(index), blob] : null;
    }))).filter(Boolean);
    const [images, custom, header] = await Promise.all([
      serializeImages(runtime.poolImageCache),
      serializeImages(Object.entries(runtime.customImages)),
      imageBlob(headerImage),
    ]);
    delete runtime.preservedCovers;
    runtime.poolImageCache = [];
    runtime.customImages = {};
    runtime.deletedImagePreviewCache = [];
    const result = {
      version: 1, savedAt: Date.now(), username: document.getElementById('username').value,
      snapshot: cloneTimelinePlain(snapshot), images, custom,
      page: temporalCollagePage, estimatedTotal: temporalPaginationEstimatedTotal,
      hasMore: temporalPaginationHasMore, requestedLimit: temporalPaginationRequestedLimit,
      header: header ? { blob: header, transform: { ...headerImageTransform }, color: headerImageDominantColor } : null,
      fonts: [...customFontFiles.entries()],
    };
    result.bytes = new Blob([JSON.stringify(result.snapshot)]).size
      + [...images, ...custom].reduce((total, entry) => total + entry[1].size, 0)
      + (header?.size || 0) + result.fonts.reduce((total, entry) => total + entry[1].size, 0);
    return result;
  }

  function scheduleSave() {
    if (restoring || !toggle.checked) return;
    clearTimeout(saveTimer);
    const version = ++saveVersion;
    saveTimer = setTimeout(() => {
      writeQueue = writeQueue.catch(() => {}).then(async () => {
        if (version !== saveVersion || !toggle.checked || restoring || _isDrawing || generationQueryState) {
          if (version === saveVersion && toggle.checked && !restoring) scheduleSave();
          return;
        }
        if (!allFetchedItems.length || !document.getElementById('collage-wrap').classList.contains('visible')) return;
        setStatus('Salvando sessão local...');
        const next = await captureSession();
        if (version !== saveVersion || !toggle.checked || restoring) return;
        await store.putSession(next);
        session = next;
        updateUsage();
        setStatus('Sessão salva neste navegador.');
      }).catch(() => setStatus('Não foi possível salvar a sessão. Verifique o espaço disponível.', true));
    }, 900);
  }

  async function restoreSession(saved) {
    restoring = true;
    awaitingLiveRefresh = false;
    stopRecentLiveUpdates();
    let refreshed = false;
    try {
      const snapshot = structuredClone(saved.snapshot);
      snapshot.settings = safeSettings(snapshot.settings);
      snapshot.runtime.preservedCovers = [...covers];
      const deserializeImages = entries => Promise.all(entries.map(async ([index, blob]) => [index, await decode(blob)]));
      snapshot.runtime.poolImageCache = await deserializeImages(saved.images);
      snapshot.runtime.customImages = Object.fromEntries(await deserializeImages(saved.custom));
      const fontIds = new Map();
      for (const [oldId, file] of saved.fonts || []) {
        await addCustomFontFile(file);
        fontIds.set(oldId, `custom-${customFontCounter}`);
      }
      snapshot.settings.fields.forEach(field => {
        if (field.id.includes('font') && fontIds.has(field.value)) field.value = fontIds.get(field.value);
      });
      const restoredHeader = saved.header ? await decode(saved.header.blob) : null;
      currentApiKey = document.getElementById('apikey').value.trim();
      const prepareDraw = () => {
        document.getElementById('username').value = typeof saved.username === 'string' ? saved.username : '';
        document.dispatchEvent(new CustomEvent('collager:account-state-changed'));
        temporalCollagePage = saved.page || 0;
        temporalPaginationEstimatedTotal = saved.estimatedTotal || 0;
        temporalPaginationHasMore = Boolean(saved.hasMore);
        temporalPaginationRequestedLimit = saved.requestedLimit || 0;
        headerImage = restoredHeader;
        headerImageDataUrl = '';
        headerImageTransform = saved.header?.transform || { x: 0, y: 0, zoom: 100 };
        headerImageDominantColor = saved.header?.color || '#0d0d0d';
      };
      const restored = await restoreStatusHistoryEntry({ id: 0, snapshot }, { prepareDraw });
      if (!restored) throw new Error('Session restore failed');
      syncHeaderImageUi();
      updateTemporalPaginationControls();
      notifyQueryConfigurationChanged();
      recordTimelineAction('Sessão local restaurada.');
      const fallback = captureTimelineSnapshot();
      setStatus('Atualizando a collage com os dados de agora...');
      refreshed = await generate({ refreshOnly: true });
      if (refreshed) {
        setStatus(currentType === 'obsessions' && obsessionDataIsStale
          ? 'O Last.fm está indisponível. Exibindo o último histórico de obsessões disponível.'
          : 'Sessão restaurada e atualizada.');
      } else {
        cancelRequested = false;
        await restoreStatusHistoryEntry({ id: 0, snapshot: fallback }, { prepareDraw });
        setStatus('Cópia local exibida. Não foi possível atualizar os dados agora.', true);
        if (getRenderedQueryState()?.mode === 'recent') {
          awaitingLiveRefresh = true;
          startRecentLiveUpdates(String(saved.username || '').trim(), currentApiKey, { applyMetadataRules: false });
        }
      }
    } finally {
      restoring = false;
      if (refreshed) scheduleSave();
    }
    return refreshed;
  }

  function dataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function encodeBlobs(value) {
    if (value instanceof Blob) return { _blob: await dataUrl(value), name: value.name || '' };
    if (Array.isArray(value)) return Promise.all(value.map(encodeBlobs));
    if (value && typeof value === 'object') {
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await encodeBlobs(child)])));
    }
    return value;
  }

  function decodeBlobs(value, depth = 0, counter = { count: 0 }) {
    if (++counter.count > 300000 || depth > 35) throw new Error('Invalid backup');
    if (!value || typeof value !== 'object') return value;
    if (value._blob) {
      const match = /^data:([a-z0-9.+/-]*);base64,([a-z0-9+/=]*)$/i.exec(value._blob);
      if (!match || !/^(image\/(png|jpeg|webp|gif|avif|bmp|svg\+xml)|font\/[a-z0-9-]+|application\/(octet-stream|font-[a-z0-9-]+|vnd.ms-fontobject))?$/i.test(match[1])) throw new Error('Invalid backup');
      const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
      return value.name ? new File([bytes], String(value.name).slice(0, 200), { type: match[1] }) : new Blob([bytes], { type: match[1] });
    }
    if (Array.isArray(value)) return value.map(child => decodeBlobs(child, depth + 1, counter));
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid backup');
      result[key] = decodeBlobs(child, depth + 1, counter);
    }
    return result;
  }

  async function exportBackup() {
    await ready;
    clearTimeout(saveTimer);
    await writeQueue.catch(() => {});
    const latest = toggle.checked && allFetchedItems.length ? await captureSession() : session;
    const backup = { format: 'collager-local-backup', version: 1, covers: [...covers.values()], session: latest };
    const blob = new Blob([JSON.stringify(await encodeBlobs(backup))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `collager_backup_${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(file) {
    if (!file || file.size > 100 * 1024 * 1024) throw new Error('Invalid backup');
    const backup = decodeBlobs(JSON.parse(await file.text()));
    if (backup.format !== 'collager-local-backup' || backup.version !== 1 || !Array.isArray(backup.covers)) throw new Error('Invalid backup');
    for (const cover of backup.covers) {
      if (!['artists', 'albums', 'tracks'].includes(cover.type) || !(cover.blob instanceof Blob)
        || !cover.blob.type.startsWith('image/') || cover.key !== coverKey(cover.item, cover.type)) throw new Error('Invalid backup');
    }
    if (backup.session && (backup.session.version !== 1 || !backup.session.snapshot?.runtime
      || !Array.isArray(backup.session.images) || !Array.isArray(backup.session.custom)
      || !Array.isArray(backup.session.snapshot.runtime.allFetchedItems))) throw new Error('Invalid backup');
    if (backup.session) {
      const saved = backup.session;
      const runtime = saved.snapshot.runtime;
      if (!saved.snapshot.settings || !Array.isArray(runtime.deletedPoolIndices)
        || !Array.isArray(runtime.collageBehaviorRules) || !runtime.customTexts || !runtime.customPlays
        || !runtime.mergeRecords || !runtime.customImageRefs || !Array.isArray(saved.fonts || [])) throw new Error('Invalid backup');
      for (const entry of [...saved.images, ...saved.custom]) {
        if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || entry[0] < 0
          || entry[0] >= runtime.allFetchedItems.length || !(entry[1] instanceof Blob)
          || !entry[1].type.startsWith('image/')) throw new Error('Invalid backup');
      }
      if ((saved.fonts || []).some(entry => !Array.isArray(entry) || !(entry[1] instanceof File))) throw new Error('Invalid backup');
      if (saved.header && (!(saved.header.blob instanceof Blob) || !saved.header.blob.type.startsWith('image/'))) throw new Error('Invalid backup');
    }
    await ready;
    clearTimeout(saveTimer);
    ++saveVersion;
    await writeQueue.catch(() => {});
    for (const cover of backup.covers) {
      await store.putCover(cover);
      covers.set(cover.key, cover);
      decodedCovers.delete(cover.key);
    }
    let sessionRefreshed = null;
    if (backup.session) {
      sessionRefreshed = await restoreSession(backup.session);
      await store.putSession(backup.session);
      session = backup.session;
      toggle.checked = true;
      localStorage.setItem(preferenceKey, '1');
    } else if (currentItems.length) await runDraw();
    updateUsage();
    setStatus(sessionRefreshed === false
      ? 'Backup importado. Não foi possível atualizar os dados agora.' : 'Backup local importado.');
  }

  window.collagerLocalWorkspace = {
    ready, coverKey, rememberCover, forgetCover, applyCovers, restoreCovers, scheduleSave,
    isRestoring: () => restoring,
    snapshotCovers: () => loaded ? [...covers] : null,
  };

  toggle.addEventListener('change', async () => {
    ++saveVersion;
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(preferenceKey, toggle.checked ? '1' : '0');
      if (toggle.checked) {
        setStatus('Salvamento local ativado.');
        scheduleSave();
      } else {
        await writeQueue.catch(() => {});
        await store.deleteSession();
        session = null;
        updateUsage();
        setStatus('Salvamento da sessão desativado.');
      }
    } catch { setStatus('Não foi possível atualizar o armazenamento local.', true); }
  });
  exportButton.addEventListener('click', () => exportBackup().catch(() => setStatus('Não foi possível exportar o backup.', true)));
  document.getElementById('local-backup-import').addEventListener('click', () => document.getElementById('local-backup-file').click());
  document.getElementById('local-backup-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) await importBackup(file).catch(() => setStatus('Backup local inválido ou armazenamento indisponível.', true));
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) scheduleSave(); });
  document.addEventListener('collager:recent-refreshed', () => {
    if (!awaitingLiveRefresh || restoring) return;
    awaitingLiveRefresh = false;
    setStatus('Sessão restaurada e atualizada.');
  });
  document.addEventListener('collager:language-changed', () => {
    updateUsage();
    if (status.dataset.message) setStatus(status.dataset.message);
  });

  (async () => {
    await ready;
    try {
      toggle.checked = localStorage.getItem(preferenceKey) === '1';
      if (toggle.checked) {
        session = await store.session();
        if (session) await restoreSession(session);
      }
      updateUsage();
    } catch { setStatus('Não foi possível restaurar a sessão local.', true); }
    finally { restoring = false; }
  })();
})();
