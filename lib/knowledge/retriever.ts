/**
 * Finds the passages that answer a question.
 *
 * This uses BM25, the ranking function behind most classic search engines. It
 * scores a document on how often the question's words appear in it, damped so
 * a word repeated twenty times does not count twenty times, and weighted so a
 * rare word like "overdraft" counts for far more than a common one like "the".
 *
 * There is no embedding model and no vector database. For a fact sheet of this
 * size that is not a compromise: the vocabulary is small and the questions use
 * the same words as the documents, which is exactly where BM25 is strongest.
 * It is also instant, free, and gives the same answer every time, which makes
 * it testable.
 */

import { KNOWLEDGE_BASE, type KnowledgeDocument } from "@/lib/knowledge/documents";

/* BM25's two dials. These are the standard values and rarely need changing. */
const K1 = 1.5; // how fast repeated words stop adding score
const B = 0.75; // how strongly long documents are penalised

/** Words so common they carry no signal about which document is relevant. */
const STOP_WORDS = new Set([
  "a", "about", "am", "an", "and", "any", "are", "as", "at", "be", "been",
  "by", "can", "could", "do", "does", "for", "from", "get", "got", "has",
  "have", "how", "i", "if", "in", "is", "it", "its", "just", "me", "my", "of",
  "on", "or", "our", "out", "please", "should", "so", "that", "the", "their",
  "there", "they", "this", "to", "up", "was", "we", "what", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your",
]);

/**
 * Splits text into comparable words.
 *
 * Numbers keep their commas and decimals so "25,000" survives as one token,
 * which matters because that exact string is the answer to a question.
 */
export function tokenise(text: string): string[] {
  const lowered = text.toLowerCase();
  const raw = lowered.match(/[a-z]+|\d[\d,.]*\d|\d/g) ?? [];
  return raw
    .map((token) => token.replace(/[.,]+$/, ""))
    .filter((token) => token.length > 0)
    .filter((token) => !STOP_WORDS.has(token))
    .map(stem);
}

/**
 * Chops the most common English endings off a word.
 *
 * Crude on purpose. It only needs "cards" to match "card" and "charges" to
 * match "charge"; anything cleverer would need a dictionary.
 *
 * Plurals are handled before verb endings, and a plural loses only its "s",
 * so "charges" becomes "charge" rather than "charg" and still matches the
 * singular. Words ending in a double s are left alone so "business" survives.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;

  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }
  for (const suffix of ["ing", "ed"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

export type IndexedDocument = {
  doc: KnowledgeDocument;
  tokens: string[];
  length: number;
  /** How many times each word appears in this document. */
  frequencies: Map<string, number>;
};

export type SearchHit = {
  document: KnowledgeDocument;
  score: number;
  /** The words from the question that actually matched. */
  matched: string[];
  /** The most relevant few sentences, for showing in the UI. */
  excerpt: string;
};

/**
 * The index, built once and reused.
 *
 * The knowledge base is a constant, so there is no reason to re-read it on
 * every request.
 */
class KnowledgeIndex {
  readonly documents: IndexedDocument[];
  private readonly documentFrequency: Map<string, number>;
  readonly averageLength: number;

  constructor(docs: KnowledgeDocument[]) {
    this.documents = docs.map((doc) => {
      const tokens = tokenise(`${doc.title} ${doc.text}`);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      return { doc, tokens, length: tokens.length, frequencies };
    });

    this.averageLength =
      this.documents.reduce((sum, d) => sum + d.length, 0) /
      Math.max(this.documents.length, 1);

    this.documentFrequency = new Map();
    for (const entry of this.documents) {
      for (const token of new Set(entry.tokens)) {
        this.documentFrequency.set(
          token,
          (this.documentFrequency.get(token) ?? 0) + 1
        );
      }
    }
  }

  /** How much a word is worth. Rare words score high, ubiquitous ones near zero. */
  private inverseDocumentFrequency(token: string): number {
    const total = this.documents.length;
    const seenIn = this.documentFrequency.get(token) ?? 0;
    return Math.log(1 + (total - seenIn + 0.5) / (seenIn + 0.5));
  }

  score(entry: IndexedDocument, queryTokens: string[]): number {
    let score = 0;
    for (const token of queryTokens) {
      const frequency = entry.frequencies.get(token);
      if (!frequency) continue;
      const idf = this.inverseDocumentFrequency(token);
      const numerator = frequency * (K1 + 1);
      const denominator =
        frequency + K1 * (1 - B + (B * entry.length) / this.averageLength);
      score += idf * (numerator / denominator);
    }
    return score;
  }
}

const index = new KnowledgeIndex(KNOWLEDGE_BASE);

/** Pulls out the sentences that contain the most matching words. */
function buildExcerpt(text: string, queryTokens: Set<string>, maxChars = 320): string {
  const sentences = text
    .split(/(?<=[.?!])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return text.slice(0, maxChars);

  const ranked = sentences
    .map((sentence, position) => {
      const hits = tokenise(sentence).filter((t) => queryTokens.has(t)).length;
      return { sentence, position, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.position - b.position);

  const chosen = (ranked.length > 0 ? ranked : [{ sentence: sentences[0], position: 0, hits: 0 }])
    .slice(0, 3)
    .sort((a, b) => a.position - b.position)
    .map((s) => s.sentence);

  let excerpt = chosen.join(" ");
  if (excerpt.length > maxChars) excerpt = `${excerpt.slice(0, maxChars).trimEnd()}...`;
  return excerpt;
}

export type SearchOptions = {
  limit?: number;
  category?: string;
  /** Hits below this score are dropped as noise rather than shown. */
  minScore?: number;
};

export function search(query: string, options: SearchOptions = {}): SearchHit[] {
  const { limit = 3, category, minScore = 0.35 } = options;
  const queryTokens = tokenise(query);
  if (queryTokens.length === 0) return [];

  const queryTokenSet = new Set(queryTokens);

  return index.documents
    .filter((entry) => !category || entry.doc.category === category)
    .map((entry) => {
      const score = index.score(entry, queryTokens);
      const matched = [...queryTokenSet].filter((t) => entry.frequencies.has(t));
      return {
        document: entry.doc,
        score: Number(score.toFixed(4)),
        matched,
        excerpt: buildExcerpt(entry.doc.text, queryTokenSet),
      };
    })
    .filter((hit) => hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The retrieved passages, formatted for dropping into a prompt. */
export function formatForPrompt(hits: SearchHit[]): string {
  if (hits.length === 0) return "No relevant passages were found in the knowledge base.";
  return hits
    .map(
      (hit, i) =>
        `[${i + 1}] ${hit.document.title} (${hit.document.source})\n${hit.document.text}`
    )
    .join("\n\n---\n\n");
}
