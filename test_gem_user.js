const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const profileDir = path.join(process.env.HOME, 'Library/Application Support/TPT VERSA/ChromeProfile');
  const browser = await chromium.launchPersistentContext(profileDir, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const page = await browser.newPage();
  await page.goto('https://gemini.google.com/gem/863ed43ea7fa', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  await page.screenshot({ path: 'gem_screenshot.png' });
  const html = await page.content();
  fs.writeFileSync('gem_html.txt', html);
  
  await browser.close();
})();
