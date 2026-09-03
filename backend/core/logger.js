const pino = require('pino');

let prettyTarget = 'pino-pretty';
try {
  prettyTarget = require.resolve('pino-pretty');
} catch {
  // fallback to module name
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: prettyTarget,
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  },
});

module.exports = logger;
