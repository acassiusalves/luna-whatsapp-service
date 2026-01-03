import { Router, Request, Response } from 'express';
import { baileysService } from '../services/baileys.js';
import type { CreateInstanceRequest } from '../types/index.js';

const router = Router();

// List all instances
router.get('/', (_req: Request, res: Response) => {
  try {
    const instances = baileysService.getAllInstances();
    res.json({ success: true, instances });
  } catch (error) {
    console.error('Error listing instances:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check detalhado de todas as instâncias
router.get('/health', (_req: Request, res: Response) => {
  try {
    const instances = baileysService.getHealthInfo();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      instances
    });
  } catch (error) {
    console.error('Error getting health info:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Debug endpoint para verificar configuração
router.get('/debug/config', (_req: Request, res: Response) => {
  const webhookUrl = process.env.WEBHOOK_URL || null;
  res.json({
    success: true,
    config: {
      webhookUrl: webhookUrl ? `${webhookUrl.substring(0, 50)}...` : 'NOT SET',
      webhookConfigured: !!webhookUrl,
      allowedOrigins: process.env.ALLOWED_ORIGINS || 'NOT SET',
      nodeEnv: process.env.NODE_ENV || 'development',
    }
  });
});

// Create new instance
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body as CreateInstanceRequest;

    if (!name) {
      res.status(400).json({ success: false, error: 'Instance name is required' });
      return;
    }

    // Validate name format (lowercase, alphanumeric, hyphens only)
    if (!/^[a-z0-9-]+$/.test(name)) {
      res.status(400).json({
        success: false,
        error: 'Instance name must be lowercase alphanumeric with hyphens only'
      });
      return;
    }

    await baileysService.createInstance(name);
    const info = baileysService.getInstanceInfo(name);

    res.status(201).json({ success: true, instance: info });
  } catch (error) {
    console.error('Error creating instance:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get instance info
router.get('/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    res.json({ success: true, instance: info });
  } catch (error) {
    console.error('Error getting instance:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get QR code for instance
router.get('/:name/qr', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    if (info.status === 'connected') {
      res.json({
        success: true,
        status: 'connected',
        message: 'Instance is already connected',
        phoneNumber: info.phoneNumber,
        profileName: info.profileName
      });
      return;
    }

    if (info.status === 'qr_code' && info.qrCode) {
      res.json({
        success: true,
        status: 'qr_code',
        qrCode: info.qrCode
      });
      return;
    }

    // Still connecting, no QR yet
    res.json({
      success: true,
      status: info.status,
      message: 'Waiting for QR code...'
    });
  } catch (error) {
    console.error('Error getting QR code:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get instance status
router.get('/:name/status', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    res.json({
      success: true,
      status: info.status,
      phoneNumber: info.phoneNumber,
      profileName: info.profileName
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Logout instance
router.post('/:name/logout', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    await baileysService.logout(name);

    res.json({ success: true, message: 'Instance logged out' });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete instance
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    await baileysService.deleteInstance(name);

    res.json({ success: true, message: 'Instance deleted' });
  } catch (error) {
    console.error('Error deleting instance:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Reconnect instance
router.post('/:name/reconnect', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    await baileysService.connect(name);

    res.json({ success: true, message: 'Reconnecting...' });
  } catch (error) {
    console.error('Error reconnecting:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get profile picture
router.get('/:name/profile-picture/:jid', async (req: Request, res: Response) => {
  try {
    const { name, jid } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    const profilePicUrl = await baileysService.getProfilePicture(name, jid);

    res.json({ success: true, profilePicUrl });
  } catch (error) {
    console.error('Error getting profile picture:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get all groups for instance
router.get('/:name/groups', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = baileysService.getInstanceInfo(name);

    if (!info) {
      res.status(404).json({ success: false, error: 'Instance not found' });
      return;
    }

    if (info.status !== 'connected') {
      res.status(400).json({ success: false, error: 'Instance not connected' });
      return;
    }

    const groups = await baileysService.getGroups(name);

    res.json({ success: true, groups });
  } catch (error) {
    console.error('Error getting groups:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
