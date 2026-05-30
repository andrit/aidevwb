---
name: iot-raspberry-pi-arduino
description: Read sensors on Raspberry Pi (Python, GPIO, I2C/smbus2) and Arduino (C++), publish data via MQTT, and bridge MQTT messages to the workbench message bus and RAG ingest API
domain: iot
type: cross-cutting
triggers:
  - "Raspberry Pi"
  - "Arduino"
  - "GPIO"
  - "I2C"
  - "microcontroller"
  - "embedded"
  - "IoT hardware"
  - "RPi"
  - "sensor"
  - "MQTT"
---

# Raspberry Pi + Arduino IoT Integration

## When to use

Activate when the user is reading hardware sensors, controlling GPIO pins on a Raspberry Pi, programming an Arduino, or bridging physical sensor data into the workbench knowledgebase. This skill covers: Raspberry Pi GPIO input/output (Python + RPi.GPIO), I2C sensor reading (Python + smbus2), Arduino C++ sketches with Serial output, MQTT publishing from the Pi, and a Python bridge that forwards MQTT messages to the workbench message bus and RAG ingest API.

## Prerequisites

- Raspberry Pi 4 (or Pi 3B+) running Raspberry Pi OS Bullseye or Bookworm (64-bit recommended)
- Python 3.11+ on the Pi: `python3 --version`
- Required Python packages: `pip3 install RPi.GPIO smbus2 paho-mqtt requests`
- Arduino IDE 2.x or arduino-cli installed on the Pi or development machine
- Mosquitto MQTT broker running on the Pi: `sudo apt install mosquitto mosquitto-clients && sudo systemctl enable mosquitto`
- Workbench running on the same network — Pi connects to `http://<host-machine-ip>:3100`

## Raspberry Pi GPIO Template (Python)

```python
# gpio_sensor.py
"""
Read a PIR motion sensor on GPIO pin 17 (input) and control an LED on GPIO pin 27 (output).
Publishes motion events to MQTT.
"""
import time
import json
import logging
import RPi.GPIO as GPIO
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)

# Pin assignments (BCM numbering)
PIR_PIN = 17
LED_PIN = 27
MQTT_BROKER = 'localhost'
MQTT_PORT = 1883
MQTT_TOPIC = 'sensors/motion'

# MQTT client setup
mqtt_client = mqtt.Client(client_id='rpi_gpio_sensor')
mqtt_client.connect(MQTT_BROKER, MQTT_PORT)
mqtt_client.loop_start()  # non-blocking background thread

# GPIO setup
GPIO.setmode(GPIO.BCM)    # use Broadcom pin numbering
GPIO.setup(PIR_PIN, GPIO.IN)
GPIO.setup(LED_PIN, GPIO.OUT, initial=GPIO.LOW)


def on_motion_detected(channel: int):
    """Callback fired on rising edge from PIR sensor."""
    state = GPIO.input(channel)
    GPIO.output(LED_PIN, state)  # mirror PIR state to LED

    payload = json.dumps({
        'pin': channel,
        'state': 'detected' if state else 'cleared',
        'timestamp': time.time(),
    })
    mqtt_client.publish(MQTT_TOPIC, payload, qos=1)
    logger.info('Motion %s → MQTT %s', 'detected' if state else 'cleared', MQTT_TOPIC)


# Register edge-triggered callback (both edges to detect start and end of motion)
GPIO.add_event_detect(PIR_PIN, GPIO.BOTH, callback=on_motion_detected, bouncetime=300)

try:
    logger.info('GPIO sensor running — waiting for motion on pin %d', PIR_PIN)
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    logger.info('Shutting down')
finally:
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    GPIO.cleanup()
```

## I2C Sensor Read (Python + smbus2)

Example: reading a BMP280 temperature/pressure sensor at I2C address `0x76`.

```python
# i2c_bmp280.py
"""
Read temperature and pressure from a BMP280 over I2C.
Publishes readings to MQTT every 5 seconds.
Enable I2C on the Pi: sudo raspi-config → Interface Options → I2C → Enable
Verify the device is visible: i2cdetect -y 1  (should show 0x76 or 0x77)
"""
import time
import json
import struct
import logging
import smbus2
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)

I2C_BUS = 1          # Pi 4 uses bus 1
BMP280_ADDR = 0x76   # jumper to 0x77 if SDO pin is high
MQTT_BROKER = 'localhost'
MQTT_TOPIC = 'sensors/environment'


def read_calibration(bus: smbus2.SMBus) -> dict:
    """Read factory calibration data from BMP280 registers."""
    calib = bus.read_i2c_block_data(BMP280_ADDR, 0x88, 24)
    dig_T1, dig_T2, dig_T3 = struct.unpack_from('<Hhh', bytes(calib), 0)
    dig_P1, *dig_Px = struct.unpack_from('<Hhhhhhhhh', bytes(calib), 6)
    return {'T1': dig_T1, 'T2': dig_T2, 'T3': dig_T3,
            'P1': dig_P1, 'Px': dig_Px}


def compensate_temperature(raw: int, calib: dict) -> float:
    """BMP280 temperature compensation formula from datasheet."""
    T1, T2, T3 = calib['T1'], calib['T2'], calib['T3']
    var1 = (raw / 16384.0 - T1 / 1024.0) * T2
    var2 = (raw / 131072.0 - T1 / 8192.0) ** 2 * T3
    return (var1 + var2) / 5120.0


def read_bmp280(bus: smbus2.SMBus, calib: dict) -> dict:
    """Trigger a forced measurement and return temperature + pressure."""
    # Write config: osrs_t=1x, osrs_p=1x, mode=forced (0b00100101)
    bus.write_byte_data(BMP280_ADDR, 0xF4, 0x25)
    time.sleep(0.1)  # wait for measurement

    data = bus.read_i2c_block_data(BMP280_ADDR, 0xF7, 6)
    raw_pressure = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
    raw_temp = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)

    temperature = compensate_temperature(raw_temp, calib)
    # Full pressure compensation omitted for brevity — see BMP280 datasheet Appendix B
    return {
        'temperature_c': round(temperature, 2),
        'raw_pressure': raw_pressure,
        'timestamp': time.time(),
    }


def main():
    client = mqtt.Client(client_id='rpi_bmp280')
    client.connect(MQTT_BROKER, 1883)
    client.loop_start()

    with smbus2.SMBus(I2C_BUS) as bus:
        # Verify chip ID (BMP280 = 0x60)
        chip_id = bus.read_byte_data(BMP280_ADDR, 0xD0)
        assert chip_id == 0x60, f'Unexpected chip ID: {chip_id:#04x}'
        logger.info('BMP280 found (chip ID: 0x60)')

        calib = read_calibration(bus)

        try:
            while True:
                reading = read_bmp280(bus, calib)
                payload = json.dumps(reading)
                client.publish(MQTT_TOPIC, payload, qos=1)
                logger.info('Published: %s', payload)
                time.sleep(5)
        except KeyboardInterrupt:
            pass
        finally:
            client.loop_stop()
            client.disconnect()


if __name__ == '__main__':
    main()
```

## Arduino Sketch Template (C++)

```cpp
// arduino_sensor.ino
// Reads a DHT22 temperature/humidity sensor and sends JSON over Serial at 115200 baud.
// The Pi reads this Serial output (via USB) and forwards it to MQTT.
// Library: DHT sensor library by Adafruit (install via Arduino IDE Library Manager)

#include <DHT.h>
#include <ArduinoJson.h>

#define DHT_PIN 2
#define DHT_TYPE DHT22
#define LED_PIN LED_BUILTIN
#define SAMPLE_INTERVAL_MS 5000

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSampleMs = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial) {}  // wait for USB Serial on Leonardo/Micro; remove for Uno
  dht.begin();
  pinMode(LED_PIN, OUTPUT);
  Serial.println(F("{\"status\":\"ready\",\"sensor\":\"DHT22\"}"));
}

void loop() {
  unsigned long now = millis();
  if (now - lastSampleMs < SAMPLE_INTERVAL_MS) return;
  lastSampleMs = now;

  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();  // Celsius

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println(F("{\"error\":\"DHT read failed\"}"));
    return;
  }

  // Blink LED to indicate a reading
  digitalWrite(LED_PIN, HIGH);
  delay(50);
  digitalWrite(LED_PIN, LOW);

  // Build JSON with ArduinoJson (avoids fragile string concatenation)
  StaticJsonDocument<128> doc;
  doc["temp_c"] = round(temperature * 10.0) / 10.0;
  doc["humidity_pct"] = round(humidity * 10.0) / 10.0;
  doc["uptime_ms"] = now;

  serializeJson(doc, Serial);
  Serial.println();  // newline terminates the JSON line for the Pi reader
}
```

## Raspberry Pi Serial → MQTT Bridge

```python
# serial_to_mqtt.py
"""
Reads newline-delimited JSON from an Arduino over USB Serial (/dev/ttyACM0)
and publishes each reading to MQTT.
Usage: python3 serial_to_mqtt.py
Requires: pip3 install pyserial paho-mqtt
"""
import json
import logging
import serial
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)

SERIAL_PORT = '/dev/ttyACM0'   # change to /dev/ttyUSB0 for CH340-based boards
BAUD_RATE = 115200
MQTT_BROKER = 'localhost'
MQTT_TOPIC = 'sensors/arduino/dht22'


def main():
    client = mqtt.Client(client_id='rpi_serial_bridge')
    client.connect(MQTT_BROKER, 1883)
    client.loop_start()

    with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2) as ser:
        logger.info('Listening on %s @ %d baud', SERIAL_PORT, BAUD_RATE)
        while True:
            try:
                line = ser.readline().decode('utf-8').strip()
                if not line:
                    continue
                data = json.loads(line)
                payload = json.dumps(data)
                client.publish(MQTT_TOPIC, payload, qos=1)
                logger.info('Published: %s', payload)
            except json.JSONDecodeError:
                logger.warning('Ignoring non-JSON line: %r', line)
            except Exception as e:
                logger.error('Serial read error: %s', e)


if __name__ == '__main__':
    main()
```

## MQTT → Workbench Bus Bridge

This is the key integration: subscribes to all sensor MQTT topics and forwards each message to the workbench message bus, and periodically ingests summaries into the RAG knowledgebase.

```python
# mqtt_to_workbench.py
"""
Subscribes to MQTT sensor topics and bridges messages to:
  1. The workbench message bus (/api/projects/<project>/bus/publish)
  2. The workbench RAG ingest (/api/projects/<project>/rag/ingest) every N messages

Usage: python3 mqtt_to_workbench.py
Requires: pip3 install paho-mqtt requests
"""
import json
import logging
import time
import threading
import paho.mqtt.client as mqtt
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)

MQTT_BROKER = 'localhost'
MQTT_TOPICS = [
    ('sensors/#', 0),   # subscribe to all sensor topics (QoS 0)
]
WORKBENCH_URL = 'http://<host-machine-ip>:3100'  # replace with your machine's IP
PROJECT = 'default'
INGEST_EVERY_N = 20   # ingest a summary after every N messages

message_buffer: list[dict] = []
message_count = 0
buffer_lock = threading.Lock()


def publish_to_bus(topic: str, payload: dict):
    """Forward a single message to the workbench bus."""
    try:
        r = requests.post(
            f'{WORKBENCH_URL}/api/projects/{PROJECT}/bus/publish',
            json={
                'channel': f'iot.{topic.replace("/", ".")}',
                'message': payload,
            },
            timeout=5,
        )
        if not r.ok:
            logger.warning('Bus publish failed: %d %s', r.status_code, r.text[:200])
    except Exception as e:
        logger.error('Bus publish error: %s', e)


def ingest_summary(messages: list[dict]):
    """Ingest a batch summary into the workbench RAG knowledgebase."""
    if not messages:
        return
    lines = [json.dumps(m) for m in messages[-20:]]  # last 20 readings
    content = (
        f"IoT sensor batch ({len(messages)} readings, latest 20 shown):\n"
        + '\n'.join(lines)
    )
    try:
        r = requests.post(
            f'{WORKBENCH_URL}/api/projects/{PROJECT}/rag/ingest',
            json={
                'content': content,
                'title': f'IoT sensor batch — {time.strftime("%Y-%m-%d %H:%M:%S")}',
                'metadata': {'source': 'mqtt_bridge', 'count': str(len(messages))},
            },
            timeout=15,
        )
        if r.ok:
            data = r.json()
            logger.info('Ingested %d readings → %s chunks', len(messages), data.get('chunk_count'))
        else:
            logger.warning('Ingest failed: %d', r.status_code)
    except Exception as e:
        logger.error('Ingest error: %s', e)


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info('Connected to MQTT broker')
        for topic, qos in MQTT_TOPICS:
            client.subscribe(topic, qos)
            logger.info('Subscribed to %s', topic)
    else:
        logger.error('MQTT connect failed: rc=%d', rc)


def on_message(client, userdata, msg):
    global message_count
    try:
        payload = json.loads(msg.payload.decode('utf-8'))
    except json.JSONDecodeError:
        payload = {'raw': msg.payload.decode('utf-8', errors='replace')}

    payload['_topic'] = msg.topic
    payload['_ts'] = time.time()

    threading.Thread(target=publish_to_bus, args=(msg.topic, payload), daemon=True).start()

    with buffer_lock:
        message_buffer.append(payload)
        message_count += 1
        if message_count % INGEST_EVERY_N == 0:
            snapshot = list(message_buffer)
            threading.Thread(target=ingest_summary, args=(snapshot,), daemon=True).start()
            message_buffer.clear()


def main():
    client = mqtt.Client(client_id='workbench_mqtt_bridge')
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, 1883)

    logger.info('MQTT→Workbench bridge starting. Ctrl+C to stop.')
    try:
        client.loop_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down')
    finally:
        if message_buffer:
            ingest_summary(message_buffer)
        client.disconnect()


if __name__ == '__main__':
    main()
```

## systemd Service (Auto-start on Boot)

```ini
# /etc/systemd/system/workbench-bridge.service
[Unit]
Description=MQTT to Workbench Bridge
After=network.target mosquitto.service
Requires=mosquitto.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/iot
ExecStart=/usr/bin/python3 /home/pi/iot/mqtt_to_workbench.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp workbench-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable workbench-bridge
sudo systemctl start workbench-bridge
sudo journalctl -u workbench-bridge -f
```

## Checklist

- [ ] I2C enabled on Pi: `sudo raspi-config → Interface Options → I2C`
- [ ] `i2cdetect -y 1` shows the sensor at the expected address before writing code
- [ ] `RPi.GPIO`, `smbus2`, `paho-mqtt`, `requests`, `pyserial` installed
- [ ] Mosquitto running: `sudo systemctl status mosquitto`
- [ ] Arduino sketch uses `Serial.println()` to terminate each JSON line
- [ ] `WORKBENCH_URL` in `mqtt_to_workbench.py` uses the host machine's LAN IP, not `localhost`
- [ ] HTTP calls from MQTT callbacks dispatched to daemon threads (non-blocking)
- [ ] systemd service created for auto-start and crash recovery

## Files involved

| File | Action |
|------|--------|
| `gpio_sensor.py` | Create: GPIO input/output with MQTT publish |
| `i2c_bmp280.py` | Create: I2C sensor reader (BMP280) |
| `arduino_sensor.ino` | Create: Arduino DHT22 sketch with JSON Serial output |
| `serial_to_mqtt.py` | Create: USB Serial → MQTT bridge |
| `mqtt_to_workbench.py` | Create: MQTT → workbench bus + ingest bridge |
| `/etc/systemd/system/workbench-bridge.service` | Create: systemd service for auto-start |

## Common mistakes

**Using `RPi.GPIO` on a non-Pi machine** — `import RPi.GPIO` raises `RuntimeError` on any machine that isn't a Raspberry Pi (including Pi 5, which needs `lgpio` instead). Test GPIO code only on the target hardware. Use mock stubs for unit tests on a development machine.

**Not calling `GPIO.cleanup()` on exit** — if a script exits without `GPIO.cleanup()`, the GPIO pins stay in their last state and subsequent runs raise `RuntimeWarning: This channel is already in use`. Always call `GPIO.cleanup()` in a `finally` block or `atexit` handler.

**Arduino Serial buffer overflow** — if the Pi doesn't read the Arduino Serial port fast enough, the 64-byte hardware buffer overflows and data is lost. Keep JSON messages short (under 128 bytes), use a higher baud rate (115200), and ensure `serial_to_mqtt.py` is running before the Arduino starts sending.

**MQTT `loop_forever()` blocking ingest calls** — `client.loop_forever()` processes messages on the same thread. If `on_message` does a slow `requests.post()`, the MQTT client can't receive new messages during that call. Always dispatch slow work to `threading.Thread(..., daemon=True).start()`.

**Workbench URL pointing to `localhost` from the Pi** — `localhost` on the Pi refers to the Pi itself, not the development machine running the workbench. Replace with the host machine's LAN IP (e.g., `http://192.168.1.50:3100`). Find it on macOS with `ipconfig getifaddr en0` or on Linux with `ip addr show`.
