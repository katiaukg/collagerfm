'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:8767';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    for (const mode of ['albums', 'recent']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      let phase = 'old';
      const requests = [];
      let writes = 0;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (url.pathname === '/fixture.png') return route.fulfill({ contentType: 'image/png', body: png });
        if (url.pathname.startsWith('/api/')) {
          if (url.pathname === '/api/lastfm-write') writes++;
          let params = {};
          try { params = route.request().postDataJSON()?.params || {}; } catch {}
          requests.push({ phase, ...params });
          const method = String(params.method || '').toLowerCase();
          if (method === 'user.getinfo') return route.fulfill({ json: { user: { name: 'test-user', subscriber: '0' } } });
          if (method === 'user.gettopalbums') {
            const album = (name, playcount) => ({ name, artist: { name: 'Artist' }, playcount, image: [{ size: 'extralarge', '#text': `${origin}/fixture.png` }] });
            return route.fulfill({ json: { topalbums: { album: phase === 'old'
              ? [album('Retained album', 2), album('Old album', 1)]
              : [album('New album', 30), album('Retained album', 12)] } } });
          }
          if (method === 'user.getrecenttracks') {
            const timestamp = Math.floor(Date.now() / 1000) + (phase === 'live' ? 20 : phase === 'fresh' ? 10 : 0);
            return route.fulfill({ json: { recenttracks: { '@attr': { totalPages: '1', total: '1' }, track: [{ name: `${phase} track`,
              artist: { '#text': 'Artist' }, album: { '#text': 'Album' }, date: { uts: String(timestamp) },
              image: [{ size: 'extralarge', '#text': `${origin}/fixture.png` }] }] } } });
          }
          if (method === 'album.getinfo') return route.fulfill({ json: { album: { image: [{ size: 'extralarge', '#text': `${origin}/fixture.png` }] } } });
          return route.fulfill({ json: { configured: false, connected: false } });
        }
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/lastfm-collage.html`);
      await page.waitForFunction(() => Boolean(window.collagerLocalWorkspace));
      await page.locator('#username').fill('test-user');
      await page.locator(`.type-btn[data-type="${mode}"]`).click();
      await page.evaluate(async () => {
        imageSources.albums = new Set(['lastfm']);
        imageSources.tracks = new Set(['lastfm']);
        imageSources.recent = new Set(['lastfm']);
        await generate();
      });
      await page.evaluate(mode => {
        stopRecentLiveUpdates();
        if (mode === 'albums') customTexts[0] = { main: 'My album title' };
      }, mode);
      await page.locator('label[for="local-session-enabled"]').click();
      await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Sessão salva neste navegador.');
      await page.evaluate(async () => {
        const saved = await CollagerLocalStore.session();
        saved.savedAt = Date.now() - 7 * 24 * 60 * 60 * 1000;
        await CollagerLocalStore.putSession(saved);
      });
      phase = 'fresh';
      await page.reload();
      await page.waitForFunction(() => document.getElementById('local-workspace-status').dataset.message === 'Sessão restaurada e atualizada.');
      assert.equal(await page.locator('#username').inputValue(), 'test-user');
      if (mode === 'albums') {
        const result = await page.evaluate(() => ({ names: currentItems.map(item => item.name),
          title: customTexts[allFetchedItems.findIndex(item => item.name === 'Retained album')]?.main,
          plays: allFetchedItems.find(item => item.name === 'Retained album').playcount }));
        assert.deepEqual(result.names, ['New album', 'Retained album']);
        assert.equal(result.title, 'My album title');
        assert.equal(result.plays, 12);
        assert(requests.some(request => request.phase === 'fresh' && request.method?.toLowerCase() === 'user.gettopalbums' && request.period === '7day'));
      } else {
        assert.equal(await page.evaluate(() => currentItems[0].name), 'fresh track');
        assert.equal(await page.evaluate(() => Boolean(recentLivePoll)), true);
        phase = 'live';
        await page.evaluate(() => { clearTimeout(recentLiveTimer); return recentLivePoll(); });
        assert.equal(await page.evaluate(() => currentItems[0].name), 'live track');
      }
      assert.equal(writes, 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Passed: week-old sessions refresh 7-day albums, preserve edits, restore username and restart live Recent updates without account writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
