---
name: react-native
description: Build cross-platform iOS and Android apps with React Native and Expo — navigation, state management, typed workbench API client, offline support, and EAS production builds
domain: mobile
type: project-type
triggers:
  - "react native"
  - "expo"
  - "cross-platform mobile"
  - "React Native app"
  - "Expo project"
  - "iOS and Android"
  - "EAS build"
  - "mobile cross-platform"
---

# React Native (Cross-Platform Mobile)

## When to use

When you need a single codebase that ships to both iOS and Android. React Native renders native UI components (not a WebView), so it looks and feels native on both platforms. Expo managed workflow is the default — it handles the native build toolchain so you don't need Xcode or Android Studio until you need a custom native module.

Prefer React Native over PWA when: you need push notifications, biometrics, camera, Bluetooth, or App Store/Play Store distribution. Prefer Swift or Kotlin for apps with heavy platform-specific UI or real-time hardware access.

## Prerequisites

- Node.js 20+ on the host machine
- Expo CLI: `npm install -g expo-cli eas-cli`
- Expo Go app on a physical device, or Xcode Simulator (macOS) / Android Emulator
- Workbench running: backend API accessible at `http://<host-LAN-IP>:3200`
- `_base/skills/mobile-swift-ios` or `mobile-kotlin-android` if you also need native modules

## Project Setup

```bash
# Expo managed workflow (recommended — no Xcode/Android Studio needed until native modules)
npx create-expo-app@latest MyApp --template blank-typescript
cd MyApp
npx expo start          # opens Expo Go on device, or press i (iOS sim) / a (Android emu)

# Expo bare workflow (eject when you need custom native code)
npx create-expo-app@latest MyApp --template bare-minimum
```

## Workbench API Client

The mcp-server is available at port 3200 on the host. From device/emulator, the address differs:

```typescript
// src/lib/api.ts
import Constants from "expo-constants";

function getApiBase(): string {
  // Physical device or Expo Go: use your LAN IP (e.g. 192.168.1.x)
  // iOS Simulator: localhost works
  // Android Emulator: 10.0.2.2 maps to host localhost
  const override = Constants.expoConfig?.extra?.apiBase;
  if (override) return override;
  if (__DEV__) return "http://10.0.2.2:3200"; // change per environment
  return "https://api.yourapp.com";
}

const BASE = getApiBase();

export async function ragQuery(
  question: string,
  project = "default"
): Promise<{ answer: string; sources: string[] }> {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Project": project },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status}`);
  return res.json();
}

export async function memoryGet(key: string, project = "default"): Promise<unknown> {
  const res = await fetch(`${BASE}/memory/${encodeURIComponent(key)}`, {
    headers: { "X-Project": project },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`memory get failed: ${res.status}`);
  const data = await res.json();
  return data.value;
}
```

Set LAN IP in `app.config.ts`:
```typescript
// app.config.ts
export default {
  expo: {
    name: "MyApp",
    extra: {
      apiBase: process.env.API_BASE ?? "http://192.168.1.42:3200",
    },
  },
};
```

## Navigation (React Navigation)

```bash
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context
```

```typescript
// src/navigation/RootNavigator.tsx
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import SearchScreen from "../screens/SearchScreen";
import SettingsScreen from "../screens/SettingsScreen";

export type RootTabParamList = {
  Home: undefined;
  Search: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
```

## State Management

Use Zustand for most apps — minimal boilerplate, works with React Native without any polyfills:

```bash
npm install zustand
```

```typescript
// src/store/search.ts
import { create } from "zustand";
import { ragQuery } from "../lib/api";

interface SearchState {
  query: string;
  answer: string | null;
  sources: string[];
  loading: boolean;
  error: string | null;
  search: (q: string) => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  answer: null,
  sources: [],
  loading: false,
  error: null,
  search: async (q) => {
    set({ loading: true, error: null, query: q });
    try {
      const result = await ragQuery(q);
      set({ answer: result.answer, sources: result.sources, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  clear: () => set({ query: "", answer: null, sources: [], error: null }),
}));
```

## Screen Template

```typescript
// src/screens/SearchScreen.tsx
import React, { useState } from "react";
import {
  View, TextInput, FlatList, Text, ActivityIndicator,
  StyleSheet, Pressable, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSearchStore } from "../store/search";

export default function SearchScreen() {
  const [input, setInput] = useState("");
  const { answer, sources, loading, error, search, clear } = useSearchStore();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask the knowledgebase…"
          returnKeyType="search"
          onSubmitEditing={() => search(input)}
        />
        <Pressable style={styles.btn} onPress={() => search(input)}>
          <Text style={styles.btnText}>Go</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 24 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {answer && <Text style={styles.answer}>{answer}</Text>}

      {sources.length > 0 && (
        <FlatList
          data={sources}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => <Text style={styles.source}>• {item}</Text>}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  inputRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  btn: { backgroundColor: "#4f46e5", borderRadius: 8, padding: 10, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  answer: { marginTop: 16, fontSize: 15, lineHeight: 22 },
  source: { color: "#6b7280", fontSize: 13, marginTop: 4 },
  error: { color: "#ef4444", marginTop: 16 },
});
```

## Platform-Specific Code

```typescript
import { Platform } from "react-native";

// Method 1 — inline
const shadowStyle = Platform.select({
  ios:     { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1 },
  android: { elevation: 4 },
  default: {},
});

// Method 2 — file-level split
// MyComponent.ios.tsx   ← used on iOS
// MyComponent.android.tsx ← used on Android
// MyComponent.tsx       ← fallback
```

## Offline Support

```bash
npx expo install @react-native-async-storage/async-storage
```

```typescript
// src/lib/cache.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function cacheSet(key: string, value: unknown, ttlMs = 3600_000) {
  await AsyncStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + ttlMs }));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const { value, expires } = JSON.parse(raw);
  if (expires < Date.now()) { await AsyncStorage.removeItem(key); return null; }
  return value as T;
}
```

## Push Notifications (Expo)

```bash
npx expo install expo-notifications expo-device
```

```typescript
// src/lib/notifications.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return null;
  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}
```

## Production Build (EAS)

```bash
# Install EAS CLI and log in
npm install -g eas-cli
eas login

# Configure
eas build:configure

# Build
eas build --platform ios      # submits to Apple TestFlight
eas build --platform android  # produces .aab for Play Store
eas build --platform all      # both at once

# Submit directly to stores
eas submit --platform ios
eas submit --platform android
```

`eas.json` (auto-generated by `eas build:configure`):
```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}
```

## Checklist

- [ ] `API_BASE` configured correctly for each environment (LAN IP for dev, domain for prod)
- [ ] `10.0.2.2` used for Android emulator, not `localhost`
- [ ] `KeyboardAvoidingView` wrapping forms (different `behavior` per platform)
- [ ] All API calls handle loading, error, and empty states
- [ ] `AsyncStorage` used for offline cache — not in-memory only
- [ ] Push token registered and sent to backend on first launch
- [ ] `Platform.select` used for any shadow/elevation styling
- [ ] EAS build configured for development, preview, and production profiles
- [ ] `expo-constants` Extra config used for environment-specific API base URL

## Files involved

| File | Action |
|------|--------|
| `app.config.ts` | Create: Expo config with `extra.apiBase` |
| `src/lib/api.ts` | Create: typed workbench API client |
| `src/lib/cache.ts` | Create: AsyncStorage offline cache helpers |
| `src/lib/notifications.ts` | Create: push notification registration |
| `src/navigation/RootNavigator.tsx` | Create: navigation structure |
| `src/store/*.ts` | Create: Zustand stores per domain |
| `src/screens/*.tsx` | Create: one file per screen |
| `eas.json` | Create (auto): EAS build profiles |

## Common mistakes

**Using `localhost` on Android emulator** — `localhost` inside an Android emulator refers to the emulator itself, not the host machine. Use `10.0.2.2` to reach the host. On iOS Simulator, `localhost` works. On a physical device, you must use the host machine's LAN IP.

**Not wrapping forms in `KeyboardAvoidingView`** — the software keyboard slides over inputs on iOS. `behavior="padding"` on iOS and `behavior="height"` on Android. Without this, the text input the user is typing into gets hidden.

**Sharing StyleSheet objects across components** — `StyleSheet.create` does a one-time optimization at creation time. Don't pass style objects as props between components; each component should own its styles. Use a theme context for shared tokens instead.

**Forgetting to handle both platforms in shadows** — `box-shadow` CSS doesn't work in React Native. iOS uses `shadow*` props; Android uses `elevation`. Use `Platform.select` or a shared utility function.

**EAS build fails on first run because of native config drift** — after adding a new Expo module that has native code (e.g., `expo-camera`), run `npx expo prebuild` locally to regenerate `ios/` and `android/` directories before pushing to EAS. Skipping this causes opaque build failures.
