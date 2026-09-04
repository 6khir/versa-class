// src/canva-telemetry.cjs
// Telemetry service for Canva live dashboard.
// Provides a WebSocket server that emits JSON events to connected renderer.
// Exposes startTelemetry() -> returns port, stopTelemetry() to close, and emit(event).

const { Server } = require('ws');
let wss = null;
let clients = new Set();
let serverPort = null;

/**
 * Starts a WebSocket server on a random free port.
 * Returns the bound port number.
 */
function startTelemetry() {
  if (wss) return serverPort; // already started
  wss = new Server({ port: 0 }); // 0 => random free port
  wss.on('listening', () => {
    serverPort = wss.address().port;
    // console.log(`[Canva Telemetry] listening on ws://localhost:${serverPort}`);
  });
  wss.on('connection', (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
  return new Promise((resolve) => {
    wss.once('listening', () => resolve(serverPort));
  });
}

/**
 * Stops the telemetry server and clears all connections.
 */
function stopTelemetry() {
  if (!wss) return;
  for (const s of clients) {
    try { s.terminate(); } catch (_) {}
  }
  clients.clear();
  wss.close();
  wss = null;
  serverPort = null;
}

/**
 * Emit an event object to all connected clients.
 * The event is JSON-stringified.
 * @param {Object} payload - arbitrary data describing the telemetry event.
 */
function emit(payload) {
  if (!wss) return;
  const message = JSON.stringify(payload);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

module.exports = { startTelemetry, stopTelemetry, emit };
