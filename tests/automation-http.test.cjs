const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startAutomationHttp } = require('../src/automation-http.cjs');

function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const blocker = http.createServer();
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', () => resolve(blocker));
  });
}

test('startAutomationHttp does not throw when the debug port is already bound', async () => {
  const blocker = await listenOnce(0);
  const port = blocker.address().port;
  try {
    const server = startAutomationHttp({
      port,
      getAppName: () => 'VERSA CLASS',
      getHandlers: () => ({}),
      getHealth: () => ({ ready: false })
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(server.listening, false);
    server.close();
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
