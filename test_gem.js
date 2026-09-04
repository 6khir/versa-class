const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  // Use the system Chrome
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://gemini.google.com/gem/863ed43ea7fa');
  await page.waitForTimeout(5000);
  const title = await page.title();
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("TITLE:", title);
  console.log("BODY:", bodyText.replace(/\n/g, ' '));
  await browser.close();
})();
