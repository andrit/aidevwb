---
name: lang-go-cloud
description: Go microservice patterns — goroutines + channels, gRPC server/client, cloud SDK integration (GCS, SQS), structured logging with slog, and workbench API client
domain: language
type: cross-cutting
triggers:
  - "golang"
  - "go language"
  - "goroutines"
  - "gRPC"
  - "go microservice"
  - "go service"
  - "go channels"
---

# Go (Cloud Microservices)

## When to use

Use this skill when building a workbench project as a Go microservice — typically a `data-pipeline`, `agent`, or `custom` project type where high throughput, gRPC APIs, or cloud SDK integration are requirements. Go's goroutine model maps well onto the workbench's concurrent ingestion and agent patterns. Use the structured logging and gRPC templates here as the starting point.

## Prerequisites

- Go 1.22+ (`go` available in container — add `golang:1.22-alpine` as a Docker stage)
- `buf` or `protoc` for compiling `.proto` files (optional if using REST)
- Cloud credentials mounted via Docker env vars (for GCS/SQS patterns)
- Workbench MCP server running for API calls (`make up`)

## go.mod Setup

```
module github.com/myorg/my-service

go 1.22

require (
    google.golang.org/grpc v1.63.0
    google.golang.org/protobuf v1.34.0
    cloud.google.com/go/storage v1.40.0
    github.com/aws/aws-sdk-go-v2 v1.26.0
    github.com/aws/aws-sdk-go-v2/service/sqs v1.31.0
    github.com/aws/aws-sdk-go-v2/config v1.27.0
)
```

Run: `go mod tidy` after editing.

## Project Layout

```
.
├── cmd/
│   └── server/
│       └── main.go          — entry point, wires up deps
├── internal/
│   ├── config/
│   │   └── config.go        — env var parsing
│   ├── service/
│   │   └── processor.go     — domain logic
│   ├── grpc/
│   │   └── server.go        — gRPC handler
│   └── workbench/
│       └── client.go        — MCP server HTTP client
├── proto/
│   └── processor/v1/
│       └── processor.proto  — service definition
├── go.mod
└── go.sum
```

## gRPC Service Template

### Proto Definition

```proto
// proto/processor/v1/processor.proto
syntax = "proto3";

package processor.v1;
option go_package = "github.com/myorg/my-service/gen/processor/v1;processorv1";

service ProcessorService {
  rpc Process(ProcessRequest) returns (ProcessResponse);
  rpc ProcessStream(ProcessRequest) returns (stream ProcessResponse);
}

message ProcessRequest {
  string project_name = 1;
  string input        = 2;
  map<string, string> metadata = 3;
}

message ProcessResponse {
  string id      = 1;
  string result  = 2;
  bool   done    = 3;
}
```

Compile: `buf generate` or `protoc --go_out=. --go-grpc_out=. proto/processor/v1/processor.proto`

### gRPC Server

```go
// internal/grpc/server.go
package grpc

import (
    "context"
    "fmt"
    "log/slog"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"

    processorv1 "github.com/myorg/my-service/gen/processor/v1"
    "github.com/myorg/my-service/internal/service"
)

type Server struct {
    processorv1.UnimplementedProcessorServiceServer
    svc    *service.Processor
    logger *slog.Logger
}

func NewServer(svc *service.Processor, logger *slog.Logger) *Server {
    return &Server{svc: svc, logger: logger}
}

func (s *Server) Process(
    ctx context.Context,
    req *processorv1.ProcessRequest,
) (*processorv1.ProcessResponse, error) {
    s.logger.InfoContext(ctx, "processing request",
        "project", req.ProjectName,
        "input_len", len(req.Input),
    )

    result, err := s.svc.Process(ctx, req.ProjectName, req.Input)
    if err != nil {
        s.logger.ErrorContext(ctx, "processing failed", "error", err)
        return nil, status.Errorf(codes.Internal, "processing failed: %v", err)
    }

    return &processorv1.ProcessResponse{
        Id:     fmt.Sprintf("result-%d", result.ID),
        Result: result.Output,
        Done:   true,
    }, nil
}

func (s *Server) ProcessStream(
    req *processorv1.ProcessRequest,
    stream processorv1.ProcessorService_ProcessStreamServer,
) error {
    ctx := stream.Context()
    chunks, err := s.svc.ProcessChunked(ctx, req.ProjectName, req.Input)
    if err != nil {
        return status.Errorf(codes.Internal, "%v", err)
    }

    for chunk := range chunks {
        if err := stream.Send(&processorv1.ProcessResponse{
            Result: chunk,
            Done:   false,
        }); err != nil {
            return err
        }
    }
    return stream.Send(&processorv1.ProcessResponse{Done: true})
}
```

### Entry Point with gRPC + Graceful Shutdown

```go
// cmd/server/main.go
package main

import (
    "context"
    "log/slog"
    "net"
    "os"
    "os/signal"
    "syscall"

    "google.golang.org/grpc"
    grpchandler "github.com/myorg/my-service/internal/grpc"
    "github.com/myorg/my-service/internal/service"
    "github.com/myorg/my-service/internal/workbench"
    processorv1 "github.com/myorg/my-service/gen/processor/v1"
)

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))

    wb := workbench.NewClient(
        envOr("MCP_SERVER_URL", "http://mcp-server:3100"),
        logger,
    )
    svc := service.NewProcessor(wb, logger)
    handler := grpchandler.NewServer(svc, logger)

    lis, err := net.Listen("tcp", ":50051")
    if err != nil {
        logger.Error("listen failed", "error", err)
        os.Exit(1)
    }

    srv := grpc.NewServer()
    processorv1.RegisterProcessorServiceServer(srv, handler)

    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    go func() {
        logger.Info("gRPC server listening", "addr", lis.Addr())
        if err := srv.Serve(lis); err != nil {
            logger.Error("serve error", "error", err)
        }
    }()

    <-ctx.Done()
    logger.Info("shutting down")
    srv.GracefulStop()
}

func envOr(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}
```

## Goroutine Worker Pool

Use when processing a queue of items concurrently with bounded parallelism:

```go
// internal/service/pool.go
package service

import (
    "context"
    "sync"
)

type WorkItem struct {
    ID    string
    Input string
}

type WorkResult struct {
    ID     string
    Output string
    Err    error
}

// WorkerPool processes items using n goroutines. Results arrive on the returned channel
// in completion order (not submission order). The returned channel closes when all items
// are processed. The caller must drain the channel.
func WorkerPool(
    ctx context.Context,
    concurrency int,
    items []WorkItem,
    fn func(context.Context, WorkItem) WorkResult,
) <-chan WorkResult {
    jobs := make(chan WorkItem, len(items))
    results := make(chan WorkResult, len(items))

    // Seed jobs
    for _, item := range items {
        jobs <- item
    }
    close(jobs)

    var wg sync.WaitGroup
    for range concurrency {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range jobs {
                if ctx.Err() != nil {
                    results <- WorkResult{ID: item.ID, Err: ctx.Err()}
                    continue
                }
                results <- fn(ctx, item)
            }
        }()
    }

    go func() {
        wg.Wait()
        close(results)
    }()

    return results
}
```

## Cloud Storage Client (GCS / S3 pattern)

```go
// internal/storage/gcs.go
package storage

import (
    "context"
    "fmt"
    "io"

    "cloud.google.com/go/storage"
    "google.golang.org/api/option"
)

type GCSClient struct {
    client *storage.Client
    bucket string
}

func NewGCSClient(ctx context.Context, bucket string) (*GCSClient, error) {
    // Uses GOOGLE_APPLICATION_CREDENTIALS env var automatically
    client, err := storage.NewClient(ctx, option.WithoutAuthentication())
    if err != nil {
        return nil, fmt.Errorf("creating GCS client: %w", err)
    }
    return &GCSClient{client: client, bucket: bucket}, nil
}

func (c *GCSClient) Upload(ctx context.Context, object string, r io.Reader) error {
    wc := c.client.Bucket(c.bucket).Object(object).NewWriter(ctx)
    if _, err := io.Copy(wc, r); err != nil {
        wc.Close()
        return fmt.Errorf("uploading %s: %w", object, err)
    }
    return wc.Close()
}

func (c *GCSClient) Download(ctx context.Context, object string) (io.ReadCloser, error) {
    rc, err := c.client.Bucket(c.bucket).Object(object).NewReader(ctx)
    if err != nil {
        return nil, fmt.Errorf("downloading %s: %w", object, err)
    }
    return rc, nil
}
```

## Workbench HTTP Client

```go
// internal/workbench/client.go
package workbench

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "log/slog"
    "net/http"
    "net/url"
)

type Client struct {
    base   string
    http   *http.Client
    logger *slog.Logger
}

func NewClient(base string, logger *slog.Logger) *Client {
    return &Client{base: base, http: &http.Client{}, logger: logger}
}

type QueryResponse struct {
    Results []struct {
        ID      string  `json:"id"`
        Content string  `json:"content"`
        Score   float64 `json:"score"`
    } `json:"results"`
    Total int `json:"total"`
}

func (c *Client) Query(ctx context.Context, project, query string, limit int) (*QueryResponse, error) {
    body, _ := json.Marshal(map[string]any{"query": query, "limit": limit})
    var result QueryResponse
    if err := c.post(ctx, fmt.Sprintf("/projects/%s/query", project), body, &result); err != nil {
        return nil, err
    }
    return &result, nil
}

func (c *Client) Remember(ctx context.Context, project, key, value string) error {
    body, _ := json.Marshal(map[string]string{"key": key, "value": value})
    return c.post(ctx, fmt.Sprintf("/projects/%s/memories", project), body, nil)
}

func (c *Client) post(ctx context.Context, path string, body []byte, out any) error {
    req, err := http.NewRequestWithContext(ctx, http.MethodPost,
        c.base+path, bytes.NewReader(body))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.http.Do(req)
    if err != nil {
        return fmt.Errorf("POST %s: %w", path, err)
    }
    defer resp.Body.Close()

    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        b, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("POST %s: HTTP %d: %s", path, resp.StatusCode, b)
    }

    if out != nil {
        return json.NewDecoder(resp.Body).Decode(out)
    }
    return nil
}

// URL-encode helper for memory keys with spaces/special chars
func encodeKey(key string) string {
    return url.PathEscape(key)
}
```

## Checklist

- [ ] `go.mod` module path matches repository path
- [ ] All errors wrapped with `fmt.Errorf("context: %w", err)` for stack-traceable chains
- [ ] Context propagated to every function that does I/O or blocks
- [ ] Goroutines either have a `sync.WaitGroup` or supervised channel — no fire-and-forget goroutine leaks
- [ ] gRPC server uses `GracefulStop()` on SIGINT/SIGTERM
- [ ] Structured logging uses `log/slog` with JSON output (not `fmt.Println`)
- [ ] Workbench client reads `MCP_SERVER_URL` from env, defaults to `http://mcp-server:3100`
- [ ] `go vet ./...` and `go build ./...` pass before committing

## Files involved

| File | Action |
|------|--------|
| `go.mod` | Create: module declaration and dependencies |
| `cmd/server/main.go` | Create: entry point, signal handling, gRPC setup |
| `proto/*/v1/*.proto` | Create: gRPC service definition |
| `internal/grpc/server.go` | Create: gRPC handler implementation |
| `internal/service/*.go` | Create: domain logic, worker pool |
| `internal/workbench/client.go` | Create: workbench HTTP client |
| `internal/storage/gcs.go` | Create: cloud storage client |

## Common mistakes

**Goroutine leak from unbounded spawning** — launching a goroutine per request without a semaphore or worker pool exhausts memory under load. Use the `WorkerPool` pattern with a fixed `concurrency` parameter, or use `golang.org/x/sync/semaphore`.

**Ignoring context cancellation in goroutines** — if the parent context is cancelled (client disconnect, deadline exceeded), goroutines that ignore `ctx.Err()` keep running. Always check `ctx.Err()` in hot loops and pass `ctx` to all blocking calls.

**`defer resp.Body.Close()` missing** — Go's HTTP client reuses connections only if the body is fully read and closed. A missing `Close()` causes connection pool exhaustion under load. Always `defer resp.Body.Close()` immediately after a successful `http.Do`.

**Untyped JSON with `interface{}`** — receiving API responses into `interface{}` and then type-asserting inline produces panics at runtime. Define concrete structs and use `json.Decoder` into them. The `QueryResponse` struct above is the pattern.

**`log/slog` vs `fmt.Println` mixing** — `fmt.Println` bypasses structured logging. All log output should go through `slog` so log aggregators (Loki, CloudWatch) can parse fields. Replace `fmt.Println`/`log.Printf` calls with `slog.InfoContext`/`slog.ErrorContext`.
