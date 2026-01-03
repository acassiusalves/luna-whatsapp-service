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

// Test webhook - sends a test event to verify webhook is working
router.post('/test', async (req: Request, res: Response) => {
  try {
    const url = baileysService.getWebhookUrl();

    if (!url) {
      res.status(400).json({ success: false, error: 'Webhook URL not configured' });
      return;
    }

    const testPayload = {
      event: 'webhook.test',
      data: {
        message: 'Test webhook from Railway service',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    console.log(`[WEBHOOK-TEST] Sending test to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });

    const responseText = await response.text();
    console.log(`[WEBHOOK-TEST] Response: ${response.status} - ${responseText}`);

    res.json({
      success: response.ok,
      webhookUrl: url,
      statusCode: response.status,
      response: responseText,
    });
  } catch (error) {
    console.error('Error testing webhook:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
