---
name: ros2-simulation
description: Add a mock/real hardware abstraction layer so nodes can be tested in CI without physical hardware
metadata:
  type: skill
  domain: iot
  triggers:
    - "ros2 simulation"
    - "mock hardware"
    - "hardware abstraction"
    - "test without hardware"
    - "hardware interface"
    - "mock sensor"
    - "mock actuator"
---

# Skill: ros2-simulation

## When to Use

When you need to run CI tests or develop node logic without physical hardware. This skill establishes the mock/real abstraction pattern that all subsequent sensor and actuator skills build on.

**Build this third** (after scaffold and create-ros2-node) because it enables hardware-free CI for every skill that follows.

---

## Prerequisites

- Workspace scaffolded and at least one node created
- Understanding of which hardware the nodes will eventually talk to
- CI pipeline where physical hardware is unavailable

---

## The Pattern

Define Python abstract base classes for each hardware interface. The ROS2 node depends on the abstraction, not a concrete implementation. CI uses `MockSensor`; production uses `RealSensor`. The node never changes.

```
┌──────────────────────────────────────────────────────────┐
│                     ROS2 Node                             │
│  Talks to: SensorInterface (abstract)                     │
└──────────────────────┬───────────────────────────────────┘
                       │ depends on
              ┌────────┴────────┐
              │                 │
     ┌────────▼───────┐ ┌──────▼──────────┐
     │  MockSensor    │ │  RealSensor      │
     │  (for CI/dev)  │ │  (serial/I2C/   │
     │                │ │   MQTT/etc.)     │
     └────────────────┘ └─────────────────┘
```

---

## Steps

### 1. Create the hardware abstraction module

Create `src/my_package/my_package/hardware/`:

```
hardware/
├── __init__.py
├── sensor_interface.py      # abstract base class
├── mock_sensor.py           # mock for testing
└── real_sensor.py           # real hardware implementation
```

### 2. Define the abstract interface

```python
# hardware/sensor_interface.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class SensorReading:
    value: float
    unit: str
    timestamp_ns: int
    valid: bool


class SensorInterface(ABC):
    """Abstract sensor interface — implemented by both mock and real hardware."""

    @abstractmethod
    def connect(self) -> None:
        """Open the connection to the sensor hardware."""

    @abstractmethod
    def disconnect(self) -> None:
        """Close the connection."""

    @abstractmethod
    def read(self) -> SensorReading:
        """Read the current sensor value. Raises SensorError on failure."""

    @abstractmethod
    def is_connected(self) -> bool:
        """Return True if the sensor is currently connected and healthy."""


class SensorError(Exception):
    """Raised when sensor communication fails."""
```

### 3. Implement the mock

```python
# hardware/mock_sensor.py
import time
import math
import threading
from .sensor_interface import SensorInterface, SensorReading


class MockSensor(SensorInterface):
    """
    Mock sensor for CI and development.
    Generates a sine wave by default. Inject custom values for specific test scenarios.
    """

    def __init__(self, base_value=1.0, amplitude=0.5, frequency=0.1, noise=0.0):
        self.base_value = base_value
        self.amplitude = amplitude
        self.frequency = frequency
        self.noise = noise
        self._connected = False
        self._failure_mode = False
        self._lock = threading.Lock()

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def read(self) -> SensorReading:
        if self._failure_mode:
            raise SensorError("Simulated sensor failure")
        t = time.time()
        import random
        value = self.base_value + self.amplitude * math.sin(2 * math.pi * self.frequency * t)
        if self.noise > 0:
            value += random.gauss(0, self.noise)
        return SensorReading(
            value=value,
            unit="m",
            timestamp_ns=time.time_ns(),
            valid=True,
        )

    def is_connected(self) -> bool:
        return self._connected

    def simulate_failure(self):
        """Call in tests to verify failure handling."""
        self._failure_mode = True

    def recover(self):
        self._failure_mode = False
```

### 4. Implement the real sensor (serial example)

```python
# hardware/real_sensor.py
import time
import serial
from .sensor_interface import SensorInterface, SensorReading, SensorError


class RealDistanceSensor(SensorInterface):
    """Reads distance from a serial-connected ultrasonic sensor."""

    def __init__(self, port: str = '/dev/mydevice', baudrate: int = 9600):
        self.port = port
        self.baudrate = baudrate
        self._ser: serial.Serial | None = None

    def connect(self) -> None:
        try:
            self._ser = serial.Serial(self.port, self.baudrate, timeout=1.0)
            time.sleep(0.1)  # let device stabilize
        except serial.SerialException as e:
            raise SensorError(f"Failed to connect to {self.port}: {e}") from e

    def disconnect(self) -> None:
        if self._ser and self._ser.is_open:
            self._ser.close()

    def read(self) -> SensorReading:
        if not self._ser or not self._ser.is_open:
            raise SensorError("Sensor not connected")
        try:
            line = self._ser.readline().decode('ascii').strip()
            value = float(line)
            return SensorReading(value=value, unit="m", timestamp_ns=time.time_ns(), valid=True)
        except (ValueError, serial.SerialException) as e:
            raise SensorError(f"Read failed: {e}") from e

    def is_connected(self) -> bool:
        return self._ser is not None and self._ser.is_open
```

### 5. Wire into the ROS2 node with dependency injection

```python
# sensor_node.py
import rclpy
from rclpy.node import Node
from std_msgs.msg import Float64
from .hardware.sensor_interface import SensorInterface, SensorError
from .hardware.mock_sensor import MockSensor
from .hardware.real_sensor import RealDistanceSensor


class SensorNode(Node):
    def __init__(self, sensor: SensorInterface | None = None):
        super().__init__('sensor_node')

        # Use injected sensor or create based on parameter
        self.declare_parameter('use_mock', False)
        use_mock = self.get_parameter('use_mock').value

        if sensor is not None:
            self.sensor_ = sensor
        elif use_mock:
            self.sensor_ = MockSensor()
        else:
            port = self.declare_parameter('serial_port', '/dev/mydevice').value
            self.sensor_ = RealDistanceSensor(port=port)

        self.sensor_.connect()
        self.pub_ = self.create_publisher(Float64, '/sensor/distance', 10)
        self.timer_ = self.create_timer(0.1, self.read_and_publish)

    def read_and_publish(self):
        try:
            reading = self.sensor_.read()
            msg = Float64()
            msg.data = reading.value
            self.pub_.publish(msg)
        except SensorError as e:
            self.get_logger().error(f'Sensor read failed: {e}')

    def destroy_node(self):
        self.sensor_.disconnect()
        super().destroy_node()
```

### 6. Write tests using the mock

```python
# test/test_sensor_node.py
import pytest
import rclpy
from std_msgs.msg import Float64
from my_package.sensor_node import SensorNode
from my_package.hardware.mock_sensor import MockSensor


@pytest.fixture(autouse=True)
def ros_init():
    rclpy.init()
    yield
    rclpy.shutdown()


def test_sensor_node_publishes_readings():
    mock = MockSensor(base_value=2.5, amplitude=0.0)  # constant 2.5
    mock.connect()
    node = SensorNode(sensor=mock)
    received = []
    node.create_subscription(Float64, '/sensor/distance', lambda m: received.append(m.data), 10)

    node.read_and_publish()
    rclpy.spin_once(node, timeout_sec=0.1)

    node.destroy_node()
    assert len(received) == 1
    assert received[0] == pytest.approx(2.5)


def test_sensor_node_handles_failure():
    mock = MockSensor()
    mock.connect()
    mock.simulate_failure()

    node = SensorNode(sensor=mock)
    # Should log an error but not crash
    node.read_and_publish()
    node.destroy_node()
    # Test passes if no exception was raised
```

### 7. CI launch with `use_mock:=true`

```yaml
# docker-compose.test.yml
services:
  test:
    build: .
    command: >
      bash -c "
        source /opt/ros/jazzy/setup.bash &&
        source /ros2_ws/install/setup.bash &&
        colcon test --packages-select my_package &&
        colcon test-result --verbose
      "
    environment:
      - ROS_DOMAIN_ID=99   # isolated from any other ROS instances
```

Or in a launch file for integration tests:
```python
Node(
    package='my_package',
    executable='sensor_node',
    parameters=[{'use_mock': True}],
)
```

---

## Checklist

- [ ] Abstract `SensorInterface` class defines `connect`, `disconnect`, `read`, `is_connected`
- [ ] `MockSensor` generates predictable values (constant or sine wave)
- [ ] `MockSensor.simulate_failure()` allows testing error paths
- [ ] ROS2 node accepts injected `SensorInterface` in constructor (dependency injection)
- [ ] Node uses `use_mock` parameter for no-code-change CI deployment
- [ ] Tests cover: normal publish, sensor failure (graceful log, no crash)
- [ ] `docker compose -f docker-compose.test.yml up` passes without hardware connected

---

## Files Involved

| File | Action |
|------|--------|
| `src/my_package/my_package/hardware/__init__.py` | Create (empty) |
| `src/my_package/my_package/hardware/sensor_interface.py` | Create |
| `src/my_package/my_package/hardware/mock_sensor.py` | Create |
| `src/my_package/my_package/hardware/real_sensor.py` | Create |
| `src/my_package/my_package/sensor_node.py` | Create or modify |
| `src/my_package/test/test_sensor_node.py` | Create |

---

## Common Mistakes

- **Testing against real hardware in CI.** CI pipelines don't have USB ports. If a test imports the real sensor and tries to open the serial port, it fails in CI. Always inject the mock or use `use_mock=True`.
- **Abstract class without `@abstractmethod`.** Without the decorator, Python won't enforce implementation. Subclasses that forget a method will fail at runtime, not at import time.
- **Connecting in `__init__`.** Don't open hardware connections in the constructor. Use `connect()` so tests can inject the mock before any hardware access happens.
- **Not testing failure paths.** The hardware will fail in production. `simulate_failure()` exists for this reason — test that the node logs the error and continues rather than crashing.
