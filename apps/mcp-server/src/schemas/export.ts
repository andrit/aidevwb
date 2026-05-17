/**
 * Export Schemas — production stack generation.
 */
import { z } from "zod";

export const ExportFormatSchema = z.enum(["compose", "terraform", "migrations-only"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportStackSchema = z.object({
  format: ExportFormatSchema.default("compose").describe("Export format"),
  include_data: z.boolean().default(false).describe("Include a database seed dump"),
  output_dir: z.string().optional().describe("Override output directory (default: <project>/stack)"),
});
export type ExportStackInput = z.infer<typeof ExportStackSchema>;

export const ExportResultSchema = z.object({
  format: z.string(),
  output_dir: z.string(),
  files_created: z.array(z.string()),
  data_exported: z.boolean(),
  data_size_bytes: z.number().optional(),
});
export type ExportResult = z.infer<typeof ExportResultSchema>;
