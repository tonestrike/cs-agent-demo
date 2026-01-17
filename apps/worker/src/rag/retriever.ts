/**
 * Knowledge Retriever Implementation
 *
 * Queries the Vectorize index to find relevant knowledge chunks
 * based on semantic similarity to the user's query.
 */

import { createEmbedder } from "./embedder";
import type {
  KnowledgeChunk,
  KnowledgeRetriever,
  RetrievalResult,
  RetrieverConfig,
} from "./types";

/** Default number of chunks to retrieve */
const DEFAULT_TOP_K = 3;

/** Default minimum similarity score threshold */
const DEFAULT_MIN_SCORE = 0.7;

/**
 * Create a knowledge retriever using Vectorize.
 *
 * @param config - Retriever configuration
 * @returns KnowledgeRetriever instance
 */
export function createKnowledgeRetriever(
  config: RetrieverConfig,
): KnowledgeRetriever {
  const { ai, vectorize, minScore = DEFAULT_MIN_SCORE } = config;
  const embedder = createEmbedder(ai);

  return {
    async retrieve(
      query: string,
      topK = DEFAULT_TOP_K,
    ): Promise<RetrievalResult> {
      // Generate embedding for the query
      const queryVector = await embedder.embed(query);

      // Query Vectorize for similar vectors
      const results = await vectorize.query(queryVector, {
        topK,
        returnMetadata: "all",
      });

      // Filter by minimum score and map to KnowledgeChunk format
      const chunks: Array<KnowledgeChunk & { score: number }> = results.matches
        .filter((match) => match.score >= minScore)
        .map((match) => {
          const metadata = match.metadata ?? {};
          return {
            id: match.id,
            content: (metadata["content"] as string) ?? "",
            metadata: {
              source: (metadata["source"] as string) ?? "unknown",
              section: (metadata["section"] as string) ?? "General",
              category:
                (metadata[
                  "category"
                ] as KnowledgeChunk["metadata"]["category"]) ?? "faqs",
            },
            score: match.score,
          };
        });

      return { chunks, query };
    },
  };
}
