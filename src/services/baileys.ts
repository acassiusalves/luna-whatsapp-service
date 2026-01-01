import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import type { Instance, InstanceInfo, InstanceStatus } from '../types/index.js';

class BaileysService {
  private instances: Map<string, Instance> = new Map();
  private sessionsPath: string;
  private webhookUrl: string | null = null;
  private logger = pino({ level: 'silent' });

  constructor() {
    this.sessionsPath = process.env.SESSIONS_PATH || './sessions';
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }

    // Load webhook URL from environment
    this.webhookUrl = process.env.WEBHOOK_URL || null;

    // Load existing sessions on startup
    this.loadExistingSessions();
  }

  private async loadExistingSessions(): Promise<void> {
    try {
      const sessions = fs.readdirSync(this.sessionsPath);
      for (const sessionName of sessions) {
        const sessionPath = path.join(this.sessionsPath, sessionName);
        if (fs.statSync(sessionPath).isDirectory()) {
          console.log(`Loading existing session: ${sessionName}`);
          await this.createInstance(sessionName);
        }
      }
    } catch (error) {
      console.error('Error loading existing sessions:', error);
    }
  }

  async createInstance(name: string): Promise<Instance> {
    if (this.instances.has(name)) {
      return this.instances.get(name)!;
    }

    const instance: Instance = {
      socket: null,
      qrCode: null,
      status: 'disconnected',
      createdAt: new Date(),
    };

    this.instances.set(name, instance);
    await this.connect(name);
    return instance;
  }

  async connect(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) throw new Error('Instance not found');

    const sessionPath = path.join(this.sessionsPath, name);

    // Ensure session directory exists
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    instance.status = 'connecting';

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      printQRInTerminal: false,
      logger: this.logger,
      browser: ['Luna CRM', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    instance.socket = socket;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR code as data URL (base64)
        instance.qrCode = await QRCode.toDataURL(qr);
        instance.status = 'qr_code';
        console.log(`[${name}] QR Code generated`);

        this.sendWebhook('qrcode.updated', {
          instance: name,
          qrCode: instance.qrCode
        });
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        console.log(`[${name}] Connection closed. Reason: ${reason}. Reconnect: ${shouldReconnect}`);

        if (reason === DisconnectReason.loggedOut) {
          instance.status = 'disconnected';
          instance.qrCode = null;
          instance.phoneNumber = undefined;
          instance.profileName = undefined;

          // Clean session if logged out
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        } else if (shouldReconnect) {
          // Reconnect automatically after delay
          instance.status = 'connecting';
          setTimeout(() => this.connect(name), 3000);
        }

        this.sendWebhook('connection.update', {
          instance: name,
          state: 'close',
          reason,
        });
      }

      if (connection === 'open') {
        instance.status = 'connected';
        instance.qrCode = null;
        instance.lastConnected = new Date();

        // Extract user info
        const userId = socket.user?.id;
        if (userId) {
          instance.phoneNumber = userId.split(':')[0].split('@')[0];
        }
        instance.profileName = socket.user?.name;

        console.log(`[${name}] Connected as ${instance.phoneNumber} (${instance.profileName})`);

        this.sendWebhook('connection.update', {
          instance: name,
          state: 'open',
          phoneNumber: instance.phoneNumber,
          profileName: instance.profileName,
        });
      }
    });

    // Handle incoming messages
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Skip messages sent by us
        if (msg.key.fromMe) continue;

        // Skip status updates
        if (msg.key.remoteJid === 'status@broadcast') continue;

        console.log(`[${name}] New message from ${msg.key.remoteJid}`);

        this.sendWebhook('messages.upsert', {
          instance: name,
          data: {
            key: msg.key,
            message: msg.message,
            messageTimestamp: msg.messageTimestamp,
            pushName: msg.pushName,
          },
        });
      }
    });

    // Handle message status updates (delivered, read)
    socket.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        this.sendWebhook('messages.update', {
          instance: name,
          update: {
            key: update.key,
            update: update.update,
          },
        });
      }
    });
  }

  async sendText(instanceName: string, to: string, text: string): Promise<unknown> {
    const instance = this.instances.get(instanceName);
    if (!instance?.socket) throw new Error('Instance not connected');
    if (instance.status !== 'connected') throw new Error('Instance not connected');

    const jid = this.formatJid(to);
    const result = await instance.socket.sendMessage(jid, { text });

    console.log(`[${instanceName}] Sent text to ${jid}`);
    return result;
  }

  async sendMedia(
    instanceName: string,
    to: string,
    mediaUrl: string,
    caption?: string,
    mediaType: 'image' | 'video' | 'audio' | 'document' = 'image',
    fileName?: string
  ): Promise<unknown> {
    const instance = this.instances.get(instanceName);
    if (!instance?.socket) throw new Error('Instance not connected');
    if (instance.status !== 'connected') throw new Error('Instance not connected');

    const jid = this.formatJid(to);

    // Download media from URL
    const response = await fetch(mediaUrl);
    if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    const messageContent: Record<string, unknown> = {};

    switch (mediaType) {
      case 'image':
        messageContent.image = buffer;
        messageContent.mimetype = contentType;
        if (caption) messageContent.caption = caption;
        break;
      case 'video':
        messageContent.video = buffer;
        messageContent.mimetype = contentType;
        if (caption) messageContent.caption = caption;
        break;
      case 'audio':
        messageContent.audio = buffer;
        messageContent.mimetype = contentType.includes('audio') ? contentType : 'audio/mp4';
        messageContent.ptt = contentType.includes('ogg'); // Voice note if ogg
        break;
      case 'document':
        messageContent.document = buffer;
        messageContent.mimetype = contentType;
        messageContent.fileName = fileName || 'document';
        break;
    }

    const result = await instance.socket.sendMessage(jid, messageContent);

    console.log(`[${instanceName}] Sent ${mediaType} to ${jid}`);
    return result;
  }

  getInstance(name: string): Instance | undefined {
    return this.instances.get(name);
  }

  getInstanceInfo(name: string): InstanceInfo | undefined {
    const instance = this.instances.get(name);
    if (!instance) return undefined;

    return {
      name,
      status: instance.status,
      phoneNumber: instance.phoneNumber,
      profileName: instance.profileName,
      profilePicUrl: instance.profilePicUrl,
      qrCode: instance.qrCode || undefined,
      createdAt: instance.createdAt,
      lastConnected: instance.lastConnected,
    };
  }

  getAllInstances(): InstanceInfo[] {
    const result: InstanceInfo[] = [];

    this.instances.forEach((instance, name) => {
      result.push({
        name,
        status: instance.status,
        phoneNumber: instance.phoneNumber,
        profileName: instance.profileName,
        profilePicUrl: instance.profilePicUrl,
        createdAt: instance.createdAt,
        lastConnected: instance.lastConnected,
      });
    });

    return result;
  }

  async deleteInstance(name: string): Promise<void> {
    const instance = this.instances.get(name);

    if (instance?.socket) {
      try {
        instance.socket.end(undefined);
      } catch (error) {
        console.error(`[${name}] Error ending socket:`, error);
      }
    }

    this.instances.delete(name);

    const sessionPath = path.join(this.sessionsPath, name);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    console.log(`[${name}] Instance deleted`);
  }

  async logout(name: string): Promise<void> {
    const instance = this.instances.get(name);

    if (instance?.socket) {
      try {
        await instance.socket.logout();
        console.log(`[${name}] Logged out`);
      } catch (error) {
        console.error(`[${name}] Error logging out:`, error);
        throw error;
      }
    }

    instance!.status = 'disconnected';
    instance!.qrCode = null;
    instance!.phoneNumber = undefined;
    instance!.profileName = undefined;
  }

  setWebhookUrl(url: string): void {
    this.webhookUrl = url;
    console.log(`Webhook URL set to: ${url}`);
  }

  getWebhookUrl(): string | null {
    return this.webhookUrl;
  }

  private formatJid(phone: string): string {
    // Already a JID - return as is
    if (phone.includes('@')) {
      return phone;
    }

    // Clean phone number
    let cleaned = phone.replace(/\D/g, '');

    // Add Brazil code if not present
    if (!cleaned.startsWith('55') && cleaned.length <= 11) {
      cleaned = '55' + cleaned;
    }

    return `${cleaned}@s.whatsapp.net`;
  }

  private async sendWebhook(event: string, data: Record<string, unknown>): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event,
          data,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        console.error(`Webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Webhook error:', error);
    }
  }
}

export const baileysService = new BaileysService();
