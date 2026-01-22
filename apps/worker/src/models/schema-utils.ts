import { z } from "zod";
import type { toolDefinitions } from "./tool-definitions";

/**
 * Convert a Zod schema to JSON Schema format.
 * Supports common Zod types used in tool definitions.
 */
export const zodToJsonSchema = (
  schema: z.ZodTypeAny,
): Record<string, unknown> => {
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema._def.values };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema._def.type) };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema._def.innerType);
    return { anyOf: [inner, { type: "null" }] };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as z.ZodRawShape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) {
        required.push(key);
      }
    }
    const result: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    } = { type: "object", properties };
    if (required.length) {
      result.required = required;
    }
    return result;
  }
  return { type: "object" };
};

type ToolDefinition = (typeof toolDefinitions)[keyof typeof toolDefinitions];

/**
 * Convert a tool definition to Claude/Anthropic's format.
 * Uses `input_schema` instead of `parameters`.
 */
export const toolToClaudeFormat = (
  name: string,
  definition: ToolDefinition,
): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} => ({
  name,
  description: definition.description,
  input_schema: zodToJsonSchema(definition.inputSchema),
});

/**
 * Convert a tool definition to OpenAI-compatible format (used by OpenRouter).
 * Uses `type: "function"` wrapper with `parameters`.
 */
export const toolToOpenAIFormat = (
  name: string,
  definition: ToolDefinition,
): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} => ({
  type: "function",
  function: {
    name,
    description: definition.description,
    parameters: zodToJsonSchema(definition.inputSchema),
  },
});

/**
 * Build tools in Claude format from tool definitions.
 */
export const buildClaudeTools = (
  definitions: Record<string, ToolDefinition>,
): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> =>
  Object.entries(definitions).map(([name, definition]) =>
    toolToClaudeFormat(name, definition),
  );

/**
 * Build tools in OpenAI format from tool definitions.
 */
export const buildOpenAITools = (
  definitions: Record<string, ToolDefinition>,
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> =>
  Object.entries(definitions).map(([name, definition]) =>
    toolToOpenAIFormat(name, definition),
  );
