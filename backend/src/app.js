// The Express app: security headers, CORS for the rider app, cookie sessions, the /api routes,
// and the built rider app itself when frontend/dist exists.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { store } from './db/index.js';
import { requireAgent } from './auth.js';
import { errorHandler, badRequest, forbidden } from './lib/http.js';
import { roadRoute } from './lib/routing.js';
import { addDemoOrder } from './demo/seed.js';
import { router as authRoutes } from './routes/auth.js';
import { router as riderRoutes } from './routes/rider.js';
import { router as orderRoutes } from './routes/orders.js';

// "28.45,77.07" → { lat, lng }
function point(value) {
  const [lat, lng] = String(value || '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw badRequest('Give a position as "lat,lng".');
  return { lat, lng };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(compression());

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'"],
        // Leaflet positions the map with inline styles.
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:'],
        // Map tiles come from the tile server (OpenStreetMap by default).
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'"],
        'upgrade-insecure-requests': config.cookie.secure ? [] : null,
      },
    },
  }));
  // The app asks for the phone's location; nothing else may.
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    next();
  });
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(cookieParser());
  app.use('/api', express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, store: store.kind }));
  // What the app needs before sign-in.
  app.get('/api/config', (req, res) => res.json({
    kitchen: config.kitchen,
    supportPhone: config.supportPhone,
    otpDevMode: config.otpDevMode,
    selfAssign: config.selfAssign,
    maxActiveOrders: config.maxActiveOrders,
    routing: Boolean(config.routingUrl),
    // Local JSON store with demo riders and orders (no MongoDB configured).
    demo: store.kind === 'file',
  }));
  app.use('/api/auth', authRoutes);

  // Everything below needs a signed-in rider.
  app.use('/api', requireAgent);
  app.use('/api/rider', riderRoutes);
  app.use('/api/orders', orderRoutes);
  app.get('/api/route', rateLimit({ windowMs: 60000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many route requests.' } }),
    async (req, res) => res.json({ route: await roadRoute(point(req.query.from), point(req.query.to)) }));
  // Demo only (local JSON store): one more order waiting for a rider, to try the app with.
  app.post('/api/demo/order', async (req, res) => {
    const order = await addDemoOrder();
    if (!order) throw forbidden('Demo orders can only be added to the local demo data.');
    res.status(201).json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  const appIndex = path.join(config.clientDir, 'index.html');
  app.locals.servesApp = fs.existsSync(appIndex);
  if (app.locals.servesApp) {
    app.use(express.static(config.clientDir, {
      index: false,
      // Built JS/CSS files have a content hash in their name, so they never change.
      setHeaders: (res, file) => {
        if (/[\\/]assets[\\/][^\\/]+-[\w-]{8}\.(js|css)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    // Every other address (/, /orders/…, /history) loads the app, which then shows that page.
    app.get('/{*page}', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(appIndex);
    });
  }

  app.use(errorHandler);
  return app;
}
