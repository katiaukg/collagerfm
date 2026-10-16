'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const auth = require('../api/lastfm-auth');

async function suggested(country) {
  let body;
  const response = { setHeader() {}, status() { return this; }, send(value) { body = JSON.parse(value); } };
  await auth({ method: 'GET', url: '/api/lastfm-auth?action=status', headers: { host: 'localhost:8767', 'x-vercel-ip-country': country } }, response);
  return body.suggestedLocale;
}

(async () => {
  assert.equal(await suggested('BR'), 'pt-BR');
  assert.equal(await suggested('US'), 'en-US');
  assert.equal(await suggested('PT'), 'en-US');
  assert.equal(await suggested(''), null);
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    for (const entry of [
      { suggested: 'pt-BR', browser: 'en-US', expected: 'pt-BR', legacy: true },
      { suggested: 'en-US', browser: 'pt-BR', expected: 'en-US' },
      { suggested: 'en-US', browser: 'pt-PT', expected: 'en-US' },
      { suggested: null, browser: 'pt-BR', expected: 'pt-BR' },
      { suggested: null, browser: 'pt-PT', expected: 'en-US' },
    ]) {
      const context = await browser.newContext({ locale: entry.browser });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { configured: false, connected: false, suggestedLocale: entry.suggested } });
        if (url.hostname !== '127.0.0.1') return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      if (entry.legacy) await page.addInitScript(() => localStorage.setItem('collagerfm-language', 'en-US'));
      await page.goto('http://127.0.0.1:8767/lastfm-collage.html');
      await page.evaluate(() => collagerI18n.ready);
      assert.equal(await page.locator('html').getAttribute('lang'), entry.expected);
      assert.equal(await page.evaluate(() => localStorage.getItem('collagerfm-language-manual')), null);
      if (entry.suggested === 'pt-BR') {
        await page.evaluate(() => collagerI18n.setLocale('en-US'));
        await page.reload();
        await page.evaluate(() => collagerI18n.ready);
        assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
      }
      await context.close();
    }
    console.log('Passed: Brazil, other countries, browser-region fallback, legacy default migration and persistent manual language selection.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
