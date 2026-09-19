'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { configured: false, connected: false } });
      if (url.hostname !== '127.0.0.1') return route.abort();
      return route.continue();
    });
    await page.goto('http://127.0.0.1:8767/lastfm-collage.html');
    await page.waitForFunction(() => typeof openTextEditModal === 'function');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ['recent', 'loved', 'obsessions']) {
        await page.evaluate(mode => {
          closeTextEditModal();
          currentType = mode;
          currentPeriod = '7day';
          periodMode = 'custom';
          document.getElementById('username').value = 'security-test-user';
          generatedQueryState = { ...capturePendingQueryState(), mode, effectiveType: 'tracks', cols: 1, rows: 1 };
          const item = { name: 'Original track', artist: { name: 'Original artist' }, albumName: 'Original album', playcount: 1,
            _temporalType: mode, _recentTimestamp: 1750000000 };
          allFetchedItems = [item]; currentItems = [item]; paintedItems = [item]; customTexts = {};
          drawCollage = async () => {};
          scheduleDownloadRefresh = () => {};
          openTextEditModal(0);
        }, mode);
        for (const id of ['edit-text-main', 'edit-text-album', 'edit-text-sub']) {
          assert.equal(await page.locator(`#${id}`).getAttribute('readonly'), null);
        }
        await page.locator('#edit-text-main').fill('Edited <script>window.injected = true</script>');
        await page.locator('#edit-text-album').fill('Edited album');
        await page.locator('#edit-text-sub').fill('Edited artist');
        if (process.env.UI_SCREENSHOT_DIR && mode === 'recent') {
          fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `editor-${width}.png`) });
        }
        await page.locator('#edit-text-save').click();
        const saved = await page.evaluate(() => ({ edited: customTexts[0], original: allFetchedItems[0].name, injected: Boolean(window.injected) }));
        assert(saved.edited.main.startsWith('Edited <script>'));
        assert.equal(saved.edited.album, 'Edited album');
        assert.equal(saved.original, 'Original track');
        assert.equal(saved.injected, false);
        await page.evaluate(() => openTextEditModal(0));
        assert.equal(await page.locator('#edit-text-sub').inputValue(), 'Edited artist');
        const overflow = await page.locator('#text-edit-modal-box').evaluate(el => el.scrollWidth > el.clientWidth + 1);
        assert.equal(overflow, false);
        if (mode === 'obsessions') {
          assert.equal(await page.evaluate(() => capturePendingQueryState().period), 'overall');
        }
        await page.locator('#edit-text-reset').click();
        assert.equal(await page.evaluate(() => Boolean(customTexts[0])), false);
      }
    }
    assert.deepEqual(errors, []);
    console.log('Editor: local title/album/artist edits, restore and all-time obsessions passed at 1280px and 390px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
