import type { WASocket, proto } from '@whiskeysockets/baileys';

export interface Instance {
  socket: WASocket | null;
  qrCode: string | null;
  status: InstanceStatus;
  phoneNumber?: string;
  profileName?: string;
  profilePicUrl?: string;
  createdAt: Date;
  lastConnected?: Date;
}

export type InstanceStatus = 'disconnected' | 'connecting' | 'qr_code' | 'connected';

export interface InstanceInfo {
  name: string;
  status: InstanceStatus;
  phoneNumber?: string;
  profileName?: string;
  profilePicUrl?: string;
  qrCode?: string;
  createdAt: Date;
  lastConnected?: Date;
}

export interface CreateInstanceRequest {
  name: string;
}

export interface SendTextRequest {
  instanceName: string;
  to: string;
  text: string;
}

export interface SendMediaRequest {
  instanceName: string;
  to: string;
  mediaUrl: string;
  caption?: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  fileName?: string;
  mimetype?: string;  // Mimetype explícito (para áudio especialmente)
  ptt?: boolean;      // Push-to-talk (áudio de voz)
}

export interface SetWebhookRequest {
  url: string;
}

export interface WebhookEvent {
  event: 'messages.upsert' | 'connection.update' | 'qrcode.updated' | 'messages.update';
  data: Record<string, unknown>;
  timestamp: string;
}

export type WAMessage = proto.IWebMessageInfo;
