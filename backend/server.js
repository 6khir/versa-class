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

// Data endpoint
app.get('/api/data', (req, res) => {
  res.json({ 
    message: 'VERSA CLASS API',
    cached: true,
    timestamp: new Date()
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
