/**
 * Schema index — re-exports all schemas and the JSON Schema converter.
 *
 * Import from here for convenience:
 *   import { QuerySchema, CreateProjectSchema, zodToJsonSchema } from "../schemas/index.js";
 */
import { z } from "zod";

// Re-export all schemas
export * from "./rag.js";
export * from "./project.js";
export * from "./conversation.js";
export * from "./memory.js";
export * from "./eval.js";
export * from "./export.js";
export * from "./bus.js";
export * from "./agent-eval.js";

/**
 * Convert a Zod schema to JSON Schema for MCP tool definitions.
 * Zod's .describe() calls become the JSON Schema 'description' fields.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodType;
      properties[key] = zodToJsonSchema(zodField);

      if (
        !(zodField instanceof z.ZodOptional) &&
        !(zodField instanceof z.ZodDefault)
      ) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodString) {
    return {
      type: "string",
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (schema instanceof z.ZodNumber) {
    return {
      type: "number",
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (schema instanceof z.ZodBoolean) {
    return {
      type: "boolean",
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: (schema as z.ZodEnum<[string, ...string[]]>).options,
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodToJsonSchema(schema._def.innerType);
    const desc =
      schema.description ?? (schema._def.innerType as z.ZodType).description;
    return {
      ...inner,
      default: schema._def.defaultValue(),
      ...(desc ? { description: desc } : {}),
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema._def.innerType);
  }

  return { type: "string" };
}
