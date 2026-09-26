import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config } from './config';
import { configurePassport } from './lib/passport';
import { emailQueue } from './lib/queue';
import { runReconciliation } from './services/reconciliation.service';
import { initElasticsearch } from './lib/elasticsearch';
import emailRoutes from './routes/email.routes';
import authRoutes from './routes/auth.routes';
import slackRoutes from './routes/slack.routes';

const app = express();

// --- Middleware ---
app.use(cors({
  origin: [config.frontendUrl, 'http://localhost:3001', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
  },
}));

// Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// --- Bull Board (Queue Monitoring UI) ---
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/slack', slackRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
  });
});

// Rate limit config endpoint
app.get('/api/config/rate-limits', (req, res) => {
  res.json({
    maxPerHourGlobal: config.rateLimit.maxPerHourGlobal,
    maxPerHourPerSender: config.rateLimit.maxPerHourPerSender,
    minDelaySeconds: config.rateLimit.minDelaySeconds,
    workerConcurrency: config.worker.concurrency,
  });
});

// --- Start server ---
async function start() {
  try {
    // Elasticsearch check
    await initElasticsearch();

    // Run reconciliation on server boot too
    console.log('[Server] Running reconciliation pass...');
    const result = await runReconciliation();
    console.log(`[Server] Reconciliation: ${result.requeued} requeued, ${result.skipped} skipped`);

    app.listen(config.port, () => {
      console.log(`\n🚀 ReachSched API server running on http://localhost:${config.port}`);
      console.log(`📊 Bull Board UI: http://localhost:${config.port}/admin/queues`);
      console.log(`🔐 Auth: http://localhost:${config.port}/api/auth/google`);
      console.log(`📧 Emails API: http://localhost:${config.port}/api/emails`);
      console.log(`💬 Slack: http://localhost:${config.port}/api/slack`);
      console.log(`❤️  Health: http://localhost:${config.port}/api/health\n`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  process.exit(0);
});
