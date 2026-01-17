/**
 * RAG (Retrieval-Augmented Generation) Types
 *
 * Types for the knowledge retrieval system that enhances
 * agent responses with relevant documentation.
 */

/**
 * A chunk of knowledge content with associated metadata.
 */
export type KnowledgeChunk = {
  /** Unique identifier for the chunk */
  id: string;
  /** The text content of the chunk */
  content: string;
  /** Metadata about the chunk's source */
  metadata: {
    /** Source file name (e.g., "services.md") */
    source: string;
    /** Section heading (e.g., "Termite Treatment") */
    section: string;
    /** Content category */
    category: "services" | "pricing" | "faqs" | "pests" | "policies";
  };
};

/**
 * Result from a knowledge retrieval query.
 */
export type RetrievalResult = {
  /** Retrieved chunks, ordered by relevance score */
  chunks: Array<KnowledgeChunk & { score: number }>;
  /** The original query used for retrieval */
  query: string;
};

/**
 * Knowledge retriever interface.
 * Implementations can use different vector stores or retrieval methods.
 */
export type KnowledgeRetriever = {
  /**
   * Retrieve relevant knowledge chunks for a query.
   * @param query - The user's message or question
   * @param topK - Maximum number of chunks to return (default: 3)
   * @returns Retrieved chunks with relevance scores
   */
  retrieve: (query: string, topK?: number) => Promise<RetrievalResult>;
};

/**
 * Embedder interface for generating vector embeddings.
 */
export type Embedder = {
  /**
   * Generate an embedding vector for the given text.
   * @param text - Text to embed
   * @returns Vector embedding
   */
  embed: (text: string) => Promise<number[]>;

  /**
   * Generate embeddings for multiple texts.
   * @param texts - Texts to embed
   * @returns Array of vector embeddings
   */
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

/**
 * Configuration for the knowledge retriever.
 */
export type RetrieverConfig = {
  /** Workers AI binding for generating embeddings */
  ai: Ai;
  /** Vectorize index for storing/querying embeddings */
  vectorize: VectorizeIndex;
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
};
