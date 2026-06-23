/**
 * Easily AI - Servidor Web
 *
 * Interface estilo claude.ai para 500+ modelos de IA via Puter MCP.
 * - Login com SQLite (sql.js, sem dependências nativas)
 * - Chat com streaming SSE
 * - Gerenciamento automático do MCP
 */

import express from 'express';
import session from 'express-session';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import mime from 'mime-types';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';
import { mcp } from './mcpBridge.js';
import { rag } from './rag.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'easily-ai.db');
const UPLOADS_DIR = join(__dirname, 'uploads');
// Porta do WebUI (evita conflito com Free Claude Code MCP na porta 9090)
let PORT = process.env.WEBUI_PORT || process.env.PORT || 3000;
const FREE_MCP_PORT = 9090;
if (Number(PORT) === FREE_MCP_PORT) {
  console.warn(`[server] ⚠️ Porta ${PORT} reservada para Free Claude Code MCP. Usando 3000.`);
  PORT = 3000;
}

// Garante diretórios
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// ============================================================
// File content extraction (PDF, text, etc.)
// ============================================================

const TEXT_FILE_EXTS = new Set([
  '.txt', '.md', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.py', '.rb', '.php', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.htm', '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml',
  '.csv', '.sh', '.bash', '.bat', '.ps1', '.sql', '.env', '.ini', '.cfg', '.conf',
  '.log', '.toml', '.lua', '.pl', '.swift', '.kt', '.dart', '.r', '.m',
]);

const TEXT_FILE_MIMES = [
  'text/',
  'application/json', 'application/javascript', 'application/typescript',
  'application/xml', 'application/x-yaml', 'application/xhtml+xml',
  'application/sql', 'application/x-perl', 'application/x-php',
];

/**
 * Extrai conteúdo textual de um arquivo a partir do buffer e do nome/MIME.
 * Retorna até 50000 caracteres (cerca de 12k tokens).
 */
async function extractFileContent(buffer, mimeType, originalName) {
  const ext = extname(originalName || '').toLowerCase();

  // Arquivos de texto
  const isText =
    (mimeType && TEXT_FILE_MIMES.some(p => mimeType.startsWith(p))) ||
    TEXT_FILE_EXTS.has(ext);

  if (isText) {
    try {
      return buffer.toString('utf-8').slice(0, 50000);
    } catch {
      return null;
    }
  }

  // PDF
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    try {
      return (await extractPdfText(buffer)).slice(0, 50000);
    } catch (err) {
      console.error('[extract] Erro ao extrair PDF:', err.message);
      return null;
    }
  }

  return null; // formato não suportado
}

/**
 * Extrai texto de PDF usando pdfjs-dist (engine PDF.js oficial).
 * Suporta PDFs criptografados, comprimidos e formatos complexos.
 */
async function extractPdfText(buffer) {
  try {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = Math.min(doc.numPages, 50); // Limite de 50 páginas
    const results = [];

    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      if (text.trim()) {
        results.push(text.trim());
      }
    }

    const fullText = results.join('\n\n');
    console.log(`[extract] PDF extraído: ${pages} páginas, ${fullText.length} caracteres`);
    return fullText;
  } catch (err) {
    console.error('[extract] Erro pdfjs-dist:', err.message);
    // Fallback: tenta extração básica com inflate
    try {
      return extractPdfTextFallback(buffer);
    } catch {
      return '';
    }
  }
}

/**
 * Fallback de extração de texto de PDF (para quando pdfjs-dist falha).
 * Usa inflateSync para descomprimir streams e regex para extrair texto.
 */
function extractPdfTextFallback(buffer) {
  let text = buffer.toString('latin1');

  text = text.replace(/stream\n([\s\S]*?)endstream/g, (match, data) => {
    const trimmed = data.trim();
    if (!trimmed) return match;
    try {
      const raw = Buffer.from(trimmed, 'latin1');
      const decompressed = inflateSync(raw);
      return 'stream\n' + decompressed.toString('latin1') + '\nendstream';
    } catch {
      return match;
    }
  });

  const results = [];
  const btBlocks = text.match(/BT[\s\S]*?ET/g) || [];

  for (const block of btBlocks) {
    const parenMatches = block.match(/\(([^)]*)\)/g) || [];
    for (const pm of parenMatches) {
      let extracted = pm.slice(1, -1);
      extracted = extracted
        .replace(/\\([nrt])/g, (m, c) => c === 'n' ? '\n' : c === 'r' ? '\r' : '\t')
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\(\d{3})/g, (m, c) => String.fromCharCode(parseInt(c, 8)));
      if (extracted.trim().length > 3) {
        results.push(extracted);
      }
    }
  }

  return results.join('\n');
}

// Padrões de modelos com capacidade de visão (multimodais)
const VISION_PATTERNS = [
  /^gpt-4/, /^gpt-5/, /^claude/, /^gemini/, /^qwen.*vl/i,
  /^qwen-2\.5/, /^llava/, /^pixtral/, /^mistral.*vision/i,
  /^reka.*(edge|core|flash)/i, /^idefics/i, /^fuyu/i,
  /^cogvlm/i, /^internvl/i, /^minicpm/i,
];

function isVisionModel(modelId) {
  return VISION_PATTERNS.some(p => p.test(modelId));
}

/**
 * Lê imagens anexadas do disco e retorna como base64 para modelos multimodais
 * Só funciona para arquivos locais (url começa com /uploads/)
 */
function readAttachmentImages(attachmentIds) {
  if (!attachmentIds || attachmentIds.length === 0) return [];
  const images = [];
  for (const attId of attachmentIds) {
    try {
      const att = dbGet('SELECT filename, mime_type, url FROM attachments WHERE id = ?', [attId]);
      if (!att || !att.mime_type?.startsWith('image/')) continue;
      // Só lê arquivos locais (Puter já deletou o arquivo do disco)
      if (!att.url?.startsWith('/uploads/')) continue;
      const filePath = join(UPLOADS_DIR, att.filename);
      if (!existsSync(filePath)) continue;
      const buffer = readFileSync(filePath);
      images.push({
        media_type: att.mime_type,
        data: buffer.toString('base64'),
      });
    } catch (err) {
      console.warn('[upload] Erro ao ler imagem para contexto multimodal:', err.message);
    }
  }
  return images;
}


// ============================================================
// Multer (File Upload)
// ============================================================

const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512MB (padrão ChatGPT)

const ALLOWED_TYPES = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
  'image/gif': true,
  'image/svg+xml': true,
  'video/mp4': true,
  'video/webm': true,
  'video/ogg': true,
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'text/plain': true,
  'text/csv': true,
  'application/vnd.ms-excel': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/vnd.ms-powerpoint': true,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': true,
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}`));
    }
  },
});

// ============================================================
// SQLite Database (sql.js)
// ============================================================

let db;
let dbBuffer; // Buffer do banco para salvar

async function initDb() {
  const SQL = await initSqlJs();

  // Carrega banco existente ou cria novo
  if (existsSync(DB_PATH)) {
    dbBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(dbBuffer);
  } else {
    db = new SQL.Database();
  }

  // Cria tabelas
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT DEFAULT 'Nova conversa',
      model TEXT DEFAULT 'gpt-5.4-nano',
      system_prompt TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      model TEXT,
      has_attachments INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      puter_path TEXT,
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('like','dislike')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      UNIQUE(message_id, user_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shared_conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rag_index (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Índices
  try { db.run('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_feedback_message ON feedback(message_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_shared_session ON shared_conversations(session_id)'); } catch {}

  // Migrations for existing databases
  try {
    db.run('ALTER TABLE messages ADD COLUMN has_attachments INTEGER DEFAULT 0');
    console.log('[db] Migration: coluna has_attachments adicionada à tabela messages');
  } catch (e) {
    // Column already exists — ignore
    if (!e.message?.includes('duplicate column')) {
      console.warn('[db] Migration has_attachments ignorada:', e.message);
    }
  }

  try {
    db.run('ALTER TABLE attachments ADD COLUMN text_content TEXT DEFAULT NULL');
    console.log('[db] Migration: coluna text_content adicionada à tabela attachments');
  } catch (e) {
    if (!e.message?.includes('duplicate column')) {
      console.warn('[db] Migration text_content ignorada:', e.message);
    }
  }

  // Migration: message_id nullable (NOT NULL → INTEGER sem constraint)
  try {
    // Verifica se a constraint NOT NULL ainda existe (banco criado antes da correção)
    db.run('INSERT INTO attachments (id, message_id, filename, original_name, mime_type, size, url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['__mig_test__', null, 'test', 'test', 'text/plain', 0, '/dev/null']);
    // Se chegou aqui, já aceita NULL — remove o registro de teste
    db.run('DELETE FROM attachments WHERE id = ?', ['__mig_test__']);
  } catch (e) {
    if (e.message?.includes('NOT NULL') || e.message?.includes('constraint')) {
      // Precisa recriar a tabela sem NOT NULL em message_id
      console.log('[db] Migration: recriando tabela attachments com message_id nullable...');
      db.run("PRAGMA foreign_keys=OFF");
      db.run("BEGIN");
      db.run(`CREATE TABLE IF NOT EXISTS attachments_new (
        id TEXT PRIMARY KEY,
        message_id INTEGER,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        puter_path TEXT,
        url TEXT NOT NULL,
        thumbnail_url TEXT,
        text_content TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )`);
      db.run('INSERT INTO attachments_new SELECT * FROM attachments');
      db.run('DROP TABLE attachments');
      db.run('ALTER TABLE attachments_new RENAME TO attachments');
      db.run("COMMIT");
      db.run("PRAGMA foreign_keys=ON");
      console.log('[db] Migration: message_id agora permite NULL');
    } else {
      console.warn('[db] Migration message_id ignorada:', e.message);
    }
  }

  // Migration: contexto persistente de documentos por sessão
  try {
    db.run('ALTER TABLE chat_sessions ADD COLUMN context_docs TEXT DEFAULT NULL');
    console.log('[db] Migration: coluna context_docs adicionada à tabela chat_sessions');
  } catch (e) {
    if (!e.message?.includes('duplicate column')) {
      console.warn('[db] Migration context_docs ignorada:', e.message);
    }
  }

  saveDb();
  console.log('[db] Banco SQLite inicializado:', DB_PATH);
}

function saveDb() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('[db] Erro ao salvar:', err.message);
  }
}

// Helper: executa query e retorna array de objetos
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: executa query e retorna um objeto ou null
function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: executa insert/update
function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// Helper: executa INSERT e retorna o rowid (salva db antes de export, que reseta last_insert_rowid)
function dbInsert(sql, params = []) {
  db.run(sql, params);
  const rowid = db.exec('SELECT last_insert_rowid() as id');
  saveDb();
  return rowid[0]?.values[0]?.[0] ?? null;
}

// Helper: last insert rowid
function dbLastId() {
  const result = dbGet('SELECT last_insert_rowid() as id');
  return result?.id;
}

// Helper: verifica se sessão tem usuário (userId pode ser 0 em sql.js!)
function getSessionUserId(req) {
  return req.session?.userId !== undefined ? req.session.userId : null;
}

/**
 * Constrói o contexto de anexos para incluir na mensagem do modelo.
 * Inclui nome, metadados E conteúdo textual extraído do arquivo.
 */
function buildAttachmentContext(attachmentIds, messageId) {
  if (!attachmentIds || attachmentIds.length === 0) return { context: '', attachments: [] };

  const attachments = dbAll('SELECT id, filename, original_name, mime_type, size, url, thumbnail_url, text_content FROM attachments WHERE message_id = ?', [messageId]);
  if (!attachments || attachments.length === 0) return { context: '', attachments: [] };

  const parts = [];
  for (const a of attachments) {
    // Metadados do anexo
    let entry = `📎 [${a.original_name}](${a.url}) — ${(a.size / 1024).toFixed(1)}KB (${a.mime_type})`;

    // Conteúdo textual extraído
    if (a.text_content && a.text_content.trim().length > 0) {
      const content = a.text_content.length > 50000
        ? a.text_content.slice(0, 50000) + '\n... [conteúdo truncado]'
        : a.text_content;
      entry += `\n\n\`\`\`\n${content}\n\`\`\``;
    } else {
      entry += '\n\n*[Conteúdo não extraído — formato não suportado ou vazio]*';
    }

    parts.push(entry);
  }

  return {
    context: `\n\n---\n**Arquivos anexados:**\n\n${parts.join('\n\n---\n\n')}`,
    attachments,
  };
}

/**
 * Indexa um anexo no RAG (se tiver conteúdo textual extraído)
 */
function indexAttachmentInRAG(attachment) {
  if (!attachment || !attachment.text_content || attachment.text_content.trim().length < 20) return;

  const chunks = rag.chunkText(attachment.text_content, {
    docId: attachment.id,
    originalName: attachment.original_name,
    mimeType: attachment.mime_type,
    size: attachment.size,
  });

  rag.indexDocument(attachment.id, chunks, {
    originalName: attachment.original_name,
    mimeType: attachment.mime_type,
    size: attachment.size,
  });
}

/**
 * Salva o índice RAG no banco de dados (em memória + disco)
 */
function saveRAGIndex() {
  try {
    const json = JSON.stringify(rag.toJSON());
    db.run('INSERT OR REPLACE INTO rag_index (key, value) VALUES (?, ?)', ['index', json]);
    saveDb(); // Persiste no disco
  } catch (e) {
    console.warn('[rag] Erro ao salvar índice:', e.message);
  }
}

/**
 * Garante que um attachment esteja indexado no RAG.
 * Se já existe no índice, é ignorado. Caso contrário, extrai do banco e indexa.
 */
function ensureAttachmentInRAG(attachmentId) {
  // Verifica se já está no RAG
  const stats = rag.stats();
  if (stats.documents.some(d => d.id === attachmentId)) return;

  // Busca attachment no banco
  const att = dbGet(
    'SELECT id, original_name, mime_type, size, text_content FROM attachments WHERE id = ?',
    [attachmentId]
  );
  if (!att || !att.text_content || att.text_content.trim().length < 20) return;

  const chunks = rag.chunkText(att.text_content, {
    docId: att.id,
    originalName: att.original_name,
    mimeType: att.mime_type,
    size: att.size,
  });

  rag.indexDocument(att.id, chunks, {
    originalName: att.original_name,
    mimeType: att.mime_type,
    size: att.size,
  });

  console.log(`[rag] 🔄 Re-indexado: "${att.original_name}" (${chunks.length} chunks)`);
  saveRAGIndex();
}

/**
 * Adiciona documentos ao contexto persistente da sessão.
 * Assim, nas próximas mensagens o modelo sabe de quais PDFs se está falando.
 */
function updateSessionContextDocs(sessionId, attachmentIds) {
  if (!sessionId || !attachmentIds || attachmentIds.length === 0) return;

  // Busca contexto atual da sessão
  const session = dbGet('SELECT context_docs FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session) return;

  let docs = [];
  try { docs = session.context_docs ? JSON.parse(session.context_docs) : []; } catch {}

  // Adiciona novos attachments que ainda não estão na lista
  for (const attId of attachmentIds) {
    if (docs.some(d => d.id === attId)) continue;
    const att = dbGet('SELECT id, original_name, mime_type, size FROM attachments WHERE id = ?', [attId]);
    if (att) docs.push(att);
  }

  // Só salva se houve mudança
  if (docs.length > 0) {
    dbRun('UPDATE chat_sessions SET context_docs = ? WHERE id = ?', [JSON.stringify(docs), sessionId]);
  }
}

/**
 * Constrói o contexto de documentos persistente da sessão
 * para incluir em TODAS as mensagens da conversa.
 * Limite: ~40000 chars totais para não estourar o contexto do modelo.
 */
function buildSessionDocumentContext(sessionId) {
  if (!sessionId) return '';

  const session = dbGet('SELECT context_docs FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!session || !session.context_docs) return '';

  let docs = [];
  try { docs = JSON.parse(session.context_docs); } catch { return ''; }
  if (docs.length === 0) return '';

  const parts = [];
  let totalChars = 0;
  const MAX_CTX_CHARS = 40000;

  for (const doc of docs) {
    const full = dbGet('SELECT text_content FROM attachments WHERE id = ?', [doc.id]);
    if (!full || !full.text_content || full.text_content.trim().length < 20) continue;

    const content = full.text_content.length > 30000
      ? full.text_content.slice(0, 30000) + '\n... [conteúdo truncado]'
      : full.text_content;

    const entry = `📄 **${doc.original_name}** (${(doc.size / 1024).toFixed(1)}KB)\n\`\`\`\n${content}\n\`\`\``;
    totalChars += entry.length;

    if (totalChars > MAX_CTX_CHARS) break;
    parts.push(entry);
  }

  if (parts.length === 0) return '';

  return `\n\n---\n**Documentos de contexto desta conversa:**\n\n${parts.join('\n\n---\n\n')}\n\n---`;
}

/**
 * Constrói o histórico da conversa para incluir no prompt.
 * Permite que o modelo mantenha continuidade entre mensagens.
 */
function buildConversationHistory(sessionId, maxMessages = 20) {
  if (!sessionId) return '';

  const messages = dbAll(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?',
    [sessionId, maxMessages]
  );
  if (!messages || messages.length === 0) return '';

  // Inverte para ordem cronológica
  messages.reverse();

  const lines = [];
  let totalChars = 0;
  const MAX_HIST_CHARS = 15000;
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'Usuário' : 'Assistente';
    const text = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content;
    const line = `**${prefix}:** ${text}`;
    totalChars += line.length;
    if (totalChars > MAX_HIST_CHARS) break;
    lines.push(line);
  }

  return `\n\n---\n**Histórico da conversa:**\n\n${lines.join('\n\n')}`;
}

/**
 * Carrega o índice RAG do banco de dados
 */
function loadRAGIndex() {
  try {
    const row = dbGet('SELECT value FROM rag_index WHERE key = ?', ['index']);
    if (row && row.value) {
      const data = JSON.parse(row.value);
      rag.fromJSON(data);
      const stats = rag.stats();
      if (stats.totalDocs > 0) {
        console.log(`[rag] 📚 Índice carregado: ${stats.totalDocs} documentos, ${stats.totalChunks} chunks`);
      }
    }
  } catch (e) {
    console.warn('[rag] Erro ao carregar índice:', e.message);
  }
}

/**
 * Constrói uma mensagem aumentada com RAG
 * @returns {{message: string, ragUsed: boolean, ragDocs: string[]}}
 */
function buildRAGEnhancedMessage(message) {
  const ragContext = rag.buildContext(message);
  if (!ragContext) return { message, ragUsed: false, ragDocs: [] };

  // Extrai nomes dos documentos referenciados
  const docMatches = [...ragContext.matchAll(/📄 \*\*(.+?)\*\*/g)];
  const ragDocs = [...new Set(docMatches.map(m => m[1].trim()))];

  if (ragDocs.length > 0) {
    console.log(`[rag] 🔍 Contexto RAG adicionado: ${ragDocs.join(', ')} (${ragContext.length} chars)`);
  }

  return { message: message + ragContext, ragUsed: true, ragDocs };
}

// Inicializa banco antes de iniciar o servidor
await initDb();

// Carrega índice RAG do banco
loadRAGIndex();

// ============================================================
// Express Setup
// ============================================================

const app = express();

app.use(express.json());
app.use(express.static(join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  },
}));

// Serve arquivos de upload (fallback para Puter)
app.use('/uploads', (req, res, next) => {
  const filePath = join(UPLOADS_DIR, req.path);
  if (existsSync(filePath)) {
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } else {
    next();
  }
});

// Sessões
app.use(session({
  secret: process.env.SESSION_SECRET || 'easily-ai-secret-' + randomUUID(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    sameSite: 'lax',
  },
}));

// Middleware de autenticação
function requireAuth(req, res, next) {
  if (getSessionUserId(req) === null) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  next();
}

// ============================================================
// API Auth Routes
// ============================================================

// POST /api/register - Criar conta
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, displayName, provider } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Usuário deve ter pelo menos 3 caracteres' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres' });
    }

    const existing = dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(409).json({ error: 'Usuário já existe' });
    }

    const hash = await bcrypt.hash(password, 10);
    dbRun('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      [username, hash, displayName || username]);

    // Busca o usuário recem-criado (sql.js last_insert_rowid pode retornar 0)
    const newUser = dbGet('SELECT id, username, display_name FROM users WHERE username = ?', [username]);
    const userId = newUser?.id;

    // Auto-login
    req.session.userId = userId;
    req.session.username = username;

    // Define o provedor MCP escolhido
    const selectedProvider = mcp.providers.includes(provider) ? provider : 'puter';
    if (selectedProvider !== mcp.provider) {
      mcp.setProvider(selectedProvider);
    }
    req.session.mcpProvider = selectedProvider;

    res.json({
      success: true,
      user: { id: userId, username, displayName: displayName || username },
      provider: selectedProvider,
    });
  } catch (err) {
    console.error('[auth] Erro register:', err.message);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// POST /api/login - Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, provider } = req.body;
    const user = dbGet('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    // Define o provedor MCP escolhido (padrão: puter)
    const selectedProvider = mcp.providers.includes(provider) ? provider : 'puter';
    if (selectedProvider !== mcp.provider) {
      mcp.setProvider(selectedProvider);
    }
    req.session.mcpProvider = selectedProvider;

    // Inicia MCP em background (não bloqueia o login)
    let mcpStatus = 'starting';
    try {
      if (!mcp.isRunning) {
        mcp.start().catch(err =>
          console.log(`[mcp] Start em background (${selectedProvider}):`, err.message)
        );
        mcpStatus = 'starting';
      } else {
        mcpStatus = 'running';
      }
    } catch (err) {
      mcpStatus = 'error';
    }

    res.json({
      success: true,
      user: { id: user.id, username: user.username, displayName: user.display_name },
      mcpStatus,
      provider: selectedProvider,
    });
  } catch (err) {
    console.error('[auth] Erro login:', err.message);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /api/session - Verifica sessão
app.get('/api/session', (req, res) => {
  if (getSessionUserId(req) === null) {
    return res.json({ authenticated: false });
  }

  const user = dbGet(
    'SELECT id, username, display_name, created_at FROM users WHERE id = ?',
    [getSessionUserId(req)]
  );

  res.json({
    authenticated: true,
    user: user ? {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      createdAt: user.created_at,
    } : null,
    provider: req.session?.mcpProvider || mcp.provider,
    providers: mcp.providers,
  });
});

// ============================================================
// API MCP Routes
// ============================================================

// GET /api/mcp/status
app.get('/api/mcp/status', async (req, res) => {
  res.json({
    running: mcp.isRunning,
    pid: 'in-process',
  });
});

// GET /api/mcp/provider - Obtém provedor atual e disponíveis
app.get('/api/mcp/provider', (req, res) => {
  res.json(mcp.getInfo());
});

// POST /api/mcp/provider - Altera provedor MCP
app.post('/api/mcp/provider', async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: 'Campo "provider" obrigatório' });
    }

    const selectedProvider = mcp.providers.includes(provider) ? provider : null;
    if (!selectedProvider) {
      return res.status(400).json({
        error: `Provedor "${provider}" não encontrado. Disponíveis: ${mcp.providers.join(', ')}`,
      });
    }

    if (selectedProvider !== mcp.provider) {
      mcp.setProvider(selectedProvider);
    }

    if (req.session) {
      req.session.mcpProvider = selectedProvider;
    }

    res.json({ success: true, provider: selectedProvider, running: mcp.isRunning });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mcp/start - Inicia MCP (usa provedor da sessão se disponível)
app.post('/api/mcp/start', async (req, res) => {
  try {
    // Se a sessão tem um provedor armazenado, usa ele
    const sessionProvider = req.session?.mcpProvider;
    if (sessionProvider && sessionProvider !== mcp.provider) {
      mcp.setProvider(sessionProvider);
    }
    await mcp.start();
    res.json({ success: true, running: mcp.isRunning, provider: mcp.provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mcp/logout - Desloga do Puter
app.post('/api/mcp/logout', async (req, res) => {
  try {
    await mcp.logout();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mcp/relogin - Reloga no Puter
app.post('/api/mcp/relogin', async (req, res) => {
  try {
    await mcp.logout();
    // login() abre navegador para autenticação
    await mcp.login();
    res.json({ success: true, running: mcp.isRunning });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API Upload Routes
// ============================================================

// POST /api/upload - Upload de arquivo
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const file = req.file;
    const attachmentId = randomUUID();
    const userId = getSessionUserId(req);

    // Upload para Puter Cloud Storage (apenas no provedor Puter)
    let puterPath = null;
    let fileUrl = null;

    // Extrai conteúdo textual ANTES do upload (arquivo pode ser deletado depois)
    let textContent = null;
    try {
      const fileBuffer = readFileSync(file.path);
      textContent = await extractFileContent(fileBuffer, file.mimetype, file.originalname);
    } catch (readErr) {
      console.warn('[upload] Não foi possível extrair conteúdo:', readErr.message);
    }

    if (mcp.provider === 'puter') {
      try {
        puterPath = `/users/${userId}/uploads/${file.filename}`;
        const fileBuffer = readFileSync(file.path);
        await mcp.fsWrite(puterPath, fileBuffer);

        // Obtém URL pública do Puter
        const readUrl = await mcp.fsGetReadUrl(puterPath);
        fileUrl = readUrl.url || readUrl;

        // Remove arquivo temporário
        unlinkSync(file.path);
      } catch (puterErr) {
        console.error('[upload] Erro Puter, usando fallback local:', puterErr.message);
        // Fallback: mantém arquivo local
        fileUrl = `/uploads/${file.filename}`;
      }
    } else {
      // Free Claude Code MCP — usa armazenamento local diretamente
      fileUrl = `/uploads/${file.filename}`;
      console.log('[upload] 📁 Modo local (Free Claude Code MCP):', file.filename);
    }

    // Gera thumbnail para imagens
    let thumbnailUrl = null;
    if (file.mimetype.startsWith('image/')) {
      thumbnailUrl = fileUrl; // Para imagens, usa a mesma URL como thumbnail
    }

    // Salva metadata no banco
    dbRun(
      `INSERT INTO attachments (id, message_id, filename, original_name, mime_type, size, puter_path, url, thumbnail_url, text_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [attachmentId, null, file.filename, file.originalname, file.mimetype, file.size, puterPath, fileUrl, thumbnailUrl, textContent]
    );

    // Indexa no RAG se tiver conteúdo textual
    indexAttachmentInRAG({
      id: attachmentId,
      text_content: textContent,
      original_name: file.originalname,
      mime_type: file.mimetype,
      size: file.size,
    });
    saveRAGIndex();

    res.json({
      id: attachmentId,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: fileUrl,
      thumbnailUrl,
    });
  } catch (err) {
    console.error('[upload] Erro:', err.message);
    // Limpa arquivo temporário se existe
    if (req.file?.path && existsSync(req.file.path)) {
      try { unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload/multiple - Upload de múltiplos arquivos
app.post('/api/upload/multiple', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const userId = getSessionUserId(req);
    const results = [];

    for (const file of req.files) {
      const attachmentId = randomUUID();
      let puterPath = null;
      let fileUrl = null;

      // Extrai conteúdo textual ANTES do upload
      let textContent = null;
      try {
        const fileBuffer = readFileSync(file.path);
        textContent = await extractFileContent(fileBuffer, file.mimetype, file.originalname);
      } catch (readErr) {
        console.warn('[upload] Não foi possível extrair conteúdo:', readErr.message);
      }

      if (mcp.provider === 'puter') {
        try {
          puterPath = `/users/${userId}/uploads/${file.filename}`;
          const fileBuffer = readFileSync(file.path);
          await mcp.fsWrite(puterPath, fileBuffer);

          const readUrl = await mcp.fsGetReadUrl(puterPath);
          fileUrl = readUrl.url || readUrl;

          unlinkSync(file.path);
        } catch (puterErr) {
          console.error('[upload] Erro Puter, usando fallback local:', puterErr.message);
          fileUrl = `/uploads/${file.filename}`;
        }
      } else {
        // Free Claude Code MCP — usa armazenamento local diretamente
        fileUrl = `/uploads/${file.filename}`;
      }

      let thumbnailUrl = null;
      if (file.mimetype.startsWith('image/')) {
        thumbnailUrl = fileUrl;
      }

      dbRun(
        `INSERT INTO attachments (id, message_id, filename, original_name, mime_type, size, puter_path, url, thumbnail_url, text_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [attachmentId, null, file.filename, file.originalname, file.mimetype, file.size, puterPath, fileUrl, thumbnailUrl, textContent]
      );

      // Indexa cada arquivo no RAG se tiver conteúdo textual
      indexAttachmentInRAG({
        id: attachmentId,
        text_content: textContent,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size: file.size,
      });
      saveRAGIndex();

      results.push({
        id: attachmentId,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: fileUrl,
        thumbnailUrl,
      });
    }

    res.json({ files: results });
  } catch (err) {
    console.error('[upload] Erro:', err.message);
    // Limpa arquivos temporários
    if (req.files) {
      for (const file of req.files) {
        if (file.path && existsSync(file.path)) {
          try { unlinkSync(file.path); } catch {}
        }
      }
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/attachments/:id - Deleta anexo
app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  try {
    const attachment = dbGet('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!attachment) {
      return res.status(404).json({ error: 'Anexo não encontrado' });
    }

    // Deleta do Puter se existe
    if (attachment.puter_path) {
      mcp.fsDelete(attachment.puter_path).catch(err => {
        console.error('[upload] Erro ao deletar do Puter:', err.message);
      });
    }

    // Deleta arquivo local se existe
    const localPath = join(UPLOADS_DIR, attachment.filename);
    if (existsSync(localPath)) {
      unlinkSync(localPath);
    }

    // Deleta do banco
    dbRun('DELETE FROM attachments WHERE id = ?', [req.params.id]);

    // Remove do índice RAG
    rag.removeDocument(req.params.id);
    saveRAGIndex();

    res.json({ success: true });
  } catch (err) {
    console.error('[delete] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/txt2img - Gera imagem a partir de texto
app.post('/api/txt2img', requireAuth, async (req, res) => {
  try {
    const { prompt, model = 'dall-e-3', sessionId } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt obrigatório' });
    }

    console.log('[txt2img] ========== INÍCIO ==========');
    console.log('[txt2img] Prompt:', prompt.slice(0, 150));
    console.log('[txt2img] Model:', model);
    console.log('[txt2img] MCP rodando:', mcp.isRunning);

    const result = await mcp.txt2img(prompt, model);

    console.log('[txt2img] Resultado:', result);

    if (!result || !result.url) {
      console.error('[txt2img] Falha: resultado vazio');
      return res.status(500).json({ error: 'Falha ao gerar imagem - resultado vazio' });
    }

    // Se é data URL, salva como arquivo
    let imageUrl = result.url;
    let puterPath = null;

    // Garante que imageUrl é string (Puter SDK pode retornar URL object)
    if (typeof imageUrl !== 'string') {
      imageUrl = typeof imageUrl.href === 'string' ? imageUrl.href : String(imageUrl);
    }

    if (imageUrl.startsWith('data:')) {
      const attachmentId = randomUUID();
      const userId = getSessionUserId(req);
      const filename = `${Date.now()}-${attachmentId.slice(0, 8)}.png`;

      // Decodifica base64
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      console.log('[txt2img] Imagem decodificada, tamanho:', buffer.length, 'bytes');

      // Salva localmente
      const localPath = join(UPLOADS_DIR, filename);
      writeFileSync(localPath, buffer);

      // Tenta enviar para Puter
      try {
        puterPath = `/users/${userId}/uploads/${filename}`;
        await mcp.fsWrite(puterPath, buffer);
        let readUrl = await mcp.fsGetReadUrl(puterPath);
        imageUrl = typeof readUrl === 'string' ? readUrl : (readUrl.url || readUrl.href || String(readUrl));
        // Remove arquivo local
        unlinkSync(localPath);
        console.log('[txt2img] Salvo no Puter:', puterPath);
      } catch (puterErr) {
        console.error('[txt2img] Erro Puter, usando fallback local:', puterErr.message);
        imageUrl = `/uploads/${filename}`;
      }

      console.log('[txt2img] ========== FIM ==========');
      res.json({
        id: attachmentId,
        url: imageUrl,
        mimeType: result.mimeType || 'image/png',
        size: result.size || buffer.length,
        prompt,
      });
    } else {
      // Já é uma URL direta
      console.log('[txt2img] URL direta:', imageUrl.slice(0, 100));
      const attachmentId = randomUUID();
      res.json({
        id: attachmentId,
        url: imageUrl,
        mimeType: result.mimeType || 'image/png',
        size: result.size || 0,
        thumbnailUrl: imageUrl,
        prompt,
      });
    }
  } catch (err) {
    console.error('[txt2img] ========== ERRO ==========');
    console.error('[txt2img] Erro:', err.message);
    console.error('[txt2img] Stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/txt2img/pollinations - Geração de imagem gratuita via Pollinations.ai
// Separa completamente a geração de imagem do fluxo de chat.
// ============================================================
app.post('/api/txt2img/pollinations', requireAuth, async (req, res) => {
  try {
    const { prompt, model = 'flux', width = 1024, height = 1024 } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt obrigatório' });
    }

    // Mapeia modelos para slugs do Pollinations
    const modelMap = {
      'flux': 'flux',
      'flux-schnell': 'flux',
      'sd3': 'sd3',
      'sdxl': 'sd3',
      'stable-diffusion': 'sd3',
      'turbo': 'turbo',
      'anime': 'anime',
      'dall-e-3': 'flux',
    };

    const pollinationsModel = modelMap[model?.toLowerCase()] || 'flux';
    const encoded = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&model=${pollinationsModel}&nologo=true&seed=${Date.now()}`;

    console.log('[pollinations] 🖼️ Gerando imagem:', imageUrl);

    // Verifica se o serviço responde com uma imagem
    const imageMod = imageUrl.startsWith('https') ? https : http;
    const u = new URL(imageUrl);

    const imgBuffer = await new Promise((resolve, reject) => {
      const req = imageMod.get(imageUrl, { timeout: 30000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    });

    console.log('[pollinations] ✅ Imagem recebida:', imgBuffer.length, 'bytes');

    // Salva localmente
    const filename = `pollinations-${Date.now()}.png`;
    const localPath = join(UPLOADS_DIR, filename);
    writeFileSync(localPath, imgBuffer);

    res.json({
      url: `/uploads/${filename}`,
      prompt,
      model: pollinationsModel,
      size: imgBuffer.length,
    });
  } catch (err) {
    console.error('[pollinations] ❌ Erro:', err.message);
    res.status(500).json({ error: `Falha ao gerar imagem: ${err.message}` });
  }
});

// ============================================================
// POST /api/leitura/upload - Upload de documento para leitura
// Extrai texto completo e retorna para o frontend.
// ============================================================
app.post('/api/leitura/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const fileBuffer = readFileSync(req.file.path);
    let textContent = '';
    try {
      textContent = await extractFileContent(fileBuffer, req.file.mimetype, req.file.originalname);
    } catch (readErr) {
      console.warn('[leitura] Erro ao extrair texto:', readErr.message);
      // Fallback: tenta extração simples
      textContent = fileBuffer.toString('utf-8');
    }

    // Limpa arquivo temporário
    try { unlinkSync(req.file.path); } catch {}

    if (!textContent || textContent.trim().length < 20) {
      return res.status(400).json({ error: 'Não foi possível extrair texto do documento' });
    }

    console.log(`[leitura] 📄 Documento carregado: ${req.file.originalname} (${textContent.length} chars)`);

    res.json({
      text: textContent,
      originalName: req.file.originalname,
      size: textContent.length,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    console.error('[leitura] Erro no upload:', err.message);
    if (req.file?.path) try { unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leitura/pergunta - Faz pergunta sobre o documento via SSE
// Usa o fcc-server (mesmo modelo do chat) com contexto do documento.
app.post('/api/leitura/pergunta', requireAuth, async (req, res) => {
  try {
    const { texto, pergunta, model } = req.body;
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'Texto do documento obrigatório' });
    if (!pergunta || !pergunta.trim()) return res.status(400).json({ error: 'Pergunta obrigatória' });

    const chatModel = model || 'qwen-2.5-72b-instruct';

    // Concatena documento + pergunta em um único prompt
    const SYSTEM_PROMPT = 'Você é um assistente especializado em leitura e análise de documentos. Responda às perguntas com base APENAS no conteúdo do documento fornecido. Seja detalhado e didático.';
    const message = `DOCUMENTO:\n\n${texto}\n\n---\n\nPERGUNTA: ${pergunta}\n\nResponda com base no documento acima.`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Envia o prompt para o fcc-server via mcpBridge
    const result = await mcp.callTool('puter_ai_chat', {
      message,
      model: chatModel,
      system: SYSTEM_PROMPT,
      max_tokens: 4096,
    });

    const responseText = result?.content?.[0]?.text || '';

    // Simula streaming para o frontend
    const chunkSize = 60;
    for (let i = 0; i < responseText.length; i += chunkSize) {
      const chunk = responseText.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
      await new Promise(r => setTimeout(r, 12));
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[leitura] Erro na pergunta:', err.message);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
      res.end();
    } catch {}
  }
});

// ============================================================
// API Chat Routes
// ============================================================

// GET /api/models
app.get('/api/models', requireAuth, async (req, res) => {
  try {
    const result = await mcp.callTool('puter_ai_list_models', { raw: true });
    const text = result?.content?.[0]?.text || '{}';

    let data = { models: [], total: 0 };
    try {
      data = JSON.parse(text);
    } catch {}

    // Extrai só id e name para o seletor
    const simplified = (data.models || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      provider: m.provider || '',
      tool_call: !!m.tool_call,
      context: m.context || 0,
      vision: isVisionModel(m.id) || undefined,
    }));

    // Adiciona modelos especiais por tipo (imagem, áudio, vídeo)
    const typedModels = [
      // 🖼️ Geração de imagem
      { id: 'dall-e-3', name: 'DALL·E 3', provider: '🖼️ Imagem', type: 'image' },
      { id: 'dall-e-2', name: 'DALL·E 2', provider: '🖼️ Imagem', type: 'image' },
      // 🎵 Áudio / TTS
      { id: 'tts-1', name: 'OpenAI TTS', provider: '🎵 Áudio', type: 'audio' },
      { id: 'tts-1-hd', name: 'OpenAI TTS HD', provider: '🎵 Áudio', type: 'audio' },
      // 🎬 Vídeo
      { id: 'runway-gen3', name: 'Runway Gen-3', provider: '🎬 Vídeo', type: 'video' },
      { id: 'pika', name: 'Pika', provider: '🎬 Vídeo', type: 'video' },
    ];

    res.json({ models: [...simplified, ...typedModels], total: data.total || simplified.length });
  } catch (err) {
    console.error('[models] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message, model = 'gpt-5.4-nano', system, sessionId, attachmentIds = [], compatMode = false } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Mensagem obrigatória' });
    }

    const sid = sessionId || randomUUID();
    const existing = dbGet('SELECT id FROM chat_sessions WHERE id = ?', [sid]);

    if (!existing) {
      dbRun(
        'INSERT INTO chat_sessions (id, user_id, title, model, system_prompt) VALUES (?, ?, ?, ?, ?)',
        [sid, req.session.userId, message.slice(0, 50), model, system || '']
      );
    } else {
      dbRun("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?", [sid]);
    }

    // Insere mensagem e já captura ID antes do saveDb resetar last_insert_rowid
    const messageId = dbInsert(
      'INSERT INTO messages (session_id, role, content, model, has_attachments) VALUES (?, ?, ?, ?, ?)',
      [sid, 'user', message, model, attachmentIds.length > 0 ? 1 : 0]
    );

    // Vincula anexos à mensagem e atualiza contexto persistente da sessão
    if (attachmentIds.length > 0 && messageId) {
      for (const attId of attachmentIds) {
        dbRun('UPDATE attachments SET message_id = ? WHERE id = ?', [messageId, attId]);
        ensureAttachmentInRAG(attId);
      }
      // Guarda os docs no contexto da sessão para mensagens futuras
      updateSessionContextDocs(sid, attachmentIds);
    }

    // Constrói mensagem completa: pergunta + contexto dos anexos atuais + docs da sessão + histórico
    let fullMessage = message;

    // Contexto dos anexos enviados nesta mensagem
    if (attachmentIds.length > 0 && messageId) {
      const { context } = buildAttachmentContext(attachmentIds, messageId);
      fullMessage += context;
    }

    // Contexto persistente da sessão (docs de perguntas anteriores)
    const sessionDocCtx = buildSessionDocumentContext(sid);
    if (sessionDocCtx) fullMessage += sessionDocCtx;

    // Histórico da conversa para continuidade
    const historyCtx = buildConversationHistory(sid);
    if (historyCtx) fullMessage += historyCtx;

    // Aumenta com RAG (busca documentos indexados relevantes)
    const ragResult = buildRAGEnhancedMessage(fullMessage);
    fullMessage = ragResult.message;

    const chatArgs = { message: fullMessage, model, compatMode };
    if (system) chatArgs.system = system;
    // Adiciona imagens apenas para modelos com capacidade de visão
    if (isVisionModel(model)) {
      const chatImages = readAttachmentImages(attachmentIds);
      if (chatImages.length > 0) chatArgs.images = chatImages;
    }

    const result = await mcp.callTool('puter_ai_chat', chatArgs);
    const responseText = result?.content?.[0]?.text || 'Sem resposta';

    dbRun('INSERT INTO messages (session_id, role, content, model) VALUES (?, ?, ?, ?)',
      [sid, 'assistant', responseText, model]);

    // Busca anexos para retornar
    const userAttachments = messageId
      ? dbAll('SELECT id, url, original_name, mime_type, size, thumbnail_url FROM attachments WHERE message_id = ?', [messageId])
      : [];

    res.json({
      sessionId: sid,
      response: responseText,
      messageId,
      attachments: userAttachments,
      rag: ragResult.ragUsed ? { docs: ragResult.ragDocs } : undefined,
    });
  } catch (err) {
    console.error('[chat] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/stream - SSE streaming
app.get('/api/chat/stream', requireAuth, async (req, res) => {
  const { message, model = 'gpt-5.4-nano', system, sessionId, compatMode = 'false' } = req.query;

  // Accept attachment IDs (may be one string or an array from multiple ?attachmentIds= params)
  let attachmentIds = [];
  if (req.query.attachmentIds) {
    attachmentIds = Array.isArray(req.query.attachmentIds)
      ? req.query.attachmentIds
      : [req.query.attachmentIds];
  }

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensagem obrigatória' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sid = sessionId || randomUUID();
  const existing = dbGet('SELECT id FROM chat_sessions WHERE id = ?', [sid]);

  if (!existing) {
    dbRun(
      'INSERT INTO chat_sessions (id, user_id, title, model, system_prompt) VALUES (?, ?, ?, ?, ?)',
      [sid, req.session.userId, message.slice(0, 50), model, system || '']
    );
  }

  // Save user message, capture ID before saveDb resets last_insert_rowid
  const messageId = dbInsert(
    'INSERT INTO messages (session_id, role, content, model, has_attachments) VALUES (?, ?, ?, ?, ?)',
    [sid, 'user', message, model, attachmentIds.length > 0 ? 1 : 0]
  );

  if (attachmentIds.length > 0 && messageId) {
    for (const attId of attachmentIds) {
      dbRun('UPDATE attachments SET message_id = ? WHERE id = ?', [messageId, attId]);
      ensureAttachmentInRAG(attId);
    }
    // Guarda os docs no contexto da sessão para mensagens futuras
    updateSessionContextDocs(sid, attachmentIds);
  }

  let fullMessage = message;
  if (attachmentIds.length > 0 && messageId) {
    try {
      const { context } = buildAttachmentContext(attachmentIds, messageId);
      fullMessage = message + context;
    } catch (ctxErr) {
      console.warn('[chat-stream] Erro ao construir contexto de anexos:', ctxErr.message);
      fullMessage = message + '\n\n[Erro ao carregar anexos]';
    }
  }

  // Contexto persistente da sessão (docs de perguntas anteriores)
  const sessionDocCtx = buildSessionDocumentContext(sid);
  if (sessionDocCtx) fullMessage += sessionDocCtx;

  // Histórico da conversa para continuidade
  const historyCtx = buildConversationHistory(sid);
  if (historyCtx) fullMessage += historyCtx;

  // Aumenta com RAG (busca documentos indexados relevantes)
  const ragResult = buildRAGEnhancedMessage(fullMessage);
  fullMessage = ragResult.message;

  if (ragResult.ragUsed) {
    res.write(`data: ${JSON.stringify({ type: 'rag', docs: ragResult.ragDocs })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ type: 'session', sessionId: sid })}\n\n`);

  try {
    const chatArgs = { message: fullMessage, model, compatMode: compatMode === 'true' };
    if (system) chatArgs.system = system;
    // Adiciona imagens apenas para modelos com capacidade de visão
    if (isVisionModel(model)) {
      const chatImages = readAttachmentImages(attachmentIds);
      if (chatImages.length > 0) chatArgs.images = chatImages;
    }

    const result = await mcp.callTool('puter_ai_chat', chatArgs);
    const responseText = result?.content?.[0]?.text || '';

    dbRun('INSERT INTO messages (session_id, role, content, model) VALUES (?, ?, ?, ?)',
      [sid, 'assistant', responseText, model]);

    // Simula streaming com chunks
    const chunkSize = 60;
    for (let i = 0; i < responseText.length; i += chunkSize) {
      const chunk = responseText.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
      await new Promise(r => setTimeout(r, 12));
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
    res.end();
  }
});

// ============================================================
// API History Routes
// ============================================================

// GET /api/sessions
app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = dbAll(
    'SELECT id, title, model, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC',
    [getSessionUserId(req)]
  );
  res.json({ sessions });
});

// GET /api/sessions/:id
app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = dbGet(
    'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]
  );
  if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });

  const messages = dbAll(
    'SELECT id, role, content, model, has_attachments, created_at FROM messages WHERE session_id = ? ORDER BY id',
    [req.params.id]
  );

  // Adiciona anexos a cada mensagem
  const messagesWithAttachments = messages.map(msg => {
    const attachments = msg.has_attachments
      ? dbAll('SELECT id, url, original_name, mime_type, size, thumbnail_url FROM attachments WHERE message_id = ?', [msg.id])
      : [];
    return { ...msg, attachments };
  });

  res.json({ session, messages: messagesWithAttachments });
});

// DELETE /api/sessions/:id
app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM messages WHERE session_id = ?', [req.params.id]);
  dbRun('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]);
  res.json({ success: true });
});

// ============================================================
// API Feedback Routes
// ============================================================

// POST /api/feedback - Salva feedback (like/dislike)
app.post('/api/feedback', requireAuth, (req, res) => {
  try {
    const { messageId, type } = req.body;
    const userId = getSessionUserId(req);

    if (!messageId || !type) {
      return res.status(400).json({ error: 'messageId e type obrigatórios' });
    }

    if (!['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'Type deve ser like ou dislike' });
    }

    // Upsert: remove existente e insere nova
    dbRun('DELETE FROM feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
    dbRun('INSERT INTO feedback (message_id, user_id, type) VALUES (?, ?, ?)',
      [messageId, userId, type]);

    res.json({ success: true, type });
  } catch (err) {
    console.error('[feedback] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/feedback/:messageId - Remove feedback
app.delete('/api/feedback/:messageId', requireAuth, (req, res) => {
  try {
    const userId = getSessionUserId(req);
    dbRun('DELETE FROM feedback WHERE message_id = ? AND user_id = ?',
      [req.params.messageId, userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[feedback] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback/:messageId - Busca feedback
app.get('/api/feedback/:messageId', requireAuth, (req, res) => {
  try {
    const userId = getSessionUserId(req);
    const feedback = dbGet(
      'SELECT type FROM feedback WHERE message_id = ? AND user_id = ?',
      [req.params.messageId, userId]
    );
    res.json({ type: feedback?.type || null });
  } catch (err) {
    console.error('[feedback] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API Share Routes
// ============================================================

// POST /api/share/:sessionId - Gera link público
app.post('/api/share/:sessionId', requireAuth, (req, res) => {
  try {
    const session = dbGet(
      'SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?',
      [req.params.sessionId, req.session.userId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    // Verifica se já existe share
    const existing = dbGet(
      'SELECT id FROM shared_conversations WHERE session_id = ?',
      [req.params.sessionId]
    );

    if (existing) {
      return res.json({ shareId: existing.id, url: `/shared/${existing.id}` });
    }

    const shareId = randomUUID();
    dbRun('INSERT INTO shared_conversations (id, session_id, user_id) VALUES (?, ?, ?)',
      [shareId, req.params.sessionId, getSessionUserId(req)]);

    res.json({ shareId, url: `/shared/${shareId}` });
  } catch (err) {
    console.error('[share] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /shared/:id - Página pública (somente leitura)
app.get('/shared/:id', (req, res) => {
  const shared = dbGet(
    'SELECT sc.*, cs.title, cs.model FROM shared_conversations sc JOIN chat_sessions cs ON sc.session_id = cs.id WHERE sc.id = ?',
    [req.params.id]
  );

  if (!shared) {
    return res.status(404).send('Conversa não encontrada ou link expirado');
  }

  const messages = dbAll(
    'SELECT role, content, model, created_at FROM messages WHERE session_id = ? ORDER BY id',
    [shared.session_id]
  );

  // Retorna página HTML simples
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${shared.title} - Easily AI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e8e8f0; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #7c5cfc; font-size: 20px; }
    .meta { color: #a0a0b8; font-size: 13px; margin-bottom: 24px; }
    .message { margin-bottom: 16px; padding: 12px; border-radius: 8px; }
    .message.user { background: #2e2e5e; }
    .message.assistant { background: #1e1e3e; }
    .role { font-size: 12px; color: #7c5cfc; margin-bottom: 4px; }
    .content { font-size: 14px; line-height: 1.6; }
    pre { background: #0f0f1e; padding: 12px; border-radius: 6px; overflow-x: auto; }
    code { font-family: 'SF Mono', monospace; font-size: 13px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #2e2e4e; color: #6b6b80; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <h1>${shared.title}</h1>
  <div class="meta">Modelo: ${shared.model} | Compartilhado em: ${new Date(shared.created_at).toLocaleDateString('pt-BR')}</div>
  ${messages.map(m => `
    <div class="message ${m.role}">
      <div class="role">${m.role === 'user' ? 'Você' : 'Assistente'}</div>
      <div class="content">${m.content.replace(/\n/g, '<br>')}</div>
    </div>
  `).join('')}
  <div class="footer">Compartilhado via Easily AI</div>
</body>
</html>`);
});

// ============================================================
// Fallback SPA
// ============================================================

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Rota não encontrada' });
  }
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ============================================================
// Start
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═════════════════════════════════════╗');
  console.log('  ║        Easily AI Server             ║');
  console.log(`  ║        http://localhost:${PORT}        ║`);
  console.log('  ║        500+ modelos de IA           ║');
  console.log('  ╚═════════════════════════════════════╝');
  console.log('');
  console.log(`  [db]  ${DB_PATH}`);
  console.log(`  [mcp] Free Claude Code MCP: http://127.0.0.1:9090 (use FREE_MCP_URL para alterar)`);
  console.log('');
});
