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

const app: Express = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

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

// Subscriptions: checkout is protected, webhook is not
app.use('/api/subscriptions', subscriptionsRouter);

app.listen(PORT, () => {
  console.log(`doc-align backend running on port ${PORT}`);
});

export default app;
