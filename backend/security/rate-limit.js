const RateLimit = require('express-rate-limit');

const apiLimiter = RateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path === '/health';
  },
});

module.exports = apiLimiter;
