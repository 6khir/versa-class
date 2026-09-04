const http = require('node:http');

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJson(raw) {
  if (!raw || !String(raw).trim()) return {};
  return JSON.parse(raw);
}

async function dispatch(req, res, {
  port,
  getAppName,
  getHandlers,
  getHealth
}) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const handlers = getHandlers() || {};

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    return res.end();
  }

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    const health = typeof getHealth === 'function' ? (getHealth() || {}) : {};
    return json(res, 200, {
      success: true,
      app: getAppName(),
      port,
      ...health
    });
  }

  if (req.method === 'GET' && (path === '/state' || path === '/snapshot')) {
    if (!handlers['state:get']) return json(res, 503, { success: false, error: 'App is not ready yet.' });
    const result = await handlers['state:get']({});
    return json(res, 200, { success: true, result });
  }

  if (req.method === 'GET' && (path === '/engine' || path === '/ai-engine')) {
    const health = typeof getHealth === 'function' ? (getHealth() || {}) : {};
    return json(res, 200, { success: true, engine: health.engine || null, result: health });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { success: false, error: 'Method not allowed' });
  }

  const body = parseJson(await readBody(req));

  const invoke = async (channel, args = []) => {
    if (!handlers[channel]) {
      const error = new Error(`Channel not found: ${channel}`);
      error.statusCode = 404;
      throw error;
    }
    return handlers[channel]({}, ...args);
  };

  try {
    if (path === '/engine' || path === '/ai-engine') {
      const engine = body.engine ?? body.args?.[0];
      const result = await invoke('settings:set-ai-engine', [engine]);
      return json(res, 200, { success: true, result });
    }
    if (path === '/queue/start') {
      const projectId = body.projectId ?? body.args?.[0];
      const options = {
        automation: true,
        ...(body.options && typeof body.options === 'object' ? body.options : {}),
        ...(body.args?.[1] && typeof body.args[1] === 'object' ? body.args[1] : {}),
        engine: body.engine ?? body.options?.engine,
        outputDir: body.outputDir ?? body.options?.outputDir
      };
      const result = await invoke('queue:start', [projectId, options]);
      return json(res, 200, { success: true, result });
    }
    if (path === '/queue/pause') {
      const result = await invoke('queue:pause', []);
      return json(res, 200, { success: true, result });
    }
    if (path === '/continue' || path === '/automation/continue') {
      const result = await invoke('automation:continue', [body]);
      return json(res, 200, { success: true, result });
    }

    const channel = body.channel;
    const args = Array.isArray(body.args) ? body.args : [];
    if (!channel) {
      return json(res, 400, { success: false, error: 'Missing channel. Use { channel, args } or a dedicated path such as /engine or /continue.' });
    }
    const result = await invoke(channel, args);
    return json(res, 200, { success: true, result });
  } catch (error) {
    return json(res, error.statusCode || 500, {
      success: false,
      error: error.message,
      code: error.code || null,
      stack: error.stack
    });
  }
}

function startAutomationHttp({ port, getAppName, getHandlers, getHealth }) {
  const server = http.createServer((req, res) => {
    dispatch(req, res, { port, getAppName, getHandlers, getHealth }).catch((error) => {
      json(res, 500, { success: false, error: error.message });
    });
  });
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.warn(`[automation-http] 127.0.0.1:${port} already in use; debug API disabled for this instance.`);
      return;
    }
    console.error(error);
  });
  try {
    server.listen(port, '127.0.0.1');
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      console.warn(`[automation-http] 127.0.0.1:${port} already in use; debug API disabled for this instance.`);
      return server;
    }
    throw error;
  }
  return server;
}

module.exports = { startAutomationHttp };
