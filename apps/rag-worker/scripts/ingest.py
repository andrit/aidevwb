"""
Standalone multimodal document ingestion.

Usage:
  docker exec -it rag-worker python scripts/ingest.py /workspace/documents/file.pdf

Uses RAG-Anything for PDFs/images, falls back to text chunking.
"""
import sys
import os

# Add parent directory for lib imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.worker import process_ingest

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/ingest.py <filepath>")
        sys.exit(1)

    filepath = sys.argv[1]
    print(f"📄 Ingesting: {filepath}")
    result = process_ingest(filepath)
    print(f"   Result: {result}")
