import { describe, it, expect } from "vitest";
import { sanitizeNarratorOutput } from "../narration/sanitizer";

describe("sanitizeNarratorOutput", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeNarratorOutput("")).toBe("");
    expect(sanitizeNarratorOutput("   ")).toBe("");
  });

  it("returns trimmed text for normal input", () => {
    expect(sanitizeNarratorOutput("  Hello there  ")).toBe("Hello there");
  });

  it("extracts answer from JSON object", () => {
    const json = '{"answer": "This is the response"}';
    expect(sanitizeNarratorOutput(json)).toBe("This is the response");
  });

  it("extracts answer from JSON array", () => {
    const json = '[{"answer": "First response"}, {"answer": "Second"}]';
    expect(sanitizeNarratorOutput(json)).toBe("First response");
  });

  it("handles malformed JSON with answer field via regex", () => {
    const malformed = '{"answer": "Extracted text", incomplete';
    expect(sanitizeNarratorOutput(malformed)).toBe("Extracted text");
  });

  it("strips embedded JSON tool calls without nested braces", () => {
    const text = 'Looking that up {"name": "crm.getAppointments"} for you';
    expect(sanitizeNarratorOutput(text)).toBe("Looking that up for you");
  });

  it("strips markdown code blocks", () => {
    const text = 'Here\'s the info:\n```json\n{"data": "test"}\n```\nDone.';
    expect(sanitizeNarratorOutput(text)).toBe("Here's the info: Done.");
  });

  it("strips generic code blocks", () => {
    const text = "Check this:\n```\nsome code\n```\nOK?";
    expect(sanitizeNarratorOutput(text)).toBe("Check this: OK?");
  });

  it("collapses multiple spaces", () => {
    const text = "Hello    there   world";
    expect(sanitizeNarratorOutput(text)).toBe("Hello there world");
  });

  it("returns empty for text that becomes too short after sanitization", () => {
    const text = '{"name": "tool"}';
    expect(sanitizeNarratorOutput(text)).toBe("");
  });

  it("handles escaped quotes in answer field", () => {
    const json = '{"answer": "He said \\"hello\\""}';
    expect(sanitizeNarratorOutput(json)).toBe('He said "hello"');
  });

  it("preserves normal text with JSON-like characters", () => {
    const text = "The price is $50 and includes a bracket [service]";
    expect(sanitizeNarratorOutput(text)).toBe(
      "The price is $50 and includes a bracket [service]",
    );
  });
});
