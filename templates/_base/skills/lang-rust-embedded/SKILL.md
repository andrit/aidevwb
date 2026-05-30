---
name: lang-rust-embedded
description: Rust for IoT and embedded systems — ownership model essentials, no_std basics, Embassy async runtime for microcontrollers, Tokio for systems services, and MQTT with rumqttc
domain: language
type: cross-cutting
triggers:
  - "rust"
  - "embedded rust"
  - "no_std"
  - "Embassy"
  - "IoT firmware"
  - "microcontroller"
  - "rust embedded"
  - "cargo embedded"
---

# Rust (Embedded / IoT)

## When to use

Use this skill when building firmware for microcontrollers with Embassy, or systems-level services with Tokio that connect IoT devices to the workbench. Covers two distinct targets: (1) bare-metal `no_std` firmware running on ARM Cortex-M (Embassy), and (2) `std` services running on Linux (Tokio + MQTT) that bridge device data to the workbench MCP server. Choose the right target before writing any code.

## Prerequisites

- Rust 1.77+ with `rustup` (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- For embedded targets: `rustup target add thumbv7em-none-eabihf` (Cortex-M4/M7)
- For systems services: standard Rust toolchain (no extra targets)
- `probe-rs` for flashing: `cargo install probe-rs-tools` (embedded only)
- Workbench MCP server running for bridging device data (`make up`)

## Cargo.toml for Embedded (no_std, Embassy)

```toml
[package]
name = "my-firmware"
version = "0.1.0"
edition = "2021"

[dependencies]
embassy-executor  = { version = "0.5", features = ["task-arena-size-32768", "arch-cortex-m", "executor-thread", "defmt"] }
embassy-time      = { version = "0.3", features = ["defmt", "defmt-timestamp-uptime"] }
embassy-stm32     = { version = "0.1", features = ["stm32f411ce", "time-driver-any", "memory-x", "defmt", "unstable-pac", "exti"] }
embassy-net       = { version = "0.4", features = ["defmt", "tcp", "dhcpv4", "medium-ethernet"] }
defmt             = "0.3"
defmt-rtt         = "0.4"
panic-probe       = { version = "0.3", features = ["print-defmt"] }
heapless          = "0.8"
cortex-m          = { version = "0.7", features = ["inline-asm"] }
cortex-m-rt       = "0.7"

[profile.release]
opt-level        = "s"
debug            = true
lto              = true
codegen-units    = 1

[profile.dev]
opt-level        = "s"
debug            = true
```

## Cargo.toml for Systems Service (std, Tokio + MQTT)

```toml
[package]
name = "iot-bridge"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio       = { version = "1", features = ["full"] }
rumqttc     = { version = "0.24", features = ["use-rustls"] }
reqwest     = { version = "0.12", features = ["json"] }
serde       = { version = "1", features = ["derive"] }
serde_json  = "1"
anyhow      = "1"
tracing     = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

## Embassy Async Task Template (Embedded)

Embassy is an async runtime for bare-metal. Each `#[embassy_executor::task]` is a cooperative coroutine — no preemption, no heap required.

```rust
// src/main.rs — Embassy firmware for STM32F411
#![no_std]
#![no_main]

use defmt::*;
use embassy_executor::Spawner;
use embassy_stm32::gpio::{Level, Output, Speed};
use embassy_stm32::usart::{Config as UartConfig, Uart};
use embassy_stm32::{bind_interrupts, peripherals, usart};
use embassy_time::{Duration, Timer};
use heapless::String;
use {defmt_rtt as _, panic_probe as _};

bind_interrupts!(struct Irqs {
    USART1 => usart::InterruptHandler<peripherals::USART1>;
});

#[embassy_executor::main]
async fn main(spawner: Spawner) {
    let p = embassy_stm32::init(Default::default());
    info!("Firmware started");

    // Spawn independent tasks — they run concurrently via cooperative scheduling
    spawner.spawn(blink_task(p.PC13.into())).unwrap();
    spawner.spawn(sensor_task(p.USART1, p.PA9, p.PA10)).unwrap();
}

// Task: blink LED at 1 Hz
#[embassy_executor::task]
async fn blink_task(pin: embassy_stm32::peripherals::PC13) {
    let mut led = Output::new(pin, Level::High, Speed::Low);
    loop {
        led.set_low();
        Timer::after(Duration::from_millis(500)).await;
        led.set_high();
        Timer::after(Duration::from_millis(500)).await;
    }
}

// Task: read sensor data over UART and queue for transmission
#[embassy_executor::task]
async fn sensor_task(
    usart: embassy_stm32::peripherals::USART1,
    tx: embassy_stm32::peripherals::PA9,
    rx: embassy_stm32::peripherals::PA10,
) {
    let mut config = UartConfig::default();
    config.baudrate = 115200;
    let mut uart = Uart::new(usart, rx, tx, Irqs, tx, rx, config).unwrap();

    let mut buf = [0u8; 64];
    loop {
        match uart.read_until_idle(&mut buf).await {
            Ok(n) => {
                let reading = &buf[..n];
                info!("Sensor reading: {:?}", reading);
                // In a real device: push to a heapless queue for the network task
            }
            Err(e) => warn!("UART read error: {:?}", e),
        }
    }
}
```

## MQTT Publish/Subscribe Pattern (Tokio, rumqttc)

The systems service runs on Linux and bridges device data to the workbench:

```rust
// src/main.rs — IoT bridge service (std + Tokio)
use anyhow::{Context, Result};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time;
use tracing::{error, info, warn};

#[derive(Debug, Serialize, Deserialize)]
struct SensorReading {
    device_id: String,
    temperature: f64,
    humidity: f64,
    timestamp_ms: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .json()
        .init();

    let broker_url = std::env::var("MQTT_BROKER").unwrap_or_else(|_| "localhost".into());
    let wb_url = std::env::var("MCP_SERVER_URL")
        .unwrap_or_else(|_| "http://mcp-server:3100".into());
    let project = std::env::var("WORKBENCH_PROJECT").context("WORKBENCH_PROJECT required")?;

    let mut opts = MqttOptions::new("iot-bridge", &broker_url, 1883);
    opts.set_keep_alive(Duration::from_secs(30));
    opts.set_clean_session(true);

    let (client, mut event_loop) = AsyncClient::new(opts, 16);

    // Subscribe to all device sensor topics
    client
        .subscribe("devices/+/sensors/#", QoS::AtLeastOnce)
        .await?;
    info!("Subscribed to MQTT topics");

    let wb = WorkbenchClient::new(wb_url, project);

    loop {
        match event_loop.poll().await {
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                let topic = publish.topic.clone();
                match serde_json::from_slice::<SensorReading>(&publish.payload) {
                    Ok(reading) => {
                        info!("Received reading from {}", reading.device_id);
                        if let Err(e) = wb.ingest_reading(&reading, &topic).await {
                            error!("Failed to ingest reading: {:#}", e);
                        }
                    }
                    Err(e) => warn!("Failed to parse payload on {}: {}", topic, e),
                }
            }
            Ok(_) => {} // ConnAck, SubAck, PingResp — ignore
            Err(e) => {
                error!("MQTT error: {:#}", e);
                time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}
```

## Workbench Client (Tokio, reqwest)

```rust
// src/workbench.rs
use anyhow::{Context, Result};
use serde_json::json;

pub struct WorkbenchClient {
    base: String,
    project: String,
    http: reqwest::Client,
}

impl WorkbenchClient {
    pub fn new(base: String, project: String) -> Self {
        Self {
            base,
            project,
            http: reqwest::Client::new(),
        }
    }

    pub async fn ingest_reading(
        &self,
        reading: &super::SensorReading,
        topic: &str,
    ) -> Result<()> {
        // Ingest as a document into the RAG pipeline
        let body = json!({
            "content": serde_json::to_string(reading)?,
            "metadata": { "topic": topic, "device_id": reading.device_id }
        });

        let res = self
            .http
            .post(format!("{}/projects/{}/ingest", self.base, self.project))
            .json(&body)
            .send()
            .await
            .context("sending ingest request")?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            anyhow::bail!("ingest failed: HTTP {}: {}", status, text);
        }
        Ok(())
    }

    pub async fn publish_to_bus(&self, channel: &str, payload: serde_json::Value) -> Result<()> {
        let body = json!({ "channel": channel, "payload": payload });
        let res = self
            .http
            .post(format!(
                "{}/projects/{}/bus/publish",
                self.base, self.project
            ))
            .json(&body)
            .send()
            .await?;

        res.error_for_status()?;
        Ok(())
    }
}
```

## Ownership Patterns for Embedded

```rust
// Pass by reference when the callee only reads:
fn process(data: &[u8]) -> u16 { /* ... */ }

// Pass by mutable reference when the callee modifies in place:
fn fill_buffer(buf: &mut [u8; 64]) { /* ... */ }

// Return owned data from constructors:
fn parse_reading(raw: &[u8]) -> Option<SensorReading> {
    // Returns owned SensorReading or None — no allocation needed with heapless
    None
}

// Use heapless::String instead of std::String in no_std:
use heapless::String;
let mut s: String<32> = String::new();
s.push_str("hello").ok(); // Result — capacity errors are checked, not panicked
```

## Checklist

- [ ] Embedded target: `#![no_std]` + `#![no_main]` at crate root
- [ ] `defmt` used for logging in embedded (not `println!` — not available in `no_std`)
- [ ] Embassy tasks use `#[embassy_executor::task]` and are spawned from `main`
- [ ] No dynamic allocation in embedded (`heapless` collections used instead of `Vec`/`String`)
- [ ] Systems service: `anyhow::Result` used for error propagation, not `unwrap()` in handlers
- [ ] MQTT reconnect loop handles `Err` from `event_loop.poll()` — does not `unwrap()`
- [ ] Workbench client reads `MCP_SERVER_URL` from env, defaults to `http://mcp-server:3100`
- [ ] `cargo build --release` (embedded: with target flag) passes without warnings

## Files involved

| File | Action |
|------|--------|
| `Cargo.toml` | Create: Embassy deps (embedded) or Tokio+rumqttc deps (service) |
| `src/main.rs` | Create: Embassy main (embedded) or Tokio main (service) |
| `src/workbench.rs` | Create: reqwest-based workbench client (service only) |
| `.cargo/config.toml` | Create: target triple + linker for embedded |
| `memory.x` | Create: MCU flash/RAM regions (embedded only) |

## Common mistakes

**Using `std::println!` in `no_std` firmware** — `println!` requires the standard library. In `no_std`, use `defmt::info!` which routes output over RTT (Real-Time Transfer). The compile error is `macro not found in this scope` — switch to `defmt` macros.

**Blocking `std` function in an Embassy task** — Embassy tasks are cooperative. Calling a blocking function (file I/O, `std::thread::sleep`) starves all other tasks. Use `embassy_time::Timer::after` for delays and only Embassy-aware I/O drivers inside tasks.

**Not sizing `heapless` collections at compile time** — `heapless::Vec<u8, 64>` has capacity 64. Pushing the 65th element returns `Err` silently if you call `.push().ok()`. Decide the max capacity upfront and handle the error case explicitly — don't `.unwrap()` on heapless push.

**MQTT reconnect not handled** — `rumqttc`'s `event_loop.poll()` returns `Err` on connection loss. If you `unwrap()` or `?`-propagate out of the loop, the bridge exits instead of reconnecting. Always match on `Err`, log it, sleep, and continue the loop.

**Cargo.lock not committed for firmware** — unlike library crates, binary crates (including firmware) should commit `Cargo.lock` so builds are reproducible. Add `Cargo.lock` to git even if the project `.gitignore` would otherwise exclude it.
