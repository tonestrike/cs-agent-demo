/**
 * Pure function for sanitizing narrator output text
 */

/**
 * Sanitize narrator output by removing JSON artifacts and code blocks.
 * Extracts answer field from JSON if present, strips embedded JSON objects.
 */
export function sanitizeNarratorOutput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  // If entire text is JSON, try to extract the answer field
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as
        | { answer?: string }
        | Array<{ answer?: string }>;
      if (Array.isArray(parsed)) {
        const first = parsed.find((entry) => entry?.answer);
        if (first?.answer) {
          return String(first.answer).trim();
        }
      } else if (parsed.answer) {
        return String(parsed.answer).trim();
      }
    } catch {
      // Fall through to regex extraction for malformed JSON.
    }
    const match = trimmed.match(/"answer"\s*:\s*"([^"]*)"/);
    if (match?.[1]) {
      return match[1].replace(/\\"/g, '"').trim();
    }
  }
  // Strip embedded JSON objects (function calls, tool calls) from anywhere in text
  // Match patterns like {"name": ...} or {"arguments": ...}
  const sanitized = trimmed
    .replace(/\{[^{}]*"name"\s*:\s*"[^"]*"[^{}]*\}/g, "")
    .replace(/\{[^{}]*"arguments"\s*:\s*[^{}]*\}/g, "")
    .replace(/\{[^{}]*"tool"\s*:\s*"[^"]*"[^{}]*\}/g, "")
    // Also strip markdown code blocks with JSON
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    // Clean up any double spaces or trailing punctuation issues
    .replace(/\s{2,}/g, " ")
    .trim();
  // If stripping left nothing meaningful, return empty
  if (!sanitized || sanitized.length < 3) {
    return "";
  }
  return sanitized;
}
