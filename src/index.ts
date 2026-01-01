import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import instancesRouter from './routes/instances.js';
import messagesRouter from './routes/messages.js';
import webhookRouter from './routes/webhook.js';
import { baileysService } from './services/baileys.js';

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// API Key authentication middleware
const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Skip auth for health check
  if (req.path === '/health') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'] as string | undefined;
  const apiKey = authHeader?.replace('Bearer ', '') || xApiKey;

  if (!API_KEY) {
    // No API key configured, allow all requests (development mode)
    next();
    return;
  }

  if (!apiKey || apiKey !== API_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
};

app.use(authMiddleware);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/instances', instancesRouter);
app.use('/messages', messagesRouter);
app.use('/webhook', webhookRouter);

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Luna WhatsApp Service',
    version: '1.0.0',
    endpoints: {
      instances: '/instances',
      messages: '/messages',
      webhook: '/webhook',
      health: '/health'
    }
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Graceful shutdown handlers
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  try {
    await baileysService.disconnectAll();
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server with session preloading
async function startServer() {
  // Wait for existing sessions to be loaded before accepting requests
  console.log('Loading existing WhatsApp sessions...');
  await baileysService.loadExistingSessions();
  console.log('Sessions loaded successfully');

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║     Luna WhatsApp Service                  ║
║     Running on port ${PORT}                    ║
╚════════════════════════════════════════════╝
    `);

    if (process.env.WEBHOOK_URL) {
      console.log(`Webhook configured: ${process.env.WEBHOOK_URL}`);
    } else {
      console.log('Webhook not configured. Set WEBHOOK_URL env variable.');
    }

    if (!API_KEY) {
      console.log('⚠️  No API_KEY set - running in development mode (no auth)');
    }
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
