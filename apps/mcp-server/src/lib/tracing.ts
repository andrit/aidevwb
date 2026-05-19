/**
 * Tracing — OpenTelemetry initialization and span helpers.
 *
 * Exports:
 *   initTracing()   — call once at startup to configure the OTel SDK
 *   withSpan()      — wrap any async function in a traced span
 *   getTracer()     — get the workbench tracer instance
 *   spanAttributes  — factory for common attribute sets
 *
 * Design:
 *   Services call withSpan() to trace their operations.
 *   The helper handles span lifecycle (start, set attributes, record errors, end).
 *   Services stay clean — no OTel imports in service code.
 */
import { trace, SpanStatusCode, type Tracer, type Span, type SpanOptions } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let _initialized = false;

/**
 * Initialize the OpenTelemetry SDK.
 * Call once at server startup, before any traced operations.
 * No-ops if already initialized or if OTEL_EXPORTER_OTLP_ENDPOINT is not set.
 */
export function initTracing(): void {
  if (_initialized) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log("Tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)");
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || "mcp-server";

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: "2.0.0",
  });

  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();
  _initialized = true;
  console.log(`Tracing enabled → ${endpoint} (service: ${serviceName})`);
}

/**
 * Get the workbench tracer. All spans use this tracer.
 */
export function getTracer(): Tracer {
  return trace.getTracer("ai-dev-workbench", "2.0.0");
}

/**
 * Wrap an async function in a traced span.
 *
 * Usage:
 *   const result = await withSpan("search.hybrid", { project: "nexus" }, async (span) => {
 *     span.setAttribute("query.top_k", 5);
 *     return doSearch(...);
 *   });
 *
 * The span is automatically:
 *   - Started before the function runs
 *   - Attributed with any initial attributes
 *   - Ended after the function completes (success or error)
 *   - Marked ERROR with the exception recorded if it throws
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      // Set initial attributes
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }

      const result = await fn(span);

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Factory for common span attribute sets.
 * Keeps attribute naming consistent across all services.
 */
export const spanAttrs = {
  /** Attributes for RAG operations */
  rag(project: string, operation: string): Record<string, string> {
    return {
      "workbench.project": project,
      "workbench.operation": operation,
      "workbench.category": "rag",
    };
  },

  /** Attributes for embedding operations */
  embedding(model: string, count: number): Record<string, string | number> {
    return {
      "embedding.model": model,
      "embedding.input_count": count,
      "workbench.category": "embedding",
    };
  },

  /** Attributes for LLM calls */
  llm(model: string, operation: string): Record<string, string> {
    return {
      "llm.model": model,
      "llm.operation": operation,
      "workbench.category": "llm",
    };
  },

  /** Attributes for agent tool calls */
  agentTool(project: string, toolName: string): Record<string, string> {
    return {
      "workbench.project": project,
      "agent.tool": toolName,
      "workbench.category": "agent",
    };
  },

  /** Attributes for memory operations */
  memory(project: string, operation: string, key: string): Record<string, string> {
    return {
      "workbench.project": project,
      "memory.operation": operation,
      "memory.key": key,
      "workbench.category": "memory",
    };
  },

  /** Attributes for conversation operations */
  conversation(project: string, operation: string): Record<string, string> {
    return {
      "workbench.project": project,
      "conversation.operation": operation,
      "workbench.category": "conversation",
    };
  },
};
