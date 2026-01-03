import { Router, Request, Response } from 'express';
import { baileysService } from '../services/baileys.js';
import type { SendTextRequest, SendMediaRequest } from '../types/index.js';

const router = Router();

// Send text message
router.post('/text', async (req: Request, res: Response) => {
  try {
    const { instanceName, to, text } = req.body as SendTextRequest;

    if (!instanceName || !to || !text) {
      res.status(400).json({
        success: false,
        error: 'instanceName, to, and text are required'
      });
      return;
    }

    const result = await baileysService.sendText(instanceName, to, text);

    res.json({ success: true, result });
  } catch (error) {
    console.error('Error sending text:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Send media message
router.post('/media', async (req: Request, res: Response) => {
  try {
    const { instanceName, to, mediaUrl, caption, mediaType, fileName } = req.body as SendMediaRequest;

    if (!instanceName || !to || !mediaUrl || !mediaType) {
      res.status(400).json({
        success: false,
        error: 'instanceName, to, mediaUrl, and mediaType are required'
      });
      return;
    }

    const validTypes = ['image', 'video', 'audio', 'document'];
    if (!validTypes.includes(mediaType)) {
      res.status(400).json({
        success: false,
        error: `mediaType must be one of: ${validTypes.join(', ')}`
      });
      return;
    }

    const result = await baileysService.sendMedia(
      instanceName,
      to,
      mediaUrl,
      caption,
      mediaType,
      fileName
    );

    res.json({ success: true, result });
  } catch (error) {
    console.error('Error sending media:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Fetch message history for a specific conversation
router.post('/history', async (req: Request, res: Response) => {
  try {
    const { instanceName, jid, count = 50 } = req.body as {
      instanceName: string;
      jid: string;
      count?: number;
    };

    if (!instanceName || !jid) {
      res.status(400).json({
        success: false,
        error: 'instanceName and jid are required'
      });
      return;
    }

    const messages = await baileysService.fetchMessageHistory(instanceName, jid, count);

    res.json({
      success: true,
      messages,
      count: messages.length
    });
  } catch (error) {
    console.error('Error fetching message history:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
