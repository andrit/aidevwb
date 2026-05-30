---
name: engine-chrome-v8
description: Embed the V8 JavaScript engine in native applications — isolates, contexts, compiling and running JS strings, exposing C++ functions to JavaScript, and safely sandboxing untrusted scripts
domain: infrastructure
type: cross-cutting
triggers:
  - "V8"
  - "Chrome V8"
  - "embed javascript"
  - "isolate"
  - "javascript engine"
  - "run JS from C++"
  - "V8 embedding"
  - "JS sandbox"
  - "node addon"
  - "native module"
---

# Embedding V8 (Chrome JavaScript Engine)

## When to use

Embed V8 when a native C++ application needs to:
- Execute user-supplied JavaScript (plugin systems, scripting layers, formula engines)
- Sandbox untrusted JS code so it cannot access the filesystem or network
- Bridge C++ domain objects to a JS scripting API without running a full Node.js process
- Build a REPL, rules engine, or template renderer that evaluates JS expressions

Do **not** embed V8 if you can run Node.js as a subprocess — it is far simpler. Embedding V8 is justified when you need sub-millisecond startup per script execution, need to share memory with C++ objects directly, or cannot spawn child processes.

For workbench projects: if you are writing a native Node.js addon (`.node` file), prefer **N-API** (`node-addon-api`) over raw V8 API — it is ABI-stable across Node versions. This skill covers raw V8 for cases where you are building a standalone binary.

## Prerequisites

- CMake 3.20+, a C++17 compiler (GCC 11+ or Clang 14+)
- V8 headers and libraries. Easiest path:
  - **libv8-dev** on Debian/Ubuntu: `apt-get install libv8-dev` (may be outdated)
  - **v8-build**: clone Chromium's `depot_tools`, run `fetch v8`, build — gives you the latest stable V8
  - **v8pp** or **v8-cmake** for CMake-friendly V8 builds
- Python 3 (required by V8's `gn` build system)

## Step 1 — V8 initialization (process-wide, once)

```cpp
// v8_init.h
#pragma once
#include <memory>
#include <v8.h>

class V8Platform {
public:
  V8Platform(const V8Platform&) = delete;
  V8Platform& operator=(const V8Platform&) = delete;

  static V8Platform& instance() {
    static V8Platform inst;
    return inst;
  }

  v8::Platform* platform() const { return platform_.get(); }

private:
  V8Platform() {
    // Must call before creating any Isolate.
    // Pass argv[0] (the binary path) so V8 can locate ICU data files.
    v8::V8::InitializeICUDefaultLocation(".");
    v8::V8::InitializeExternalStartupData(".");
    platform_ = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform_.get());
    v8::V8::Initialize();
  }

  ~V8Platform() {
    v8::V8::Dispose();
    v8::V8::DisposePlatform();
  }

  std::unique_ptr<v8::Platform> platform_;
};
```

Call `V8Platform::instance()` once at program startup before any V8 usage.

## Step 2 — Isolate creation and cleanup

An **Isolate** is an independent V8 heap — one JS VM. Create one per thread; never share across threads without locking. For a scripting plugin system, create one Isolate per plugin or reuse a pool.

```cpp
// isolate_guard.h — RAII wrapper for an Isolate
#pragma once
#include <v8.h>

class IsolateGuard {
public:
  explicit IsolateGuard(size_t heap_limit_bytes = 128 * 1024 * 1024 /* 128 MB */) {
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator =
      v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    params.constraints.set_max_old_generation_size_in_bytes(heap_limit_bytes);
    isolate_ = v8::Isolate::New(params);
    allocator_ = params.array_buffer_allocator;
  }

  ~IsolateGuard() {
    isolate_->Dispose();
    delete allocator_;
  }

  v8::Isolate* get() const { return isolate_; }
  v8::Isolate* operator->() const { return isolate_; }

private:
  v8::Isolate* isolate_ = nullptr;
  v8::ArrayBuffer::Allocator* allocator_ = nullptr;
};
```

## Step 3 — Context creation and running a JS string

A **Context** is the global object scope for a script. Create a new Context per untrusted script execution if you need isolation; reuse the same Context across calls if scripts share state.

```cpp
// runner.cpp — run a JavaScript string and return the string result
#include <string>
#include <stdexcept>
#include <v8.h>
#include "v8_init.h"
#include "isolate_guard.h"

std::string RunScript(const std::string& source_code) {
  // Ensure platform is initialized
  V8Platform::instance();

  IsolateGuard isolate_guard;
  v8::Isolate* isolate = isolate_guard.get();
  v8::Isolate::Scope isolate_scope(isolate);

  // Stack-allocated handle scope — frees all Local handles when it goes out of scope
  v8::HandleScope handle_scope(isolate);

  // Fresh context with empty global object (no access to C++ globals yet)
  v8::Local<v8::Context> context = v8::Context::New(isolate);
  v8::Context::Scope context_scope(context);

  // Compile the script
  v8::Local<v8::String> source = v8::String::NewFromUtf8(
    isolate, source_code.c_str(), v8::NewStringType::kNormal
  ).ToLocalChecked();

  v8::TryCatch try_catch(isolate);

  v8::Local<v8::Script> script;
  if (!v8::Script::Compile(context, source).ToLocal(&script)) {
    v8::String::Utf8Value error(isolate, try_catch.Exception());
    throw std::runtime_error(std::string("Compile error: ") + *error);
  }

  // Run the script
  v8::Local<v8::Value> result;
  if (!script->Run(context).ToLocal(&result)) {
    v8::String::Utf8Value error(isolate, try_catch.Exception());
    throw std::runtime_error(std::string("Runtime error: ") + *error);
  }

  // Convert result to string
  v8::String::Utf8Value utf8(isolate, result);
  return *utf8 ? *utf8 : "(null)";
}
```

Usage:

```cpp
std::string result = RunScript("2 + 2");           // "4"
std::string result = RunScript("JSON.stringify({x: 1})");  // "{\"x\":1}"
```

## Step 4 — Exposing a C++ function to JavaScript

This is the most common embedding pattern: give the JS sandbox a controlled API surface by binding C++ functions as JS globals.

```cpp
// native_bindings.cpp
#include <v8.h>
#include <iostream>

// C++ function exposed as JS global: log(message)
static void NativeLog(const v8::FunctionCallbackInfo<v8::Value>& args) {
  if (args.Length() < 1) return;
  v8::Isolate* isolate = args.GetIsolate();
  v8::HandleScope scope(isolate);

  v8::String::Utf8Value str(isolate, args[0]);
  std::cout << "[sandbox] " << *str << std::endl;
  // Return undefined implicitly
}

// C++ function: fetch(key) → looks up from a safe read-only store
static void NativeFetch(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  v8::HandleScope scope(isolate);
  v8::Local<v8::Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsString()) {
    isolate->ThrowException(
      v8::String::NewFromUtf8(isolate, "fetch(key): key must be a string")
        .ToLocalChecked()
    );
    return;
  }

  v8::String::Utf8Value key(isolate, args[0]);
  // Look up from a safe in-memory store (never expose filesystem or network here)
  std::string value = GetFromSafeStore(std::string(*key));

  args.GetReturnValue().Set(
    v8::String::NewFromUtf8(isolate, value.c_str()).ToLocalChecked()
  );
}

// Install bindings into a context before running untrusted code
void InstallBindings(v8::Isolate* isolate, v8::Local<v8::Context> context) {
  v8::HandleScope scope(isolate);
  v8::Local<v8::Object> global = context->Global();

  // global.log = NativeLog
  global->Set(context,
    v8::String::NewFromUtf8(isolate, "log").ToLocalChecked(),
    v8::Function::New(context, NativeLog).ToLocalChecked()
  ).Check();

  // global.fetch = NativeFetch
  global->Set(context,
    v8::String::NewFromUtf8(isolate, "fetch").ToLocalChecked(),
    v8::Function::New(context, NativeFetch).ToLocalChecked()
  ).Check();

  // Freeze or remove dangerous globals (optional — depends on trust model)
  // global->Delete(context, v8::String::NewFromUtf8(isolate, "eval").ToLocalChecked());
}
```

## Step 5 — Sandboxing untrusted scripts

To prevent untrusted JS from reading/writing arbitrary memory or spinning the CPU indefinitely:

```cpp
// sandbox_runner.cpp
#include <v8.h>
#include <atomic>
#include <thread>
#include <chrono>
#include "isolate_guard.h"
#include "native_bindings.h"

struct SandboxResult {
  bool ok;
  std::string value;
  std::string error;
};

SandboxResult RunSandboxed(
  const std::string& source,
  const std::unordered_map<std::string, std::string>& safe_globals,
  std::chrono::milliseconds timeout = std::chrono::milliseconds(1000)
) {
  IsolateGuard isolate_guard(8 * 1024 * 1024 /* 8 MB heap limit */);
  v8::Isolate* isolate = isolate_guard.get();

  // Set up CPU timeout: terminate execution after `timeout`
  std::atomic<bool> timed_out{false};
  std::thread watchdog([&]() {
    std::this_thread::sleep_for(timeout);
    if (!timed_out.exchange(true)) {
      isolate->TerminateExecution();
    }
  });

  SandboxResult result;
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);

    // Create context with ONLY our bindings — no Node.js globals, no require()
    v8::Local<v8::ObjectTemplate> global_tmpl = v8::ObjectTemplate::New(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate, nullptr, global_tmpl);
    v8::Context::Scope context_scope(context);

    // Install controlled API
    InstallBindings(isolate, context);
    LoadSafeGlobals(isolate, context, safe_globals);

    v8::TryCatch try_catch(isolate);
    v8::Local<v8::Script> script;
    v8::Local<v8::String> source_v8 =
      v8::String::NewFromUtf8(isolate, source.c_str()).ToLocalChecked();

    if (!v8::Script::Compile(context, source_v8).ToLocal(&script)) {
      result.ok = false;
      v8::String::Utf8Value err(isolate, try_catch.Exception());
      result.error = *err;
    } else {
      v8::Local<v8::Value> retval;
      if (!script->Run(context).ToLocal(&retval)) {
        result.ok = false;
        if (timed_out.load()) {
          result.error = "Script execution timed out";
        } else {
          v8::String::Utf8Value err(isolate, try_catch.Exception());
          result.error = *err;
        }
      } else {
        result.ok = true;
        v8::String::Utf8Value val(isolate, retval);
        result.value = *val;
      }
    }
  }

  timed_out.store(true);   // tell watchdog we're done even if not timed out
  watchdog.join();
  return result;
}
```

## Step 6 — CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.20)
project(v8_embed CXX)
set(CMAKE_CXX_STANDARD 17)

# Locate V8 (adjust paths for your build)
find_library(V8_LIB v8 HINTS /usr/lib /usr/local/lib)
find_path(V8_INCLUDE v8.h HINTS /usr/include /usr/local/include)

add_executable(sandbox
  main.cpp
  runner.cpp
  isolate_guard.h
  native_bindings.cpp
  sandbox_runner.cpp
)

target_include_directories(sandbox PRIVATE ${V8_INCLUDE})
target_link_libraries(sandbox
  ${V8_LIB}
  v8_libplatform
  pthread
  dl
)
```

## Checklist

- [ ] `V8Platform::instance()` called once at program startup before any Isolate is created
- [ ] Each Isolate has its own `ArrayBuffer::Allocator` — created with Isolate, deleted after `Dispose()`
- [ ] `HandleScope` opened before any `Local<>` handle is created in a scope
- [ ] `TryCatch` used around `Compile()` and `Run()` — V8 errors are silent without it
- [ ] Heap limit set on `CreateParams` (prevents sandbox OOM from taking down the process)
- [ ] CPU timeout watchdog terminates execution via `isolate->TerminateExecution()`
- [ ] Dangerous globals (`require`, `process`, `__dirname`) not present in sandboxed context
- [ ] `IsolateGuard` destructor calls `isolate->Dispose()` before deleting the allocator (order matters)

## Files involved

| File | Action |
|------|--------|
| `v8_init.h` | Create: process-wide V8Platform singleton |
| `isolate_guard.h` | Create: RAII Isolate wrapper with heap limit |
| `runner.cpp` | Create: compile and run a JS string, return string result |
| `native_bindings.cpp` | Create: install C++ functions as JS globals |
| `sandbox_runner.cpp` | Create: sandboxed execution with CPU timeout and heap limit |
| `CMakeLists.txt` | Create or update: link against V8 and v8_libplatform |

## Common mistakes

**Deleting the allocator before calling `Isolate::Dispose()`** — V8 uses the allocator during GC which can happen inside `Dispose()`. Always call `isolate->Dispose()` first, then `delete allocator_`. Reversing the order causes a use-after-free crash.

**Forgetting `HandleScope` in callback functions** — every `v8::FunctionCallback` that creates `Local<>` handles must open its own `HandleScope`. Without it, handles leak into the caller's scope and the GC can't reclaim them, eventually exhausting the heap.

**Using `ToLocalChecked()` without a `TryCatch`** — `ToLocalChecked()` calls `isolate->ThrowException()` and terminates the process if the `MaybeLocal` is empty. Always use `.ToLocal(&local)` and check the return value, or ensure a `TryCatch` is in scope.

**Sharing an Isolate across threads** — V8 Isolates are not thread-safe. Two threads calling into the same Isolate without a `v8::Locker` will corrupt the heap. Use one Isolate per thread, or acquire a `Locker` before entering the Isolate from a second thread.

**Not terminating execution in the watchdog when the script finishes** — if the watchdog thread sleeps for 1 second and the script finishes in 10ms, the watchdog will call `TerminateExecution()` 990ms later on a different script running in the reused Isolate. Always signal the watchdog when execution finishes normally, as shown in Step 5.
