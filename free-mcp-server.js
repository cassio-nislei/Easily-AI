/**
 * Free MCP Server - Modelos de IA gratuitos via API compatível com OpenAI
 *
 * Implementa o protocolo MCP (JSON-RPC sobre stdio) para fornecer
 * modelos de IA gratuitos/configuráveis.
 *
 * Configuração via env vars:
 *   FREE_API_URL  - URL base da API compatível com OpenAI (ex: https://api.groq.com/openai/v1)
 *   FREE_API_KEY  - Chave de API
 *   FREE_MODEL    - Modelo padrão (default: qwen-2.5-72b-instruct)
 *
 * Se FREE_API_URL não estiver configurado, retorna mensagens informativas
 * para orientar o usuário sobre como configurar.
 */

import { createInterface } from 'node:readline';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

// ============================================================
// CONFIG
// ============================================================

const FREE_API_URL = process.env.FREE_API_URL || '';
const FREE_API_KEY = process.env.FREE_API_KEY || '';
const FREE_MODEL = process.env.FREE_MODEL || 'qwen-2.5-72b-instruct';

const isConfigured = FREE_API_URL.length > 0 && FREE_API_KEY.length > 0;

// Lista de modelos gratuitos/sugeridos
const FREE_MODELS = [
  { id: 'qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B (free)', provider: 'free', context: 32768 },
  { id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B (free)', provider: 'free', context: 32768 },
  { id: 'gemma-2-27b-it', name: 'Gemma 2 27B (free)', provider: 'free', context: 8192 },
  { id: 'deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 32B (free)', provider: 'free', context: 16384 },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (free)', provider: 'free', context: 32768 },
];

// ============================================================
// TRANSPORTE STDIO (MCP Protocol)
// ============================================================

const rl = createInterface({ input: process.stdin });

function sendJson(obj) {
  const msg = JSON.stringify(obj);
  process.stdout.write(msg + '\n');
}

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line.trim());

    // Se tem id E não tem method, é resposta a uma requisição nossa
    if (msg.id !== undefined && !msg.method) {
      return;
    }

    switch (msg.method) {
      case 'initialize':
        sendJson({
          id: msg.id,
          result: {
            protocolVersion: '0.1.0',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'free-mcp-server', version: '1.0.0' },
          },
        });
        break;

      case 'tools/list':
        handleListTools(msg.id);
        break;

      case 'tools/call':
        handleCallTool(msg);
        break;

      case 'resources/list':
        sendJson({ id: msg.id, result: { resources: [] } });
        break;

      default:
        sendJson({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  } catch (err) {
    console.error('[free-mcp] Erro:', err.message);
  }
});

// ============================================================
// TOOLS DEFINITION
// ============================================================

const TOOLS = [
  {
    name: 'ai_chat',
    description: 'Envia mensagem para um modelo de IA gratuito. Configure FREE_API_URL e FREE_API_KEY no servidor.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'A mensagem/prompt para o modelo' },
        model: { type: 'string', description: `Modelo (padrão: ${FREE_MODEL})` },
        system: { type: 'string', description: 'Mensagem de sistema / contexto' },
      },
      required: ['message'],
    },
  },
  {
    name: 'ai_list_models',
    description: 'Lista modelos de IA gratuitos disponíveis.',
    inputSchema: {
      type: 'object',
      properties: {
        raw: { type: 'boolean', description: 'Se true, retorna JSON bruto dos modelos' },
      },
    },
  },
  {
    name: 'ai_txt2img',
    description: 'Gera imagem a partir de texto (depende da API configurada).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Descrição da imagem' },
        model: { type: 'string', description: 'Modelo de imagem' },
      },
      required: ['prompt'],
    },
  },
];

const getConfigStatus = () => ({
  configured: isConfigured,
  apiUrl: FREE_API_URL,
  model: FREE_MODEL,
});

// ============================================================
// HANDLERS
// ============================================================

function handleListTools(id) {
  sendJson({ id, result: { tools: TOOLS } });
}

async function handleCallTool(msg) {
  const { name, arguments: args } = msg.params;
  const id = msg.id;

  try {
    const result = await executeTool(name, args || {});
    sendJson({
      id,
      result: {
        content: [{ type: 'text', text: result }],
      },
    });
  } catch (err) {
    sendJson({
      id,
      result: {
        content: [{ type: 'text', text: `Erro: ${err.message}` }],
        isError: true,
      },
    });
  }
}

async function executeTool(name, args) {
  switch (name) {
    case 'ai_chat':
      return await handleChat(args);
    case 'ai_list_models':
      return handleListModels(args);
    case 'ai_txt2img':
      return await handleTxt2img(args);
    default:
      throw new Error(`Tool ${name} não encontrada`);
  }
}

// ============================================================
// AI CHAT
// ============================================================

async function handleChat(args) {
  const { message, model = FREE_MODEL, system } = args;

  if (!isConfigured) {
    return (
      `⚠️ **Free MCP Server não configurado**\n\n` +
      `Para usar modelos gratuitos, defina as variáveis de ambiente:\n\n` +
      `  FREE_API_URL=https://api.groq.com/openai/v1\n` +
      `  FREE_API_KEY=sua-chave-aqui\n` +
      `  FREE_MODEL=llama-3.3-70b-versatile\n\n` +
      `Você pode obter uma chave gratuita em: https://console.groq.com/keys\n\n` +
      `Exemplo de comando:\n` +
      `  set FREE_API_URL=https://api.groq.com/openai/v1\n` +
      `  set FREE_API_KEY=gsk_...\n` +
      `  node webui/server.js\n\n` +
      `Provedores gratuitos compatíveis:\n` +
      `  • Groq (groq.com) - Llama, Mixtral, Gemma\n` +
      `  • OpenRouter (openrouter.ai) - muitos modelos free\n` +
      `  • Ollama local - http://localhost:11434/v1`
    );
  }

  // Monta requisição compatível com OpenAI Chat API
  const body = {
    model,
    messages: [],
    max_tokens: 4096,
  };

  if (system) {
    body.messages.push({ role: 'system', content: system });
  }
  body.messages.push({ role: 'user', content: message });

  const response = await apiPost('/chat/completions', body);
  const text = response?.choices?.[0]?.message?.content || 'Sem resposta do modelo';
  return text;
}

// ============================================================
// LIST MODELS
// ============================================================

function handleListModels(args) {
  // Se temos uma API configurada, tenta buscar modelos reais
  // Senão, retorna a lista curada de modelos gratuitos conhecidos

  if (args.raw) {
    return JSON.stringify({ models: FREE_MODELS, total: FREE_MODELS.length, config: getConfigStatus() });
  }

  return `${FREE_MODELS.length} modelos gratuitos disponíveis. Configure FREE_API_URL para acessá-los.`;
}

// ============================================================
// TXT2IMG
// ============================================================

async function handleTxt2img(args) {
  const { prompt, model = 'flux-schnell' } = args;

  if (!isConfigured) {
    return (
      `⚠️ Geração de imagem não disponível sem configuração.\n\n` +
      `Defina FREE_API_URL para um provedor compatível com DALL-E/Imagen.`
    );
  }

  try {
    const body = {
      model,
      prompt,
      n: 1,
      size: '1024x1024',
    };

    const response = await apiPost('/images/generations', body);
    const imageUrl = response?.data?.[0]?.url || response?.data?.[0]?.b64_json || '';
    return JSON.stringify({ url: imageUrl, mimeType: 'image/png', size: 0 });
  } catch (err) {
    throw new Error(`Erro ao gerar imagem: ${err.message}`);
  }
}

// ============================================================
// HTTP HELPER (OpenAI-compatible API)
// ============================================================

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(path, FREE_API_URL.endsWith('/') ? FREE_API_URL : FREE_API_URL + '/');

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FREE_API_KEY}`,
        },
        timeout: 60000,
      };

      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = requester(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const errMsg = parsed?.error?.message || parsed?.error || `HTTP ${res.statusCode}`;
              reject(new Error(errMsg));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Resposta inválida (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Falha na requisição: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout na requisição')); });

      req.write(JSON.stringify(body));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// console.error no startup
console.error('[free-mcp] ✅ Free MCP Server pronto');
console.error(`[free-mcp] Config: ${isConfigured ? '✓ configurado' : '✗ não configurado'}`);
if (isConfigured) {
  console.error(`[free-mcp] API: ${FREE_API_URL}`);
  console.error(`[free-mcp] Modelo: ${FREE_MODEL}`);
} else {
  console.error('[free-mcp] Configure FREE_API_URL e FREE_API_KEY para usar modelos gratuitos');
}
