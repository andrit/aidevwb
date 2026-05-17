/**
 * Text chunking — pure function, no side effects.
 * Split text into overlapping pieces for embedding.
 */

export interface ChunkOptions {
  size: number;
  overlap: number;
}

const DEFAULTS: ChunkOptions = { size: 500, overlap: 50 };

export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {}
): string[] {
  const { size, overlap } = { ...DEFAULTS, ...options };

  if (size <= 0) throw new Error("Chunk size must be positive");
  if (overlap < 0) throw new Error("Overlap must be non-negative");
  if (overlap >= size) throw new Error("Overlap must be less than chunk size");

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
    start += size - overlap;
  }
  return chunks;
}
