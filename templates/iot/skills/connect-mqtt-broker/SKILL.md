---
name: connect-mqtt-broker
description: Connect a ROS2 node or Python service to an MQTT broker — topic design, QoS, TLS, retained messages, last-will, and ROS2 bridge
metadata:
  type: skill
  domain: iot
  triggers:
    - "connect mqtt"
    - "mqtt broker"
    - "mqtt publisher"
    - "mqtt subscriber"
    - "iot messaging"
    - "sensor telemetry"
---

# Skill: connect-mqtt-broker

## When to Use

When you need to send or receive IoT sensor data over MQTT — either in a standalone Python service or bridged into a ROS2 topic graph.

---

## Prerequisites

- MQTT broker available (Mosquitto, HiveMQ, AWS IoT, or similar)
- `paho-mqtt` or `aiomqtt` in `requirements.txt`
- If bridging to ROS2: workspace scaffolded (`scaffold-ros2-workspace`)

---

## Steps

### 1. Design the topic hierarchy

Before writing any code, document your topic structure:

```
device/{device_id}/telemetry        QoS 1, retain: false
device/{device_id}/status           QoS 1, retain: true  (last-will too)
device/{device_id}/command/{type}   QoS 1 or 2, retain: false
device/{device_id}/config           QoS 1, retain: true
fleet/{group}/broadcast             QoS 1, retain: false
```

Add this to `.workbench/mqtt-topics.md` as living documentation.

### 2. Add the broker to `docker-compose.yml` (development)

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
      - "9001:9001"   # WebSocket
    volumes:
      - ./configs/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - mosquitto-data:/mosquitto/data

volumes:
  mosquitto-data:
```

```ini
# configs/mosquitto/mosquitto.conf
listener 1883
allow_anonymous true        # dev only — use auth in production

listener 9001
protocol websockets
```

### 3. Install MQTT client

```bash
# requirements.txt
paho-mqtt==2.1.0
aiomqtt==2.3.0    # if using async
```

### 4. Create the MQTT client module

```python
# my_package/mqtt_client.py
import json
import logging
import threading
import time
from typing import Callable
import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)


class MqttClient:
    def __init__(
        self,
        host: str,
        port: int = 1883,
        client_id: str = "my-service",
        use_tls: bool = False,
        username: str | None = None,
        password: str | None = None,
    ):
        self.host = host
        self.port = port
        self._client = mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv311)
        self._connected = threading.Event()
        self._handlers: dict[str, Callable] = {}

        if use_tls:
            self._client.tls_set()
        if username:
            self._client.username_pw_set(username, password)

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def connect(self, device_id: str | None = None, timeout: float = 10.0):
        # Set last-will before connecting
        if device_id:
            self._client.will_set(
                f"device/{device_id}/status",
                payload=json.dumps({"online": False}),
                qos=1,
                retain=True,
            )
        self._client.connect(self.host, self.port, keepalive=60)
        self._client.loop_start()
        if not self._connected.wait(timeout):
            raise RuntimeError(f"MQTT connection timeout after {timeout}s")

    def disconnect(self):
        self._client.loop_stop()
        self._client.disconnect()

    def publish(self, topic: str, payload: dict | str, qos: int = 1, retain: bool = False):
        if isinstance(payload, dict):
            payload = json.dumps(payload)
        self._client.publish(topic, payload, qos=qos, retain=retain)

    def subscribe(self, topic: str, handler: Callable, qos: int = 1):
        self._handlers[topic] = handler
        self._client.subscribe(topic, qos=qos)

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info(f"MQTT connected to {self.host}:{self.port}")
            # Resubscribe on reconnect
            for topic in self._handlers:
                client.subscribe(topic, 1)
            self._connected.set()
        else:
            logger.error(f"MQTT connection failed: rc={rc}")

    def _on_disconnect(self, client, userdata, rc):
        self._connected.clear()
        if rc != 0:
            logger.warning(f"MQTT unexpected disconnect: rc={rc}, reconnecting...")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
        except json.JSONDecodeError:
            payload = msg.payload.decode()

        for pattern, handler in self._handlers.items():
            if mqtt.topic_matches_sub(pattern, msg.topic):
                try:
                    handler(msg.topic, payload)
                except Exception as e:
                    logger.error(f"MQTT handler error for {msg.topic}: {e}")
```

### 5. Create the ROS2 bridge node

```python
# my_package/mqtt_ros_bridge.py
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Temperature, Humidity
from std_msgs.msg import String
from .mqtt_client import MqttClient


class MqttRosBridge(Node):
    """Bridges MQTT telemetry topics to ROS2 topics."""

    def __init__(self):
        super().__init__('mqtt_ros_bridge')

        # Parameters
        self.declare_parameter('broker_host', 'mosquitto')
        self.declare_parameter('broker_port', 1883)
        self.declare_parameter('device_id', 'sensor-01')

        host = self.get_parameter('broker_host').value
        port = self.get_parameter('broker_port').value
        self.device_id_ = self.get_parameter('device_id').value

        # ROS2 publishers
        self.temp_pub_ = self.create_publisher(Temperature, '/sensors/temperature', 10)
        self.status_pub_ = self.create_publisher(String, '/sensors/status', 10)

        # MQTT client
        self.mqtt_ = MqttClient(host, port, client_id=f"ros-bridge-{self.device_id_}")
        self.mqtt_.connect(device_id=self.device_id_)
        self.mqtt_.subscribe(f"device/{self.device_id_}/telemetry", self.on_telemetry)
        self.mqtt_.subscribe(f"device/{self.device_id_}/status", self.on_status)

        # Publish online status
        self.mqtt_.publish(
            f"device/{self.device_id_}/status",
            {"online": True},
            retain=True,
        )

        self.get_logger().info(f"MQTT bridge started for device {self.device_id_}")

    def on_telemetry(self, topic: str, payload: dict):
        if "temperature" in payload:
            msg = Temperature()
            msg.temperature = float(payload["temperature"])
            msg.header.stamp = self.get_clock().now().to_msg()
            self.temp_pub_.publish(msg)

    def on_status(self, topic: str, payload: dict):
        msg = String()
        msg.data = str(payload)
        self.status_pub_.publish(msg)

    def destroy_node(self):
        self.mqtt_.publish(
            f"device/{self.device_id_}/status",
            {"online": False},
            retain=True,
        )
        self.mqtt_.disconnect()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = MqttRosBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

### 6. Test with a mock broker

```python
# test/test_mqtt_client.py
import pytest
import threading
import time

def test_mqtt_publish_subscribe(tmp_path):
    """Integration test using a local Mosquitto broker (requires docker-compose.test.yml)."""
    import paho.mqtt.client as mqtt

    received = []
    event = threading.Event()

    def on_message(client, userdata, msg):
        received.append(json.loads(msg.payload.decode()))
        event.set()

    subscriber = mqtt.Client("test-sub")
    subscriber.on_message = on_message
    subscriber.connect("localhost", 1883)
    subscriber.subscribe("test/topic", 1)
    subscriber.loop_start()

    from my_package.mqtt_client import MqttClient
    publisher = MqttClient("localhost", 1883, client_id="test-pub")
    publisher.connect()
    publisher.publish("test/topic", {"value": 42})

    event.wait(timeout=2.0)
    subscriber.loop_stop()
    publisher.disconnect()

    assert len(received) == 1
    assert received[0]["value"] == 42
```

---

## Checklist

- [ ] Topic hierarchy documented in `.workbench/mqtt-topics.md`
- [ ] QoS levels chosen for each topic type (0 for high-freq, 1 for commands, 2 for critical)
- [ ] Last-will set before `connect()` for device presence detection
- [ ] Retained messages used for status/config topics
- [ ] `on_disconnect` logs and reconnects (paho does this automatically with `loop_start()`)
- [ ] ROS2 bridge node publishes correct message types for each topic
- [ ] Broker added to `docker-compose.yml` for local development
- [ ] TLS enabled for production config (only plaintext for local dev)

---

## Files Involved

| File | Action |
|------|--------|
| `src/my_package/my_package/mqtt_client.py` | Create |
| `src/my_package/my_package/mqtt_ros_bridge.py` | Create |
| `src/my_package/setup.py` | Modify — add console_scripts entries |
| `configs/mosquitto/mosquitto.conf` | Create |
| `docker-compose.yml` | Modify — add mosquitto service |
| `requirements.txt` | Modify — add paho-mqtt, aiomqtt |
| `.workbench/mqtt-topics.md` | Create — topic hierarchy doc |

---

## Common Mistakes

- **Setting last-will after connect().** Last-will must be configured before `connect()` or the broker never receives it.
- **QoS 0 for commands.** If the device reboots while a command is in flight, QoS 0 drops it silently. Use QoS 1 or 2 for commands.
- **Not retaining status/config.** Without `retain=True`, a new bridge node that connects after the device has already published its status will never receive it.
- **Blocking in `on_message`.** paho calls `on_message` from its network thread. Heavy processing blocks all incoming messages. Enqueue and process on a separate thread.
- **Missing TLS in production.** `allow_anonymous true` is for local dev only. Production brokers require TLS + auth. Document the credentials location in `.workbench/`.
