/**
 * Knowledge Base Seeder
 *
 * Seeds the Vectorize index with knowledge chunks from markdown content.
 * This can be called via a worker endpoint.
 */

import { type ChunkOptions, chunkMarkdown } from "./chunker";
import { createEmbedder } from "./embedder";
import type { KnowledgeChunk } from "./types";

/**
 * Knowledge source configuration.
 */
type KnowledgeSource = {
  content: string;
  options: ChunkOptions;
};

/**
 * Services markdown content.
 */
const SERVICES_CONTENT = `# Pest Control Services

## Termite Treatment
Comprehensive termite control including inspection, treatment, and prevention.

### Inspection
- Free initial inspection
- Thorough structural evaluation
- Written report within 24 hours

### Treatment Pricing
- Liquid barrier treatment: $800-$1500
- Bait station systems: $1200-$2000
- Fumigation (severe cases): $2500+

## General Pest Control
Monthly and quarterly plans for ants, roaches, spiders, silverfish.

### Pricing
- One-time service: $150-$250
- Monthly plan: $45/month
- Quarterly plan: $120/quarter

## Rodent Control
### Pricing
- Initial inspection: Free
- Treatment plan: $200-$400
- Exclusion work: $300-$800
`;

/**
 * FAQs markdown content.
 */
const FAQS_CONTENT = `# Frequently Asked Questions

## Scheduling
### How far in advance should I book?
We recommend booking 2-3 days in advance for routine service.
Emergency services available same-day for active infestations.

### Can I reschedule my appointment?
Yes, reschedule up to 24 hours before at no charge.
Same-day changes may incur a $25 fee.

## Safety
### Is the treatment safe for pets?
Our treatments are pet-safe once dry (typically 2-4 hours).
Keep pets away during application.

### How long until I see results?
Most customers see significant reduction within 48-72 hours.
Complete elimination typically takes 1-2 weeks.

## Cancellation Policy
Cancel 24 hours in advance for full refund.
Same-day cancellations forfeit deposit.
`;

/**
 * Get all knowledge sources.
 */
function getKnowledgeSources(): KnowledgeSource[] {
  return [
    {
      content: SERVICES_CONTENT,
      options: { source: "services.md", category: "services" },
    },
    {
      content: FAQS_CONTENT,
      options: { source: "faqs.md", category: "faqs" },
    },
  ];
}

/**
 * Generate all knowledge chunks from markdown sources.
 */
export function generateKnowledgeChunks(): KnowledgeChunk[] {
  const sources = getKnowledgeSources();
  const allChunks: KnowledgeChunk[] = [];

  for (const source of sources) {
    const chunks = chunkMarkdown(source.content, source.options);
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * Seed result with statistics.
 */
export type SeedResult = {
  success: boolean;
  chunksProcessed: number;
  vectorsInserted: number;
  errors: string[];
};

/**
 * Seed the Vectorize index with knowledge chunks.
 *
 * @param ai - Workers AI binding for generating embeddings
 * @param vectorize - Vectorize index binding
 * @returns Seed result with statistics
 */
export async function seedKnowledgeBase(
  ai: Ai,
  vectorize: VectorizeIndex,
): Promise<SeedResult> {
  const chunks = generateKnowledgeChunks();
  const embedder = createEmbedder(ai);
  const errors: string[] = [];
  let vectorsInserted = 0;

  // Process chunks in batches to avoid hitting rate limits
  const batchSize = 10;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    try {
      // Generate embeddings for the batch
      const texts = batch.map((chunk) => chunk.content);
      const embeddings = await embedder.embedBatch(texts);

      // Create vectors with metadata
      const vectors: VectorizeVector[] = batch.map((chunk, idx) => ({
        id: chunk.id,
        values: embeddings[idx] ?? [],
        metadata: {
          content: chunk.content,
          source: chunk.metadata.source,
          section: chunk.metadata.section,
          category: chunk.metadata.category,
        },
      }));

      // Upsert vectors into Vectorize
      await vectorize.upsert(vectors);
      vectorsInserted += vectors.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Batch ${i / batchSize + 1}: ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    chunksProcessed: chunks.length,
    vectorsInserted,
    errors,
  };
}
