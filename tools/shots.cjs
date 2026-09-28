// Batch headless screenshots: node tools/shots.cjs WxH url1 out1 [url2 out2 ...]
// Pages set window.__ready = true when their frame is done (fallback: 20 s).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [size, ...pairs] = process.argv.slice(2);
  const [w, h] = size.split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (let i = 0; i < pairs.length; i += 2) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const logs = [];
    page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await page.goto(pairs[i]);
    try { await page.waitForFunction('window.__ready === true', null, { timeout: +(process.env.WAIT || 60000), polling: 250 }); } catch (e) { logs.push('timeout waiting for __ready'); }
    await page.screenshot({ path: pairs[i + 1], timeout: 120000 });
    if (logs.length) console.log(pairs[i + 1] + '\n  ' + logs.slice(0, 20).join('\n  '));
    await page.close();
  }
  await browser.close();
})();
