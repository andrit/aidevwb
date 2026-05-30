# IoT Protocols — MQTT, Serial, I2C, Modbus, OPC-UA

## Protocol Decision Guide

| Protocol | Range | Topology | Power | Reliability | Use when |
|----------|-------|----------|-------|-------------|----------|
| MQTT | LAN/WAN | Many-to-many via broker | Low | QoS 0/1/2 | Cloud-connected IoT, dashboards, remote sensors |
| Serial (RS-232) | <15m | Point-to-point | Medium | Framing needed | Lab instruments, GPS modules, legacy devices |
| Serial (RS-485) | <1200m | Multi-drop (32 devices) | Low | Half-duplex | Industrial sensors on a bus |
| I2C | <1m | Multi-drop (112 devices) | Very low | ACK-based | Sensors on a PCB (IMU, barometer, display) |
| Modbus RTU | <1200m | Master/slave | Low | CRC | Industrial PLCs, VFDs, power meters |
| Modbus TCP | LAN | Client/server | N/A | TCP | Same devices, Ethernet-connected |
| OPC-UA | LAN/WAN | Client/server + pub/sub | N/A | Secure + encrypted | Modern industrial equipment, SCADA systems |

---

## MQTT

### Connection and Basic Pub/Sub

```python
# paho-mqtt (synchronous, simpler)
import paho.mqtt.client as mqtt
import json, time

def on_connect(client, userdata, flags, rc):
    print(f"Connected: {rc}")
    client.subscribe("device/+/telemetry")  # wildcard: all device IDs

def on_message(client, userdata, msg):
    payload = json.loads(msg.payload.decode())
    print(f"{msg.topic}: {payload}")

client = mqtt.Client(client_id="my-service")
client.on_connect = on_connect
client.on_message = on_message

# TLS connection
client.tls_set(ca_certs="/etc/ssl/certs/ca-certificates.crt")
client.username_pw_set("user", "password")
client.connect("broker.example.com", 8883, keepalive=60)
client.loop_start()  # non-blocking background thread

# Publish
client.publish("device/sensor-01/telemetry", json.dumps({"temp": 22.5}), qos=1)
```

```python
# aiomqtt (async, recommended for new code)
import asyncio
import aiomqtt

async def main():
    async with aiomqtt.Client("broker.example.com", port=8883,
                               username="user", password="password",
                               tls_params=aiomqtt.TLSParameters()) as client:
        await client.subscribe("device/+/telemetry")
        async with client.messages() as messages:
            async for message in messages:
                print(f"{message.topic}: {message.payload.decode()}")

asyncio.run(main())
```

### Topic Hierarchy Convention

```
device/{device_id}/telemetry        # sensor readings → broker (retain: false, QoS 1)
device/{device_id}/status           # online/offline (retain: true, last-will)
device/{device_id}/command/{type}   # commands → device (QoS 1 or 2)
device/{device_id}/config           # config push to device (retain: true, QoS 1)
fleet/{group}/broadcast             # send to all devices in a group
```

### QoS Levels

| QoS | Name | Delivery | Overhead | Use for |
|-----|------|----------|---------|---------|
| 0 | At most once | Fire and forget | Lowest | High-frequency telemetry where missing a reading is OK |
| 1 | At least once | Guaranteed, may duplicate | Medium | Commands, alerts (idempotent operations) |
| 2 | Exactly once | Guaranteed, no duplicates | Highest | Financial transactions, actuator commands that must not repeat |

### Retained Messages and Last-Will

```python
# Retained message: new subscribers immediately get the last value
client.publish("device/sensor-01/status", "online", qos=1, retain=True)

# Last-will: broker publishes this if the client disconnects unexpectedly
client.will_set("device/sensor-01/status", "offline", qos=1, retain=True)
client.connect("broker.example.com", 1883)
```

### Bridging MQTT to ROS2

```python
# A bridge node: subscribes to MQTT, publishes to ROS2 topic
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Temperature
import paho.mqtt.client as mqtt
import json

class MqttRosBridge(Node):
    def __init__(self):
        super().__init__('mqtt_ros_bridge')
        self.pub_ = self.create_publisher(Temperature, '/temperature', 10)

        self.mqtt_client = mqtt.Client()
        self.mqtt_client.on_message = self.on_mqtt_message
        self.mqtt_client.connect("localhost", 1883)
        self.mqtt_client.subscribe("device/+/telemetry")

        # Poll MQTT in a timer (keeps ROS2 executor in control)
        self.create_timer(0.05, self.mqtt_client.loop)

    def on_mqtt_message(self, client, userdata, msg):
        data = json.loads(msg.payload.decode())
        ros_msg = Temperature()
        ros_msg.temperature = float(data.get("temp", 0))
        self.pub_.publish(ros_msg)
```

---

## Serial (RS-232 / RS-485)

```python
import serial
import struct, time

# RS-232 connection
ser = serial.Serial(
    port='/dev/ttyUSB0',
    baudrate=9600,
    bytesize=serial.EIGHTBITS,
    parity=serial.PARITY_NONE,
    stopbits=serial.STOPBITS_ONE,
    timeout=1.0   # read timeout in seconds
)

# Simple readline (for ASCII-framed protocols like NMEA GPS)
line = ser.readline().decode('ascii', errors='replace').strip()

# Binary framing: read until start/end bytes
def read_frame(ser, start_byte=0xAA, end_byte=0x55):
    while True:
        b = ser.read(1)
        if not b:
            return None   # timeout
        if b[0] == start_byte:
            frame = bytearray()
            while True:
                b = ser.read(1)
                if not b:
                    return None
                if b[0] == end_byte:
                    return bytes(frame)
                frame.append(b[0])

# Reconnect wrapper
def safe_read(ser, retries=3):
    for i in range(retries):
        try:
            return ser.readline()
        except serial.SerialException as e:
            if i == retries - 1:
                raise
            time.sleep(0.5)
            ser.close()
            ser.open()
```

**RS-485 note:** RS-485 is half-duplex — only one device transmits at a time. Most USB-RS485 adapters handle direction switching automatically. If yours doesn't, use `ser.rs485_mode = serial.rs485.RS485Settings()`.

---

## I2C (smbus2)

```python
from smbus2 import SMBus, i2c_msg
import time

# Scan for devices (useful during development)
def scan_i2c_bus(bus_num=1):
    found = []
    with SMBus(bus_num) as bus:
        for addr in range(0x03, 0x78):
            try:
                bus.read_byte(addr)
                found.append(hex(addr))
            except OSError:
                pass
    return found

# Read a register
with SMBus(1) as bus:
    # Read 2 bytes from register 0x00 of device at address 0x68
    data = bus.read_i2c_block_data(0x68, 0x00, 2)
    raw = (data[0] << 8) | data[1]

# Write a register
with SMBus(1) as bus:
    bus.write_byte_data(0x68, 0x6B, 0x00)  # wake up MPU-6050

# Read with repeated start (for devices that require it)
with SMBus(1) as bus:
    write_msg = i2c_msg.write(0x68, [0x3B])   # set register pointer
    read_msg = i2c_msg.read(0x68, 14)          # read 14 bytes
    bus.i2c_rdwr(write_msg, read_msg)
    raw_data = list(read_msg)
```

**Clock stretching:** Some I2C devices stretch the clock while preparing data. If you see `OSError: [Errno 121] Remote I/O error`, the device needs more time — add `time.sleep(0.001)` between write and read.

---

## Modbus RTU / TCP

```python
from pymodbus.client import ModbusSerialClient, ModbusTcpClient
from pymodbus.exceptions import ModbusException

# RTU (serial)
client = ModbusSerialClient(
    port='/dev/ttyUSB0',
    baudrate=9600,
    bytesize=8, parity='N', stopbits=1,
    timeout=1
)

# TCP
client = ModbusTcpClient('192.168.1.100', port=502)

client.connect()

# Read holding registers (unit=slave_id)
result = client.read_holding_registers(address=0, count=4, unit=1)
if not result.isError():
    values = result.registers  # list of 16-bit ints

# Read coils (bits)
result = client.read_coils(address=0, count=8, unit=1)
if not result.isError():
    bits = result.bits[:8]

# Write single register
client.write_register(address=10, value=100, unit=1)

# Write multiple registers
client.write_registers(address=10, values=[100, 200, 300], unit=1)

client.close()
```

**Register types:**
- **Coils** (0x) — single bits, read/write (digital outputs)
- **Discrete inputs** (1x) — single bits, read-only (digital inputs)
- **Input registers** (3x) — 16-bit words, read-only (sensor readings)
- **Holding registers** (4x) — 16-bit words, read/write (setpoints, config)

---

## OPC-UA (asyncua)

```python
import asyncio
from asyncua import Client, ua

async def read_opcua():
    url = "opc.tcp://192.168.1.100:4840"

    async with Client(url=url) as client:
        # Browse the server namespace
        root = client.get_root_node()
        objects = await root.get_child(["0:Objects"])

        # Read a node by NodeId
        node = client.get_node("ns=2;i=1001")
        value = await node.get_value()
        print(f"Value: {value}")

        # Subscribe to value changes
        handler = SubHandler()
        sub = await client.create_subscription(period=500, handler=handler)
        handle = await sub.subscribe_data_change([node])

        await asyncio.sleep(10)  # collect data
        await sub.unsubscribe(handle)

class SubHandler:
    def datachange_notification(self, node, val, data):
        print(f"Node {node}: {val}")

asyncio.run(read_opcua())
```

---

## Error Handling and Reconnection Pattern

All hardware protocols need reconnect logic. Use this pattern:

```python
import time
import logging

logger = logging.getLogger(__name__)

class RobustConnection:
    def __init__(self, connect_fn, max_retries=5, backoff_base=1.0):
        self.connect_fn = connect_fn
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.conn = None

    def connect(self):
        for attempt in range(self.max_retries):
            try:
                self.conn = self.connect_fn()
                logger.info("Connected")
                return
            except Exception as e:
                wait = self.backoff_base * (2 ** attempt)
                logger.warning(f"Connect failed (attempt {attempt+1}): {e}. Retrying in {wait}s")
                time.sleep(wait)
        raise RuntimeError(f"Failed to connect after {self.max_retries} attempts")

    def read_with_reconnect(self, read_fn):
        try:
            return read_fn(self.conn)
        except Exception as e:
            logger.warning(f"Read failed: {e}. Reconnecting...")
            self.connect()
            return read_fn(self.conn)
```
