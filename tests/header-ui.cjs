'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { configured: false } });
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:8767/lastfm-collage.html');
    await page.addStyleTag({ content: 'body .app .preview-area { display: grid !important; position: fixed; inset: 70px 0 90px; height: auto; z-index: 100; }' });
    for (const width of [1600, 1000, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        document.body.dataset.mobileView = 'preview';
        document.querySelector('.preview-area').style.setProperty('display', 'grid', 'important');
        document.getElementById('collage-wrap').classList.add('visible');
        const stack = document.getElementById('collage-canvas-stack');
        stack.style.width = 'min(600px, 90vw)';
        stack.style.height = '600px';
        const canvas = document.getElementById('collage-canvas');
        canvas.width = 600; canvas.height = 600; canvas.dataset.headerHeight = '90';
        canvas.style.width = '100%'; canvas.style.height = '600px';
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#99e9da'; ctx.fillRect(0, 0, 600, 90);
        ctx.fillStyle = '#111'; ctx.font = 'bold 36px Arial'; ctx.fillText('Recent tracks', 40, 55);
        showHeaderChk.checked = true;
        headerInteractiveEnabled = true; headerInteractiveGridVisible = true;
        headerPosition = 'top';
        headerInteractiveLayout = { title: { x: .4, y: .5, size: 36 }, logo: { x: .85, y: .5, size: 18 } };
        lastInteractiveHeaderModel = { headerRect: { x: 0, y: 0, w: 600, h: 90 }, components: [
          { key: 'title', label: 'Title', x: .4, y: .5, boxW: 300, boxH: 48, size: 36 },
          { key: 'logo', label: 'Logo', x: .85, y: .5, boxW: 100, boxH: 24, size: 18 }
        ] };
        scheduleInteractiveHeaderRedraw = () => syncInteractiveHeaderEditor();
        syncInteractiveHeaderEditor();
      });
      const toolbar = page.locator('#header-box-toolbar');
      console.log('Viewport', width);
      await toolbar.waitFor({ state: 'visible' });
      assert.equal(await toolbar.evaluate(el => el.parentElement === document.body), true);
      assert.equal(await toolbar.evaluate(el => getComputedStyle(el).position), 'fixed');
      const box = await toolbar.boundingBox();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1);
      await page.locator('#header-box-selection').selectOption('title');
      await page.locator('#header-box-size').fill('52');
      await page.locator('#header-box-size').press('Enter');
      assert.equal(await page.evaluate(() => headerInteractiveLayout.title.size), 52);
      await page.locator('[data-header-step="1"]').click();
      assert.equal(await page.evaluate(() => headerInteractiveLayout.title.size), 53);
      const increaseButton = await page.locator('[data-header-step="1"]').boundingBox();
      await page.mouse.move(increaseButton.x + increaseButton.width / 2, increaseButton.y + increaseButton.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(240);
      await page.mouse.up();
      assert((await page.evaluate(() => headerInteractiveLayout.title.size)) >= 55);
      await page.locator('[data-header-step="-1"]').click();
      await page.locator('#header-box-rotate').click();
      assert.equal(await page.evaluate(() => headerInteractiveLayout.title.rotation), 90);
      await page.locator('#header-box-lock').click();
      assert.equal(await page.locator('#header-box-size').isDisabled(), true);
      await page.locator('#header-box-lock').click();
      assert.equal(await page.locator('#header-box-size').isDisabled(), false);
      assert.equal(await toolbar.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      if (process.env.UI_SCREENSHOT_DIR) await toolbar.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/header-${width}.png` });
      await page.evaluate(() => { headerInteractiveGridVisible = false; syncInteractiveHeaderEditor(); });
      assert.equal(await toolbar.isVisible(), false);
      await page.locator('#interactive-header-grid-toggle').click();
      await toolbar.waitFor({ state: 'visible' });
      for (const zoom of [.85, 1, 1.5]) {
        await page.evaluate(zoom => {
          headerInteractiveGridVisible = false;
          const center = document.querySelector('.collage-center');
          center.style.overflow = 'hidden';
          const stack = document.getElementById('collage-canvas-stack');
          const size = center.clientWidth * zoom;
          stack.style.width = `${size}px`;
          stack.style.maxWidth = 'none';
          document.getElementById('collage-wrap').style.maxWidth = 'none';
          syncInteractiveHeaderEditor();
        }, zoom);
        const visible = await page.locator('#interactive-header-grid-toggle').evaluate(button => {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return button === hit || button.contains(hit);
        });
        assert.equal(visible, true, `Launch button must be clickable at ${width}px / ${zoom * 100}%`);
        await page.locator('#interactive-header-grid-toggle').click();
        await toolbar.waitFor({ state: 'visible' });
      }
      const grip = await page.locator('#header-panel-grip').boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(width - 10, 300, { steps: 8 });
      await page.mouse.up();
      const moved = await page.locator('#interactive-header-control-panel').boundingBox();
      assert(moved.x >= 0 && moved.x + moved.width <= width);
      assert.equal(await page.locator('#interactive-header-control-panel').evaluate(el => el.parentElement === document.body), true);
    }
    assert.deepEqual(errors, []);
    console.log('Header toolbar: size, rotate, lock, selection and visibility passed on desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
