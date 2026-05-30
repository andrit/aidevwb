---
name: mobile-swift-ios
description: Build a Swift + SwiftUI iOS app that calls the workbench API — views, state management, async/await networking, CoreData local storage, and Swift Package Manager setup
domain: platform
type: cross-cutting
triggers:
  - "swift"
  - "iOS"
  - "SwiftUI"
  - "iPhone app"
  - "Apple development"
  - "iOS app"
  - "Xcode"
---

# Swift + SwiftUI iOS

## When to use

Activate when the user is building a native iOS app, prototyping an iPhone interface, or wants to connect an existing Swift project to the workbench API (RAG query, memory, conversations). This skill covers the full stack: SwiftUI views, observable state, async URLSession calls to the workbench, and CoreData for offline-first storage.

## Prerequisites

- Xcode 15+ installed on macOS (minimum macOS 13 Ventura for Xcode 15)
- Apple Developer account (free account is enough for Simulator; paid account required for physical device)
- Workbench running (`make up`) — the mcp-server exposes its API at `http://localhost:3100` from the host machine; inside the Docker network it is `http://mcp-server:3100`
- On a physical iPhone: the device and Mac must be on the same LAN, and you must use the Mac's LAN IP (e.g., `http://192.168.1.x:3100`) not `localhost`

## Package.swift Template

Create a new Xcode project (App template, SwiftUI interface, Swift language). If building a Swift package instead of an app target, use this `Package.swift`:

```swift
// Package.swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WorkbenchClient",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "WorkbenchClient", targets: ["WorkbenchClient"])
    ],
    dependencies: [],          // no external dependencies — URLSession only
    targets: [
        .target(
            name: "WorkbenchClient",
            path: "Sources/WorkbenchClient"
        ),
        .testTarget(
            name: "WorkbenchClientTests",
            dependencies: ["WorkbenchClient"],
            path: "Tests/WorkbenchClientTests"
        )
    ]
)
```

## Workbench API Client

Put this in `Sources/WorkbenchClient/WorkbenchAPI.swift` (or `WorkbenchAPI.swift` inside your Xcode target):

```swift
import Foundation

// MARK: - Models

struct RAGQueryRequest: Encodable {
    let query: String
    let topK: Int

    enum CodingKeys: String, CodingKey {
        case query
        case topK = "top_k"
    }
}

struct RAGQueryResult: Decodable, Identifiable {
    let id: String
    let content: String
    let score: Double
    let metadata: [String: String]
}

struct RAGQueryResponse: Decodable {
    let results: [RAGQueryResult]
    let query: String
}

struct IngestRequest: Encodable {
    let content: String
    let title: String
    let metadata: [String: String]
}

struct IngestResponse: Decodable {
    let documentId: String
    let chunkCount: Int

    enum CodingKeys: String, CodingKey {
        case documentId = "document_id"
        case chunkCount = "chunk_count"
    }
}

// MARK: - API Error

enum WorkbenchError: LocalizedError {
    case invalidURL
    case httpError(Int)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:          return "Invalid workbench URL"
        case .httpError(let code): return "HTTP \(code) from workbench"
        case .decodingError(let e): return "Decode error: \(e.localizedDescription)"
        case .networkError(let e):  return "Network error: \(e.localizedDescription)"
        }
    }
}

// MARK: - Client

actor WorkbenchAPI {
    static let shared = WorkbenchAPI(baseURL: "http://localhost:3100")

    private let baseURL: String
    private let projectName: String
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: String, projectName: String = "default") {
        self.baseURL = baseURL
        self.projectName = projectName
        self.session = URLSession.shared
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: RAG Query

    func query(_ text: String, topK: Int = 5) async throws -> RAGQueryResponse {
        let url = try makeURL("/api/projects/\(projectName)/rag/query")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = RAGQueryRequest(query: text, topK: topK)
        request.httpBody = try encoder.encode(body)
        return try await perform(request)
    }

    // MARK: Ingest

    func ingest(content: String, title: String, metadata: [String: String] = [:]) async throws -> IngestResponse {
        let url = try makeURL("/api/projects/\(projectName)/rag/ingest")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = IngestRequest(content: content, title: title, metadata: metadata)
        request.httpBody = try encoder.encode(body)
        return try await perform(request)
    }

    // MARK: Helpers

    private func makeURL(_ path: String) throws -> URL {
        guard let url = URL(string: baseURL + path) else {
            throw WorkbenchError.invalidURL
        }
        return url
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw WorkbenchError.networkError(error)
        }
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw WorkbenchError.httpError(http.statusCode)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw WorkbenchError.decodingError(error)
        }
    }
}
```

## ViewModel with @Observable

iOS 17+ uses `@Observable` macro. For iOS 16 compatibility use `ObservableObject` + `@Published`.

```swift
import Foundation
import Observation

@Observable
final class RAGViewModel {
    var query: String = ""
    var results: [RAGQueryResult] = []
    var isLoading: Bool = false
    var errorMessage: String?

    private let api: WorkbenchAPI

    init(api: WorkbenchAPI = .shared) {
        self.api = api
    }

    @MainActor
    func search() async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await api.query(query)
            results = response.results
        } catch {
            errorMessage = error.localizedDescription
            results = []
        }
    }
}
```

## SwiftUI View Template

```swift
import SwiftUI

struct RAGSearchView: View {
    @State private var viewModel = RAGViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack {
                    TextField("Ask the knowledgebase…", text: $viewModel.query)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.search() } }
                    Button {
                        Task { await viewModel.search() }
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .disabled(viewModel.isLoading)
                }
                .padding()

                // State
                if viewModel.isLoading {
                    ProgressView("Searching…")
                        .padding()
                    Spacer()
                } else if let error = viewModel.errorMessage {
                    ContentUnavailableView(
                        "Error",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                } else if viewModel.results.isEmpty && !viewModel.query.isEmpty {
                    ContentUnavailableView.search(text: viewModel.query)
                } else {
                    List(viewModel.results) { result in
                        ResultRow(result: result)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Knowledge Search")
        }
    }
}

struct ResultRow: View {
    let result: RAGQueryResult

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(result.content)
                .font(.body)
                .lineLimit(4)
            HStack {
                Label(String(format: "%.0f%%", result.score * 100), systemImage: "target")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if let source = result.metadata["source"] {
                    Text(source)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    RAGSearchView()
}
```

## CoreData Stack Setup

Add a `WorkbenchData.xcdatamodeld` file to your Xcode project with a `CachedResult` entity:

| Attribute | Type |
|-----------|------|
| `id` | String |
| `content` | String |
| `score` | Double |
| `query` | String |
| `cachedAt` | Date |

Then add the persistence controller:

```swift
import CoreData

struct PersistenceController {
    static let shared = PersistenceController()

    let container: NSPersistentContainer

    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "WorkbenchData")
        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }
        container.loadPersistentStores { _, error in
            if let error {
                fatalError("CoreData load failed: \(error)")
            }
        }
        container.viewContext.automaticallyMergesChangesFromParent = true
    }

    // Save RAG results to CoreData for offline access
    func cacheResults(_ results: [RAGQueryResult], forQuery query: String) {
        let ctx = container.newBackgroundContext()
        ctx.perform {
            // Clear old cached results for this query
            let fetch = NSFetchRequest<NSManagedObject>(entityName: "CachedResult")
            fetch.predicate = NSPredicate(format: "query == %@", query)
            (try? ctx.fetch(fetch))?.forEach { ctx.delete($0) }

            // Insert new results
            for result in results {
                let obj = NSEntityDescription.insertNewObject(forEntityName: "CachedResult", into: ctx)
                obj.setValue(result.id, forKey: "id")
                obj.setValue(result.content, forKey: "content")
                obj.setValue(result.score, forKey: "score")
                obj.setValue(query, forKey: "query")
                obj.setValue(Date(), forKey: "cachedAt")
            }
            try? ctx.save()
        }
    }
}
```

Wire it into the app entry point:

```swift
@main
struct MyApp: App {
    let persistence = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            RAGSearchView()
                .environment(\.managedObjectContext, persistence.container.viewContext)
        }
    }
}
```

## Info.plist — Allow Local HTTP

The workbench runs over plain HTTP. Add this to `Info.plist` (or the app target's Info tab in Xcode):

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
    <!-- For physical device on LAN, also add the host exception: -->
    <key>NSExceptionDomains</key>
    <dict>
        <key>192.168.1.100</key>  <!-- replace with your Mac's LAN IP -->
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```

## Checklist

- [ ] `Package.swift` or Xcode target set to iOS 17+ (or iOS 16 with `ObservableObject` fallback)
- [ ] `WorkbenchAPI` actor created with correct `baseURL`
- [ ] `Info.plist` has `NSAllowsLocalNetworking` set to `true`
- [ ] Physical device testing uses Mac's LAN IP, not `localhost`
- [ ] `@Observable` ViewModel drives SwiftUI view (no manual `objectWillChange`)
- [ ] All network calls use `async/await`, not completion handlers
- [ ] CoreData `NSPersistentContainer` initialized before first view renders
- [ ] App builds with zero warnings in Xcode (`Product > Build`)

## Files involved

| File | Action |
|------|--------|
| `Package.swift` | Create: Swift package manifest |
| `Sources/WorkbenchClient/WorkbenchAPI.swift` | Create: API client actor |
| `Sources/WorkbenchClient/RAGViewModel.swift` | Create: `@Observable` view model |
| `Views/RAGSearchView.swift` | Create: SwiftUI search view |
| `WorkbenchData.xcdatamodeld` | Create: CoreData model file (via Xcode) |
| `Persistence.swift` | Create: CoreData stack |
| `Info.plist` | Modify: add `NSAppTransportSecurity` exception |

## Common mistakes

**Using `localhost` on a physical device** — `localhost` resolves to the iPhone itself, not your Mac. When testing on a real device, find your Mac's LAN IP (`System Settings > Wi-Fi > Details`) and use that as `baseURL`. Both devices must be on the same network.

**Forgetting `NSAllowsLocalNetworking`** — iOS blocks plain HTTP by default (App Transport Security). Without the `Info.plist` exception, every request to `http://localhost:3100` silently fails with `NSURLErrorDomain -1022`. Add `NSAllowsLocalNetworking = true` for development.

**Calling async functions without `Task {}`** — SwiftUI button actions and `.onAppear` are synchronous contexts. Wrap `async` calls in `Task { await viewModel.search() }`. Calling `await` directly in a `Button` action label closure will not compile.

**Mutating `@Observable` properties off the main actor** — SwiftUI requires UI updates on the main thread. Mark state-mutating methods `@MainActor` or use `await MainActor.run { ... }` when updating results from a background task.

**CoreData `viewContext` used from a background thread** — always use `container.newBackgroundContext()` for background saves, and `container.viewContext` only on the main thread. Accessing `viewContext` from a detached Task without `@MainActor` will cause data races.
