/**
 * Local search over end-to-end encrypted messages (Spec 10/26 — client-side E2EE search).
 *
 * Because ciphertext cannot be searched server-side, the client decrypts messages
 * and builds a local, in-memory index. Nothing here ever touches the network: the
 * index and every query are processed purely on-device, so plaintext never leaves
 * the client.
 *
 * The implementation is deliberately dependency-free and deterministic so it can be
 * unit-tested and later reused by the web client, the mobile app, or a worker.
 */

/** A decrypted message eligible for local search. */
export interface E2eeIndexMessage {
  id: string;
  conversationId: string;
  senderWorkspaceId: string;
  /** Epoch milliseconds of when the message was sent. */
  sentAt: number;
  /** Decrypted plaintext (kept only in memory on this device). */
  text: string;
}

/** Token -> message ids that contain the token. */
export type E2eePostings = Map<string, Set<string>>;

export interface E2eeSearchIndex {
  messages: Map<string, E2eeIndexMessage>;
  postings: E2eePostings;
}

export interface E2eeSearchHit {
  id: string;
  conversationId: string;
  senderWorkspaceId: string;
  sentAt: number;
  score: number;
}

export interface E2eeSearchOptions {
  limit?: number;
  conversationId?: string;
  senderWorkspaceId?: string;
  /** Only match messages sent at or after this epoch-ms. */
  sinceSentAt?: number;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'as', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me',
  'my', 'your', 'his', 'her', 'our', 'their', 'not', 'no', 'do', 'does', 'did',
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and single-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function tf(text: string, token: string): number {
  // Count whole-word occurrences of the (already lowercased) token.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.toLowerCase().match(new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, 'g'));
  return matches ? matches.length : 0;
}

export function createE2eeIndex(): E2eeSearchIndex {
  return { messages: new Map(), postings: new Map() };
}

/** Build (or rebuild) an index from a set of decrypted messages. */
export function buildE2eeIndex(messages: Iterable<E2eeIndexMessage>): E2eeSearchIndex {
  const index = createE2eeIndex();
  for (const msg of messages) addE2eeMessage(index, msg);
  return index;
}

/** Incrementally add one decrypted message to an existing index. */
export function addE2eeMessage(index: E2eeSearchIndex, msg: E2eeIndexMessage): void {
  index.messages.set(msg.id, msg);
  const tokens = new Set(tokenize(msg.text));
  for (const token of tokens) {
    let set = index.postings.get(token);
    if (!set) {
      set = new Set();
      index.postings.set(token, set);
    }
    set.add(msg.id);
  }
}

/** Remove a message (e.g. after a local delete or a remote tombstone). */
export function removeE2eeMessage(index: E2eeSearchIndex, messageId: string): void {
  const msg = index.messages.get(messageId);
  if (!msg) return;
  index.messages.delete(messageId);
  for (const token of tokenize(msg.text)) {
    const set = index.postings.get(token);
    if (!set) continue;
    set.delete(messageId);
    if (set.size === 0) index.postings.delete(token);
  }
}

/**
 * Query the local index. A message matches only if it contains EVERY query token
 * (AND semantics); results are ranked by term frequency with a mild recency bonus.
 */
export function searchE2eeIndex(
  index: E2eeSearchIndex,
  query: string,
  opts: E2eeSearchOptions = {}
): E2eeSearchHit[] {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const limit = opts.limit ?? 50;

  // Seed candidate set from the rarest query token's postings (fast AND filter).
  const candidateIds = new Set<string>();
  for (const id of index.postings.get(queryTokens[0]!) ?? []) candidateIds.add(id);

  for (let i = 1; i < queryTokens.length; i++) {
    const postings = index.postings.get(queryTokens[i]!);
    if (!postings) return []; // a query token appears nowhere -> no AND match
    for (const id of [...candidateIds]) {
      if (!postings.has(id)) candidateIds.delete(id);
    }
    if (candidateIds.size === 0) return [];
  }

  const now = Date.now();
  const hits: E2eeSearchHit[] = [];

  for (const id of candidateIds) {
    const msg = index.messages.get(id);
    if (!msg) continue;
    if (opts.conversationId && msg.conversationId !== opts.conversationId) continue;
    if (opts.senderWorkspaceId && msg.senderWorkspaceId !== opts.senderWorkspaceId) continue;
    if (opts.sinceSentAt !== undefined && msg.sentAt < opts.sinceSentAt) continue;

    let score = 0;
    for (const token of queryTokens) score += tf(msg.text, token);

    // Mild recency bonus so fresher messages edge out equally-relevant older ones.
    const ageDays = Math.max(0, (now - msg.sentAt) / 86_400_000);
    const recency = Math.max(0, 1 - ageDays / 365);
    score += recency;

    hits.push({
      id: msg.id,
      conversationId: msg.conversationId,
      senderWorkspaceId: msg.senderWorkspaceId,
      sentAt: msg.sentAt,
      score: Number(score.toFixed(6)),
    });
  }

  hits.sort((a, b) => (b.score - a.score) || (b.sentAt - a.sentAt) || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}

/** Extract a short snippet around the first query match for display. */
export function extractSnippet(text: string, query: string, maxLen = 160): string {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return text.slice(0, maxLen);

  const lower = text.toLowerCase();
  let idx = -1;
  for (const token of queryTokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (idx === -1 || found < idx)) idx = found;
  }
  if (idx === -1) return text.slice(0, maxLen);

  const start = Math.max(0, idx - Math.floor(maxLen / 3));
  const slice = text.slice(start, start + maxLen);
  return `${start > 0 ? '…' : ''}${slice}${start + maxLen < text.length ? '…' : ''}`;
}

// ============================================================================
// Semantic Search (TF-IDF + Cosine Similarity) — Spec 17 Phase 5
// ============================================================================

export interface SemanticVector {
  messageId: string;
  vector: Map<string, number>;
  magnitude: number;
}

export interface SemanticIndex {
  vectors: Map<string, SemanticVector>;
  idf: Map<string, number>;
  totalDocs: number;
}

export interface SemanticSearchHit {
  id: string;
  conversationId: string;
  senderWorkspaceId: string;
  sentAt: number;
  score: number;
  snippet: string;
}

export interface SemanticSearchOptions {
  limit?: number;
  conversationId?: string;
  senderWorkspaceId?: string;
  sinceSentAt?: number;
}

/** Build TF-IDF vectors for all messages in the index. */
export function buildSemanticIndex(messages: Iterable<E2eeIndexMessage>): SemanticIndex {
  const index: SemanticIndex = {
    vectors: new Map(),
    idf: new Map(),
    totalDocs: 0,
  };

  const docFreq = new Map<string, number>();
  const allMessages: E2eeIndexMessage[] = [];

  // First pass: collect all messages and document frequencies
  for (const msg of messages) {
    allMessages.push(msg);
    index.totalDocs++;
    const tokens = new Set(tokenize(msg.text));
    for (const token of tokens) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  // Compute IDF for each token
  for (const [token, df] of docFreq) {
    index.idf.set(token, Math.log(index.totalDocs / df) + 1);
  }

  // Second pass: build TF-IDF vectors
  for (const msg of allMessages) {
    const tokens = tokenize(msg.text);
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    const vector = new Map<string, number>();
    let magnitudeSq = 0;
    for (const [token, tf] of termFreq) {
      const idf = index.idf.get(token) ?? 1;
      const tfidf = (tf / tokens.length) * idf;
      vector.set(token, tfidf);
      magnitudeSq += tfidf * tfidf;
    }

    index.vectors.set(msg.id, {
      messageId: msg.id,
      vector,
      magnitude: Math.sqrt(magnitudeSq),
    });
  }

  return index;
}

/** Compute cosine similarity between two TF-IDF vectors. */
function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>, mag1: number, mag2: number): number {
  if (mag1 === 0 || mag2 === 0) return 0;

  let dotProduct = 0;
  // Iterate over the smaller vector for efficiency
  const [smaller, larger] = vec1.size < vec2.size ? [vec1, vec2] : [vec2, vec1];
  for (const [token, value] of smaller) {
    const otherValue = larger.get(token);
    if (otherValue !== undefined) {
      dotProduct += value * otherValue;
    }
  }

  return dotProduct / (mag1 * mag2);
}

/** Build a query vector from a search query. */
function buildQueryVector(query: string, index: SemanticIndex): Map<string, number> {
  const tokens = tokenize(query);
  const termFreq = new Map<string, number>();
  for (const token of tokens) {
    termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
  }

  const vector = new Map<string, number>();
  for (const [token, tf] of termFreq) {
    const idf = index.idf.get(token) ?? 1;
    vector.set(token, (tf / tokens.length) * idf);
  }

  return vector;
}

/** Query the semantic index using cosine similarity. */
export function semanticSearch(
  index: SemanticIndex,
  query: string,
  messages: Map<string, E2eeIndexMessage>,
  opts: SemanticSearchOptions = {}
): SemanticSearchHit[] {
  const queryVector = buildQueryVector(query, index);
  if (queryVector.size === 0) return [];

  const queryMagnitude = Math.sqrt([...queryVector.values()].reduce((sum, v) => sum + v * v, 0));
  if (queryMagnitude === 0) return [];

  const limit = opts.limit ?? 50;
  const hits: SemanticSearchHit[] = [];

  for (const [messageId, vec] of index.vectors) {
    const msg = messages.get(messageId);
    if (!msg) continue;
    if (opts.conversationId && msg.conversationId !== opts.conversationId) continue;
    if (opts.senderWorkspaceId && msg.senderWorkspaceId !== opts.senderWorkspaceId) continue;
    if (opts.sinceSentAt !== undefined && msg.sentAt < opts.sinceSentAt) continue;

    const score = cosineSimilarity(queryVector, vec.vector, queryMagnitude, vec.magnitude);
    if (score <= 0) continue;

    hits.push({
      id: msg.id,
      conversationId: msg.conversationId,
      senderWorkspaceId: msg.senderWorkspaceId,
      sentAt: msg.sentAt,
      score: Number(score.toFixed(6)),
      snippet: extractSnippet(msg.text, query, 200),
    });
  }

  hits.sort((a, b) => (b.score - a.score) || (b.sentAt - a.sentAt) || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}
