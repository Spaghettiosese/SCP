// Headless screenshot helper: node tools/shot.cjs <url> <out.png> [waitMs] [js-to-eval]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [url, out, wait = '4000', js = '', w = '1400', h = '860'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(+wait);
  if (js) { await page.evaluate(js); await page.waitForTimeout(1500); }
  await page.screenshot({ path: out });
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
