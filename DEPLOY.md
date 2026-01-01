# Guia de Deploy - Luna WhatsApp Service

## Pré-requisitos

- Conta no Railway ou Render
- Conta na Vercel (para o app Next.js)
- Firebase configurado
- Domínio da Vercel (será gerado após primeiro deploy)

## Passo 1: Deploy do WhatsApp Service (Baileys)

### Railway (Recomendado)

1. Acesse [railway.app](https://railway.app)
2. Clique em "New Project" → "Deploy from GitHub repo"
3. Selecione o repositório `luna-whatsapp-service`
4. Configure as variáveis de ambiente:

```env
NODE_ENV=production
PORT=3000
API_KEY=SUA_CHAVE_SECRETA_FORTE_AQUI
ALLOWED_ORIGINS=https://seu-app.vercel.app,http://localhost:3000
SESSIONS_PATH=/app/sessions
WEBHOOK_URL=https://seu-app.vercel.app/api/evo-whatsapp/webhook
```

5. Railway fará deploy automático
6. Copie a URL pública (ex: `https://luna-whatsapp-service-production.up.railway.app`)

### Render (Alternativa)

1. Acesse [render.com](https://render.com)
2. "New" → "Web Service"
3. Conecte o repositório `luna-whatsapp-service`
4. Configurações:
   - **Environment**: Docker
   - **Plan**: Starter ($7/mês) - necessário para manter sempre ativo
   - **Environment Variables**: mesmas acima
5. Clique em "Create Web Service"
6. Copie a URL pública

## Passo 2: Deploy do Next.js App (Luna) na Vercel

1. Acesse [vercel.com](https://vercel.com)
2. "Import Project" → selecione o repositório `luna`
3. Configure as variáveis de ambiente:

```env
# Firebase Public (do seu .env.local)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin (do seu .env.local)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=... (copie com as quebras de linha \\n)

# WhatsApp Service - URL do Passo 1
WHATSAPP_SERVICE_URL=https://sua-url-do-railway.up.railway.app
WHATSAPP_SERVICE_KEY=SUA_CHAVE_SECRETA_FORTE_AQUI

# Ambiente
NODE_ENV=production
```

4. Clique em "Deploy"
5. Copie a URL da Vercel gerada (ex: `https://luna-production.vercel.app`)

## Passo 3: Atualizar Variáveis com URLs Reais

### No Railway/Render (WhatsApp Service)

Atualize as variáveis:
```env
ALLOWED_ORIGINS=https://luna-production.vercel.app
WEBHOOK_URL=https://luna-production.vercel.app/api/evo-whatsapp/webhook
```

### Na Vercel (Next.js App)

Atualize a variável:
```env
WHATSAPP_SERVICE_URL=https://luna-whatsapp-service-production.up.railway.app
```

Após atualizar, faça redeploy em ambos os serviços.

## Passo 4: Configurar Firestore Rules (Segurança)

No Firebase Console, vá em Firestore → Rules e atualize:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read/write their own data
    match /evo_instances/{instanceId} {
      allow read, write: if request.auth != null;
    }

    match /evo_leads/{leadId} {
      allow read, write: if request.auth != null;
    }

    match /evo_conversations/{conversationId} {
      allow read, write: if request.auth != null;
    }

    match /evo_messages/{messageId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Passo 5: Testar em Produção

1. Acesse a URL da Vercel
2. Faça login
3. Conecte uma instância WhatsApp
4. Teste envio/recebimento de mensagens
5. Verifique o Pipeline e Inbox

## Monitoramento

### Railway
- Dashboard mostra logs em tempo real
- Métricas de CPU, memória e rede
- Alertas automáticos

### Vercel
- Dashboard Analytics
- Error tracking
- Performance metrics

## Troubleshooting

### Erro "Unauthorized" ao enviar mensagens
- Verifique se `WHATSAPP_SERVICE_KEY` é igual em ambos os serviços

### Erro "CORS policy"
- Verifique se `ALLOWED_ORIGINS` inclui a URL da Vercel
- Certifique-se de usar HTTPS (não HTTP)

### Mensagens não chegam
- Verifique se `WEBHOOK_URL` está correto
- Veja logs no Railway/Render para erros
- Teste o endpoint `/health` do WhatsApp Service

### Instância desconecta
- Railway/Render Starter plan mantém serviço sempre ativo
- Free tier pode hibernar - upgrade para Starter

## Custos Estimados

- **Railway**: ~$5-10/mês (Starter plan)
- **Render**: $7/mês (Starter plan)
- **Vercel**: Grátis (Hobby) ou $20/mês (Pro)
- **Firebase**: Grátis até certo limite

**Total**: ~$7-17/mês

## Backup

O WhatsApp Service salva sessões em `/app/sessions`. Configure backup periódico:

### Railway
- Usar volume persistente (disponível no plan Starter)
- Configurar em: Project Settings → Volumes

### Render
- Usar disks persistentes
- Configurar em: Service Settings → Disks

## Atualizações

Para atualizar o código em produção:

1. Faça commit e push para o GitHub
2. Railway/Render e Vercel fazem deploy automático
3. Monitore logs durante deploy
4. Teste funcionalidades críticas

## Variáveis de Ambiente - Checklist

### WhatsApp Service (Railway/Render)
- [ ] NODE_ENV=production
- [ ] PORT=3000
- [ ] API_KEY (mesma chave em ambos)
- [ ] ALLOWED_ORIGINS (URL da Vercel)
- [ ] SESSIONS_PATH=/app/sessions
- [ ] WEBHOOK_URL (URL da Vercel + /api/evo-whatsapp/webhook)

### Next.js App (Vercel)
- [ ] Todas as variáveis Firebase (NEXT_PUBLIC_*)
- [ ] Todas as variáveis Firebase Admin
- [ ] WHATSAPP_SERVICE_URL (URL do Railway/Render)
- [ ] WHATSAPP_SERVICE_KEY (mesma chave do service)
- [ ] NODE_ENV=production
