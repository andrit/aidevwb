/**
 * Content hashing — pure function for SHA256 fingerprinting.
 * Used for document change detection (skip re-ingestion if unchanged).
 */
import { createHash } from "crypto";

export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}
