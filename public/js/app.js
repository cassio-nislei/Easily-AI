/**
 * Easily AI - Frontend Logic
 * UI estilo ChatGPT com upload, streaming, temas e mais
 */

// ==========================================
// STATE
// ==========================================

const state = {
  authenticated: false,
  user: null,
  currentSessionId: null,
  currentModel: 'gpt-5.4-nano',
  currentProvider: 'puter',
  messages: [],
  isLoading: false,
  eventSource: null,
  streamingEnabled: localStorage.getItem('streaming') !== 'false',
  compatMode: localStorage.getItem('compatMode') === 'true',
  imgGenMode: localStorage.getItem('imgGenMode') === 'true',
  pendingFiles: [],
  theme: localStorage.getItem('theme') || 'dark',
};

// ==========================================
// DOM REFS
// ==========================================

const $ = (id) => document.getElementById(id);
const loginScreen = $('login-screen');
const chatScreen = $('chat-screen');
const loginForm = $('login-form');
const registerForm = $('register-form');
const loginError = $('login-error');
const registerError = $('register-error');
const loginLoading = $('login-loading');
const chatMessages = $('chat-messages');
const chatInput = $('chat-input');
const btnSend = $('btn-send');
const btnStop = $('btn-stop');
const modelSelect = $('model-select');
const sessionList = $('session-list');
const sidebarUser = $('sidebar-user');
const userAvatar = $('user-avatar');
const mcpDot = $('mcp-dot');
const mcpStatusText = $('mcp-status-text');
const welcomeMessage = $('welcome-message');
const previewBar = $('preview-bar');
const dropOverlay = $('drop-overlay');
const fileInput = $('file-input');
const lightbox = $('lightbox');
const lightboxImage = $('lightbox-image');
const streamingToggle = $('streaming-toggle');
const sessionTitle = $('session-title');
const compatToggle = $('compat-toggle');
const imgGenToggle = $('imggen-toggle');

// ==========================================
// INIT
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  initTheme();
  initStreamingToggle();
  initCompatToggle();
  initImgGenToggle();
  initDragAndDrop();
});

// ==========================================
// THEME
// ==========================================

function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
}

// ==========================================
// STREAMING TOGGLE
// ==========================================

function initStreamingToggle() {
  streamingToggle.checked = state.streamingEnabled;
}

function toggleStreaming() {
  state.streamingEnabled = streamingToggle.checked;
  localStorage.setItem('streaming', state.streamingEnabled);
}

// ==========================================
// COMPAT MODE TOGGLE
// ==========================================

function initCompatToggle() {
  compatToggle.checked = state.compatMode;
}

function toggleCompat() {
  state.compatMode = compatToggle.checked;
  localStorage.setItem('compatMode', state.compatMode);
}

// ==========================================
// IMAGE GEN MODE TOGGLE
// ==========================================

function initImgGenToggle() {
  imgGenToggle.checked = state.imgGenMode;
}

function toggleImgGen() {
  state.imgGenMode = imgGenToggle.checked;
  localStorage.setItem('imgGenMode', state.imgGenMode);
}

// ==========================================
// PROVIDER SELECTOR (Login Screen)
// ==========================================

document.querySelectorAll('.provider-option').forEach(option => {
  option.addEventListener('click', () => {
    document.querySelectorAll('.provider-option').forEach(o => o.classList.remove('active'));
    option.classList.add('active');
    const radio = option.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  });
});

function getSelectedProvider() {
  const checked = document.querySelector('input[name="mcp-provider"]:checked');
  return checked ? checked.value : 'puter';
}

// ==========================================
// LOGIN / AUTH
// ==========================================

document.querySelectorAll('.login-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabName = tab.dataset.tab;
    loginForm.classList.toggle('hidden', tabName !== 'login');
    registerForm.classList.toggle('hidden', tabName !== 'register');
    loginError.style.display = 'none';
    registerError.style.display = 'none';
  });
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value;

  loginError.style.display = 'none';
  loginLoading.style.display = 'block';
  const submitBtn = loginForm.querySelector('.btn-primary');
  submitBtn.disabled = true;

  try {
    // Timeout de 15s para o login
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const provider = getSelectedProvider();

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, provider }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao fazer login');
    state.authenticated = true;
    state.user = data.user;
    state.currentProvider = data.provider || provider;
    enterChat();
  } catch (err) {
    if (err.name === 'AbortError') {
      loginError.textContent = 'Tempo limite excedido. O servidor está rodando?';
    } else {
      loginError.textContent = err.message;
    }
    loginError.style.display = 'block';
  } finally {
    loginLoading.style.display = 'none';
    submitBtn.disabled = false;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('reg-username').value.trim();
  const password = $('reg-password').value;
  const displayName = $('reg-display').value.trim();

  registerError.style.display = 'none';
  const submitBtn = registerForm.querySelector('.btn-primary');
  submitBtn.disabled = true;

  try {
    const provider = getSelectedProvider();

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, displayName, provider }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao criar conta');
    state.authenticated = true;
    state.user = data.user;
    state.currentProvider = data.provider || provider;
    enterChat();
  } catch (err) {
    registerError.textContent = err.message;
    registerError.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
});

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  state.authenticated = false;
  state.user = null;
  state.currentSessionId = null;
  state.messages = [];
  state.currentProvider = 'puter';
  loginScreen.style.display = 'flex';
  chatScreen.style.display = 'none';
  $('login-username').value = '';
  $('login-password').value = '';
  loginError.style.display = 'none';
}

async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    if (data.authenticated && data.user) {
      state.authenticated = true;
      state.user = data.user;
      enterChat();
    } else {
      loginScreen.style.display = 'flex';
    }
  } catch {
    loginScreen.style.display = 'flex';
  }
}

// ==========================================
// ENTER CHAT
// ==========================================

async function enterChat() {
  loginScreen.style.display = 'none';
  chatScreen.style.display = 'flex';
  sidebarUser.textContent = state.user?.username || 'Usuário';
  userAvatar.textContent = (state.user?.username || 'U')[0].toUpperCase();
  initModelProviders();
  loadModels();
  loadSessions();
  checkMcpStatus();
  newChat();
}

// ==========================================
// MCP STATUS
// ==========================================

async function checkMcpStatus() {
  try {
    const res = await fetch('/api/mcp/start', { method: 'POST' });
    const data = await res.json();
    if (data.running) {
      mcpDot.className = 'mcp-dot online';
      const providerName = data.provider || state.currentProvider || 'puter';
      state.currentProvider = providerName;
      mcpStatusText.textContent = providerName === 'claude_code' ? 'Free MCP ativo' : 'MCP ativo';
    } else if (data.error) {
      mcpDot.className = 'mcp-dot';
      mcpStatusText.textContent = 'Erro';
    } else {
      mcpDot.className = 'mcp-dot';
      mcpStatusText.textContent = 'Offline';
    }
  } catch {
    mcpDot.className = 'mcp-dot';
    mcpStatusText.textContent = 'Offline';
  }
}

async function puterRelogin() {
  if (!confirm('Isso vai deslogar do Puter e re-autenticar. Continuar?')) return;

  try {
    mcpStatusText.textContent = 'Re-autenticando...';
    mcpDot.className = 'mcp-dot';

    const res = await fetch('/api/mcp/relogin', { method: 'POST' });
    const data = await res.json();

    if (data.success && data.running) {
      mcpDot.className = 'mcp-dot online';
      mcpStatusText.textContent = 'MCP ativo';
      alert('Puter re-autenticado com sucesso!');
    } else {
      mcpStatusText.textContent = 'Erro';
      alert('Erro ao re-autenticar: ' + (data.error || 'Desconhecido'));
    }
  } catch (err) {
    mcpStatusText.textContent = 'Erro';
    alert('Erro ao re-autenticar: ' + err.message);
  }
}

// ==========================================
// MODEL PROVIDERS
// ==========================================

let currentProvider = 'all';

/**
 * Normalized provider aliases from the API.
 */
const PROVIDER_ALIASES = {
  'openai': 'GPT',
  'anthropic': 'Claude',
  'google': 'Google',
  'deepseek': 'DeepSeek',
  'mistral': 'Mistral',
  'alibaba': 'Qwen',
  'meta': 'Meta',
  'cohere': 'Cohere',
  'zhipu': 'GLM',
  '01-ai': 'Yi',
};

/**
 * Determine the provider label for a model.
 * Uses API provider info when available; falls back to model ID pattern matching.
 */
function getModelProvider(modelId, providerFromApi) {
  // Use API's provider field if present and not generic
  if (providerFromApi) {
    const lower = providerFromApi.toLowerCase();
    if (lower && lower !== 'puter') {
      // Check aliases first
      for (const [key, label] of Object.entries(PROVIDER_ALIASES)) {
        if (lower === key || lower.startsWith(key)) return label;
      }
      // Fallback: capitalize first letter
      return providerFromApi.charAt(0).toUpperCase() + providerFromApi.slice(1);
    }
  }

  // Fallback: classify by model ID prefix
  const id = modelId.toLowerCase();
  if (/^(gpt|davinci|curie|babbage|dall|whisper)/.test(id)) return 'GPT';
  if (/^claude/.test(id)) return 'Claude';
  if (/^gemini/.test(id)) return 'Google';
  if (/^deepseek/.test(id)) return 'DeepSeek';
  if (/^mistral|^pixtral|^codestral/.test(id)) return 'Mistral';
  if (/^qwen/.test(id)) return 'Qwen';
  if (/^glm/.test(id)) return 'GLM';
  if (/^llama/.test(id)) return 'Meta';
  if (/^command/.test(id)) return 'Cohere';
  if (/^yi\b/.test(id)) return 'Yi';

  // If model ID starts with a recognizable name, use it
  const first = id.match(/^([a-zA-Z][a-z0-9_-]+)/);
  if (first) {
    const name = first[1].charAt(0).toUpperCase() + first[1].slice(1);
    return name;
  }

  return 'Outros';
}

/**
 * Rebuild the provider button bar from the current option set.
 */
function buildProviderButtons() {
  const container = document.getElementById('model-categories');
  const providers = new Set();

  // Collect unique providers from all <option> elements
  document.querySelectorAll('#model-select option').forEach(opt => {
    if (opt.dataset.provider) {
      providers.add(opt.dataset.provider);
    }
  });

  // Separa provedores especiais (image/audio/video) dos demais
  const typedProviders = ['🖼️ Imagem', '🎵 Áudio', '🎬 Vídeo'];
  const regularProviders = [...providers].filter(p => !typedProviders.includes(p));

  // Sort: push "Outros" to the end, rest alphabetically
  const sorted = regularProviders.sort((a, b) => {
    if (a === 'Outros') return 1;
    if (b === 'Outros') return -1;
    return a.localeCompare(b);
  });

  let html = `<button class="cat-btn${currentProvider === 'all' ? ' active' : ''}" data-provider="all" onclick="selectProvider('all')">Todos</button>`;
  html += `<button class="cat-btn${currentProvider === 'free' ? ' active' : ''}" data-provider="free" onclick="selectProvider('free')">🆓 Free</button>`;
  sorted.forEach(p => {
    html += `<button class="cat-btn${currentProvider === p ? ' active' : ''}" data-provider="${p}" onclick="selectProvider('${p.replace(/'/g, "\\'")}')">${p}</button>`;
  });

  // Adiciona separador visual e botões para tipos especiais
  const hasTyped = typedProviders.some(p => providers.has(p));
  if (hasTyped) {
    html += `<span class="cat-separator"></span>`;
    typedProviders.forEach(p => {
      if (providers.has(p)) {
        html += `<button class="cat-btn cat-btn-type${currentProvider === p ? ' active' : ''}" data-provider="${p}" onclick="selectType('${p}')">${p}</button>`;
      }
    });
  }

  // Botão Visão — mostra modelos com capacidade multimodal
  if (providers.size > 0) {
    html += `<button class="cat-btn cat-btn-vision${currentProvider === 'vision' ? ' active' : ''}" data-provider="vision" onclick="selectProvider('vision')">👁️ Visão</button>`;
  }

  container.innerHTML = html;
}

/**
 * Select a provider and filter the model dropdown.
 */
function selectProvider(provider) {
  currentProvider = provider;

  // Update active button highlight
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === provider);
  });

  filterByProvider();
}

function getSelectedModelType() {
  const opt = modelSelect.options[modelSelect.selectedIndex];
  return opt?.dataset?.type || null;
}

/**
 * Select a typed model category (image/audio/video) and filter dropdown.
 * Unlike selectProvider, this uses the model's dataset.type field.
 */
function selectType(provider) {
  currentProvider = provider;

  // Update active button highlight
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === provider);
  });

  const typeMap = { '🖼️ Imagem': 'image', '🎵 Áudio': 'audio', '🎬 Vídeo': 'video' };
  const selectedType = typeMap[provider];

  // Show/hide options based on type match
  const options = modelSelect.querySelectorAll('option');
  let visibleCount = 0;

  options.forEach(opt => {
    const match = opt.dataset.type === selectedType;
    opt.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  // Show a placeholder when nothing matches
  const placeholder = modelSelect.querySelector('.provider-placeholder');
  if (visibleCount === 0) {
    if (!placeholder) {
      const p = document.createElement('option');
      p.className = 'provider-placeholder';
      p.disabled = true;
      p.textContent = '— Nenhum modelo disponível —';
      modelSelect.appendChild(p);
    }
  } else {
    if (placeholder) placeholder.remove();
  }

  // If the currently selected model is now hidden, pick the first visible one
  const selected = modelSelect.options[modelSelect.selectedIndex];
  if (selected && selected.style.display === 'none') {
    const first = modelSelect.querySelector('option:not([style*="display: none"])');
    if (first) {
      modelSelect.value = first.value;
    }
  }
}

/**
 * Show/hide model options based on current provider filter.
 */
function filterByProvider() {
  const options = modelSelect.querySelectorAll('option');
  let visibleCount = 0;

  options.forEach(opt => {
    let match;
    if (currentProvider === 'all') {
      match = true;
    } else if (currentProvider === 'free') {
      match = opt.dataset.free === 'true';
    } else if (currentProvider === 'vision') {
      match = opt.dataset.vision === 'true';
    } else {
      match = opt.dataset.provider === currentProvider;
    }
    opt.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  // Show a placeholder when nothing matches
  const placeholder = modelSelect.querySelector('.provider-placeholder');
  if (visibleCount === 0) {
    if (!placeholder) {
      const p = document.createElement('option');
      p.className = 'provider-placeholder';
      p.disabled = true;
      p.textContent = '— Nenhum modelo —';
      modelSelect.appendChild(p);
    }
  } else {
    if (placeholder) placeholder.remove();
  }

  // If the currently selected model is now hidden, pick the first visible one
  const selected = modelSelect.options[modelSelect.selectedIndex];
  if (selected && selected.style.display === 'none') {
    const first = modelSelect.querySelector('option:not([style*="display: none"])');
    if (first) {
      modelSelect.value = first.value;
      state.currentModel = first.value;
    }
  }
}

/**
 * Check if a model ID suggests it is free tier.
 */
function isFreeModel(modelId, modelName) {
  const id = ((modelId || '') + ' ' + (modelName || '')).toLowerCase();
  if (/\bfree\b/.test(id)) return true;
  return false;
}

/**
 * Initialize providers: classify static options and build buttons.
 */
function initModelProviders() {
  const options = modelSelect.querySelectorAll('option');
  options.forEach(opt => {
    if (!opt.dataset.provider) {
      opt.dataset.provider = getModelProvider(opt.value, '');
    }
    if (!opt.dataset.free) {
      opt.dataset.free = isFreeModel(opt.value, opt.textContent) ? 'true' : 'false';
    }
  });
  buildProviderButtons();
  selectProvider('all');
}

// ==========================================
// MODELS
// ==========================================

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.models && data.models.length > 0) {
      const currentOptions = new Set();
      modelSelect.querySelectorAll('option').forEach(o => currentOptions.add(o.value));
      for (const m of data.models) {
        if (!currentOptions.has(m.id)) {
          const opt = document.createElement('option');
          opt.value = m.id;
          // Formata nome: typed models (image/audio/video) omitem provider no texto
          if (m.type) {
            const prefix = m.type === 'image' ? '🖼️ ' : m.type === 'audio' ? '🎵 ' : '🎬 ';
            opt.textContent = `${prefix}${m.name || m.id}`;
            opt.dataset.type = m.type;
          } else {
            opt.textContent = `${m.name || m.id}${m.provider ? ` (${m.provider})` : ''}`;
          }
          opt.dataset.provider = getModelProvider(m.id, m.provider);
          opt.dataset.free = isFreeModel(m.id, m.name || m.id) ? 'true' : 'false';
          opt.dataset.vision = m.vision ? 'true' : 'false';
          // Apply current filter to new option
          let show;
          if (currentProvider === 'all') show = true;
          else if (currentProvider === 'free') show = opt.dataset.free === 'true';
          else show = opt.dataset.provider === currentProvider;
          opt.style.display = show ? '' : 'none';
          modelSelect.appendChild(opt);
        }
      }
      // Rebuild provider buttons and refresh filter
      buildProviderButtons();
      filterByProvider();
    }
  } catch (err) {
    console.error('Erro ao carregar modelos:', err);
  }
}

// ==========================================
// SESSIONS
// ==========================================

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    if (data.sessions && data.sessions.length > 0) {
      renderSessions(data.sessions);
    } else {
      sessionList.innerHTML = '<div class="session-empty">Nenhuma conversa ainda</div>';
    }
  } catch {
    sessionList.innerHTML = '<div class="session-empty">Erro ao carregar histórico</div>';
  }
}

function renderSessions(sessions) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const groups = { today: [], yesterday: [], older: [] };
  sessions.forEach(s => {
    const d = new Date(s.updated_at).toDateString();
    if (d === today) groups.today.push(s);
    else if (d === yesterday) groups.yesterday.push(s);
    else groups.older.push(s);
  });

  let html = '';
  if (groups.today.length) {
    html += '<div class="session-date-group">Hoje</div>';
    html += groups.today.map(s => sessionItemHtml(s)).join('');
  }
  if (groups.yesterday.length) {
    html += '<div class="session-date-group">Ontem</div>';
    html += groups.yesterday.map(s => sessionItemHtml(s)).join('');
  }
  if (groups.older.length) {
    html += '<div class="session-date-group">Anteriores</div>';
    html += groups.older.map(s => sessionItemHtml(s)).join('');
  }

  sessionList.innerHTML = html;
}

function sessionItemHtml(s) {
  return `
    <div class="session-item ${s.id === state.currentSessionId ? 'active' : ''}"
         onclick="loadSession('${s.id}')" title="${escapeHtml(s.title)}">
      <span class="session-text">${escapeHtml(s.title)}</span>
      <div class="session-actions">
        <button onclick="event.stopPropagation(); renameSession('${s.id}')" title="Renomear">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
        </button>
        <button onclick="event.stopPropagation(); deleteSession('${s.id}')" title="Deletar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function filterSessions(query) {
  const items = sessionList.querySelectorAll('.session-item');
  const lower = query.toLowerCase();
  items.forEach(item => {
    const text = item.querySelector('.session-text').textContent.toLowerCase();
    item.style.display = text.includes(lower) ? 'flex' : 'none';
  });
}

async function loadSession(sessionId) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    const data = await res.json();
    if (!res.ok) return;

    state.currentSessionId = sessionId;
    state.messages = data.messages || [];

    if (data.session?.model) {
      modelSelect.value = data.session.model;
      state.currentModel = data.session.model;
    }

    sessionTitle.textContent = data.session?.title || 'Nova conversa';
    welcomeMessage.style.display = 'none';
    renderMessages();
    loadSessions();
    toggleSidebar(false);
  } catch (err) {
    console.error('Erro ao carregar sessão:', err);
  }
}

async function newChat() {
  state.currentSessionId = null;
  state.messages = [];
  state.pendingFiles = [];
  sessionTitle.textContent = 'Nova conversa';
  welcomeMessage.style.display = 'block';
  chatMessages.querySelectorAll('.message').forEach(el => el.remove());
  chatMessages.querySelectorAll('.typing-indicator').forEach(el => el.remove());
  chatInput.value = '';
  previewBar.innerHTML = '';
  previewBar.classList.remove('has-items');
  autoResizeInput(chatInput);
  chatInput.focus();

  // Clear code blocks and files
  clearCodePanel();

  // Switch back to chat tab
  switchMainTab('chat');

  loadSessions();
}

async function renameSession(sessionId) {
  const session = state.messages.length > 0 ? state.messages[0] : null;
  const currentTitle = session?.content?.slice(0, 50) || 'Nova conversa';
  const newTitle = prompt('Novo nome da conversa:', currentTitle);
  if (newTitle && newTitle !== currentTitle) {
    // TODO: Implementar rename no backend
    loadSessions();
  }
}

async function deleteSession(sessionId) {
  if (!confirm('Deletar esta conversa?')) return;
  try {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (state.currentSessionId === sessionId) newChat();
    loadSessions();
  } catch (err) {
    console.error('Erro ao deletar:', err);
  }
}

// ==========================================
// FILE UPLOAD
// ==========================================

function triggerFileInput() {
  fileInput.click();
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  addFiles(files);
  fileInput.value = '';
}

function addFiles(files) {
  const maxFiles = 10;
  const maxSize = 512 * 1024 * 1024; // 512MB

  for (const file of files) {
    if (state.pendingFiles.length >= maxFiles) {
      alert(`Máximo de ${maxFiles} arquivos por mensagem`);
      break;
    }
    if (file.size > maxSize) {
      alert(`Arquivo ${file.name} excede 512MB`);
      continue;
    }
    state.pendingFiles.push(file);
    addFilePreview(file);
  }

  updateSendButton();
}

function addFilePreview(file) {
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = document.createElement('div');
  item.className = 'preview-item';
  item.id = id;

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  let previewHtml = '';
  if (isImage) {
    const url = URL.createObjectURL(file);
    previewHtml = `<img src="${url}" alt="${file.name}">`;
  } else if (isVideo) {
    previewHtml = `<div class="doc-icon">🎬</div>`;
  } else {
    previewHtml = `<div class="doc-icon ${getDocClass(file.type)}">${getDocEmoji(file.type)}</div>`;
  }

  item.innerHTML = `
    ${previewHtml}
    <div class="preview-info">
      <span class="preview-name">${escapeHtml(file.name)}</span>
      <span class="preview-size">${formatFileSize(file.size)}</span>
    </div>
    <button class="preview-remove" onclick="removeFile('${id}', '${file.name}')">&times;</button>
  `;

  previewBar.appendChild(item);
  previewBar.classList.add('has-items');
}

function removeFile(id, fileName) {
  state.pendingFiles = state.pendingFiles.filter(f => f.name !== fileName);
  const el = $(id);
  if (el) el.remove();
  if (state.pendingFiles.length === 0) {
    previewBar.classList.remove('has-items');
  }
  updateSendButton();
}

function getDocClass(mime) {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('word') || mime.includes('document')) return 'word';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return 'excel';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'ppt';
  return 'text';
}

function getDocEmoji(mime) {
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📑';
  return '📃';
}

// ==========================================
// DRAG & DROP
// ==========================================

function initDragAndDrop() {
  let dragCounter = 0;

  chatScreen.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
  });

  chatScreen.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dropOverlay.classList.remove('active');
    }
  });

  chatScreen.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  chatScreen.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      addFiles(files);
    }
  });
}

// ==========================================
// PASTE
// ==========================================

function handlePaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const files = [];

  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  if (files.length > 0) {
    e.preventDefault();
    addFiles(files);
  }
}

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage() {
  const text = chatInput.value.trim();
  if ((!text && state.pendingFiles.length === 0) || state.isLoading) return;

  state.isLoading = true;
  updateSendButton();
  welcomeMessage.style.display = 'none';

  const model = modelSelect.value;
  state.currentModel = model;

  // Upload files first
  const attachments = [];
  if (state.pendingFiles.length > 0) {
    showTyping();
    try {
      const formData = new FormData();
      state.pendingFiles.forEach(f => formData.append('files', f));

      const uploadRes = await fetch('/api/upload/multiple', {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      if (uploadRes.ok && uploadData.files) {
        attachments.push(...uploadData.files);
      }
    } catch (err) {
      console.error('Erro no upload:', err);
    }
    hideTyping();
  }

  // Add user message
  addMessage('user', text || 'Arquivos anexados', attachments);
  chatInput.value = '';
  state.pendingFiles = [];
  previewBar.innerHTML = '';
  previewBar.classList.remove('has-items');
  autoResizeInput(chatInput);

  if (state.streamingEnabled) {
    await sendMessageStreaming(text, model, attachments);
  } else {
    await sendMessageDirect(text, model, attachments);
  }
}

async function sendMessageStreaming(text, model, attachments) {
  showTyping();
  btnStop.style.display = 'flex';
  btnSend.style.display = 'none';

  try {
    // Modelo selecionado explicitamente pelo tipo (image/audio/video)
    const modelType = getSelectedModelType();
    console.log('[chat-stream] Modelo selecionado:', model, 'tipo:', modelType);

    if (modelType === 'image') {
      // Image models redirect to the dedicated Imagem tab
      hideTyping();
      addMessage('assistant', '🖼️ Use a aba **Imagem** acima para gerar imagens com IA gratuitamente.');
      finishSending('');
      return;
    }

    if (modelType === 'audio') {
      hideTyping();
      addMessage('assistant', '🎵 *Geração de áudio/TTS não disponível neste servidor.*\n\nEm breve: conversão de texto para fala com modelos como OpenAI TTS.');
      finishSending('');
      return;
    }

    if (modelType === 'video') {
      hideTyping();
      addMessage('assistant', '🎬 *Geração de vídeo não disponível neste servidor.*\n\nEm breve: geração de vídeos com modelos como Runway Gen-3 e Pika.');
      finishSending('');
      return;
    }

    const params = new URLSearchParams({
      message: text || '',
      model,
      sessionId: state.currentSessionId || '',
      compatMode: state.compatMode ? 'true' : 'false',
    });

    // Pass attachment IDs so the server can include them in the context
    if (attachments && attachments.length > 0) {
      attachments.forEach(att => params.append('attachmentIds', att.id));
    }

    state.eventSource = new EventSource(`/api/chat/stream?${params}`);

    let responseText = '';
    let firstChunk = true;
    let pendingRagInfo = null;

    state.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'rag') {
          pendingRagInfo = data;
        } else if (data.type === 'session') {
          state.currentSessionId = data.sessionId;
        } else if (data.type === 'chunk') {
          if (firstChunk) {
            hideTyping();
            addMessage('assistant', '', [], pendingRagInfo);
            firstChunk = false;
          }
          responseText += data.text;
          updateLastAssistantMessage(responseText);
        } else if (data.type === 'done') {
          state.eventSource.close();
          state.eventSource = null;
          finishSending(responseText);
        } else if (data.type === 'error') {
          state.eventSource.close();
          state.eventSource = null;
          hideTyping();
          addMessage('assistant', `Erro: ${data.text}`);
          finishSending('');
        }
      } catch (err) {
        console.error('Erro ao processar chunk:', err);
      }
    };

    state.eventSource.onerror = () => {
      state.eventSource.close();
      state.eventSource = null;
      if (!responseText) {
        hideTyping();
        addMessage('assistant', 'Erro de conexão com o servidor');
      }
      finishSending(responseText);
    };
  } catch (err) {
    hideTyping();
    addMessage('assistant', `Erro: ${err.message}`);
    finishSending('');
  }
}

async function sendMessageDirect(text, model, attachments) {
  showTyping();

  try {
    // Modelo selecionado explicitamente pelo tipo (image/audio/video)
    const modelType = getSelectedModelType();
    console.log('[chat] Modelo selecionado:', model, 'tipo:', modelType);

    if (modelType === 'image') {
      hideTyping();
      addMessage('assistant', '🖼️ Use a aba **Imagem** acima para gerar imagens com IA gratuitamente.');
      finishSending('');
      return;
    }

    if (modelType === 'audio') {
      hideTyping();
      addMessage('assistant', '🎵 *Geração de áudio/TTS não disponível neste servidor.*\n\nEm breve: conversão de texto para fala com modelos como OpenAI TTS.');
      finishSending('');
      return;
    }

    if (modelType === 'video') {
      hideTyping();
      addMessage('assistant', '🎬 *Geração de vídeo não disponível neste servidor.*\n\nEm breve: geração de vídeos com modelos como Runway Gen-3 e Pika.');
      finishSending('');
      return;
    }

    // Chat normal
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text || 'Arquivos anexados',
        model,
        sessionId: state.currentSessionId || undefined,
        attachmentIds: attachments.map(a => a.id),
        compatMode: state.compatMode,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      hideTyping();
      addMessage('assistant', `Erro: ${data.error || 'Falha na comunicação'}`);
      finishSending('');
      return;
    }

    if (data.sessionId) {
      state.currentSessionId = data.sessionId;
    }

    hideTyping();
    addMessage('assistant', data.response || '', [], data.rag);
    finishSending(data.response);
  } catch (err) {
    console.error('[chat] Erro:', err);
    hideTyping();
    addMessage('assistant', `Erro de conexão: ${err.message}`);
    finishSending('');
  }
}

function finishSending(responseText) {
  state.isLoading = false;
  btnStop.style.display = 'none';
  btnSend.style.display = 'flex';
  updateSendButton();
  chatInput.focus();

  // Safety net: extract code blocks from full response text
  if (responseText) {
    const blocks = extractCodeBlocks(responseText);
    for (const b of blocks) {
      addCodeItem(b.lang, b.code);
    }
  }

  loadSessions();
}

function stopGeneration() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  finishSending('');
}

// ==========================================
// CODE & FILES SESSION STORE
// ==========================================

let sessionCodeBlocks = []; // {lang, code, id}
let sessionFileItems = [];   // {name, url, size, mimeType}
let currentMainTab = 'chat';
let _previewBlobUrl = null;  // blob URL for combined preview
let _previewBlobCount = 0;   // counter for unique tab keys

let codePanelItems = [];

function getRightPanel() {
  return document.getElementById('rightpanel-content');
}

// ==========================================
// MAIN TAB SWITCHING (Chat | Código | Preview)
// ==========================================

function switchMainTab(tabName) {
  currentMainTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
  const tabBtn = document.querySelector(`.chat-tab[data-tab="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');

  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(`tab-${tabName}`);
  if (pane) pane.classList.add('active');

  // Lazy-render on first switch
  if (tabName === 'codigo') renderCodigoTab();
  if (tabName === 'preview') renderPreviewTab();
}

// ============================================================
// TAB: Imagem — Geração via Pollinations.ai
// ============================================================

let _ultimoPromptImagem = '';

function gerarImagem() {
  const prompt = document.getElementById('imagem-prompt').value.trim();
  if (!prompt) return;

  _ultimoPromptImagem = prompt;
  const model = document.getElementById('imagem-model').value;
  const width = parseInt(document.getElementById('imagem-width').value) || 1024;
  const height = parseInt(document.getElementById('imagem-height').value) || 1024;

  const resultDiv = document.getElementById('imagem-result');
  const loadingDiv = document.getElementById('imagem-loading');
  const errorDiv = document.getElementById('imagem-error');
  const btn = document.getElementById('btn-gerar-imagem');

  resultDiv.style.display = 'none';
  errorDiv.style.display = 'none';
  loadingDiv.style.display = 'block';
  btn.disabled = true;
  document.getElementById('imagem-status').textContent = 'conectando ao Pollinations...';

  fetch('/api/txt2img/pollinations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, width, height }),
  })
    .then(res => res.json())
    .then(data => {
      loadingDiv.style.display = 'none';
      btn.disabled = false;

      if (data.error) {
        errorDiv.style.display = 'block';
        document.getElementById('imagem-error-text').textContent = data.error;
        return;
      }

      const img = document.getElementById('imagem-img');
      img.src = data.url;
      img.alt = prompt;
      resultDiv.style.display = 'block';
    })
    .catch(err => {
      loadingDiv.style.display = 'none';
      btn.disabled = false;
      errorDiv.style.display = 'block';
      document.getElementById('imagem-error-text').textContent = err.message || 'Erro de conexão';
    });
}

function downloadImagem() {
  const img = document.getElementById('imagem-img');
  if (!img.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = `pollinations-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copiarImagemPrompt() {
  if (_ultimoPromptImagem) {
    navigator.clipboard.writeText(_ultimoPromptImagem).catch(() => {});
  }
}

function renderCodigoTab() {
  const container = document.getElementById('codigo-content');

  // Group blocks by language
  const groups = {};
  for (const b of sessionCodeBlocks) {
    const lang = b.lang || 'code';
    if (!groups[lang]) groups[lang] = [];
    groups[lang].push(b);
  }

  if (Object.keys(groups).length === 0 && sessionFileItems.length === 0) {
    container.innerHTML = `
      <div class="tab-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <polyline points="16 18 22 12 16 6"/>
          <polyline points="8 6 2 12 8 18"/>
        </svg>
        <p>Nenhum código gerado ainda</p>
        <span>Os códigos aparecerão aqui conforme a IA responde.</span>
      </div>`;
    return;
  }

  let html = '';

  // Code blocks by language
  for (const [lang, blocks] of Object.entries(groups)) {
    const langLabel = lang || 'code';
    html += `<div class="code-lang-group"><h4>${escapeHtml(langLabel)}</h4>`;
    for (const block of blocks) {
      html += makeCodeItemHtml(block.lang, block.code, block.id);
    }
    html += `</div>`;
  }

  // Files section
  if (sessionFileItems.length > 0) {
    html += `<div class="code-lang-group"><h4>📎 Arquivos</h4>`;
    for (const f of sessionFileItems) {
      html += makeFileItemHtml(f.name, f.url, f.size, f.mimeType);
    }
    html += `</div>`;
  }

  container.innerHTML = html;

  // Update badge count
  updateTabBadge();
}

function makeCodeItemHtml(lang, code, id) {
  const preview = code.length > 400 ? code.slice(0, 400) + '\n...' : code;
  const langLabel = lang || 'code';
  const safeLang = escapeHtml(langLabel);
  const safePreview = escapeHtml(preview);
  const fileName = `code-${id || Date.now()}.${lang || 'txt'}`;
  const isHtml = lang === 'html' || lang === 'htm';
  const uniqueId = id || Date.now();

  let tabsHtml = '';
  let previewHtml = '';
  if (isHtml) {
    tabsHtml = `
      <div class="code-item-tabs">
        <button class="code-item-tab active" onclick="switchCodeTab(this, 'code', '${uniqueId}')">Código</button>
        <button class="code-item-tab" onclick="switchCodeTab(this, 'preview', '${uniqueId}')">Preview</button>
      </div>`;
    previewHtml = `<iframe class="code-item-preview-frame" id="code-frame-${uniqueId}" sandbox="allow-scripts"></iframe>`;
  }

  return `
    <div class="code-item" data-code="${escapeHtml(code)}" data-filename="${fileName}" data-id="${uniqueId}">
      <div class="code-item-header">
        <span class="code-item-lang">${safeLang}</span>
        <div class="code-item-actions">
          <button onclick="copyCodeItem(this)" title="Copiar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button onclick="downloadCodeItem(this)" title="Baixar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
          </button>
        </div>
      </div>
      ${tabsHtml}
      <div class="code-item-preview" onclick="clickCodePreview(this)">${safePreview}</div>
      ${previewHtml}
    </div>`;
}

function makeFileItemHtml(name, url, size, mimeType) {
  const ext = name.split('.').pop().toLowerCase();
  const isImg = mimeType && mimeType.startsWith('image/');
  const isVid = mimeType && mimeType.startsWith('video/');
  let emoji = '📁';
  if (isImg) emoji = '🖼️';
  else if (isVid) emoji = '🎬';
  else if (ext === 'pdf') emoji = '📄';
  const safeName = escapeHtml(name);

  return `
    <div class="file-item" data-url="${escapeHtml(url || '')}" data-filename="${safeName}">
      <span class="file-item-icon">${emoji}</span>
      <div class="file-item-info">
        <div class="file-item-name" title="${safeName}">${safeName}</div>
        <div class="file-item-size">${formatFileSize(size)}</div>
      </div>
      <button class="file-item-download" onclick="downloadPanelFile(this)" title="Baixar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
      </button>
    </div>`;
}

function renderPreviewTab() {
  const container = document.getElementById('preview-content');
  if (!container) return;

  // Collect HTML, CSS, JS blocks
  const htmlBlocks = sessionCodeBlocks.filter(b => b.lang === 'html');
  const cssBlocks = sessionCodeBlocks.filter(b => b.lang === 'css');
  const jsBlocks = sessionCodeBlocks.filter(b => b.lang === 'javascript' || b.lang === 'js');

  if (htmlBlocks.length === 0 && cssBlocks.length === 0 && jsBlocks.length === 0) {
    container.innerHTML = `
      <div class="tab-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p>Nenhuma página web para preview</p>
        <span>Gere código HTML, CSS ou JavaScript para ver o preview combinado aqui.</span>
      </div>`;
    return;
  }

  // Build combined HTML document
  let combinedHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">';

  // Embed CSS
  if (cssBlocks.length > 0) {
    combinedHtml += '<style>\n';
    for (const b of cssBlocks) {
      combinedHtml += b.code + '\n';
    }
    combinedHtml += '</style>\n';
  }

  combinedHtml += '</head><body>\n';

  // Embed HTML body content (merge all HTML blocks)
  for (const b of htmlBlocks) {
    // Extract body content if it's a full HTML doc
    const code = b.code;
    const bodyMatch = code.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      combinedHtml += bodyMatch[1] + '\n';
    } else {
      // Remove html/head/body wrappers and use the content
      const stripped = code
        .replace(/<!DOCTYPE[^>]*>/i, '')
        .replace(/<html[^>]*>/gi, '')
        .replace(/<\/html>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<body[^>]*>/gi, '')
        .replace(/<\/body>/gi, '');
      combinedHtml += stripped + '\n';
    }
  }

  // Embed JS
  if (jsBlocks.length > 0) {
    combinedHtml += '<script>\n';
    for (const b of jsBlocks) {
      combinedHtml += b.code + '\n';
    }
    combinedHtml += '<\/script>\n';
  }

  combinedHtml += '</body></html>';

  // Revoke old blob URL
  if (_previewBlobUrl) {
    URL.revokeObjectURL(_previewBlobUrl);
    _previewBlobUrl = null;
  }

  const blob = new Blob([combinedHtml], { type: 'text/html' });
  _previewBlobUrl = URL.createObjectURL(blob);

  // Build toolbar + iframe layout
  _previewBlobCount++;
  const previewKey = _previewBlobCount;

  container.innerHTML = `
    <div class="preview-toolbar">
      <span class="preview-url">Preview combinado (${htmlBlocks.length} HTML, ${cssBlocks.length} CSS, ${jsBlocks.length} JS)</span>
      <button onclick="refreshPreview()" title="Atualizar preview">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 4v6h6M23 20v-6h-6"/>
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
        </svg>
        Recarregar
      </button>
      <button onclick="openPreviewInTab()" title="Abrir em nova aba">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
        </svg>
        Nova Aba
      </button>
    </div>
    <div class="preview-iframe-container">
      <iframe id="preview-main-frame" sandbox="allow-scripts" src="${_previewBlobUrl}"></iframe>
    </div>`;
}

function refreshPreview() {
  renderPreviewTab();
}

function openPreviewInTab() {
  if (_previewBlobUrl) {
    window.open(_previewBlobUrl, '_blank');
  }
}

function updateTabBadge() {
  const codigoBadge = document.getElementById('codigo-badge');
  const previewBadge = document.getElementById('preview-badge');
  if (codigoBadge) {
    const count = sessionCodeBlocks.length;
    codigoBadge.textContent = count;
    codigoBadge.style.display = count > 0 ? 'inline' : 'none';
  }
  if (previewBadge) {
    const hasWeb = sessionCodeBlocks.some(b => ['html','css','javascript','js'].includes(b.lang));
    const count = sessionCodeBlocks.filter(b => ['html','css','javascript','js'].includes(b.lang)).length;
    previewBadge.textContent = count > 0 ? 'Web' : '';
    previewBadge.style.display = hasWeb ? 'inline' : 'none';
  }
}

function resetProviderFilter() {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  selectProvider('all');
}

function extractCodeBlocks(text) {
  const blocks = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1] || 'code', code: match[2].trim() });
  }
  return blocks;
}

function addCodeItem(lang, code) {
  // Dedup: skip if exact code already exists
  for (const existing of sessionCodeBlocks) {
    if (existing.code === code) return;
  }

  // Push to session store
  const id = Date.now() + Math.floor(Math.random() * 1000);
  sessionCodeBlocks.push({ lang, code, id });

  // Update badge
  updateTabBadge();

  // If we're on the codigo tab, re-render
  if (currentMainTab === 'codigo') renderCodigoTab();
}

function clickCodePreview(el) {
  downloadCodeItem(el);
}

function switchCodeTab(btn, tab, itemId) {
  let item;
  if (itemId) {
    item = document.querySelector(`.code-item[data-id="${itemId}"]`);
  } else {
    item = btn.closest('.code-item');
  }
  if (!item) return;

  const tabs = item.querySelectorAll('.code-item-tab');
  tabs.forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const preview = item.querySelector('.code-item-preview');
  const frame = item.querySelector('.code-item-preview-frame');

  // CSS: .code-item-preview.active { display: none; }  — "active" HIDES it
  //      .code-item-preview-frame.active { display: block; }
  if (tab === 'code') {
    if (preview) preview.classList.remove('active');
    if (frame) {
      // Revoga blob URL ao sair do preview
      if (frame.src && frame.src.startsWith('blob:')) {
        URL.revokeObjectURL(frame.src);
      }
      frame.src = '';
      frame.classList.remove('active');
    }
  } else {
    if (preview) preview.classList.add('active');
    if (frame) {
      frame.classList.add('active');
      const code = item.dataset.code;
      if (code) {
        // Blob URL é mais confiável que srcdoc para iframes criados via innerHTML
        const blob = new Blob([code], { type: 'text/html' });
        frame.src = URL.createObjectURL(blob);
      }
    }
  }
}

function addFileItem(name, url, size, mimeType) {
  // Push to session store
  sessionFileItems.push({ name, url, size, mimeType });

  // If we're on the codigo tab, re-render
  if (currentMainTab === 'codigo') renderCodigoTab();
}

function clearCodePanel() {
  // Revoga todos os blob URLs
  const frames = document.querySelectorAll('.code-item-preview-frame');
  for (const frame of frames) {
    if (frame.src && frame.src.startsWith('blob:')) {
      URL.revokeObjectURL(frame.src);
    }
  }
  if (_previewBlobUrl) {
    URL.revokeObjectURL(_previewBlobUrl);
    _previewBlobUrl = null;
  }

  // Clear session store
  sessionCodeBlocks = [];
  sessionFileItems = [];

  // Re-render if on a tab that shows this data
  if (currentMainTab === 'codigo') renderCodigoTab();
  if (currentMainTab === 'preview') renderPreviewTab();
  updateTabBadge();
}

function copyCodeItem(btn) {
  const item = btn.closest('.code-item');
  const code = item.dataset.code;
  navigator.clipboard.writeText(code).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  });
}

function downloadCodeItem(el) {
  const item = el.closest('.code-item');
  const code = item.dataset.code;
  const filename = item.dataset.filename;
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadPanelFile(btn) {
  const item = btn.closest('.file-item');
  const url = item.dataset.url;
  const filename = item.dataset.filename;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ==========================================
// UI HELPERS
// ==========================================

function addMessage(role, content, attachments = [], ragInfo = null) {
  state.messages.push({ role, content, attachments, ragInfo });

  const div = document.createElement('div');
  div.className = `message ${role} fade-in`;

  const avatar = role === 'user' ? (state.user?.username || 'U')[0].toUpperCase() : 'E';
  const messageId = state.messages.length - 1;

  let attachmentsHtml = '';
  if (attachments.length > 0) {
    if (attachments.length === 1 && attachments[0].mimeType?.startsWith('image/')) {
      // Single image: show large preview
      const att = attachments[0];
      attachmentsHtml = `
        <div class="message-attachments-single">
          <div class="message-image" onclick="openLightbox('${att.url}')">
            <img src="${att.url}" alt="${escapeHtml(att.originalName)}" loading="lazy">
          </div>
        </div>`;
    } else if (attachments.every(a => a.mimeType?.startsWith('image/'))) {
      // Multiple images: grid
      attachmentsHtml = '<div class="message-attachments-grid">';
      for (const att of attachments) {
        attachmentsHtml += `
          <div class="message-image" onclick="openLightbox('${att.url}')">
            <img src="${att.url}" alt="${escapeHtml(att.originalName)}" loading="lazy">
          </div>`;
      }
      attachmentsHtml += '</div>';
    } else {
      // Mixed: show each attachment in its appropriate format
      attachmentsHtml = '<div class="message-attachments">';
      for (const att of attachments) {
        if (att.mimeType?.startsWith('image/')) {
          attachmentsHtml += `
            <div class="message-attachment-item image" onclick="openLightbox('${att.url}')">
              <img src="${att.url}" alt="${escapeHtml(att.originalName)}" loading="lazy">
              <div class="att-overlay"><span>🔍</span></div>
            </div>`;
        } else if (att.mimeType?.startsWith('video/')) {
          attachmentsHtml += `
            <div class="message-attachment-item video">
              <div class="att-video-preview">
                <video preload="metadata">
                  <source src="${att.url}" type="${att.mimeType}">
                </video>
              </div>
              <div class="att-info">
                <span class="att-name">${escapeHtml(att.originalName)}</span>
              </div>
            </div>`;
        } else {
          // Document / file card with visual icon
          const docClass = getDocClass(att.mimeType || '');
          const docEmoji = getDocEmoji(att.mimeType || '');
          const isPdf = att.mimeType === 'application/pdf' || att.originalName?.toLowerCase().endsWith('.pdf');
          attachmentsHtml += `
            <div class="message-attachment-item doc" onclick="window.open('${att.url}', '_blank')">
              <div class="att-doc-icon ${docClass}">
                <span class="doc-emoji">${docEmoji}</span>
                <span class="doc-ext">${isPdf ? 'PDF' : att.originalName?.split('.').pop()?.toUpperCase() || 'FILE'}</span>
              </div>
              <div class="att-info">
                <span class="att-name">${escapeHtml(att.originalName)}</span>
                <span class="att-size">${formatFileSize(att.size)}</span>
              </div>
            </div>`;
        }
      }
      attachmentsHtml += '</div>';
    }
  }

  const actionsHtml = role === 'assistant' ? `
    <div class="message-actions">
      <button onclick="copyMessage(this)" title="Copiar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copiar
      </button>
      <button onclick="downloadMessage(this)" title="Baixar TXT">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        Baixar
      </button>
      <button onclick="regenerateMessage(${messageId})" title="Regenerar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 4v6h6M23 20v-6h-6"/>
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
        </svg>
        Regenerar
      </button>
      <button class="feedback-btn" data-msg-id="${messageId}" onclick="toggleFeedback(${messageId}, 'like')" title="Gostei">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
        </svg>
      </button>
      <button class="feedback-btn" data-msg-id="${messageId}" onclick="toggleFeedback(${messageId}, 'dislike')" title="Não gostei">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
        </svg>
      </button>
    </div>` : `
    <div class="message-actions">
      <button onclick="copyMessage(this)" title="Copiar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copiar
      </button>
      <button onclick="downloadMessage(this)" title="Baixar TXT">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        Baixar
      </button>
      <button onclick="editMessage(${messageId})" title="Editar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
        Editar
      </button>
    </div>`;

  // RAG badge for assistant messages with document references
  let ragBadgeHtml = '';
  if (role === 'assistant' && ragInfo && ragInfo.docs && ragInfo.docs.length > 0) {
    const docsList = ragInfo.docs.map(d => escapeHtml(d)).join('\n• ');
    ragBadgeHtml = `<div class="message-rag-badge" title="Documentos consultados:\n• ${docsList}">📚 ${ragInfo.docs.length} doc(s)</div>`;
  }

  div.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      ${attachmentsHtml}
      <div class="message-text">${formatContent(content)}</div>
      ${ragBadgeHtml}
      ${actionsHtml}
    </div>
  `;

  chatMessages.appendChild(div);
  scrollToBottom();

  // Add code blocks to session store (shows in Código tab)
  if (role === 'assistant' && content) {
    const blocks = extractCodeBlocks(content);
    for (const b of blocks) {
      addCodeItem(b.lang, b.code);
    }
  }

  // Add attachment files to session store (shows in Código tab)
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.url) {
        addFileItem(
          att.originalName || `file-${Date.now()}`,
          att.url,
          att.size || 0,
          att.mimeType || ''
        );
      }
    }
  }
}

function updateLastAssistantMessage(content) {
  let lastMsg = chatMessages.querySelector('.message.assistant:last-child');

  if (!lastMsg) {
    lastMsg = document.createElement('div');
    lastMsg.className = 'message assistant fade-in';
    lastMsg.innerHTML = `
      <div class="message-avatar">E</div>
      <div class="message-content">
        <div class="message-text"></div>
        <div class="message-actions">
          <button onclick="copyMessage(this)" title="Copiar">Copiar</button>
        </div>
      </div>
    `;
    chatMessages.appendChild(lastMsg);
  }

  const textContainer = lastMsg.querySelector('.message-text');
  if (textContainer) {
    textContainer.innerHTML = formatContent(content);
  }

  scrollToBottom();

  // Extract code blocks only if content has grown (avoid duplicates during streaming)
  if (content) {
    const prevLen = parseInt(lastMsg.dataset.codeLen || '0');
    if (content.length > prevLen) {
      lastMsg.dataset.codeLen = String(content.length);
      const blocks = extractCodeBlocks(content);
      for (const b of blocks) {
        addCodeItem(b.lang, b.code);
      }
    }
  }
}

function showTyping() {
  hideTyping();
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="message-avatar">E</div>
    <div class="typing-dots">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateSendButton() {
  const hasContent = chatInput.value.trim() || state.pendingFiles.length > 0;
  btnSend.disabled = !hasContent || state.isLoading;
}

function formatContent(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return '<p>' + html + '</p>';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  updateSendButton();
}

function toggleSidebar(open) {
  const sidebar = $('sidebar');
  if (typeof open === 'boolean') {
    sidebar.classList.toggle('open', open);
  } else {
    sidebar.classList.toggle('open');
  }
}

function toggleRightPanel() {
  const panel = document.getElementById('rightpanel');
  panel.classList.toggle('open');
}

function quickExample(text) {
  chatInput.value = text;
  autoResizeInput(chatInput);
  chatInput.focus();
}

// ==========================================
// MESSAGE ACTIONS
// ==========================================

function copyMessage(btn) {
  const content = btn.closest('.message-content');
  const text = content.querySelector('.message-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Copiado';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  });
}

function downloadMessage(btn) {
  const content = btn.closest('.message-content');
  const text = content.querySelector('.message-text').textContent;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resposta-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function editMessage(messageId) {
  const msg = state.messages[messageId];
  if (!msg || msg.role !== 'user') return;

  const messageEl = chatMessages.querySelectorAll('.message')[messageId];
  if (!messageEl) return;

  const textEl = messageEl.querySelector('.message-text');
  const originalContent = msg.content;

  textEl.innerHTML = `
    <div class="message-edit-container">
      <textarea class="edit-textarea">${escapeHtml(originalContent)}</textarea>
      <div class="message-edit-actions">
        <button class="btn-save-edit" onclick="saveEdit(${messageId})">Salvar</button>
        <button class="btn-cancel-edit" onclick="cancelEdit(${messageId}, '${escapeHtml(originalContent).replace(/'/g, "\\'")}')">Cancelar</button>
      </div>
    </div>
  `;
}

function saveEdit(messageId) {
  const messageEl = chatMessages.querySelectorAll('.message')[messageId];
  const textarea = messageEl.querySelector('.edit-textarea');
  const newContent = textarea.value.trim();

  if (newContent) {
    state.messages[messageId].content = newContent;
    const textEl = messageEl.querySelector('.message-text');
    textEl.innerHTML = formatContent(newContent);
  }
}

function cancelEdit(messageId, originalContent) {
  const messageEl = chatMessages.querySelectorAll('.message')[messageId];
  const textEl = messageEl.querySelector('.message-text');
  textEl.innerHTML = formatContent(originalContent);
}

async function regenerateMessage(messageId) {
  if (state.isLoading) return;

  // Find the user message before this assistant message
  let userMessageIndex = messageId - 1;
  while (userMessageIndex >= 0 && state.messages[userMessageIndex].role !== 'user') {
    userMessageIndex--;
  }

  if (userMessageIndex < 0) return;

  const userMessage = state.messages[userMessageIndex];
  chatInput.value = userMessage.content;
  autoResizeInput(chatInput);
  sendMessage();
}

// ==========================================
// FEEDBACK
// ==========================================

async function toggleFeedback(messageId, type) {
  try {
    const msgEl = chatMessages.querySelectorAll('.message')[messageId];
    const buttons = msgEl.querySelectorAll('.feedback-btn');
    const currentType = buttons[0]?.classList.contains('active') ? 'like' :
                        buttons[1]?.classList.contains('active') ? 'dislike' : null;

    // Remove all active
    buttons.forEach(b => b.classList.remove('active'));

    if (currentType === type) {
      // Toggle off
      await fetch(`/api/feedback/${messageId}`, { method: 'DELETE' });
    } else {
      // Set new type
      buttons.forEach(b => {
        if (b.getAttribute('onclick')?.includes(type)) {
          b.classList.add('active');
        }
      });
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, type }),
      });
    }
  } catch (err) {
    console.error('Erro ao salvar feedback:', err);
  }
}

// ==========================================
// SHARE
// ==========================================

async function shareConversation() {
  if (!state.currentSessionId) {
    alert('Salve a conversa primeiro');
    return;
  }

  try {
    const res = await fetch(`/api/share/${state.currentSessionId}`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.url) {
      const fullUrl = `${window.location.origin}${data.url}`;
      await navigator.clipboard.writeText(fullUrl);
      alert('Link copiado para a área de transferência!');
    }
  } catch (err) {
    console.error('Erro ao compartilhar:', err);
  }
}

// ==========================================
// LIGHTBOX
// ==========================================

function openLightbox(url) {
  lightboxImage.src = url;
  lightbox.classList.add('active');
}

function closeLightbox() {
  lightbox.classList.remove('active');
  lightboxImage.src = '';
}

// ============================================================
// TAB: Leitura — Document Reader com Voz
// ============================================================

let _leituraTexto = '';
let _leituraFilename = '';
let _leituraUtterance = null;
let _leituraSynth = window.speechSynthesis;

function leituraUploadFile(file) {
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  document.getElementById('leitura-upload-area').style.display = 'none';
  document.getElementById('leitura-loading').style.display = 'flex';
  document.getElementById('leitura-loading-text').textContent = 'Extraindo texto do documento...';

  fetch('/api/leitura/upload', {
    method: 'POST',
    body: formData,
  })
    .then(r => r.json())
    .then(data => {
      document.getElementById('leitura-loading').style.display = 'none';

      if (data.error) {
        document.getElementById('leitura-error-text').textContent = data.error;
        document.getElementById('leitura-error').style.display = 'block';
        document.getElementById('leitura-upload-area').style.display = 'flex';
        return;
      }

      _leituraTexto = data.text;
      _leituraFilename = data.originalName;

      // Exibe info
      document.getElementById('leitura-filename').textContent = data.originalName;
      document.getElementById('leitura-stats').textContent = `${(data.size / 1000).toFixed(0)} caracteres`;
      document.getElementById('leitura-info').style.display = 'flex';

      // Exibe texto
      document.getElementById('leitura-text-content').textContent = data.text;
      document.getElementById('leitura-main').style.display = 'flex';

      // Scroll do texto para o topo
      document.getElementById('leitura-text-body').scrollTop = 0;

      // Limpa Q&A anterior
      document.getElementById('leitura-qa-messages').innerHTML =
        '<div class="leitura-qa-empty"><p>Faça perguntas sobre o documento</p><span>Ex: "Resuma este documento", "O que diz sobre..."</span></div>';

      console.log(`[leitura] Documento carregado: ${data.originalName} (${data.size} chars)`);
    })
    .catch(err => {
      document.getElementById('leitura-loading').style.display = 'none';
      document.getElementById('leitura-error-text').textContent = err.message || 'Erro ao processar documento';
      document.getElementById('leitura-error').style.display = 'block';
      document.getElementById('leitura-upload-area').style.display = 'flex';
    });
}

function leituraDropFile(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) leituraUploadFile(file);
}

// Clique na área de upload abre seletor de arquivos
document.addEventListener('DOMContentLoaded', () => {
  const drop = document.getElementById('leitura-drop');
  if (drop) {
    drop.addEventListener('click', () => {
      document.getElementById('leitura-file-input').click();
    });
  }
});

function leituraFecharDocumento() {
  leituraStop();
  _leituraTexto = '';
  _leituraFilename = '';
  document.getElementById('leitura-main').style.display = 'none';
  document.getElementById('leitura-info').style.display = 'none';
  document.getElementById('leitura-upload-area').style.display = 'flex';
  document.getElementById('leitura-error').style.display = 'none';
  document.getElementById('leitura-text-content').textContent = '';
}

// ── Voice ──

function leituraPlay() {
  if (!_leituraTexto) return;

  leituraStop();

  _leituraUtterance = new SpeechSynthesisUtterance(_leituraTexto);
  _leituraUtterance.lang = 'pt-BR';
  _leituraUtterance.rate = parseFloat(document.getElementById('leitura-speed').value) || 1;
  _leituraUtterance.pitch = 1;

  _leituraUtterance.onstart = () => {
    document.getElementById('leitura-btn-play').style.display = 'none';
    document.getElementById('leitura-btn-pause').style.display = 'flex';
    document.getElementById('leitura-btn-stop').style.display = 'flex';
  };

  _leituraUtterance.onend = () => {
    document.getElementById('leitura-btn-play').style.display = 'flex';
    document.getElementById('leitura-btn-pause').style.display = 'none';
    document.getElementById('leitura-btn-stop').style.display = 'none';
  };

  _leituraUtterance.onerror = (e) => {
    console.warn('[leitura] Erro de voz:', e.error);
    leituraStop();
  };

  _leituraSynth.speak(_leituraUtterance);
}

function leituraPause() {
  if (_leituraSynth.speaking) {
    if (_leituraSynth.paused) {
      _leituraSynth.resume();
      document.getElementById('leitura-btn-play').style.display = 'none';
      document.getElementById('leitura-btn-pause').style.display = 'flex';
    } else {
      _leituraSynth.pause();
      document.getElementById('leitura-btn-play').style.display = 'flex';
      document.getElementById('leitura-btn-pause').style.display = 'none';
    }
  }
}

function leituraStop() {
  if (_leituraSynth.speaking) {
    _leituraSynth.cancel();
  }
  _leituraUtterance = null;
  document.getElementById('leitura-btn-play').style.display = 'flex';
  document.getElementById('leitura-btn-pause').style.display = 'none';
  document.getElementById('leitura-btn-stop').style.display = 'none';
}

function leituraChangeSpeed() {
  if (_leituraUtterance && _leituraSynth.speaking) {
    const rate = parseFloat(document.getElementById('leitura-speed').value) || 1;
    _leituraUtterance.rate = rate;
    // Web Speech API não permite mudar rate mid-speech,
    // então precisa reiniciar
    if (!_leituraSynth.paused) {
      const pos = _leituraUtterance.text;
      leituraStop();
      // Nova utterance com texto completo (não temos posição precisa)
      leituraPlay();
    }
  }
}

// ── Perguntas ──

function leituraPerguntar() {
  const input = document.getElementById('leitura-pergunta-input');
  const pergunta = input.value.trim();
  if (!pergunta || !_leituraTexto) return;

  input.value = '';
  const btn = document.getElementById('leitura-btn-perguntar');
  btn.disabled = true;

  // Adiciona pergunta na UI
  const msgs = document.getElementById('leitura-qa-messages');
  const empty = msgs.querySelector('.leitura-qa-empty');
  if (empty) empty.remove();

  const userMsg = document.createElement('div');
  userMsg.className = 'leitura-qa-msg user';
  userMsg.innerHTML = `<div class="msg-text">${leituraEscapeHtml(pergunta)}</div>`;
  msgs.appendChild(userMsg);
  msgs.scrollTop = msgs.scrollHeight;

  // Placeholder da resposta
  const assistantMsg = document.createElement('div');
  assistantMsg.className = 'leitura-qa-msg assistant';
  assistantMsg.innerHTML = '<div class="msg-label">Assistente</div><div class="msg-text" id="leitura-resposta-text">🤔 Pensando...</div>';
  msgs.appendChild(assistantMsg);
  msgs.scrollTop = msgs.scrollHeight;

  fetch('/api/leitura/pergunta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: _leituraTexto, pergunta }),
  })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let respostaCompleta = '';
      const respTextEl = document.getElementById('leitura-resposta-text');

      function readChunk() {
        reader.read().then(({ done, value }) => {
          if (done) {
            btn.disabled = false;
            // Lê resposta em voz alta se toggle ativo
            if (document.getElementById('leitura-auto-voz').checked && respostaCompleta) {
              const utter = new SpeechSynthesisUtterance(respostaCompleta);
              utter.lang = 'pt-BR';
              utter.rate = parseFloat(document.getElementById('leitura-speed').value) || 1;
              window.speechSynthesis.speak(utter);
              respTextEl.innerHTML += '<div class="audio-indicator">🔊 Lendo resposta...</div>';
            }
            return;
          }
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'chunk') {
                  respostaCompleta += data.text;
                  respTextEl.textContent = respostaCompleta;
                }
                if (data.type === 'error') {
                  respTextEl.textContent = '❌ ' + data.text;
                  btn.disabled = false;
                }
              } catch {}
            }
          }
          msgs.scrollTop = msgs.scrollHeight;
          readChunk();
        }).catch(err => {
          respTextEl.textContent = '❌ ' + err.message;
          btn.disabled = false;
        });
      }
      readChunk();
    })
    .catch(err => {
      const el = document.getElementById('leitura-resposta-text');
      if (el) el.textContent = '❌ ' + err.message;
      btn.disabled = false;
    });
}

function leituraEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.classList.contains('active')) {
    closeLightbox();
  }
});
