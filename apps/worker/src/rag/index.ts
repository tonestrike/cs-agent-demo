/**
 * RAG (Retrieval-Augmented Generation) Module
 *
 * Provides knowledge retrieval capabilities for enhancing
 * agent responses with relevant documentation.
 *
 * Usage:
 * ```ts
 * import { createKnowledgeRetriever } from "./rag";
 *
 * const retriever = createKnowledgeRetriever({
 *   ai: env.AI,
 *   vectorize: env.KNOWLEDGE_VECTORS,
 * });
 *
 * const result = await retriever.retrieve("How much does termite treatment cost?");
 * console.log(result.chunks); // Top 3 relevant chunks
 * ```
 */

export { createKnowledgeRetriever } from "./retriever";
export { createEmbedder } from "./embedder";
export { chunkMarkdown, type ChunkOptions } from "./chunker";
export {
  seedKnowledgeBase,
  generateKnowledgeChunks,
  type SeedResult,
} from "./seeder";
export type {
  KnowledgeChunk,
  KnowledgeRetriever,
  RetrievalResult,
  RetrieverConfig,
  Embedder,
} from "./types";
