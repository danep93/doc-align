import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import { authMiddleware } from './middleware/auth';
import usersRouter from './routes/users';
import signaturesRouter from './routes/signatures';
import signoffsRouter from './routes/signoffs';
import subscriptionsRouter from './routes/subscriptions';
import organizationRoutes from './routes/organizations';
import groupRoutes from './routes/groups';
import signoffRulesRoutes from './routes/signoffRules';
import trackedDocsRouter from './routes/trackedDocs';

const app: Express = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Request logger with response status
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400) {
      console.log(`${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// Stripe webhook needs raw body
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/signatures', authMiddleware, signaturesRouter);
app.use('/api/signoffs', authMiddleware, signoffsRouter);

app.use('/api/tracked-docs', authMiddleware, trackedDocsRouter);
app.use('/api/organizations', authMiddleware, organizationRoutes);
app.use('/api/organizations/:orgId/groups', authMiddleware, groupRoutes);
app.use('/api/organizations/:orgId/signoff-rules', authMiddleware, signoffRulesRoutes);

// Subscriptions: checkout is protected, webhook is not
app.use('/api/subscriptions', subscriptionsRouter);

app.listen(PORT, () => {
  console.log(`doc-align backend running on port ${PORT}`);
});

export default app;
