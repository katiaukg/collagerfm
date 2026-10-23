'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const row = (id, name, date) => `<li class="obsession-history-item"><h3 class="obsession-history-item-heading">${name}</h3><p class="obsession-history-item-artist"><a>Artist &amp; Name</a></p><p class="obsession-history-item-date"><a href="/user/test-user/obsessions/${id}">${date}</a></p><div style="background-image:url(https://lastfm.freetls.fastly.net/i/u/300x300/test.png)"></div><a data-track-url="/music/Artist/_/Track"></a></li>`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    let challenge = false;
    let empty = false;
    let requests = 0;
    await page.route('**/*', route => {
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/obsessions')) {
        requests++;
        const second = url.searchParams.get('page') === '2';
        return route.fulfill({ contentType: 'text/html', body: challenge ? '<title>Client Challenge</title>'
          : `<ul class="obsession-history-list">${empty ? '' : second ? row('2', 'Track Two', '22 out. 2026') : row('1', 'Track One', '23 Oct 2026')}</ul>${!empty && !second ? '<a href="?page=2">Next</a>' : ''}` });
      }
      return route.fulfill({ contentType: 'text/html', body: '<html></html>' });
    });
    await page.goto('https://www.last.fm/user/test-user');
    await page.evaluate(() => {
      window.chrome = { runtime: { onMessage: { addListener(listener) { window.testListener = listener; } } } };
    });
    await page.addScriptTag({ content: fs.readFileSync(require.resolve('../extension/lastfm-content.js'), 'utf8') });
    const read = limit => page.evaluate(limit => new Promise(resolve => window.testListener({
      channel: 'collager-lastfm-page', action: 'readObsessions', payload: { username: 'test-user', limit },
    }, {}, resolve)), limit);
    const result = await read(50);
    assert.equal(result.ok, true);
    assert.deepEqual(result.obsessions.map(item => item.name), ['Track One', 'Track Two']);
    assert.deepEqual(result.obsessions.map(item => item.dateIso), ['2026-10-23', '2026-10-22']);
    assert.equal(result.obsessions[0].artist, 'Artist & Name');
    assert.equal(requests, 2);
    const firstOnly = await read(1);
    assert.equal(firstOnly.obsessions.length, 1);
    challenge = true;
    const blocked = await read(10);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'LASTFM_ACCESS_CHALLENGE');
    assert.equal(blocked.openUrl, 'https://www.last.fm/user/test-user/obsessions');
    assert.equal(blocked.obsessions, undefined);
    challenge = false;
    empty = true;
    const none = await read(10);
    assert.equal(none.ok, true);
    assert.deepEqual(none.obsessions, []);

    const local = await browser.newPage();
    let serverRequests = 0;
    await local.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/obsessions') {
        serverRequests++;
        return route.fulfill({ status: 503, json: { error: 'Access check', code: 'LASTFM_ACCESS_CHALLENGE' } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { configured: false, connected: false } });
      if (url.hostname !== '127.0.0.1') return route.abort();
      return route.continue();
    });
    await local.addInitScript(() => {
      window.testCapabilities = ['readObsessions'];
      window.addEventListener('message', event => {
        if (event.data?.type !== 'collager-lastfm-extension-request') return;
        const result = event.data.action === 'ping' ? { available: true, capabilities: window.testCapabilities }
          : { obsessions: [{ name: 'From browser', artist: 'Artist', dateIso: '2026-10-23' }] };
        window.postMessage({ type: 'collager-lastfm-extension-response', requestId: event.data.requestId, ok: true, result }, location.origin);
      });
    });
    await local.goto('http://127.0.0.1:8767/lastfm-collage.html');
    await local.waitForFunction(() => Boolean(window.collagerLocalWorkspace));
    await local.evaluate(() => { collagerLastfmExtensionAvailable = true; });
    assert.equal(await local.evaluate(async () => (await getRecentObsessionItems('test-user'))[0].name), 'From browser');
    assert.equal(serverRequests, 0);
    const oldExtensionError = await local.evaluate(async () => {
      window.testCapabilities = [];
      collagerLastfmExtensionCapabilities = new Set();
      try { await getRecentObsessionItems('test-user'); } catch (error) { return error.message; }
    });
    assert(oldExtensionError.includes('1.1.0'));
    console.log('Passed: browser obsession reader, pagination, limits, EN/PT dates, empty history and explicit access challenge. No account writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
