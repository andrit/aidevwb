---
name: mobile-kotlin-android
description: Build a Kotlin + Jetpack Compose Android app that calls the workbench API — Composables, ViewModel with StateFlow, Retrofit networking, Room local DB, and Gradle setup
domain: platform
type: cross-cutting
triggers:
  - "kotlin"
  - "android"
  - "Jetpack Compose"
  - "Android app"
  - "ViewModel"
  - "Compose"
  - "Android Studio"
---

# Kotlin + Jetpack Compose Android

## When to use

Activate when the user is building a native Android app or wants to connect an existing Kotlin project to the workbench API (RAG query, memory, conversations). This skill covers Composable UI, ViewModel + StateFlow state management, Retrofit for HTTP calls to the workbench, and Room for offline-first storage.

## Prerequisites

- Android Studio Hedgehog (2023.1) or later
- Android SDK 34 (compileSdk) with minSdk 26 (Android 8.0+)
- Workbench running (`make up`) — the mcp-server exposes its API at `http://10.0.2.2:3100` from the Android emulator; physical devices use the Mac/PC's LAN IP (e.g., `http://192.168.1.x:3100`)
- `package-lock.json` in `apps/mcp-server/` must exist before running `make up`; if missing, run `cd apps/mcp-server && npm install && cd ../..` first

## build.gradle.kts (app module)

```kotlin
// app/build.gradle.kts
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)                // for Room annotation processing
    alias(libs.plugins.hilt)               // optional: Hilt for DI
}

android {
    namespace = "com.example.workbenchclient"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.workbenchclient"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Compose BOM — pins all Compose versions together
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Lifecycle + ViewModel
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")

    // Activity
    implementation("androidx.activity:activity-compose:1.9.0")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Retrofit + OkHttp + Gson
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
```

## Retrofit Interface for Workbench API

```kotlin
// data/remote/WorkbenchService.kt
package com.example.workbenchclient.data.remote

import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

data class RagQueryRequest(
    val query: String,
    val top_k: Int = 5
)

data class RagResult(
    val id: String,
    val content: String,
    val score: Double,
    val metadata: Map<String, String> = emptyMap()
)

data class RagQueryResponse(
    val results: List<RagResult>,
    val query: String
)

data class IngestRequest(
    val content: String,
    val title: String,
    val metadata: Map<String, String> = emptyMap()
)

data class IngestResponse(
    val document_id: String,
    val chunk_count: Int
)

interface WorkbenchService {
    @POST("api/projects/{project}/rag/query")
    suspend fun query(
        @Path("project") project: String,
        @Body body: RagQueryRequest
    ): RagQueryResponse

    @POST("api/projects/{project}/rag/ingest")
    suspend fun ingest(
        @Path("project") project: String,
        @Body body: IngestRequest
    ): IngestResponse
}
```

## Retrofit Client Factory

```kotlin
// data/remote/WorkbenchClient.kt
package com.example.workbenchclient.data.remote

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object WorkbenchClient {
    // Emulator: 10.0.2.2 maps to host machine's localhost
    // Physical device: replace with your machine's LAN IP
    private const val BASE_URL = "http://10.0.2.2:3100/"

    private val okhttp = OkHttpClient.Builder()
        .addInterceptor(HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        })
        .build()

    val service: WorkbenchService = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(okhttp)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(WorkbenchService::class.java)
}
```

## ViewModel with StateFlow

```kotlin
// ui/search/SearchViewModel.kt
package com.example.workbenchclient.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.workbenchclient.data.remote.RagResult
import com.example.workbenchclient.data.remote.RagQueryRequest
import com.example.workbenchclient.data.remote.WorkbenchClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchUiState(
    val query: String = "",
    val results: List<RagResult> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class SearchViewModel(
    private val projectName: String = "default"
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    fun onQueryChange(newQuery: String) {
        _uiState.update { it.copy(query = newQuery) }
    }

    fun search() {
        val currentQuery = _uiState.value.query.trim()
        if (currentQuery.isEmpty()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val response = WorkbenchClient.service.query(
                    project = projectName,
                    body = RagQueryRequest(query = currentQuery)
                )
                _uiState.update { it.copy(results = response.results, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "Unknown error", isLoading = false) }
            }
        }
    }
}
```

## Composable View Template

```kotlin
// ui/search/SearchScreen.kt
package com.example.workbenchclient.ui.search

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.workbenchclient.data.remote.RagResult

@Composable
fun SearchScreen(
    viewModel: SearchViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize()) {
        // Search input
        OutlinedTextField(
            value = uiState.query,
            onValueChange = viewModel::onQueryChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            label = { Text("Ask the knowledgebase") },
            trailingIcon = {
                IconButton(onClick = viewModel::search) {
                    Icon(Icons.Default.Search, contentDescription = "Search")
                }
            },
            singleLine = true
        )

        when {
            uiState.isLoading -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            uiState.error != null -> {
                Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = "Error: ${uiState.error}",
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
            else -> {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(uiState.results, key = { it.id }) { result ->
                        ResultCard(result = result)
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
fun ResultCard(result: RagResult) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(
            text = result.content,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 4
        )
        Spacer(modifier = Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Score: ${"%.0f".format(result.score * 100)}%",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.secondary
            )
            result.metadata["source"]?.let { source ->
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = source,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.tertiary
                )
            }
        }
    }
}
```

## Room Entity Template

```kotlin
// data/local/CachedResult.kt
package com.example.workbenchclient.data.local

import androidx.room.*

@Entity(tableName = "cached_results")
data class CachedResultEntity(
    @PrimaryKey val id: String,
    val content: String,
    val score: Double,
    val query: String,
    val cachedAt: Long = System.currentTimeMillis()
)

@Dao
interface CachedResultDao {
    @Query("SELECT * FROM cached_results WHERE query = :query ORDER BY score DESC")
    suspend fun getForQuery(query: String): List<CachedResultEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(results: List<CachedResultEntity>)

    @Query("DELETE FROM cached_results WHERE query = :query")
    suspend fun deleteForQuery(query: String)

    @Query("DELETE FROM cached_results WHERE cachedAt < :cutoffMs")
    suspend fun evictOlderThan(cutoffMs: Long)
}

@Database(entities = [CachedResultEntity::class], version = 1, exportSchema = false)
abstract class WorkbenchDatabase : RoomDatabase() {
    abstract fun cachedResultDao(): CachedResultDao

    companion object {
        @Volatile private var INSTANCE: WorkbenchDatabase? = null

        fun getInstance(context: android.content.Context): WorkbenchDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    WorkbenchDatabase::class.java,
                    "workbench_cache"
                ).build().also { INSTANCE = it }
            }
    }
}
```

## AndroidManifest.xml — Allow Local HTTP

```xml
<!-- AndroidManifest.xml — inside <application> tag -->
<application
    ...
    android:usesCleartextTraffic="true">
    <!-- usesCleartextTraffic=true allows plain HTTP to the workbench on LAN -->
    ...
</application>

<!-- Also add internet permission before <application>: -->
<uses-permission android:name="android.permission.INTERNET" />
```

For production, replace `usesCleartextTraffic="true"` with a Network Security Config that whitelists only the workbench hostname.

## Checklist

- [ ] `build.gradle.kts` uses Compose BOM to manage all Compose library versions
- [ ] `compileSdk = 34`, `minSdk = 26` (or higher) set
- [ ] `WorkbenchService` interface uses `suspend` functions (not `Call<>`)
- [ ] Emulator URL uses `10.0.2.2`, not `localhost`
- [ ] `android:usesCleartextTraffic="true"` in `AndroidManifest.xml`
- [ ] `INTERNET` permission in `AndroidManifest.xml`
- [ ] ViewModel collected with `collectAsStateWithLifecycle()` (not `collectAsState()`)
- [ ] Room `@Database` version incremented on any schema change (add a Migration)
- [ ] KSP plugin added for Room annotation processing (`ksp` not `kapt`)

## Files involved

| File | Action |
|------|--------|
| `app/build.gradle.kts` | Create/modify: add Compose, Retrofit, Room, Coroutines deps |
| `data/remote/WorkbenchService.kt` | Create: Retrofit interface + request/response models |
| `data/remote/WorkbenchClient.kt` | Create: OkHttp + Retrofit factory |
| `ui/search/SearchViewModel.kt` | Create: ViewModel with StateFlow |
| `ui/search/SearchScreen.kt` | Create: Composable screen + result card |
| `data/local/CachedResult.kt` | Create: Room entity, DAO, and database |
| `AndroidManifest.xml` | Modify: add INTERNET permission and cleartext traffic flag |

## Common mistakes

**Using `10.0.2.2` on a physical device** — `10.0.2.2` is the emulator's alias for the host. A physical device on Wi-Fi has no knowledge of that address. Use `adb reverse tcp:3100 tcp:3100` to forward the port over USB, or switch the `BASE_URL` to your machine's LAN IP when testing on device.

**Using `kapt` instead of `ksp` for Room** — `kapt` (old annotation processor) is significantly slower and deprecated for new projects. Use the `ksp` Gradle plugin and `ksp("androidx.room:room-compiler:...")` instead of `kapt(...)`. Mixing them causes compile errors.

**Collecting StateFlow with `collectAsState()` instead of `collectAsStateWithLifecycle()`** — `collectAsState()` keeps the coroutine active even when the app is in the background, draining the battery. Always use `collectAsStateWithLifecycle()` from `lifecycle-runtime-compose`.

**Forgetting to bump Room `version` after a schema change** — adding or renaming a column without incrementing the `@Database(version = N)` and providing a `Migration` causes an `IllegalStateException` crash on first launch after an update. Add a migration or use `fallbackToDestructiveMigration()` during development only.

**Calling Retrofit from the main thread** — if `WorkbenchService` methods are not `suspend`, calling them on the main thread throws `NetworkOnMainThreadException`. Always use `suspend` functions and call them inside a `viewModelScope.launch {}` block.
