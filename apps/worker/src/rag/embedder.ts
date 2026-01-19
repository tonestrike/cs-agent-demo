/**
 * Embedder Implementation
 *
 * Generates vector embeddings using Workers AI's BGE model.
 * Used for both indexing knowledge chunks and querying.
 */

import type { Embedder } from "./types";

/** Workers AI embedding model - produces 768-dimensional vectors */
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Response type for Workers AI embedding models.
 * @see https://developers.cloudflare.com/vectorize/get-started/embeddings/
 */
type EmbeddingResponse = {
  shape: number[];
  data: number[][];
};

/**
 * Create an embedder using Workers AI.
 *
 * @param ai - Workers AI binding
 * @returns Embedder instance
 */
export function createEmbedder(ai: Ai): Embedder {
  return {
    async embed(text: string): Promise<number[]> {
      const result = (await ai.run(EMBEDDING_MODEL, {
        text: [text],
      })) as EmbeddingResponse;

      if (!result.data?.[0]) {
        throw new Error("Failed to generate embedding");
      }

      return result.data[0];
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      const result = (await ai.run(EMBEDDING_MODEL, {
        text: texts,
      })) as EmbeddingResponse;

      if (!result.data || result.data.length !== texts.length) {
        throw new Error("Failed to generate batch embeddings");
      }

      return result.data;
    },
  };
}
