const express = require('express');
const cors = require('cors');
try {
  require('dotenv').config();
} catch {
  if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(); } catch {}
  }
}

const app = express();
const apiLimiter = require('./security/rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const logger = require('./core/logger');
const cacheManager = require('./core/cache');
const batchQueue = require('./core/batch-queue');
const Validators = require('./security/validators');

// Wire batch queue handler
batchQueue.setFlushHandler(async (batch) => {
  logger.info({ count: batch.operations.length }, 'Flushed batched operations');
});

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  logger.info({ method: req.method, path: req.path }, 'Incoming request');
  next();
});

// Log all outgoing responses
app.use((req, res, next) => {
  res.on('finish', () => {
    logger.info(
      { method: req.method, path: req.path, status: res.statusCode },
      'Request completed'
    );
  });
  next();
});

app.use('/api/', apiLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Data endpoint with active caching
app.get('/api/data', async (req, res, next) => {
  try {
    const cachedItem = cacheManager.cache.get('api_data');
    if (cachedItem) {
      return res.json({
        ...cachedItem,
        cached: true
      });
    }
    const fresh = {
      message: 'VERSA CLASS API',
      timestamp: new Date().toISOString()
    };
    cacheManager.set('api_data', fresh, 60);
    res.json({
      ...fresh,
      cached: false
    });
  } catch (err) {
    next(err);
  }
});

// Validated project creation endpoint
app.post('/api/projects', Validators.validateBody(Validators.validateProject), (req, res) => {
  res.status(201).json({
    success: true,
    project: req.validatedBody
  });
});

// Batch operation queue endpoint
app.post('/api/batch', (req, res) => {
  batchQueue.add(req.body);
  res.status(202).json({
    queued: true,
    queueLength: batchQueue.queue.length
  });
});

// Error testing endpoint (disabled in production)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/test-error', (req, res) => {
    throw new Error('Secret DB connection string: postgres://secret@db');
  });
}

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Centralized error handler to prevent stack/secret leaks to clients
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logger.error(
    {
      err: { message: err.message, stack: err.stack },
      method: req.method,
      path: req.path,
      status
    },
    'Unhandled server error'
  );

  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : err.message
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
