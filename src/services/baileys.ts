import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  AnyMessageContent,
  GroupMetadata,
  GroupParticipant,
  downloadContentFromMessage,
  MediaType,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import type { Instance, InstanceInfo, InstanceStatus } from '../types/index.js';

// Debug: armazenar últimos eventos para diagnóstico
const debugEvents: Array<{ timestamp: string; event: string; data: unknown }> = [];
const MAX_DEBUG_EVENTS = 50;

function logDebugEvent(event: string, data: unknown) {
  debugEvents.unshift({ timestamp: new Date().toISOString(), event, data });
  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.pop();
  }
  console.log(`[DEBUG EVENT] ${event}:`, JSON.stringify(data).substring(0, 500));
}

export function getDebugEvents() {
  return debugEvents;
}

class BaileysService {
  private instances: Map<string, Instance> = new Map();
  private sessionsPath: string;
  private webhookUrl: string | null = null;
  private logger = pino({ level: 'warn' }); // Aumentado de 'silent' para ver warnings
  private reconnectAttempts: Map<string, number> = new Map();
  private keepAliveIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastActivity: Map<string, Date> = new Map();
  // Tracking de última mensagem recebida para detectar conexões zombie
  private lastMessageReceived: Map<string, Date> = new Map();
  private zombieCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.sessionsPath = process.env.SESSIONS_PATH || './sessions';
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }

    // Load webhook URL from environment
    this.webhookUrl = process.env.WEBHOOK_URL || null;

    // Note: Sessions are now loaded explicitly from index.ts to ensure they're ready before server starts
  }

  async loadExistingSessions(): Promise<void> {
    try {
      const sessions = fs.readdirSync(this.sessionsPath);
      for (const sessionName of sessions) {
        // Skip system directories like lost+found (created by Linux volumes)
        if (sessionName === 'lost+found' || sessionName.startsWith('.')) {
          console.log(`Skipping system directory: ${sessionName}`);
          continue;
        }

        const sessionPath = path.join(this.sessionsPath, sessionName);
        if (fs.statSync(sessionPath).isDirectory()) {
          console.log(`Loading existing session: ${sessionName}`);
          await this.createInstance(sessionName);
        }
      }

      // Iniciar verificação periódica de conexões zombie
      this.startZombieChecker();
    } catch (error) {
      console.error('Error loading existing sessions:', error);
    }
  }

  /**
   * Inicia verificação periódica para detectar conexões "zombie"
   * Uma conexão zombie é quando o socket parece conectado mas não está recebendo mensagens
   */
  private startZombieChecker(): void {
    // Limpar intervalo anterior se existir
    if (this.zombieCheckInterval) {
      clearInterval(this.zombieCheckInterval);
    }

    // Verificar a cada 15 minutos
    const ZOMBIE_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutos
    const ZOMBIE_THRESHOLD = 60 * 60 * 1000; // 60 minutos sem mensagens = possível zombie

    console.log('[ZOMBIE-CHECKER] Starting zombie connection checker (every 15 min)');

    this.zombieCheckInterval = setInterval(() => {
      this.instances.forEach(async (instance, name) => {
        if (instance.status !== 'connected') return;

        const lastReceived = this.lastMessageReceived.get(name);
        const lastConnected = instance.lastConnected;

        // Se nunca recebemos uma mensagem desde a conexão
        if (!lastReceived && lastConnected) {
          const timeSinceConnect = Date.now() - lastConnected.getTime();

          // Se passou mais de 60 min conectado sem receber nenhuma mensagem
          if (timeSinceConnect > ZOMBIE_THRESHOLD) {
            console.warn(`[ZOMBIE-CHECKER] [${name}] Possible zombie: connected for ${Math.round(timeSinceConnect / 60000)} min without receiving any messages`);
            console.warn(`[ZOMBIE-CHECKER] [${name}] Forcing reconnect...`);

            // Força reconexão
            try {
              await this.connect(name);
              console.log(`[ZOMBIE-CHECKER] [${name}] Reconnect initiated`);
            } catch (error) {
              console.error(`[ZOMBIE-CHECKER] [${name}] Failed to reconnect:`, error);
            }
          }
        } else if (lastReceived) {
          const timeSinceLastMessage = Date.now() - lastReceived.getTime();

          // Se passou mais de 60 min desde a última mensagem recebida
          if (timeSinceLastMessage > ZOMBIE_THRESHOLD) {
            console.warn(`[ZOMBIE-CHECKER] [${name}] Possible zombie: no messages received in ${Math.round(timeSinceLastMessage / 60000)} min`);
            // Apenas logar warning, não reconectar automaticamente se já recebeu mensagens antes
            // (pode ser que simplesmente não há mensagens novas)
          }
        }
      });
    }, ZOMBIE_CHECK_INTERVAL);
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
      syncFullHistory: true, // Ativado para sincronizar histórico completo
      markOnlineOnConnect: true, // Marcar como online para receber mensagens
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
          // Reconnect automatically with exponential backoff
          instance.status = 'connecting';
          const attempts = this.reconnectAttempts.get(name) || 0;
          const delay = Math.min(3000 * Math.pow(2, attempts), 60000); // Max 60s
          this.reconnectAttempts.set(name, attempts + 1);
          console.log(`[${name}] Reconnecting in ${delay/1000}s (attempt ${attempts + 1})`);
          setTimeout(() => this.connect(name), delay);
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

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts.set(name, 0);

        logDebugEvent('connection.open', { instance: name, phoneNumber: instance.phoneNumber });

        // Clear any existing keep-alive interval
        const existingInterval = this.keepAliveIntervals.get(name);
        if (existingInterval) {
          clearInterval(existingInterval);
        }

        // Set up keep-alive: send presence update every 5 minutes
        const keepAliveInterval = setInterval(() => {
          if (instance.socket && instance.status === 'connected') {
            try {
              instance.socket.sendPresenceUpdate('available');
              console.log(`[${name}] Keep-alive ping sent`);
            } catch (error) {
              console.error(`[${name}] Keep-alive error:`, error);
            }
          }
        }, 5 * 60 * 1000); // 5 minutes
        this.keepAliveIntervals.set(name, keepAliveInterval);

        // Extract user info
        const userId = socket.user?.id;
        if (userId) {
          instance.phoneNumber = userId.split(':')[0].split('@')[0];
        }
        instance.profileName = socket.user?.name;

        console.log(`[${name}] Connected as ${instance.phoneNumber} (${instance.profileName})`);

        // Update last activity
        this.lastActivity.set(name, new Date());

        this.sendWebhook('connection.update', {
          instance: name,
          state: 'open',
          phoneNumber: instance.phoneNumber,
          profileName: instance.profileName,
        });
      }
    });

    // Handle incoming messages
    console.log(`[${name}] Registering messages.upsert listener...`);
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      // Log detalhado ANTES de qualquer filtro para debug
      console.log(`[${name}] >>> messages.upsert EVENT FIRED - type: ${type}, count: ${messages.length}`);
      logDebugEvent('messages.upsert', { instance: name, type, count: messages.length, firstMsgJid: messages[0]?.key?.remoteJid });
      for (const msg of messages) {
        console.log(`[${name}] Message DEBUG: fromMe=${msg.key.fromMe}, type=${type}, jid=${msg.key.remoteJid?.substring(0, 20)}`);
      }

      // Processar TANTO 'notify' (novas) quanto 'append' (sincronizadas do celular/WhatsApp Web)
      // Isso garante que mensagens enviadas por outros dispositivos também sejam capturadas
      if (type !== 'notify' && type !== 'append') {
        console.log(`[${name}] Ignorando messages.upsert com type=${type}`);
        return;
      }

      // Atualizar timestamp de última mensagem recebida (para detectar conexões zombie)
      this.lastMessageReceived.set(name, new Date());

      for (const msg of messages) {
        // Skip status updates
        if (msg.key.remoteJid === 'status@broadcast') continue;

        // Log message type (received or sent by us)
        const messageType = msg.key.fromMe ? 'sent' : 'received';
        console.log(`[${name}] Processing message ${messageType} - ${msg.key.remoteJid}`);

        // Update last activity on message received
        this.lastActivity.set(name, new Date());

        // Detecta e baixa mídia antes de enviar o webhook
        let mediaBase64: string | null = null;
        let mediaMimetype: string | null = null;

        const message = msg.message;
        if (message) {
          if (message.imageMessage) {
            console.log(`[${name}] Image message detected, downloading...`);
            const media = await this.downloadMediaAsBase64(message, 'image');
            if (media) {
              mediaBase64 = media.base64;
              mediaMimetype = media.mimetype;
            }
          } else if (message.audioMessage) {
            console.log(`[${name}] Audio message detected, downloading...`);
            const media = await this.downloadMediaAsBase64(message, 'audio');
            if (media) {
              mediaBase64 = media.base64;
              mediaMimetype = media.mimetype;
            }
          } else if (message.videoMessage) {
            console.log(`[${name}] Video message detected, downloading...`);
            const media = await this.downloadMediaAsBase64(message, 'video');
            if (media) {
              mediaBase64 = media.base64;
              mediaMimetype = media.mimetype;
            }
          } else if (message.documentMessage) {
            console.log(`[${name}] Document message detected, downloading...`);
            const media = await this.downloadMediaAsBase64(message, 'document');
            if (media) {
              mediaBase64 = media.base64;
              mediaMimetype = media.mimetype;
            }
          } else if (message.stickerMessage) {
            console.log(`[${name}] Sticker message detected, downloading...`);
            const media = await this.downloadMediaAsBase64(message, 'sticker');
            if (media) {
              mediaBase64 = media.base64;
              mediaMimetype = media.mimetype;
            }
          }
        }

        // Log completo para mensagens do Facebook (@lid) para debug
        if (msg.key.remoteJid?.includes('@lid')) {
          console.log(`[${name}] LID message - full data:`, JSON.stringify(msg, null, 2).substring(0, 1500));

          // Tenta resolver o LID para número de telefone real
          const lid = msg.key.remoteJid;
          let resolvedPhoneNumber: string | undefined;

          try {
            // O Baileys armazena o mapeamento LID -> PN internamente
            // Verifica se o socket tem o signalRepository com lidMapping
            const sock = instance.socket as unknown as {
              signalRepository?: {
                lidMapping?: {
                  getPNForLID?: (lid: string) => Promise<string | null>;
                }
              }
            };

            if (sock?.signalRepository?.lidMapping?.getPNForLID) {
              const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
              if (pn) {
                resolvedPhoneNumber = pn;
                console.log(`[${name}] LID ${lid} resolved to phone number: ${pn}`);
              }
            }
          } catch (lidError) {
            console.log(`[${name}] Could not resolve LID to phone number:`, lidError);
          }

          // Envia webhook com o número resolvido (se disponível) e mídia
          this.sendWebhook('messages.upsert', {
            instance: name,
            data: {
              key: msg.key,
              message: msg.message,
              messageTimestamp: msg.messageTimestamp,
              pushName: msg.pushName,
              verifiedBizName: (msg as unknown as Record<string, unknown>).verifiedBizName,
              bizPrivacyStatus: (msg as unknown as Record<string, unknown>).bizPrivacyStatus,
              participant: msg.key.participant,
              // Número de telefone resolvido do LID (se disponível)
              resolvedPhoneNumber,
              // Mídia baixada em base64
              mediaBase64,
              mediaMimetype,
            },
          });
          continue; // Já enviou o webhook, pula para próxima mensagem
        }

        this.sendWebhook('messages.upsert', {
          instance: name,
          data: {
            key: msg.key,
            message: msg.message,
            messageTimestamp: msg.messageTimestamp,
            pushName: msg.pushName,
            // Campos adicionais que podem conter informações úteis
            verifiedBizName: (msg as unknown as Record<string, unknown>).verifiedBizName,
            bizPrivacyStatus: (msg as unknown as Record<string, unknown>).bizPrivacyStatus,
            // Para mensagens do Facebook, pode haver um campo com o número real
            participant: msg.key.participant,
            // Mídia baixada em base64
            mediaBase64,
            mediaMimetype,
          },
        });
      }
    });

    // Handle message status updates (delivered, read)
    socket.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        console.log(`[${name}] Message status update: ${update.key.id} -> status=${(update.update as { status?: number })?.status}`);
        this.sendWebhook('messages.update', {
          instance: name,
          update: {
            key: update.key,
            update: update.update,
          },
        });
      }
    });

    // Handle history sync (mensagens antigas ao conectar)
    socket.ev.on('messaging-history.set', async ({ chats, messages, isLatest }) => {
      console.log(`[${name}] History sync: ${messages.length} messages, ${chats.length} chats, isLatest: ${isLatest}`);

      // Envia mensagens do histórico via webhook (em batches para não sobrecarregar)
      const batchSize = 50;
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        for (const msg of batch) {
          // Skip status updates
          if (msg.key.remoteJid === 'status@broadcast') continue;

          this.sendWebhook('messages.upsert', {
            instance: name,
            data: {
              key: msg.key,
              message: msg.message,
              messageTimestamp: msg.messageTimestamp,
              pushName: (msg as unknown as { pushName?: string }).pushName,
              isHistorySync: true, // Flag para identificar que é do histórico
            },
          });
        }
        // Pequeno delay entre batches
        if (i + batchSize < messages.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      console.log(`[${name}] History sync completed: sent ${messages.length} messages to webhook`);
    });

    // Handle presence updates (digitando, gravando, online)
    socket.ev.on('presence.update', ({ id, presences }) => {
      console.log(`[${name}] Presence update for ${id}:`, JSON.stringify(presences));

      this.sendWebhook('presence.update', {
        instance: name,
        data: {
          jid: id,
          presences,
        },
      });
    });
  }

  async sendText(instanceName: string, to: string, text: string): Promise<unknown> {
    const instance = this.instances.get(instanceName);

    console.log(`[${instanceName}] sendText - instance exists: ${!!instance}, socket: ${!!instance?.socket}, status: ${instance?.status}`);

    if (!instance?.socket) throw new Error('Instance not connected');
    if (instance.status !== 'connected') throw new Error('Instance not connected');

    const jid = this.formatJid(to);
    const result = await instance.socket.sendMessage(jid, { text });

    console.log(`[${instanceName}] Sent text to ${jid}`);
    logDebugEvent('sendText', { instance: instanceName, to: jid, textPreview: text.substring(0, 50) });
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

    let messageContent: AnyMessageContent;

    switch (mediaType) {
      case 'image':
        messageContent = {
          image: buffer,
          caption: caption || undefined,
        };
        break;
      case 'video':
        messageContent = {
          video: buffer,
          caption: caption || undefined,
        };
        break;
      case 'audio':
        messageContent = {
          audio: buffer,
          mimetype: contentType.includes('audio') ? contentType : 'audio/mp4',
          ptt: contentType.includes('ogg'), // Voice note if ogg
        };
        break;
      case 'document':
        messageContent = {
          document: buffer,
          mimetype: contentType,
          fileName: fileName || 'document',
        };
        break;
      default:
        throw new Error(`Unsupported media type: ${mediaType}`);
    }

    const result = await instance.socket.sendMessage(jid, messageContent);

    console.log(`[${instanceName}] Sent ${mediaType} to ${jid}`);
    return result;
  }

  async getProfilePicture(instanceName: string, jid: string): Promise<string | null> {
    const instance = this.instances.get(instanceName);
    if (!instance?.socket) throw new Error('Instance not connected');
    if (instance.status !== 'connected') throw new Error('Instance not connected');

    try {
      const formattedJid = this.formatJid(jid);
      const profilePicUrl = await instance.socket.profilePictureUrl(formattedJid, 'image');
      console.log(`[${instanceName}] Got profile picture for ${formattedJid}`);
      return profilePicUrl || null;
    } catch (error) {
      console.log(`[${instanceName}] No profile picture for ${jid}:`, error);
      return null;
    }
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

  /**
   * Retorna informações detalhadas de saúde de todas as instâncias
   */
  getHealthInfo(): Array<{
    name: string;
    status: InstanceStatus;
    phoneNumber?: string;
    profileName?: string;
    lastActivity?: Date;
    lastMessageReceived?: Date;
    reconnectAttempts: number;
    socketAlive: boolean;
    createdAt: Date;
    lastConnected?: Date;
  }> {
    const result: Array<{
      name: string;
      status: InstanceStatus;
      phoneNumber?: string;
      profileName?: string;
      lastActivity?: Date;
      lastMessageReceived?: Date;
      reconnectAttempts: number;
      socketAlive: boolean;
      createdAt: Date;
      lastConnected?: Date;
    }> = [];

    this.instances.forEach((instance, name) => {
      result.push({
        name,
        status: instance.status,
        phoneNumber: instance.phoneNumber,
        profileName: instance.profileName,
        lastActivity: this.lastActivity.get(name),
        lastMessageReceived: this.lastMessageReceived.get(name),
        reconnectAttempts: this.reconnectAttempts.get(name) || 0,
        socketAlive: instance.socket !== null && instance.status === 'connected',
        createdAt: instance.createdAt,
        lastConnected: instance.lastConnected,
      });
    });

    return result;
  }

  /**
   * Busca histórico de mensagens de uma conversa específica sob demanda
   */
  async fetchMessageHistory(instanceName: string, jid: string, count: number = 50): Promise<unknown[]> {
    const instance = this.instances.get(instanceName);
    if (!instance?.socket) throw new Error('Instance not connected');
    if (instance.status !== 'connected') throw new Error('Instance not connected');

    try {
      console.log(`[${instanceName}] Fetching ${count} messages from ${jid}`);

      // O Baileys tem o método fetchMessageHistory para buscar mensagens antigas
      // Nota: Este método pode não estar disponível em todas as versões do Baileys
      const socket = instance.socket as unknown as {
        fetchMessageHistory?: (count: number, options: { jid: string }) => Promise<unknown[]>;
      };

      if (typeof socket.fetchMessageHistory === 'function') {
        const messages = await socket.fetchMessageHistory(count, { jid });
        console.log(`[${instanceName}] Fetched ${(messages || []).length} messages from ${jid}`);
        return messages || [];
      } else {
        console.log(`[${instanceName}] fetchMessageHistory not available in this Baileys version`);
        return [];
      }
    } catch (error) {
      console.error(`[${instanceName}] Error fetching message history:`, error);
      throw error;
    }
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

  /**
   * Busca todos os grupos do WhatsApp
   */
  async getGroups(name: string): Promise<Array<{
    id: string;
    subject: string;
    owner?: string;
    creation?: number;
    size?: number;
    desc?: string;
    descId?: string;
    restrict?: boolean;
    announce?: boolean;
    participants?: Array<{
      id: string;
      admin?: string;
    }>;
  }>> {
    const instance = this.instances.get(name);
    if (!instance?.socket) {
      throw new Error('Instance not connected');
    }

    try {
      // Busca todos os grupos participando
      const groups: Record<string, GroupMetadata> = await instance.socket.groupFetchAllParticipating();

      // Converte o objeto para array
      const groupList = Object.values(groups).map((group: GroupMetadata) => ({
        id: group.id,
        subject: group.subject,
        owner: group.owner,
        creation: group.creation,
        size: group.size,
        desc: group.desc,
        descId: group.descId,
        restrict: group.restrict,
        announce: group.announce,
        participants: group.participants?.map((p: GroupParticipant) => ({
          id: p.id,
          admin: p.admin ?? undefined,
        })),
      }));

      console.log(`[${name}] Found ${groupList.length} groups`);
      return groupList;
    } catch (error) {
      console.error(`[${name}] Error fetching groups:`, error);
      throw error;
    }
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

  /**
   * Baixa mídia de uma mensagem e retorna em base64
   */
  private async downloadMediaAsBase64(
    message: proto.IMessage,
    mediaType: MediaType
  ): Promise<{ base64: string; mimetype: string } | null> {
    try {
      // Seleciona o mediaMessage correto baseado no tipo
      let mediaMessage: proto.Message.IImageMessage | proto.Message.IAudioMessage | proto.Message.IVideoMessage | proto.Message.IDocumentMessage | proto.Message.IStickerMessage | null | undefined = null;

      switch (mediaType) {
        case 'image':
          mediaMessage = message.imageMessage;
          break;
        case 'audio':
          mediaMessage = message.audioMessage;
          break;
        case 'video':
          mediaMessage = message.videoMessage;
          break;
        case 'document':
          mediaMessage = message.documentMessage;
          break;
        case 'sticker':
          mediaMessage = message.stickerMessage;
          break;
      }

      if (!mediaMessage) {
        console.log(`[MEDIA] No media message found for type ${mediaType}`);
        return null;
      }

      console.log(`[MEDIA] Downloading ${mediaType}...`);
      const stream = await downloadContentFromMessage(mediaMessage, mediaType);
      const chunks: Buffer[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      const mimetype = mediaMessage.mimetype || 'application/octet-stream';

      console.log(`[MEDIA] Downloaded ${mediaType}: ${buffer.length} bytes, mimetype: ${mimetype}`);
      return { base64, mimetype };
    } catch (error) {
      console.error(`[MEDIA] Error downloading ${mediaType}:`, error);
      return null;
    }
  }

  async disconnectAll(): Promise<void> {
    console.log('Disconnecting all instances for graceful shutdown...');

    // Clear zombie checker interval
    if (this.zombieCheckInterval) {
      clearInterval(this.zombieCheckInterval);
      console.log('[ZOMBIE-CHECKER] Interval cleared');
    }

    // Clear all keep-alive intervals
    for (const [name, interval] of this.keepAliveIntervals) {
      clearInterval(interval);
      console.log(`[${name}] Keep-alive interval cleared`);
    }
    this.keepAliveIntervals.clear();

    // Close all sockets
    for (const [name, instance] of this.instances) {
      if (instance.socket) {
        try {
          console.log(`[${name}] Closing socket...`);
          instance.socket.end(undefined);
        } catch (error) {
          console.error(`[${name}] Error closing socket:`, error);
        }
      }
    }

    // Wait a bit for credentials to be saved
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('All instances disconnected gracefully');
  }

  private async sendWebhook(event: string, data: Record<string, unknown>, retryCount = 0): Promise<void> {
    if (!this.webhookUrl) {
      console.log(`[WEBHOOK] URL not configured, skipping event: ${event}`);
      return;
    }

    const maxRetries = 3;
    const baseDelay = 1000; // 1 segundo

    console.log(`[WEBHOOK] Sending ${event} to ${this.webhookUrl.substring(0, 50)}...`);

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
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      console.log(`[WEBHOOK] ${event} sent successfully`);
    } catch (error) {
      console.error(`Webhook error (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);

      // Retry com backoff exponencial
      if (retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount); // 1s, 2s, 4s
        console.log(`Retrying webhook in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendWebhook(event, data, retryCount + 1);
      } else {
        console.error(`Webhook failed after ${maxRetries + 1} attempts for event: ${event}`);
      }
    }
  }
}

export const baileysService = new BaileysService();
