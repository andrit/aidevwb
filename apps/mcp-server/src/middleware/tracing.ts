/**
 * Request tracing middleware — creates a root span per HTTP request.
 *
 * Adds project name, route, method, and status code to each span.
 * All service spans (embedding, LLM, search) become children of the
 * request span because they run within its active context.
 */
import { FastifyInstance } from "fastify";
import { getTracer } from "../lib/tracing.js";
import { SpanStatusCode, type Span, context as otelContext } from "@opentelemetry/api";

export function registerTracingHooks(app: FastifyInstance): void {
  const tracer = getTracer();

  app.addHook("onRequest", (request, _reply, done) => {
    const spanName = `${request.method} ${request.url.split("?")[0]}`;
    const span = tracer.startSpan(spanName);

    span.setAttribute("http.method", request.method);
    span.setAttribute("http.url", request.url);
    span.setAttribute("http.route", request.url.split("?")[0]);

    // Attach project context if available
    const project =
      (request.params as Record<string, string>)?.project ??
      (request.headers["x-project"] as string) ??
      process.env.WORKBENCH_PROJECT;
    if (project) {
      span.setAttribute("workbench.project", project);
    }

    // Store span on request for later use
    (request as unknown as Record<string, Span>).__span = span;

    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const span = (request as unknown as Record<string, Span>).__span;
    if (span) {
      span.setAttribute("http.status_code", reply.statusCode);
      span.setAttribute("http.response_time_ms", Math.round(reply.elapsedTime));

      if (reply.statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${reply.statusCode}` });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
    }
    done();
  });

  app.addHook("onError", (request, _reply, error, done) => {
    const span = (request as unknown as Record<string, Span>).__span;
    if (span) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
    }
    done();
  });
}
