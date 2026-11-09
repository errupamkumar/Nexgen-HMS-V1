import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isTest } from './config/env.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { logger } from './core/logger.js';
import { pool } from './db/client.js';
import { authRouter } from './modules/auth/routes.js';
import { platformRouter, publicRouter } from './modules/platform/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { mastersRouter } from './modules/masters/routes.js';
import { patientsRouter } from './modules/patients/routes.js';
import { appointmentsRouter } from './modules/appointments/routes.js';
import { opdRouter } from './modules/opd/routes.js';
import { billingRouter } from './modules/billing/routes.js';
import { pharmacyRouter } from './modules/pharmacy/routes.js';
import { labRouter } from './modules/lab/routes.js';
import { ipdRouter } from './modules/ipd/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { commsRouter } from './modules/comms/routes.js';
import { portalRouter } from './modules/portal/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Tenant logos are configurable URLs, so images may come from any https origin.
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url }), res: (r) => ({ statusCode: r.statusCode }) },
      }),
    );
  }
  // Global safety net; auth endpoints carry stricter limits of their own.
  app.use('/api', rateLimit({ windowMs: 60_000, limit: isTest ? 100_000 : 600, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/masters', mastersRouter);
  app.use('/api/patients', patientsRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/opd', opdRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/pharmacy', pharmacyRouter);
  app.use('/api/lab', labRouter);
  app.use('/api/ipd', ipdRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api', commsRouter);
  app.use('/api/portal', portalRouter);

  app.use('/api', notFoundHandler);

  // Single-process deployment: serve the built SPA when it is present.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = env.WEB_DIST ? path.resolve(env.WEB_DIST) : path.resolve(here, '../../web/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '7d', immutable: true }));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
