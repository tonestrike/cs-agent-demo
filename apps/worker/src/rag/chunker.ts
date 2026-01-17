/**
 * Markdown Chunker
 *
 * Splits markdown documents into chunks suitable for embedding.
 * Preserves section context and metadata for each chunk.
 */

import type { KnowledgeChunk } from "./types";

/** Target chunk size in characters (roughly 400-600 tokens) */
const TARGET_CHUNK_SIZE = 1500;

/** Minimum chunk size to avoid tiny fragments */
const MIN_CHUNK_SIZE = 200;

/**
 * Options for chunking a markdown document.
 */
export type ChunkOptions = {
  /** Source file name */
  source: string;
  /** Content category */
  category: KnowledgeChunk["metadata"]["category"];
};

/**
 * Parsed section from markdown.
 */
type MarkdownSection = {
  heading: string;
  level: number;
  content: string;
};

/**
 * Parse markdown into sections based on headings.
 */
function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;
  let contentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const hashMarks = headingMatch[1];
      const headingText = headingMatch[2];

      // Save previous section
      if (currentSection) {
        currentSection.content = contentLines.join("\n").trim();
        if (currentSection.content) {
          sections.push(currentSection);
        }
      }

      // Start new section
      currentSection = {
        heading: headingText ?? "",
        level: hashMarks?.length ?? 1,
        content: "",
      };
      contentLines = [];
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  // Save final section
  if (currentSection) {
    currentSection.content = contentLines.join("\n").trim();
    if (currentSection.content) {
      sections.push(currentSection);
    }
  }

  return sections;
}

/**
 * Split a section into smaller chunks if needed.
 */
function splitLargeSection(
  section: MarkdownSection,
  parentHeading: string,
): Array<{ heading: string; content: string }> {
  const fullHeading = parentHeading
    ? `${parentHeading} > ${section.heading}`
    : section.heading;

  if (section.content.length <= TARGET_CHUNK_SIZE) {
    return [{ heading: fullHeading, content: section.content }];
  }

  // Split by paragraphs
  const paragraphs = section.content.split(/\n\n+/);
  const chunks: Array<{ heading: string; content: string }> = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if (
      currentChunk.length + para.length > TARGET_CHUNK_SIZE &&
      currentChunk.length >= MIN_CHUNK_SIZE
    ) {
      chunks.push({ heading: fullHeading, content: currentChunk.trim() });
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ heading: fullHeading, content: currentChunk.trim() });
  }

  return chunks;
}

/**
 * Chunk a markdown document into knowledge chunks.
 *
 * @param markdown - The markdown content to chunk
 * @param options - Chunking options (source, category)
 * @returns Array of knowledge chunks with unique IDs
 */
export function chunkMarkdown(
  markdown: string,
  options: ChunkOptions,
): KnowledgeChunk[] {
  const sections = parseMarkdownSections(markdown);
  const chunks: KnowledgeChunk[] = [];
  let parentH1 = "";
  let parentH2 = "";

  for (const section of sections) {
    // Track parent headings for context
    if (section.level === 1) {
      parentH1 = section.heading;
      parentH2 = "";
    } else if (section.level === 2) {
      parentH2 = section.heading;
    }

    // Build parent context
    const parentHeading =
      section.level === 1
        ? ""
        : section.level === 2
          ? parentH1
          : `${parentH1}${parentH2 ? ` > ${parentH2}` : ""}`;

    // Split section if too large
    const sectionChunks = splitLargeSection(section, parentHeading);

    for (let i = 0; i < sectionChunks.length; i++) {
      const chunk = sectionChunks[i];
      if (!chunk) continue;
      const { heading, content } = chunk;
      const chunkId = `${options.source}:${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${i}`;

      chunks.push({
        id: chunkId,
        content,
        metadata: {
          source: options.source,
          section: heading,
          category: options.category,
        },
      });
    }
  }

  return chunks;
}
