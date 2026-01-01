# 🔧 Verificar Configuração do Railway

## Problema Atual
O serviço Railway está retornando `401 Unauthorized` mesmo enviando a API key correta.

**Causa Provável**: A variável de ambiente `API_KEY` não está configurada no Railway, ou está com valor diferente.

---

## Como Verificar e Corrigir

### 1. Acessar Railway Dashboard
1. Acesse: https://railway.app/dashboard
2. Clique no projeto **luna-whatsapp-service**
3. Vá na aba **Variables** (ou Settings → Environment Variables)

### 2. Verificar Variável API_KEY

Procure pela variável `API_KEY` na lista.

#### ✅ Se NÃO EXISTE:
1. Clique em **New Variable**
2. Preencha:
   - **Variable Name**: `API_KEY`
   - **Value**: `Luna@WhatsApp2025!SecureKey`
3. Clique em **Add**
4. **IMPORTANTE**: Railway irá reiniciar o serviço automaticamente

#### ⚠️ Se EXISTE mas com valor diferente:
1. Clique na variável para editar
2. Altere o valor para: `Luna@WhatsApp2025!SecureKey`
3. Salve
4. Railway irá reiniciar automaticamente

#### ✅ Se EXISTE com valor correto:
Existem 2 possibilidades:
- **A) A variável tem espaços em branco extras** (antes ou depois do valor)
- **B) A variável está usando caracteres invisíveis**

**Solução**: Delete e recrie a variável:
1. Delete a variável `API_KEY` existente
2. Clique em **New Variable**
3. Preencha:
   - **Variable Name**: `API_KEY`
   - **Value**: `Luna@WhatsApp2025!SecureKey`
4. Copie e cole o valor exatamente: `Luna@WhatsApp2025!SecureKey`
5. Adicione

### 3. Verificar Outras Variáveis Necessárias

Certifique-se de que todas essas variáveis existem no Railway:

```env
API_KEY=Luna@WhatsApp2025!SecureKey
ALLOWED_ORIGINS=https://luna-sooty.vercel.app,http://localhost:3000
WEBHOOK_URL=https://luna-sooty.vercel.app/api/evo-whatsapp/webhook
PORT=3001
NODE_ENV=production
```

**Nota**: `PORT` geralmente é definido automaticamente pelo Railway, mas não faz mal ter.

### 4. Aguardar Redeploy

Após adicionar/modificar variáveis:
1. Railway reinicia o serviço automaticamente
2. Aguarde ~1-2 minutos
3. Vá na aba **Deployments** e verifique se o status é **Success**

### 5. Verificar Logs

Depois do redeploy:
1. Vá na aba **Logs** ou **Deployments** → último deployment → **View Logs**
2. Procure por linhas com `[AUTH DEBUG]`
3. Você deve ver algo como:
   ```
   [AUTH DEBUG] {
     hasXApiKey: true,
     hasAuthHeader: false,
     receivedKeyPrefix: 'Luna@WhatsA',
     expectedKeyPrefix: 'Luna@WhatsA',
     keysMatch: true
   }
   ```

Se `keysMatch: false`, significa que as chaves não são idênticas.

---

## Testar Depois de Configurar

Após configurar a variável e aguardar o redeploy, teste:

### 1. Teste de Saúde (não requer autenticação):
```bash
curl https://luna-whatsapp-service-production.up.railway.app/health
```

**Resposta esperada**:
```json
{"status":"ok","uptime":123.456,"timestamp":"..."}
```

### 2. Teste de Autenticação:
```bash
curl -H 'x-api-key: Luna@WhatsApp2025!SecureKey' \
  https://luna-whatsapp-service-production.up.railway.app/instances
```

**Resposta esperada** (se funcionar):
```json
{"success":true,"instances":[]}
```

**Resposta de erro** (se não funcionar):
```json
{"success":false,"error":"Unauthorized"}
```

---

## Se Ainda Não Funcionar

Se após configurar corretamente ainda retornar `Unauthorized`:

1. **Tire um print da tela de variáveis do Railway** mostrando:
   - Nome da variável: `API_KEY`
   - Primeiros 10 caracteres do valor

2. **Copie os logs do Railway** que aparecem depois de fazer o teste curl acima
   - Procure por linhas com `[AUTH DEBUG]`

3. **Me envie** essas informações para eu te ajudar a diagnosticar

---

## Valores Corretos (Referência)

### Railway (luna-whatsapp-service):
```
API_KEY=Luna@WhatsApp2025!SecureKey
ALLOWED_ORIGINS=https://luna-sooty.vercel.app,http://localhost:3000
WEBHOOK_URL=https://luna-sooty.vercel.app/api/evo-whatsapp/webhook
```

### Vercel (luna):
```
WHATSAPP_SERVICE_URL=https://luna-whatsapp-service-production.up.railway.app
WHATSAPP_SERVICE_KEY=Luna@WhatsApp2025!SecureKey
```

**IMPORTANTE**:
- `API_KEY` no Railway = `WHATSAPP_SERVICE_KEY` na Vercel
- Devem ser **EXATAMENTE IGUAIS**!

---

Boa sorte! 🚀
