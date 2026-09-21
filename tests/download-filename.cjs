'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:8767/lastfm-collage.html');
    const names = await page.evaluate(() => {
      const now = new Date(2026, 8, 20, 13, 4, 5);
      downloadFilenameMode = 'saved-at';
      const savedAt = getDownloadBaseName(now);
      downloadFilenameMode = 'period';
      generatedQueryState = { mode: 'albums', periodMode: 'preset', period: '6month' };
      const preset = getDownloadBaseName(now);
      generatedQueryState = { mode: 'tracks', periodMode: 'custom', dateFrom: '2026-01-02', dateTo: '2026-03-04' };
      const custom = getDownloadBaseName(now);
      headerSubtitleOverride = 'Dias Atrás Ai Man';
      const customText = getDownloadBaseName(now);
      headerSubtitleOverride = null;
      return { savedAt, preset, custom, customText };
    });
    assert.equal(names.savedAt, 'collager_albums_20260920130405');
    assert.equal(names.preset, 'collager_albums_6m_20260920');
    assert.equal(names.custom, 'collager_tracks_custom20260102-to-20260304_20260920');
    assert.equal(names.customText, 'collager_tracks_diasatrasaiman_20260920');
    console.log('Download file names: save timestamp, preset period, custom dates and custom header text passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
