'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = 'http://127.0.0.1:8767/lastfm-collage.html';
async function setup(context) {
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.pathname.startsWith('/api/')) return route.fulfill({ json: { configured: false, connected: false } });
    if (target.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.collagerLocalWorkspace));
  await page.evaluate(() => collagerLocalWorkspace.ready);
  return { page, errors };
}

async function seed(page, mode = 'tracks', period = '7day', reverse = false) {
  await page.evaluate(async ({ mode, period, reverse }) => {
    closeTextEditModal();
    currentType = mode;
    currentPeriod = period;
    const type = ['recent', 'loved', 'obsessions'].includes(mode) ? 'tracks' : mode;
    document.getElementById('username').value = 'local-test-user';
    document.getElementById('cols').value = '3';
    document.getElementById('rows').value = '3';
    generatedQueryState = { ...capturePendingQueryState(), mode, effectiveType: type, cols: 3, rows: 3 };
    generationQueryState = null;
    const item = (name, artist, album) => ({ name, artist: { name: artist }, albumName: album, playcount: 10, image: [] });
    allFetchedItems = [item('Chosen item', 'Artist A', period === '7day' ? 'Album A' : 'Other album'), item('Other item', 'Artist B', 'Album B'), item('Chosen item', 'Artist B', 'Album B')];
    if (reverse) allFetchedItems.reverse();
    currentItems = allFetchedItems.slice();
    customImages = {}; customImageRefs = {}; customTexts = {}; customPlays = {}; mergeRecords = {};
    deletedPoolIndices = new Set(); poolImageCache.clear();
    headerLabelText = 'Test collage';
    activeCollageMemoryContext = getCollageMemoryContext();
    await drawCollage(currentItems, type, 3, 3, headerLabelText, '', undefined, { cacheOnlyImages: true });
    document.getElementById('collage-wrap').classList.add('visible');
    recordTimelineAction('Fixture ready');
  }, { mode, period, reverse });
}

async function upload(page, color = '#e12c47') {
  const data = await page.evaluate(color => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    canvas.getContext('2d').fillStyle = color;
    canvas.getContext('2d').fillRect(0, 0, 24, 24);
    openTextEditModal(0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  await page.locator('#modal-image-input').setInputFiles({ name: 'chosen.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Capa preservada neste navegador.');
  await page.waitForFunction(() => customImageRefs[0]?.kind === 'preserved');
  await page.locator('#edit-text-cancel').click();
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const { page, errors } = await setup(context);
    await seed(page);
    await upload(page);
    assert.equal(await page.evaluate(async () => (await CollagerLocalStore.covers())[0].blob.size > 0), true);
    assert.equal(await page.evaluate(() => CollagerLocalStore.session()), undefined);

    await seed(page, 'recent', 'overall', true);
    const association = await page.evaluate(() => ({ match: Boolean(customImages[2]), wrongArtist: Boolean(customImages[0]), wrongTitle: Boolean(customImages[1]) }));
    assert.deepEqual(association, { match: true, wrongArtist: false, wrongTitle: false });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.collagerLocalWorkspace));
    await seed(page, 'loved', '1month', true);
    assert.equal(await page.evaluate(() => Boolean(customImages[2])), true);

    await page.evaluate(() => {
      document.getElementById('username').value = '  Local-Test-User  ';
      customTexts[2] = { main: 'My saved title' };
      document.getElementById('apikey').value = 'SECRET_NOT_IN_BACKUP';
      document.getElementById('inline-youtube-apikey').value = 'YOUTUBE_SECRET_NOT_IN_BACKUP';
      headerSubtitleOverride = 'Saved header';
      headerImage = customImages[2];
      headerImageTransform = { x: 7, y: 3, zoom: 130 };
      deletedPoolIndices.add(1);
      mergeRecords[1] = { targetPoolIdx: 2, amount: 10 };
      customPlays[2] = 20;
      document.getElementById('header-use-username-label').checked = true;
      document.getElementById('header-username-size').value = '42';
    });
    await page.locator('label[for="local-session-enabled"]').click();
    await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Sessão salva neste navegador.');
    const saved = await page.evaluate(() => CollagerLocalStore.session());
    assert(saved.bytes > 0);
    assert.equal(saved.username, '  Local-Test-User  ');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Cópia local exibida. Não foi possível atualizar os dados agora.');
    const resumed = await page.evaluate(() => ({ title: customTexts[2]?.main, image: Boolean(customImages[2]), mode: getDrawType(), header: headerSubtitleOverride, count: currentItems.length, headerImage: Boolean(headerImage), transform: headerImageTransform, merged: mergeRecords[1].targetPoolIdx }));
    assert.deepEqual(resumed, { title: 'My saved title', image: true, mode: 'tracks', header: 'Saved header', count: 2, headerImage: true, transform: { x: 7, y: 3, zoom: 130 }, merged: 2 });
    const readAccountFields = () => page.evaluate(() => ({
      usernames: ['username', 'desktop-menu-username', 'mobile-quick-username'].map(id => document.getElementById(id).value),
      headerUsesUsername: document.getElementById('header-use-username-label').checked,
      headerUsernameSize: document.getElementById('header-username-size').value,
    }));
    const expectedAccount = { usernames: Array(3).fill('  Local-Test-User  '), headerUsesUsername: true, headerUsernameSize: '42' };
    assert.deepEqual(await readAccountFields(), expectedAccount);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#local-backup-export').click();
    const download = await downloadPromise;
    const backup = fs.readFileSync(await download.path());
    assert(!backup.toString().includes('SECRET_NOT_IN_BACKUP'));
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const imported = await setup(fresh);
    await imported.page.locator('#local-backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await imported.page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Backup importado. Não foi possível atualizar os dados agora.');
    assert.equal(await imported.page.evaluate(() => customTexts[2].main), 'My saved title');
    assert.equal(await imported.page.evaluate(() => Boolean(customImages[2])), true);
    await imported.page.reload();
    await imported.page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Cópia local exibida. Não foi possível atualizar os dados agora.');
    assert.deepEqual(await imported.page.evaluate(() => ({
      usernames: ['username', 'desktop-menu-username', 'mobile-quick-username'].map(id => document.getElementById(id).value),
      headerUsesUsername: document.getElementById('header-use-username-label').checked,
      headerUsernameSize: document.getElementById('header-username-size').value,
    })), expectedAccount);
    assert.equal(await imported.page.locator('#local-workspace-panel').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    if (process.env.UI_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await imported.page.locator('#local-workspace-panel').scrollIntoViewIfNeeded();
      await imported.page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'local-workspace-mobile.png'), animations: 'disabled' });
      await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'local-workspace-desktop.png'), animations: 'disabled' });
    }

    await page.locator('label[for="local-session-enabled"]').click();
    await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Salvamento da sessão desativado.');
    assert.equal(await page.evaluate(() => CollagerLocalStore.session()), undefined);
    assert.equal(await page.evaluate(async () => (await CollagerLocalStore.covers()).length), 1);
    await page.evaluate(() => openTextEditModal(currentItems.indexOf(allFetchedItems[2])));
    await page.locator('#edit-image-reset').click();
    assert.equal(await page.evaluate(async () => (await CollagerLocalStore.covers()).length), 0);
    await page.evaluate(() => restoreStatusHistoryEntry(getPreviousTimelineEntry()));
    assert.equal(await page.evaluate(async () => (await CollagerLocalStore.covers()).length), 1);
    assert.equal(await page.evaluate(() => Boolean(customImages[2])), true);

    await page.locator('#local-backup-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"collager-local-backup","version":1,"covers":[],"__proto__":{"injected":true}}') });
    await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Backup local inválido ou armazenamento indisponível.');
    assert.equal(await page.evaluate(() => ({}).injected), undefined);

    for (const mode of ['artists', 'albums']) {
      await seed(imported.page, mode);
      await upload(imported.page, '#218c66');
      await seed(imported.page, mode, '6month', true);
      assert.equal(await imported.page.evaluate(() => Boolean(customImages[2])), true);
      assert.equal(await imported.page.evaluate(() => Boolean(customImages[1])), false);
      assert.equal(await imported.page.evaluate(() => Boolean(customImages[0])), mode === 'artists');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(imported.errors, []);
    console.log('Passed: cover identity, periods/modes, reload, opt-in session restore, backup round-trip, no credentials, reset/undo, mobile layout and invalid backup.');
    await fresh.close();
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
