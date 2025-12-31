import { Router, Request, Response } from 'express';
import { baileysService } from '../services/baileys.js';
import type { SetWebhookRequest } from '../types/index.js';

const router = Router();

// Set webhook URL
router.post('/set', (req: Request, res: Response) => {
  try {
    const { url } = req.body as SetWebhookRequest;

    if (!url) {
      res.status(400).json({ success: false, error: 'url is required' });
      return;
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      res.status(400).json({ success: false, error: 'Invalid URL format' });
      return;
    }

    baileysService.setWebhookUrl(url);

    res.json({ success: true, message: `Webhook set to: ${url}` });
  } catch (error) {
    console.error('Error setting webhook:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current webhook URL
router.get('/', (_req: Request, res: Response) => {
  try {
    const url = baileysService.getWebhookUrl();

    res.json({
      success: true,
      url: url || null,
      configured: !!url
    });
  } catch (error) {
    console.error('Error getting webhook:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
