const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

function installSecurity(app, config) {
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet({
    contentSecurityPolicy: config.production ? {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
        frameAncestors: ["'none'"], formAction: ["'self'"],
      },
    } : false,
    strictTransportSecurity: config.production ? { maxAge: 31536000 } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));
  app.use((req, res, next) => {
    if (config.production && !req.secure && req.path !== '/health/live') {
      return res.status(426).json({ reply: 'HTTPS is required.' });
    }
    next();
  });
  app.use(['/api', '/message'], rateLimit({
    windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { reply: 'Too many requests. Please try again later.' },
  }));
}

function createChatLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => String(req.chatAccount.id),
    message: { reply: 'Too many messages. Please wait a minute and try again.' },
  });
}

module.exports = { installSecurity, createChatLimiter };
