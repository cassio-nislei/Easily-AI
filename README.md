# Easily AI

Interface web estilo claude.ai para 500+ modelos de IA via Puter MCP.

![Easily AI](https://img.shields.io/badge/800%2B%20Modelos-IA-blue)

## Funcionalidades

- 🤖 **800+ modelos de IA** — Acesso via Puter.js SDK (GPT-4, Claude, Gemini, Llama, etc.)
- 💬 **Chat com streaming SSE** — Respostas em tempo real
- 📄 **PDF com RAG** — Upload de PDFs com busca semântica e contexto persistente na sessão
- 🖼️ **Suporte a imagens** — Modelos com visão podem analisar imagens
- 💾 **SQLite embutido** — Sem dependências nativas, usa sql.js
- 🔐 **Login/Registro** — Autenticação com bcrypt
- 📚 **Histórico de conversas** — Sessões persistentes com contexto

## Instalação

```bash
git clone https://github.com/cassio-nislei/Easily-AI.git
cd Easily-AI
npm install
```

## Uso

```bash
# Produção
npm start

# Desenvolvimento (auto-reload)
npm run dev
```

O servidor inicia em `http://localhost:3000`.

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `PORT` | Porta do servidor | `3000` |
| `FREE_MCP_URL` | URL do Free MCP server | `http://127.0.0.1:9090` |

## Estrutura

```
Easily-AI/
├── server.js          # Servidor Express principal
├── mcpBridge.js       # Bridge para Puter MCP (800+ modelos)
├── free-mcp-server.js # Servidor MCP alternativo (modelos gratuitos)
├── rag.js             # Motor RAG (TF-IDF + chunking)
├── package.json
├── public/
│   ├── index.html     # SPA principal
│   ├── css/style.css  # Estilos
│   └── js/app.js      # Lógica do frontend
├── data/              # Banco SQLite (gerado automaticamente)
└── uploads/           # Arquivos enviados (gerado automaticamente)
```

## Tecnologias

- **Backend:** Express.js, sql.js (SQLite in-memory), pdf-parse
- **Frontend:** HTML/CSS/JS vanilla, EventSource (SSE)
- **IA:** Puter.js SDK, MCP (Model Context Protocol)
- **RAG:** TF-IDF invertido com chunking por parágrafo (~600 palavras, 20% overlap)

## Licença

MIT
