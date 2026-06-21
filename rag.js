/**
 * RAG Engine — Busca por documentos anexados
 *
 * Implementa um inverted index com scoring TF-IDF para buscar
 * trechos relevantes de documentos anexados. Sem dependências externas.
 *
 * Uso:
 *   import { rag } from './rag.js';
 *   rag.indexDocument(docId, chunks);    // indexar chunks
 *   const ctx = rag.buildContext(query); // busca + monta contexto
 */

// ============================================================
// Stop words (pt + en)
// ============================================================
const STOP_WORDS = new Set([
  // English
  'a','an','the','is','it','to','and','of','in','that','for','on','with',
  'as','by','at','from','or','be','this','are','was','were','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','can','need','about','into','through','during',
  'before','after','above','below','between','out','off','over','under',
  'again','further','then','once','here','there','when','where','why',
  'how','all','each','every','both','few','more','most','other','some',
  'such','no','nor','not','only','own','same','so','than','too','very',
  'just','because','but','which','who','whom','what',
  // Portuguese
  'de','da','do','em','para','com','um','uma','uns','umas','o','a','os',
  'as','ele','ela','eles','elas','meu','minha','meus','minhas','seu','sua',
  'seus','suas','nosso','nossa','nossos','nossas','que','como','por','mais',
  'mas','se','já','ao','aos','à','às','dos','das','num','numa','nuns',
  'numas','lá','cá','ali','aqui','são','tem','têm','vai','vão','foi',
  'foram','era','eram','ser','sido','está','estão','estava','estavam',
  'estar','esteve','tinha','tinham','ter','tido','há','entre','contra',
  'sem','sob','sobre','depois','ainda','já','não','sim','também','só',
  'nenhum','nenhuma','cada','qual','quais','cujo','cuja','cujos','cujas',
  'quanto','quanta','quantos','quantas','qualquer','quem',
]);

const MAX_CHUNK_WORDS = 600;    // ~2400 chars, ~600 tokens por chunk
const MAX_CONTEXT_CHARS = 12000; // ~3000 tokens de contexto
const DEFAULT_LIMIT = 8;        // chunks retornados por busca

// ============================================================
// RAG Engine
// ============================================================
class RAGEngine {
  constructor() {
    /** Map<chunkId, {text, metadata}> */
    this.chunks = new Map();
    /** Map<term, Set<chunkId>> */
    this.termIndex = new Map();
    /** Map<docId, chunkId[]> */
    this.docChunks = new Map();
    /** Map<docId, {originalName, mimeType, size}> */
    this.docMeta = new Map();
  }

  /**
   * Tokeniza texto: lower case, remove pontuação, filtra stop words e termos curtos
   */
  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\sà-ÿáéíóúâêîôûãõçñ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
      .filter(t => !STOP_WORDS.has(t));
  }

  /**
   * Divide texto em chunks com sobreposição
   */
  chunkText(text, metadata = {}) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length === 0) {
      // Texto sem parágrafos, cria chunks por número de linhas
      const lines = text.split('\n').filter(l => l.trim());
      for (let i = 0; i < lines.length; i += 20) {
        const chunkText = lines.slice(i, i + 20).join('\n').trim();
        if (chunkText) {
          paragraphs.push(chunkText);
        }
      }
    }

    const chunks = [];
    let current = [];
    let currentWords = 0;

    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).length;

      if (current.length > 0 && currentWords + paraWords > MAX_CHUNK_WORDS) {
        // Finaliza chunk atual
        chunks.push(current.join('\n\n'));
        // Mantém overlap de ~20% (último parágrafo + atual)
        const overlap = current.length > 1
          ? current.slice(-Math.max(1, Math.floor(current.length * 0.2))).join('\n\n')
          : '';
        current = overlap ? [overlap, para] : [para];
        currentWords = current.join(' ').split(/\s+/).length;
      } else {
        current.push(para);
        currentWords += paraWords;
      }
    }

    if (current.length > 0) {
      chunks.push(current.join('\n\n'));
    }

    const docId = metadata.docId || `doc-${Date.now()}`;
    return chunks.map((text, i) => ({
      id: `${docId}-chunk-${i}`,
      text: text.trim(),
      metadata: { ...metadata, docId, chunkIndex: i, totalChunks: chunks.length },
    }));
  }

  /**
   * Indexa chunks de um documento
   */
  indexDocument(docId, chunks, docMeta = {}) {
    this.removeDocument(docId); // limpa index anterior

    const chunkIds = [];
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      chunkIds.push(chunk.id);

      const terms = this._tokenize(chunk.text);
      const seen = new Set();
      for (const term of terms) {
        if (seen.has(term)) continue;
        seen.add(term);
        if (!this.termIndex.has(term)) {
          this.termIndex.set(term, new Set());
        }
        this.termIndex.get(term).add(chunk.id);
      }
    }
    this.docChunks.set(docId, chunkIds);
    this.docMeta.set(docId, docMeta);

    const logMeta = docMeta.originalName || docId;
    console.log(`[rag] 📚 Documento indexado: "${logMeta}" — ${chunks.length} chunks, ${this.chunks.size} total`);
  }

  /**
   * Busca chunks relevantes para uma query
   * @param {string} query - texto da pergunta
   * @param {number} limit - max chunks a retornar
   * @returns {Array<{id, text, metadata, score}>}
   */
  search(query, limit = DEFAULT_LIMIT) {
    const queryTerms = this._tokenize(query);
    if (queryTerms.length === 0 || this.chunks.size === 0) return [];

    const totalDocs = this.chunks.size;

    // Score TF-IDF simplificado: S(termo, chunk) = IDF(termo) para cada termo presente
    const scores = new Map();

    for (const term of queryTerms) {
      const matchingChunks = this.termIndex.get(term);
      if (!matchingChunks || matchingChunks.size === 0) continue;

      // IDF = log(N / df) + 1  (suavizado)
      const idf = Math.log((totalDocs + 1) / (matchingChunks.size + 1)) + 1;

      for (const chunkId of matchingChunks) {
        scores.set(chunkId, (scores.get(chunkId) || 0) + idf);
      }
    }

    if (scores.size === 0) return [];

    // Normaliza score pelo melhor resultado
    const maxScore = Math.max(...scores.values());

    return [...scores.entries()]
      .map(([chunkId, score]) => ({
        chunkId,
        score: score / maxScore,
        ...this.chunks.get(chunkId),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Constrói contexto aumentado para o modelo
   * @param {string} query - pergunta do usuário
   * @param {number} maxChars - limite de caracteres do contexto
   * @returns {string} contexto formatado (vazio se nada relevante)
   */
  buildContext(query, maxChars = MAX_CONTEXT_CHARS) {
    const results = this.search(query);
    if (results.length === 0) return '';

    let context = '\n\n---\n**Conteúdo dos documentos anexados:**\n\n';
    let chars = context.length;

    for (const r of results) {
      const docName = r.metadata?.originalName || r.metadata?.docId || 'documento';
      const chunkLabel = r.metadata?.totalChunks > 1
        ? ` (parte ${(r.metadata.chunkIndex || 0) + 1}/${r.metadata.totalChunks})`
        : '';
      const scoreLabel = `[relevância: ${(r.score * 100).toFixed(0)}%]`;

      const entry = `📄 **${docName}**${chunkLabel} ${scoreLabel}\n${r.text}\n\n---\n\n`;
      chars += entry.length;

      if (chars > maxChars) break;
      context += entry;
    }

    if (context === '\n\n---\n**Conteúdo dos documentos anexados:**\n\n') {
      return ''; // nenhum documento foi adicionado de fato
    }

    return context.trimEnd();
  }

  /**
   * Remove documento do índice
   */
  removeDocument(docId) {
    const oldChunkIds = this.docChunks.get(docId);
    if (!oldChunkIds) return;

    for (const cid of oldChunkIds) {
      this.chunks.delete(cid);
      // Remove do índice de termos
      for (const [, chunkIds] of this.termIndex) {
        chunkIds.delete(cid);
      }
    }

    this.docChunks.delete(docId);
    this.docMeta.delete(docId);

    // Limpa termos órfãos
    for (const [term, chunkIds] of this.termIndex) {
      if (chunkIds.size === 0) this.termIndex.delete(term);
    }
  }

  /**
   * Estatísticas do índice
   */
  stats() {
    return {
      totalChunks: this.chunks.size,
      totalDocs: this.docChunks.size,
      totalTerms: this.termIndex.size,
      documents: [...this.docMeta.entries()].map(([id, meta]) => ({
        id,
        name: meta.originalName || id,
        chunks: (this.docChunks.get(id) || []).length,
        size: meta.size || 0,
      })),
    };
  }

  /**
   * Serializa para JSON (para salvar no banco)
   */
  toJSON() {
    return {
      chunks: [...this.chunks.entries()].map(([id, chunk]) => [id, chunk]),
      docChunks: [...this.docChunks.entries()].map(([id, ids]) => [id, ids]),
      docMeta: [...this.docMeta.entries()].map(([id, meta]) => [id, meta]),
    };
  }

  /**
   * Carrega de JSON
   */
  fromJSON(data) {
    this.chunks = new Map(data.chunks || []);
    this.docChunks = new Map(data.docChunks || []);
    this.docMeta = new Map(data.docMeta || []);

    // Reconstrói índice de termos
    this.termIndex.clear();
    for (const [chunkId, chunk] of this.chunks) {
      const terms = this._tokenize(chunk.text);
      const seen = new Set();
      for (const term of terms) {
        if (seen.has(term)) continue;
        seen.add(term);
        if (!this.termIndex.has(term)) {
          this.termIndex.set(term, new Set());
        }
        this.termIndex.get(term).add(chunkId);
      }
    }

    console.log(`[rag] 🔄 Índice carregado: ${this.chunks.size} chunks, ${this.termIndex.size} termos`);
  }
}

export const rag = new RAGEngine();
