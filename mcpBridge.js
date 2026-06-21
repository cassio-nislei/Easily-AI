/**
 * MCP Bridge - Provider abstraction layer
 *
 * Suporta múltiplos provedores MCP:
 *   - puter: Puter.js SDK (500+ modelos, conta Puter gratuita)
 *   - claude_code: Free Claude Code MCP via OpenAI REST API
 *
 * O McpBridge roteia chamadas para o provedor ativo.
 * Exporta singleton: import { mcp } from './mcpBridge.js'
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(__dirname, '..');
const TOKEN_FILE = join(MCP_ROOT, '.puter-token.json');
const PUTER_ORIGIN = process.env.PUTER_ORIGIN || 'https://puter.com';

// Carrega init.cjs da Puter (já tem suporte Node.js nativo)
const { init: initPuter, getAuthToken } = createRequire(
  import.meta.url
)('@heyputer/puter.js/src/init.cjs');

// ============================================================
// PUTER MCP PROVIDER
// ============================================================

class PuterMcpProvider {
  constructor() {
    this.puter = null;
    this._ready = false;
    this._initializing = false;
  }

  get isRunning() {
    return this._ready && this.puter !== null;
  }

  /**
   * Inicializa a Puter SDK com token salvo ou abre navegador para login
   */
  async start() {
    if (this._ready) return true;
    if (this._initializing) {
      while (this._initializing) await new Promise(r => setTimeout(r, 100));
      return this._ready;
    }

    this._initializing = true;

    try {
      // Tenta carregar token salvo
      const token = this._loadToken();

      if (token) {
        console.log('[mcp:puter] 🔑 Inicializando Puter.js com token salvo...');
        this.puter = initPuter(token);
      } else {
        console.log('[mcp:puter] ⚠️ Sem token, abrindo navegador para login...');
        await this.login();
        return this._ready;
      }

      // Verifica se está autenticado
      try {
        const signedIn = this.puter?.auth?.isSignedIn?.();
        if (signedIn) {
          const user = this.puter?.auth?.getUser?.();
          console.log('[mcp:puter] ✅ Autenticado como:', user?.username || 'usuário Puter');
        } else if (token) {
          console.log('[mcp:puter] ⚠️ Token presente mas sessão expirou, re-autenticando...');
          await this.login();
          return this._ready;
        }
      } catch {
        console.log('[mcp:puter] ⚠️ Erro ao verificar autenticação, re-autenticando...');
        await this.login();
        return this._ready;
      }

      this._ready = true;
      console.log('[mcp:puter] ✅ Puter.js SDK pronto');
      return true;
    } catch (err) {
      console.error('[mcp:puter] ❌ Erro ao inicializar Puter:', err.message);
      this._ready = false;
      throw err;
    } finally {
      this._initializing = false;
    }
  }

  /**
   * Inicia autenticação via navegador (abre Puter.com para login)
   */
  async login() {
    console.log('[mcp:puter] 🔑 Abrindo navegador para autenticação...');
    try {
      const token = await getAuthToken(PUTER_ORIGIN);
      if (!token) throw new Error('Falha na autenticação');

      this._saveToken(token);
      this.puter = initPuter(token);
      this._ready = true;
      console.log('[mcp:puter] ✅ Autenticação concluída');
      return true;
    } catch (err) {
      console.error('[mcp:puter] ❌ Erro na autenticação:', err.message);
      throw err;
    }
  }

  /**
   * Desloga do Puter (remove token e reseta estado)
   */
  async stop() {
    console.log('[mcp:puter] 🔓 Deslogando do Puter...');
    try {
      this.puter = null;
      this._ready = false;

      // Remove token salvo
      if (existsSync(TOKEN_FILE)) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(TOKEN_FILE);
        console.log('[mcp:puter] Token removido');
      }

      console.log('[mcp:puter] ✅ Deslogado do Puter');
      return true;
    } catch (err) {
      console.error('[mcp:puter] ❌ Erro ao deslogar:', err.message);
      throw err;
    }
  }

  // Alias para compatibilidade
  async logout() {
    return this.stop();
  }

  /**
   * Lista modelos disponíveis
   */
  async listModels() {
    await this._ensureReady();
    try {
      const models = await this.puter.ai.listModels();
      return models;
    } catch (err) {
      console.error('[mcp:puter] Erro ao listar modelos:', err.message);
      throw err;
    }
  }

  /**
   * Envia chat para um modelo de IA
   */
  async chat(message, options = {}) {
    await this._ensureReady(true);
    const { compatMode = false, ...chatOptions } = options;

    try {
      console.log('[mcp:puter] chat chamado com model:', chatOptions.model);
      const response = await this.puter.ai.chat(message, chatOptions);

      if (response === null || response === undefined) {
        return 'Sem resposta do modelo';
      }

      if (typeof response === 'string') {
        return response;
      }

      if (typeof response === 'object') {
        let content = null;

        // Formato Puter/Claude: { message: { content: [{ type: "text", text: "..." }] } }
        if (response.message?.content) {
          if (typeof response.message.content === 'string') {
            content = response.message.content;
          } else if (Array.isArray(response.message.content)) {
            content = response.message.content
              .filter(c => c && (c.text || typeof c === 'string'))
              .map(c => c.text || c)
              .join('');
          }
        }

        // Formato Anthropic direto: { content: [{ type: "text", text: "..." }] }
        if (!content && Array.isArray(response.content) && response.content.length > 0) {
          content = response.content
            .filter(c => c && (c.text || typeof c === 'string'))
            .map(c => c.text || c)
            .join('');
        }

        // Formato direto: { content: "..." }
        if (!content && typeof response.content === 'string') {
          content = response.content;
        }

        // Formato texto: { text: "..." }
        if (!content && typeof response.text === 'string') {
          content = response.text;
        }

        // Formato resposta: { response: "..." }
        if (!content && typeof response.response === 'string') {
          content = response.response;
        }

        // Formato choices (OpenAI): { choices: [{ message: { content: "..." } }] }
        if (!content && response.choices?.[0]?.message?.content) {
          content = response.choices[0].message.content;
        }

        // Formato delta (streaming): { choices: [{ delta: { content: "..." } }] }
        if (!content && response.choices?.[0]?.delta?.content) {
          content = response.choices[0].delta.content;
        }

        // Formato resultado: { result: "..." }
        if (!content && typeof response.result === 'string') {
          content = response.result;
        }

        // Formato output: { output: "..." }
        if (!content && typeof response.output === 'string') {
          content = response.output;
        }

        // Modo compatível: busca recursiva em qualquer propriedade
        if (!content && compatMode) {
          console.log('[mcp:puter] Modo compatível: busca recursiva');
          content = this._extractRecursive(response);
        }

        // Fallback: stringify formatado
        if (!content) {
          console.warn('[mcp:puter] Formato não reconhecido:', Object.keys(response));
          content = JSON.stringify(response, null, 2);
        }

        return String(content);
      }

      return String(response);
    } catch (err) {
      console.error('[mcp:puter] Erro no chat:', err.message);
      throw err;
    }
  }

  _extractRecursive(obj, depth = 0) {
    if (depth > 5) return null;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && val.length > 5) return val;
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        const result = this._extractRecursive(val, depth + 1);
        if (result) return result;
      }
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.length > 5) return item;
          if (typeof item === 'object' && item !== null) {
            const result = this._extractRecursive(item, depth + 1);
            if (result) return result;
          }
        }
      }
    }
    return null;
  }

  /**
   * Simula tools/call do MCP para compatibilidade com o server.js
   */
  async callTool(name, args = {}) {
    switch (name) {
      case 'puter_ai_list_models': {
        const models = await this.listModels();
        if (args.raw) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ models, total: models.length }) }],
          };
        }
        return {
          content: [{ type: 'text', text: `${models.length} modelos disponíveis` }],
        };
      }

      case 'puter_ai_chat': {
        const response = await this.chat(args.message, {
          model: args.model || 'gpt-5.4-nano',
          system: args.system || undefined,
          compatMode: args.compatMode || false,
        });
        return {
          content: [{ type: 'text', text: response }],
        };
      }

      case 'puter_ai_txt2img': {
        const result = await this.txt2img(args.prompt, args.model);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      case 'puter_fs_write': {
        await this.fsWrite(args.path, args.content);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, path: args.path }) }],
        };
      }

      case 'puter_fs_read': {
        const blob = await this.fsRead(args.path);
        const text = await blob.text();
        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'puter_fs_delete': {
        await this.fsDelete(args.path);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      }

      case 'puter_fs_mkdir': {
        await this.fsMkdir(args.path);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, path: args.path }) }],
        };
      }

      case 'puter_fs_readdir': {
        const entries = await this.fsReaddir(args.path);
        return {
          content: [{ type: 'text', text: JSON.stringify({ entries }) }],
        };
      }

      case 'puter_auth_status': {
        const authenticated = this._isAuthenticated();
        return {
          content: [{ type: 'text', text: JSON.stringify({ authenticated }) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Tool ${name} não implementada no Puter provider` }],
          isError: true,
        };
    }
  }

  /**
   * Gera imagem a partir de texto
   */
  async txt2img(prompt, model = 'dall-e-3') {
    await this._ensureReady(true);
    try {
      if (this.puter?.ai?.txt2img) {
        if (model && model !== 'default') {
          try {
            const result = await this.puter.ai.txt2img(prompt, { model });
            const parsed = this._parseImageResult(result);
            if (parsed?.url) return parsed;
          } catch (sdkErr) {
            console.warn('[mcp:puter] Tentativa txt2img com modelo falhou:', sdkErr.message);
          }
        }

        try {
          const result = await this.puter.ai.txt2img(prompt);
          const parsed = this._parseImageResult(result);
          if (parsed?.url) return parsed;
        } catch (sdkErr2) {
          console.warn('[mcp:puter] Tentativa txt2img sem modelo falhou:', sdkErr2.message);
        }
      }

      throw new Error(
        `Não foi possível gerar imagem com o modelo "${model}". ` +
        `O serviço de geração de imagem do Puter está temporariamente indisponível.`
      );
    } catch (err) {
      console.error('[mcp:puter] Erro no txt2img:', err.message);
      throw err;
    }
  }

  _parseImageResult(result) {
    if (result === null || result === undefined) return null;
    if (typeof result === 'string') {
      if (result.startsWith('http') || result.startsWith('data:')) {
        return { url: result, mimeType: 'image/png', size: 0 };
      }
      if (result.length > 1000) {
        return { url: `data:image/png;base64,${result}`, mimeType: 'image/png', size: 0 };
      }
      try {
        return this._parseImageResult(JSON.parse(result));
      } catch { /* não é JSON */ }
    }
    if (typeof result === 'object') {
      if (result.src) return { url: result.src, mimeType: 'image/png', size: 0 };
      if (result.url) return { url: result.url, mimeType: result.mimeType || 'image/png', size: result.size || 0 };
      if (result.data?.[0]?.b64_json) return { url: `data:image/png;base64,${result.data[0].b64_json}`, mimeType: 'image/png', size: 0 };
      if (result.data?.[0]?.url) return { url: result.data[0].url, mimeType: 'image/png', size: 0 };
      if (result.image_url) return { url: result.image_url, mimeType: 'image/png', size: 0 };
      if (result.image?.url) return { url: result.image.url, mimeType: 'image/png', size: 0 };
      if (result.content) return this._parseImageResult(result.content);
      if (result.message?.content) return this._parseImageResult(result.message.content);
      for (const key of Object.keys(result)) {
        const val = result[key];
        if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('data:image'))) {
          return { url: val, mimeType: 'image/png', size: 0 };
        }
        if (typeof val === 'object' && val !== null) {
          const inner = this._parseImageResult(val);
          if (inner?.url) return inner;
        }
      }
      if (Array.isArray(result)) {
        for (const item of result) {
          const inner = this._parseImageResult(item);
          if (inner?.url) return inner;
        }
      }
    }
    return null;
  }

  async fsWrite(path, content) {
    await this._ensureReady(true);
    return await this.puter.fs.write(path, content);
  }

  async fsRead(path) {
    await this._ensureReady(true);
    return await this.puter.fs.read(path);
  }

  async fsDelete(path) {
    await this._ensureReady(true);
    return await this.puter.fs.delete(path);
  }

  async fsMkdir(path) {
    await this._ensureReady(true);
    return await this.puter.fs.mkdir(path);
  }

  async fsReaddir(path) {
    await this._ensureReady(true);
    return await this.puter.fs.readdir(path);
  }

  async _ensureReady(requireAuth = false) {
    if (!this._ready) await this.start();
    if (requireAuth && !this._isAuthenticated()) {
      throw new Error(
        '❌ Não autenticado no Puter. Faça login ou use puter_auth_login.'
      );
    }
  }

  _isAuthenticated() {
    try {
      return !!this.puter?.auth?.isSignedIn?.();
    } catch {
      return false;
    }
  }

  _loadToken() {
    try {
      if (existsSync(TOKEN_FILE)) {
        return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')).token || null;
      }
    } catch {}
    return null;
  }

  _saveToken(token) {
    writeFileSync(TOKEN_FILE, JSON.stringify({ token, savedAt: new Date().toISOString() }, null, 2));
  }
}

// ============================================================
// CLAUDE CODE MCP PROVIDER (OpenAI-compatible REST API)
// ============================================================

/**
 * Provider para Free Claude Code (fcc-server) via OpenAI REST API.
 *
 * O fcc-server roda na porta 9090 (FREE_MCP_URL) e expõe endpoints
 * compatíveis com OpenAI:
 *   GET  /v1/models              → lista de modelos (ex: nvidia, openrouter, opencode)
 *   POST /v1/chat/completions    → chat completion
 *
 * NÃO usa o protocolo MCP JSON-RPC (tools/list, tools/call).
 */

const FREE_MCP_URL = process.env.FREE_MCP_URL || 'http://127.0.0.1:9090';
const FREE_MCP_KEY = process.env.FREE_MCP_KEY || 'freecc';

class ClaudeCodeMcpProvider {
  constructor() {
    this._models = [];
    this._running = false;
    this._fetching = false;
  }

  get isRunning() {
    return this._running;
  }

  /**
   * Testa conexão com o fcc-server via GET /v1/models
   */
  async start() {
    if (this._running) return true;

    console.log(`[mcp:claude_code] 🌐 Conectando a fcc-server: ${FREE_MCP_URL}`);

    try {
      const models = await this._fetchModels();
      this._models = models;
      this._running = true;
      console.log(`[mcp:claude_code] ✅ Conectado — ${models.length} modelos disponíveis`);
      return true;
    } catch (err) {
      this._running = false;
      console.error(`[mcp:claude_code] ❌ Falha ao conectar: ${err.message}`);
      throw new Error(`Não foi possível conectar ao fcc-server em ${FREE_MCP_URL}: ${err.message}`);
    }
  }

  async stop() {
    this._running = false;
    this._models = [];
    return true;
  }

  async logout() {
    return this.stop();
  }

  // ============================================================
  // HTTP helpers
  // ============================================================

  async _fetch(urlPath, options = {}) {
    const url = FREE_MCP_URL.replace(/\/+$/, '') + urlPath;
    const headers = {
      'Authorization': `Bearer ${FREE_MCP_KEY}`,
      ...(options.headers || {}),
    };

    if (typeof fetch === 'function') {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: options.signal || AbortSignal.timeout(120000),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.detail || `HTTP ${res.status}`);
      }
      return data;
    }

    // Fallback: http/https module
    const mod = url.startsWith('https') ? await import('node:https') : await import('node:http');
    const u = new URL(url);

    return new Promise((resolve, reject) => {
      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: options.method || 'GET',
        headers,
        timeout: 120000,
      };

      const req = mod.request(opts, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 400) {
              reject(new Error(parsed?.error?.message || parsed?.detail || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Resposta inválida (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`));
          }
        });
      });
      req.on('error', (err) => reject(new Error(`Falha HTTP: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout HTTP')); });
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  // ============================================================
  // Model listing — GET /v1/models
  // ============================================================

  /**
   * Busca modelos da API OpenAI-compatible
   * Retorno esperado: { data: [{ id, object, owned_by, ... }] }
   */
  async _fetchModels() {
    console.log(`[mcp:claude_code] 🔍 Buscando modelos de ${FREE_MCP_URL}/v1/models`);
    const data = await this._fetch('/v1/models');

    let rawModels = [];
    if (Array.isArray(data)) {
      // Alguns servidores retornam array direto
      rawModels = data;
    } else if (data?.data && Array.isArray(data.data)) {
      // Formato OpenAI padrão: { data: [...] }
      rawModels = data.data;
    } else if (data?.models && Array.isArray(data.models)) {
      rawModels = data.models;
    } else if (typeof data === 'object') {
      // Tenta achar qualquer array de objetos com 'id'
      for (const val of Object.values(data)) {
        if (Array.isArray(val) && val.length > 0 && val[0]?.id) {
          rawModels = val;
          break;
        }
      }
    }

    // Normaliza para o formato { id, name, provider, context }
    const seen = new Set();
    const models = [];

    for (const m of rawModels) {
      const id = m.id || m.name || m.model || m.modelId || '';
      if (!id || seen.has(id)) continue;
      seen.add(id);

      // Usa display_name para exibição (mais legível que o id)
      const name = m.display_name || m.name || m.title || id;

      // Extrai provider: tenta extrair do display_name ou do id
      // fcc-server usa formato "anthropic/mistral/mistral-medium" ou "claude-3-freecc-no-thinking/nvidia/..."
      let provider = m.owned_by || m.provider || '';
      if (!provider) {
        const pathParts = id.split('/');
        // Se tem 2+ segmentos, o provider real é o segundo
        // Ex: "anthropic/mistral/mistral-medium" → mistral
        //     "claude-3-freecc-no-thinking/nvidia/llama" → nvidia
        if (pathParts.length >= 3) {
          provider = pathParts[1];
        } else if (pathParts.length === 2) {
          provider = pathParts[0];
        }
      }
      if (!provider) {
        if (id.includes(':')) {
          provider = id.split(':')[0];
        } else if (id.startsWith('nvidia')) {
          provider = 'nvidia';
        } else if (id.startsWith('openrouter')) {
          provider = 'openrouter';
        } else if (id.startsWith('opencode')) {
          provider = 'opencode';
        } else if (id.startsWith('anthropic')) {
          provider = 'anthropic';
        } else if (id.startsWith('openai') || id.startsWith('gpt')) {
          provider = 'openai';
        }
      }

      models.push({
        id,
        name,
        provider: provider || 'free',
        description: m.description || '',
        context: m.context || m.max_context || 0,
        tool_call: false,
      });
    }

    console.log(`[mcp:claude_code] ✅ ${models.length} modelos carregados`);
    // Mostra provedores distintos
    const providers = [...new Set(models.map(m => m.provider).filter(Boolean))];
    console.log(`[mcp:claude_code] 📊 Provedores: ${providers.join(', ')}`);

    return models;
  }

  // ============================================================
  // Chat completion — POST /v1/messages (Anthropic API)
  // ============================================================

  /**
   * Lê resposta SSE do fcc-server em streaming.
   * O fcc-server usa SSE mesmo com stream=false — a conexão NÃO fecha sozinha,
   * então precisamos ler eventos até encontrar message_stop.
   */
  async _fetchSSE(urlPath, options = {}) {
    const url = FREE_MCP_URL.replace(/\/+$/, '') + urlPath;
    const headers = {
      'Authorization': `Bearer ${FREE_MCP_KEY}`,
      ...(options.headers || {}),
    };

    // Usa timeout global para não travar
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      if (typeof fetch === 'function') {
        return await this._fetchSSEStream(url, options, headers, controller);
      }
      return await this._fetchSSEStreamHttp(url, options, headers, controller);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Lê SSE usando fetch() ReadableStream
   */
  async _fetchSSEStream(url, options, headers, controller) {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text();
      try {
        const errData = JSON.parse(bodyText);
        throw new Error(errData?.error?.message || errData?.detail || `HTTP ${res.status}`);
      } catch (e) {
        if (e.message.startsWith('HTTP') || e.message.includes('HTTP')) throw e;
        throw new Error(bodyText.slice(0, 200) || `HTTP ${res.status}`);
      }
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break; // conexão fechada — sai

      buffer += decoder.decode(value, { stream: true });

      // Processa eventos SSE completos no buffer
      const processed = this._processSSEBuffer(buffer);
      if (processed.text) resultText += processed.text;
      buffer = processed.rest;

      // Se encontrou message_stop, para de ler
      if (processed.finished) {
        controller.abort(); // fecha conexão
        break;
      }
    }

    return resultText;
  }

  /**
   * Lê SSE usando http/https module (fallback)
   */
  _fetchSSEStreamHttp(url, options, headers, controller) {
    return new Promise(async (resolve, reject) => {
      const mod = url.startsWith('https') ? await import('node:https') : await import('node:http');
      const u = new URL(url);

      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: options.method || 'GET',
        headers,
      };

      const req = mod.request(opts, (res) => {
        if (res.statusCode >= 400) {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`)));
          return;
        }

        let buffer = '';
        let resultText = '';

        res.on('data', (chunk) => {
          if (controller.signal.aborted) {
            res.destroy();
            return;
          }

          buffer += chunk.toString();

          const processed = this._processSSEBuffer(buffer);
          if (processed.text) resultText += processed.text;
          buffer = processed.rest;

          if (processed.finished) {
            res.destroy();
            resolve(resultText);
          }
        });

        res.on('end', () => {
          resolve(resultText); // conexão fechou, retorna o que tem
        });
      });

      req.on('error', (err) => {
        if (err.name === 'AbortError') return;
        reject(new Error(`Falha HTTP: ${err.message}`));
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout HTTP')); });

      controller.signal.addEventListener('abort', () => {
        req.destroy();
      });

      if (options.body) req.write(options.body);
      req.end();
    });
  }

  /**
   * Processa buffer SSE: extrai eventos completos, retorna texto acumulado
   * e se encontrou message_stop.
   */
  _processSSEBuffer(buffer) {
    let text = '';
    let finished = false;

    // Divide por \n\n (separador de eventos SSE)
    const parts = buffer.split('\n\n');

    // A última parte pode estar incompleta — guarda como rest
    const rest = parts.pop();

    for (const part of parts) {
      if (!part.trim()) continue;

      let dataLine = '';
      for (const line of part.trim().split('\n')) {
        if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
          break;
        }
      }
      if (!dataLine) continue;

      try {
        const data = JSON.parse(dataLine);

        // Verifica se é o fim da mensagem
        if (data.type === 'message_stop') {
          finished = true;
          continue;
        }

        // Acumula texto de content_block_delta/text_delta
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          text += data.delta.text || '';
        }
      } catch { /* ignora linhas inválidas */ }
    }

    return { text, rest, finished };
  }

  /**
   * Envia chat para o fcc-server via Anthropic Messages API
   *
   * Request:  POST /v1/messages com { model, max_tokens, messages }
   * Response: SSE stream com content_block_delta/text_delta
   *           (a conexão fica aberta até receber message_stop)
   */
  async _sendChat(args) {
    const model = args.model || 'qwen-2.5-72b-instruct';
    const system = args.system || '';
    const message = args.message || '';
    const images = args.images || []; // Array de { media_type, data } (base64)

    let content;
    if (images.length > 0) {
      // Conteúdo multimodal com imagens (formato OpenAI / fcc-server)
      content = [
        { type: 'text', text: message },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: `data:${img.media_type};base64,${img.data}`,
          },
        })),
      ];
    } else {
      content = message; // string simples (text-only)
    }

    const body = {
      model,
      max_tokens: args.max_tokens || 4096,
      messages: [
        { role: 'user', content },
      ],
    };

    // Anthropic coloca system prompt fora do array messages
    if (system) {
      body.system = system;
    }

    console.log(`[mcp:claude_code] 💬 Chat com modelo: ${model}`);

    const text = await this._fetchSSE('/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FREE_MCP_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const preview = text.length > 150 ? text.slice(0, 150) + '...' : text;
    console.log(`[mcp:claude_code] ✅ Resposta recebida (${text.length} caracteres)`);
    console.log(`[mcp:claude_code] 📝 Preview: ${JSON.stringify(preview)}`);
    if (/```(\w+)?/.test(text)) {
      console.log(`[mcp:claude_code] 🔧 Resposta contém blocos de código`);
    }

    return text || 'Sem resposta do modelo.';
  }

  // ============================================================
  // Tool call dispatch
  // ============================================================

  async callTool(name, args = {}) {
    if (!this.isRunning) {
      try {
        await this.start();
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Free MCP não disponível: ${err.message}` }],
          isError: true,
        };
      }
    }

    switch (name) {
      case 'puter_ai_list_models': {
        // Recarrega modelos se solicitado explicitamente ou se não temos
        if (args.force || this._models.length === 0) {
          try {
            this._models = await this._fetchModels();
          } catch (err) {
            console.warn('[mcp:claude_code] ⚠️ Erro ao recarregar modelos:', err.message);
          }
        }
        if (args.raw) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ models: this._models, total: this._models.length }) }],
          };
        }
        return {
          content: [{ type: 'text', text: `${this._models.length} modelos disponíveis` }],
        };
      }

      case 'puter_ai_chat': {
        try {
          const text = await this._sendChat(args);
          return {
            content: [{ type: 'text', text }],
          };
        } catch (err) {
          console.error('[mcp:claude_code] ❌ Erro no chat:', err.message);
          return {
            content: [{ type: 'text', text: `Erro: ${err.message}` }],
            isError: true,
          };
        }
      }

      case 'puter_ai_txt2img': {
        return {
          content: [{ type: 'text', text: 'Geração de imagem não disponível no Free Claude Code MCP' }],
          isError: true,
        };
      }

      case 'puter_auth_status': {
        return {
          content: [{ type: 'text', text: JSON.stringify({ authenticated: this._running }) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Tool "${name}" não disponível no Free Claude Code MCP. Ferramentas disponíveis: ai_chat, ai_list_models` }],
          isError: true,
        };
    }
  }
}

// ============================================================
// MCP BRIDGE ROUTER
// ============================================================

class McpBridge {
  constructor() {
    this._providers = {
      puter: new PuterMcpProvider(),
      claude_code: new ClaudeCodeMcpProvider(),
    };
    this._current = 'puter';
  }

  /** Nome do provedor atual */
  get provider() {
    return this._current;
  }

  /** Lista de provedores disponíveis */
  get providers() {
    return Object.keys(this._providers);
  }

  /** Referência ao provedor atual */
  get current() {
    return this._providers[this._current];
  }

  /** isRunning do provedor atual */
  get isRunning() {
    return this.current ? this.current.isRunning : false;
  }

  /**
   * Altera o provedor ativo
   */
  setProvider(name) {
    if (!this._providers[name]) {
      throw new Error(`Provedor desconhecido: ${name}. Disponíveis: ${this.providers.join(', ')}`);
    }
    if (name !== this._current) {
      // Para o provedor atual se estiver rodando
      if (this.current?.isRunning) {
        this.current.stop().catch(() => {});
      }
      this._current = name;
      console.log(`[mcp] Provedor alterado para: ${name}`);
    }
    return this._current;
  }

  /**
   * Inicia o provedor atual
   */
  async start() {
    return this.current ? this.current.start() : false;
  }

  /**
   * Para o provedor atual
   */
  async stop() {
    return this.current ? this.current.stop() : false;
  }

  /**
   * Login via navegador (apenas Puter)
   */
  async login() {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.login();
    }
    throw new Error('Login via navegador só está disponível no provedor Puter MCP.');
  }

  /**
   * Logout / desliga provedor
   */
  async logout() {
    return this.current ? this.current.logout() : false;
  }

  /**
   * Dispatch central de ferramentas - usado por TODAS as rotas do server.js
   */
  async callTool(name, args = {}) {
    return this.current ? this.current.callTool(name, args) : {
      content: [{ type: 'text', text: 'Nenhum provedor MCP ativo' }],
      isError: true,
    };
  }

  /**
   * Obtém informações do provedor atual para a UI
   */
  getInfo() {
    return {
      provider: this._current,
      running: this.isRunning,
      available: this.providers,
    };
  }

  /**
   * Geração de imagem (usado pela rota /api/txt2img)
   * Para Puter: usa o método nativo com tentativas de fallback
   * Para ClaudeCode: roteia via callTool
   */
  async txt2img(prompt, model) {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.txt2img(prompt, model);
    }
    // ClaudeCode: via callTool
    const result = await this.callTool('puter_ai_txt2img', { prompt, model });
    const text = result?.content?.[0]?.text || '{}';
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Cloud storage (apenas Puter Provider)
   */
  async fsWrite(path, content) {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.fsWrite(path, content);
    }
    throw new Error('Cloud storage não disponível no Free Claude Code MCP');
  }

  async fsRead(path) {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.fsRead(path);
    }
    throw new Error('Cloud storage não disponível no Free Claude Code MCP');
  }

  async fsGetReadUrl(path) {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.fsGetReadUrl(path);
    }
    throw new Error('Cloud storage não disponível no Free Claude Code MCP');
  }

  async fsDelete(path) {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.fsDelete(path);
    }
    throw new Error('Cloud storage não disponível no Free Claude Code MCP');
  }

  /**
   * Lista modelos diretamente (usado pelo callTool do Puter)
   */
  async listModels() {
    if (this.current instanceof PuterMcpProvider) {
      return this.current.listModels();
    }
    // Para ClaudeCode, usa callTool
    const result = await this.callTool('puter_ai_list_models', { raw: true });
    const text = result?.content?.[0]?.text || '{}';
    try {
      const data = JSON.parse(text);
      return data.models || [];
    } catch {
      return [];
    }
  }
}

// ============================================================
// SINGLETON
// ============================================================

export const mcp = new McpBridge();
