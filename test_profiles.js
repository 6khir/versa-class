const { BrowserController } = require('./src/browser-controller.cjs');
const b = new BrowserController({profileDir: '.', downloadDir: '.'});
(async () => {
  console.log(await b.getSystemProfiles());
})();
