# Luna WhatsApp Service

WhatsApp service for Luna CRM using Baileys library.

## Features

- Multiple WhatsApp instances (numbers)
- QR Code generation for connection
- Send text and media messages
- Webhook notifications for incoming messages
- Auto-reconnection on disconnect
- Session persistence

## API Endpoints

### Instances

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/instances` | List all instances |
| POST | `/instances` | Create new instance |
| GET | `/instances/:name` | Get instance info |
| GET | `/instances/:name/qr` | Get QR code |
| GET | `/instances/:name/status` | Get status |
| POST | `/instances/:name/logout` | Logout instance |
| DELETE | `/instances/:name` | Delete instance |
| POST | `/instances/:name/reconnect` | Reconnect instance |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/messages/text` | Send text message |
| POST | `/messages/media` | Send media message |

### Webhook

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/webhook` | Get webhook config |
| POST | `/webhook/set` | Set webhook URL |

## Environment Variables

```env
PORT=3001
API_KEY=your-secret-key
SESSIONS_PATH=./sessions
WEBHOOK_URL=https://your-app.com/api/webhook
```

## Development

```bash
npm install
npm run dev
```

## Production (Docker)

```bash
docker-compose up -d
```

## Webhook Events

The service sends the following events to the configured webhook URL:

### `qrcode.updated`
```json
{
  "event": "qrcode.updated",
  "data": {
    "instance": "instance-name",
    "qrCode": "data:image/png;base64,..."
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `connection.update`
```json
{
  "event": "connection.update",
  "data": {
    "instance": "instance-name",
    "state": "open",
    "phoneNumber": "5511999999999",
    "profileName": "John Doe"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `messages.upsert`
```json
{
  "event": "messages.upsert",
  "data": {
    "instance": "instance-name",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "fromMe": false,
        "id": "message-id"
      },
      "message": {
        "conversation": "Hello!"
      },
      "messageTimestamp": 1704067200,
      "pushName": "Contact Name"
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `messages.update`
```json
{
  "event": "messages.update",
  "data": {
    "instance": "instance-name",
    "update": {
      "key": {...},
      "update": {
        "status": 3
      }
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```
