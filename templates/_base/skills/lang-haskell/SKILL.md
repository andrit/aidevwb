---
name: lang-haskell
description: Haskell for data pipeline projects — pure functions with type classes, Aeson for JSON parsing, Conduit for streaming data processing, and Cabal project setup
domain: language
type: cross-cutting
triggers:
  - "haskell"
  - "functional pipeline"
  - "Aeson"
  - "Conduit"
  - "pure functions"
  - "haskell pipeline"
  - "ghc"
---

# Haskell (Data Pipelines)

## When to use

Use this skill when building a workbench `data-pipeline` project in Haskell. Haskell's type system and lazy evaluation make it well-suited for transformation pipelines where correctness is critical — financial data, schema migrations, ETL jobs. Conduit provides constant-memory streaming for large datasets. Use this when the pipeline logic is complex enough that type-driven development would catch bugs before runtime.

## Prerequisites

- GHC 9.6+ via GHCup: `curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh`
- `cabal` 3.10+ (installed by GHCup)
- Or use Docker: `haskell:9.6-slim` base image
- Workbench MCP server running for ingestion (`make up`)

## Cabal Project Setup

```
my-pipeline/
├── my-pipeline.cabal
├── cabal.project
├── app/
│   └── Main.hs
└── src/
    ├── Pipeline/
    │   ├── Types.hs
    │   ├── Fetch.hs
    │   ├── Transform.hs
    │   └── Sink.hs
    └── Workbench/
        └── Client.hs
```

### my-pipeline.cabal

```cabal
cabal-version:      3.4
name:               my-pipeline
version:            0.1.0.0
synopsis:           Data pipeline for workbench
build-type:         Simple

common shared
    default-language:   GHC2021
    ghc-options:        -Wall -Wunused-imports -Werror
    default-extensions:
        OverloadedStrings
        DeriveGeneric
        DeriveAnyClass
        RecordWildCards
        LambdaCase
        TupleSections

library
    import:           shared
    hs-source-dirs:   src
    exposed-modules:
        Pipeline.Types
        Pipeline.Fetch
        Pipeline.Transform
        Pipeline.Sink
        Workbench.Client
    build-depends:
        base           >= 4.18  && < 5,
        aeson          >= 2.1   && < 3,
        conduit        >= 1.3   && < 2,
        conduit-extra  >= 1.3   && < 2,
        http-client    >= 0.7   && < 1,
        http-client-tls >= 0.3  && < 1,
        http-conduit   >= 2.3   && < 3,
        text           >= 2.0   && < 3,
        bytestring     >= 0.11  && < 1,
        time           >= 1.12  && < 2,
        containers     >= 0.6   && < 1,
        vector         >= 0.13  && < 1,
        unliftio       >= 0.2   && < 1

executable my-pipeline
    import:           shared
    main-is:          Main.hs
    hs-source-dirs:   app
    build-depends:
        base,
        my-pipeline
```

### cabal.project

```
packages: .
optimization: True
```

Build: `cabal build` | Run: `cabal run my-pipeline` | Test: `cabal test`

## Core Types

```haskell
-- src/Pipeline/Types.hs
module Pipeline.Types
    ( Record(..)
    , TransformError(..)
    , PipelineConfig(..)
    , Result
    ) where

import Data.Aeson (FromJSON, ToJSON)
import Data.Text  (Text)
import Data.Time  (UTCTime)
import GHC.Generics (Generic)

-- | A single record flowing through the pipeline
data Record = Record
    { recordId      :: Text
    , recordSource  :: Text
    , recordPayload :: [(Text, Text)]   -- key-value pairs
    , recordTime    :: UTCTime
    } deriving (Show, Eq, Generic)

instance FromJSON Record
instance ToJSON   Record

-- | Errors that can occur during transformation
data TransformError
    = MissingField  Text
    | InvalidValue  Text Text     -- field name, bad value
    | ParseError    Text          -- description
    deriving (Show, Eq)

-- | Pipeline configuration, loaded from environment
data PipelineConfig = PipelineConfig
    { configProject    :: Text
    , configMcpBaseUrl :: Text
    , configBatchSize  :: Int
    , configConcurrency :: Int
    } deriving (Show, Eq)

type Result a = Either TransformError a
```

## Aeson JSON Parsing

```haskell
-- src/Pipeline/Fetch.hs
module Pipeline.Fetch
    ( fetchBatch
    , parseApiResponse
    ) where

import Data.Aeson
import Data.Aeson.Types (Parser)
import qualified Data.ByteString.Lazy as BL
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time (parseTimeM, defaultTimeLocale)

import Pipeline.Types

-- | Parse a raw JSON ByteString into a list of Records
-- Returns Left with parse error message on failure
parseApiResponse :: BL.ByteString -> Either String [Record]
parseApiResponse = eitherDecode

-- | Custom FromJSON for a third-party API format
-- Maps their schema to our internal Record type
data ApiItem = ApiItem
    { apiId        :: Text
    , apiTimestamp :: Text          -- ISO8601 string
    , apiData      :: Object        -- arbitrary JSON object
    } deriving (Generic)

instance FromJSON ApiItem where
    parseJSON = withObject "ApiItem" $ \o -> ApiItem
        <$> o .: "id"
        <*> o .: "ts"
        <*> o .: "data"

-- | Convert external API item → internal Record
-- Uses explicit field mapping so schema drift is a compile error
fromApiItem :: ApiItem -> Parser Record
fromApiItem ApiItem{..} = do
    t <- parseTimeM True defaultTimeLocale "%Y-%m-%dT%H:%M:%SZ" (T.unpack apiTimestamp)
    pure Record
        { recordId      = apiId
        , recordSource  = "external-api"
        , recordPayload = []   -- populate from apiData fields as needed
        , recordTime    = t
        }

-- | Full parse pipeline: bytes → validated Records
fetchBatch :: BL.ByteString -> Either String [Record]
fetchBatch bytes = do
    items <- eitherDecode bytes :: Either String [ApiItem]
    -- Run the Parser-level conversions (field access, time parsing)
    case mapM (parseMaybe fromApiItem) items of
        Nothing  -> Left "Failed to convert one or more ApiItems"
        Just recs -> Right recs
```

## Conduit Streaming Pipeline

Conduit processes data in constant memory — a source produces items, transformers process them, a sink consumes them. The pipeline only pulls the next item when the sink is ready.

```haskell
-- src/Pipeline/Transform.hs
module Pipeline.Transform
    ( transformPipeline
    , validateRecord
    , enrichRecord
    , batchRecords
    ) where

import Conduit
import Data.Text (Text)
import qualified Data.Text as T
import Data.Maybe (mapMaybe)

import Pipeline.Types

-- | Full pipeline: source of raw records → validated → enriched → batched
-- This runs in constant memory regardless of input size
transformPipeline
    :: (MonadResource m)
    => ConduitT Record Void m ()    -- ^ sink (e.g. ingest to workbench)
    -> ConduitT () Record m ()      -- ^ source
    -> m ()
transformPipeline sink source =
    runConduit $
        source
        .| validateC
        .| enrichC
        .| batchC 100
        .| sink

-- | Validate each record; drop invalid ones with a warning
validateC :: (Monad m) => ConduitT Record Record m ()
validateC = awaitForever $ \r ->
    case validateRecord r of
        Right valid -> yield valid
        Left  err   -> return ()  -- log/metric in production: logWarning err

-- | Enrich records with derived fields
enrichC :: (Monad m) => ConduitT Record Record m ()
enrichC = mapC enrichRecord

-- | Collect n items into a list and yield the list
batchC :: (Monad m) => Int -> ConduitT Record [Record] m ()
batchC n = loop []
  where
    loop acc = do
        mx <- await
        case mx of
            Nothing -> unless (null acc) (yield (reverse acc))
            Just x  ->
                let acc' = x : acc
                in if length acc' >= n
                   then yield (reverse acc') >> loop []
                   else loop acc'

-- | Pure validation — easy to unit test
validateRecord :: Record -> Result Record
validateRecord r
    | T.null (recordId r)     = Left (MissingField "id")
    | T.null (recordSource r) = Left (MissingField "source")
    | otherwise               = Right r

-- | Pure enrichment — adds computed fields
enrichRecord :: Record -> Record
enrichRecord r = r
    { recordPayload = recordPayload r ++ [("processed", "true")]
    }
```

## Conduit Sink: Ingest to Workbench

```haskell
-- src/Pipeline/Sink.hs
module Pipeline.Sink
    ( workbenchSink
    ) where

import Conduit
import Control.Monad.IO.Class (liftIO)
import Data.Aeson (encode)

import Pipeline.Types
import Workbench.Client (WorkbenchClient, ingestBatch)

-- | Conduit sink: consume batches of Records and POST to workbench
workbenchSink
    :: (MonadIO m)
    => WorkbenchClient
    -> ConduitT [Record] Void m ()
workbenchSink client = awaitForever $ \batch -> liftIO $ do
    result <- ingestBatch client batch
    case result of
        Left err -> putStrLn $ "Ingest error: " <> show err
        Right n  -> putStrLn $ "Ingested " <> show n <> " records"
```

## Workbench HTTP Client

```haskell
-- src/Workbench/Client.hs
module Workbench.Client
    ( WorkbenchClient
    , newClient
    , ingestBatch
    , queryKnowledge
    ) where

import Data.Aeson
import Data.Text (Text)
import qualified Data.Text as T
import Network.HTTP.Simple
import qualified Data.ByteString.Char8 as BS

import Pipeline.Types

data WorkbenchClient = WorkbenchClient
    { clientBase    :: String
    , clientProject :: Text
    }

newClient :: String -> Text -> WorkbenchClient
newClient = WorkbenchClient

-- | POST a batch of records to /projects/:name/ingest
ingestBatch :: WorkbenchClient -> [Record] -> IO (Either String Int)
ingestBatch WorkbenchClient{..} records = do
    let path = "/projects/" <> T.unpack clientProject <> "/ingest"
        body = object ["records" .= records]
    req <- parseRequest ("POST " <> clientBase <> path)
    let req' = setRequestBodyJSON body
             $ setRequestHeader "Content-Type" ["application/json"]
             $ req
    response <- httpJSON req' :: IO (Response Value)
    let status = getResponseStatusCode response
    if status >= 200 && status < 300
        then pure $ Right (length records)
        else pure $ Left $ "HTTP " <> show status

-- | POST query to /projects/:name/query
queryKnowledge :: WorkbenchClient -> Text -> Int -> IO (Either String [Value])
queryKnowledge WorkbenchClient{..} q limit = do
    let path = "/projects/" <> T.unpack clientProject <> "/query"
        body = object ["query" .= q, "limit" .= limit]
    req <- parseRequest ("POST " <> clientBase <> path)
    let req' = setRequestBodyJSON body req
    response <- httpJSON req' :: IO (Response Value)
    let status = getResponseStatusCode response
    if status >= 200 && status < 300
        then case getResponseBody response ^? key "results" of
                Just (Array arr) -> pure $ Right (toList arr)
                _                -> pure $ Left "unexpected response shape"
        else pure $ Left $ "HTTP " <> show status
```

## Entry Point

```haskell
-- app/Main.hs
module Main where

import Conduit
import System.Environment (lookupEnv)
import Data.Maybe (fromMaybe)
import qualified Data.Text as T

import Pipeline.Types
import Pipeline.Transform
import Pipeline.Sink
import Workbench.Client

main :: IO ()
main = do
    mcpUrl  <- fromMaybe "http://mcp-server:3100" <$> lookupEnv "MCP_SERVER_URL"
    project <- maybe (error "WORKBENCH_PROJECT required") T.pack
                 <$> lookupEnv "WORKBENCH_PROJECT"

    let client = newClient mcpUrl project
        source = yieldMany []  -- replace with real source: file, HTTP, DB

    runConduit $
        source
        .| validateC
        .| enrichC
        .| batchC 100
        .| workbenchSink client
```

## Checklist

- [ ] `cabal.project` exists alongside `*.cabal` file
- [ ] All domain types derived from `Generic` with `FromJSON`/`ToJSON` instances
- [ ] Pure transformation functions (`validateRecord`, `enrichRecord`) unit tested without I/O
- [ ] Conduit pipeline composes source → transform → sink with no intermediate lists
- [ ] `Either TransformError a` used for validation errors (not exceptions)
- [ ] Workbench client reads `MCP_SERVER_URL` from env
- [ ] `-Wall -Werror` in ghc-options — zero warnings compile
- [ ] `cabal build` succeeds before committing

## Files involved

| File | Action |
|------|--------|
| `my-pipeline.cabal` | Create: library + executable with deps |
| `cabal.project` | Create: build settings |
| `src/Pipeline/Types.hs` | Create: core data types, FromJSON/ToJSON |
| `src/Pipeline/Fetch.hs` | Create: Aeson parsing logic |
| `src/Pipeline/Transform.hs` | Create: Conduit transformers |
| `src/Pipeline/Sink.hs` | Create: Conduit sink to workbench |
| `src/Workbench/Client.hs` | Create: HTTP client |
| `app/Main.hs` | Create: entry point, wires pipeline |

## Common mistakes

**Forgetting `OverloadedStrings`** — string literals in Haskell are `String` (= `[Char]`) by default. Aeson and Text require `Text`. Add `{-# LANGUAGE OverloadedStrings #-}` or `OverloadedStrings` in `default-extensions` in Cabal, or you'll get `Couldn't match type 'Char' with 'Text'` everywhere.

**Lazy I/O in a streaming pipeline** — using `readFile` or `BL.readFile` for large inputs loads the entire file into memory defeating the purpose of Conduit. Use `sourceFile` from `conduit-extra` which streams in chunks.

**`fromJust` on Aeson lookups** — `obj ^? key "field"` returns `Maybe Value`. Calling `fromJust` on it crashes on unexpected API responses. Use `withObject`/`.:` in a `Parser` so failures produce descriptive error messages, not runtime panics.

**Not separating pure logic from IO** — Haskell's type system enforces this, but it's easy to reach for `IO` prematurely. Keep `validateRecord` and `enrichRecord` as pure functions returning `Result`. Test them with `HUnit` without any mocking framework.

**Missing `buildDepends` version bounds** — Cabal will use the latest versions during fresh installs, which can break the build months later. Always specify `>= x.y && < (x+1)` bounds for each dependency. `cabal gen-bounds` can generate them from your current environment.
