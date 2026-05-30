---
name: add-sensor-interface
description: Add a new sensor to a ROS2 node with mock/real abstraction, calibration parameters, dropout handling, and correct sensor_msgs types
metadata:
  type: skill
  domain: iot
  triggers:
    - "add sensor"
    - "sensor interface"
    - "read sensor data"
    - "sensor publisher"
    - "connect sensor"
---

# Skill: add-sensor-interface

## When to Use

When connecting a new physical sensor (distance, temperature, IMU, camera, lidar, etc.) to a ROS2 node. This skill applies the mock/real pattern from `ros2-simulation` to a specific sensor type.

---

## Prerequisites

- `ros2-simulation` skill applied (hardware abstraction pattern in place)
- Know the sensor type, communication protocol (serial, I2C, MQTT), and appropriate `sensor_msgs` type

---

## Sensor Type → Message Type Reference

| Sensor | Message Type | Key fields |
|--------|-------------|-----------|
| Distance (ultrasonic/laser) | `sensor_msgs/Range` | `range`, `min_range`, `max_range`, `radiation_type` |
| Lidar (2D) | `sensor_msgs/LaserScan` | `ranges[]`, `angle_min/max/increment`, `range_min/max` |
| Lidar (3D) | `sensor_msgs/PointCloud2` | binary point data |
| Camera | `sensor_msgs/Image` | `height`, `width`, `encoding`, `data[]` |
| IMU | `sensor_msgs/Imu` | `angular_velocity`, `linear_acceleration`, `orientation` |
| Temperature | `sensor_msgs/Temperature` | `temperature` (°C), `variance` |
| Humidity | `sensor_msgs/RelativeHumidity` | `relative_humidity` (0.0–1.0), `variance` |
| Pressure | `sensor_msgs/FluidPressure` | `fluid_pressure` (Pa), `variance` |
| GPS | `sensor_msgs/NavSatFix` | `latitude`, `longitude`, `altitude`, `status` |
| Battery | `sensor_msgs/BatteryState` | `voltage`, `percentage`, `power_supply_status` |
| Joint encoder | `sensor_msgs/JointState` | `name[]`, `position[]`, `velocity[]`, `effort[]` |

---

## Steps

### 1. Identify the interface type

Based on your sensor:
- Serial → `RealSerialSensor` (see `ros2-simulation` template as base)
- I2C → `RealI2cSensor` (uses smbus2)
- MQTT → wire through the MQTT bridge node (no new sensor class needed)

### 2. Extend the abstract interface for this sensor

```python
# hardware/sensor_interface.py (extend existing)
from dataclasses import dataclass
from abc import ABC, abstractmethod

@dataclass
class ImuReading:
    accel_x: float   # m/s²
    accel_y: float
    accel_z: float
    gyro_x: float    # rad/s
    gyro_y: float
    gyro_z: float
    timestamp_ns: int

class ImuInterface(ABC):
    @abstractmethod
    def connect(self) -> None: ...
    @abstractmethod
    def disconnect(self) -> None: ...
    @abstractmethod
    def read(self) -> ImuReading: ...
    @abstractmethod
    def is_connected(self) -> bool: ...
```

### 3. Implement the mock with calibration offsets

```python
# hardware/mock_imu.py
import time, math
from .sensor_interface import ImuInterface, ImuReading, SensorError

class MockImu(ImuInterface):
    def __init__(self):
        self._connected = False
        self._failure_mode = False
        self.accel_bias = (0.0, 0.0, 9.81)   # simulate gravity on z-axis
        self.gyro_noise = 0.001               # rad/s noise

    def connect(self): self._connected = True
    def disconnect(self): self._connected = False
    def is_connected(self): return self._connected

    def read(self) -> ImuReading:
        if self._failure_mode:
            raise SensorError("Simulated IMU failure")
        import random
        return ImuReading(
            accel_x=self.accel_bias[0] + random.gauss(0, 0.01),
            accel_y=self.accel_bias[1] + random.gauss(0, 0.01),
            accel_z=self.accel_bias[2] + random.gauss(0, 0.01),
            gyro_x=random.gauss(0, self.gyro_noise),
            gyro_y=random.gauss(0, self.gyro_noise),
            gyro_z=random.gauss(0, self.gyro_noise),
            timestamp_ns=time.time_ns(),
        )

    def simulate_failure(self): self._failure_mode = True
    def recover(self): self._failure_mode = False
```

### 4. Implement the real sensor (I2C example — MPU-6050)

```python
# hardware/real_imu.py
import time
import struct
from smbus2 import SMBus
from .sensor_interface import ImuInterface, ImuReading, SensorError

MPU6050_ADDR = 0x68
PWR_MGMT_1 = 0x6B
ACCEL_XOUT_H = 0x3B
GYRO_XOUT_H = 0x43
ACCEL_SCALE = 9.81 / 16384.0   # ±2g range
GYRO_SCALE = math.radians(1) / 131.0   # ±250°/s range

class Mpu6050(ImuInterface):
    def __init__(self, bus_num: int = 1, address: int = MPU6050_ADDR):
        self.bus_num = bus_num
        self.address = address
        self._bus: SMBus | None = None

        # Calibration offsets (measured at rest)
        self.accel_offset = (0.0, 0.0, 0.0)
        self.gyro_offset = (0.0, 0.0, 0.0)

    def connect(self) -> None:
        try:
            self._bus = SMBus(self.bus_num)
            self._bus.write_byte_data(self.address, PWR_MGMT_1, 0x00)  # wake up
            time.sleep(0.1)
        except Exception as e:
            raise SensorError(f"MPU-6050 connect failed: {e}") from e

    def disconnect(self) -> None:
        if self._bus:
            self._bus.close()

    def is_connected(self) -> bool:
        return self._bus is not None

    def read(self) -> ImuReading:
        try:
            data = self._bus.read_i2c_block_data(self.address, ACCEL_XOUT_H, 14)
            ax, ay, az = [self._to_signed(data[i*2], data[i*2+1]) * ACCEL_SCALE
                         for i in range(3)]
            gx, gy, gz = [self._to_signed(data[8+i*2], data[9+i*2]) * GYRO_SCALE
                         for i in range(3)]
            return ImuReading(
                accel_x=ax - self.accel_offset[0],
                accel_y=ay - self.accel_offset[1],
                accel_z=az - self.accel_offset[2],
                gyro_x=gx - self.gyro_offset[0],
                gyro_y=gy - self.gyro_offset[1],
                gyro_z=gz - self.gyro_offset[2],
                timestamp_ns=time.time_ns(),
            )
        except Exception as e:
            raise SensorError(f"MPU-6050 read failed: {e}") from e

    def calibrate(self, samples: int = 200):
        """Measure bias at rest. Call once on a stationary robot."""
        readings = [self.read() for _ in range(samples) if not time.sleep(0.005)]  # type: ignore
        self.accel_offset = (
            sum(r.accel_x for r in readings) / samples,
            sum(r.accel_y for r in readings) / samples,
            sum(r.accel_z for r in readings) / samples - 9.81,
        )
        self.gyro_offset = (
            sum(r.gyro_x for r in readings) / samples,
            sum(r.gyro_y for r in readings) / samples,
            sum(r.gyro_z for r in readings) / samples,
        )

    @staticmethod
    def _to_signed(high, low):
        val = (high << 8) | low
        return val - 65536 if val > 32767 else val
```

### 5. Create the sensor publisher node with dropout handling

```python
# imu_node.py
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu
from .hardware.sensor_interface import ImuInterface, SensorError
from .hardware.mock_imu import MockImu
from .hardware.real_imu import Mpu6050

CONSECUTIVE_FAILURE_LIMIT = 5

class ImuNode(Node):
    def __init__(self, imu: ImuInterface | None = None):
        super().__init__('imu_node')

        self.declare_parameter('use_mock', False)
        self.declare_parameter('publish_rate', 50.0)   # Hz
        self.declare_parameter('frame_id', 'imu_link')

        rate = self.get_parameter('publish_rate').value
        self.frame_id_ = self.get_parameter('frame_id').value

        if imu is not None:
            self.imu_ = imu
        elif self.get_parameter('use_mock').value:
            self.imu_ = MockImu()
        else:
            self.imu_ = Mpu6050()

        self.imu_.connect()
        self.pub_ = self.create_publisher(Imu, '/imu/raw', 10)
        self.timer_ = self.create_timer(1.0 / rate, self.publish_reading)

        self._failure_count = 0
        self._last_good: Imu | None = None

    def publish_reading(self):
        try:
            raw = self.imu_.read()
            msg = Imu()
            msg.header.stamp = self.get_clock().now().to_msg()
            msg.header.frame_id = self.frame_id_
            msg.linear_acceleration.x = raw.accel_x
            msg.linear_acceleration.y = raw.accel_y
            msg.linear_acceleration.z = raw.accel_z
            msg.angular_velocity.x = raw.gyro_x
            msg.angular_velocity.y = raw.gyro_y
            msg.angular_velocity.z = raw.gyro_z
            # Covariance: -1 means unknown
            msg.orientation_covariance[0] = -1.0
            msg.linear_acceleration_covariance[0] = 0.01
            msg.angular_velocity_covariance[0] = 0.001

            self.pub_.publish(msg)
            self._last_good = msg
            self._failure_count = 0

        except SensorError as e:
            self._failure_count += 1
            self.get_logger().error(f'IMU read failed ({self._failure_count}/{CONSECUTIVE_FAILURE_LIMIT}): {e}')

            if self._failure_count >= CONSECUTIVE_FAILURE_LIMIT:
                self.get_logger().fatal('IMU unresponsive — halting publication. Check hardware.')
                self.timer_.cancel()

    def destroy_node(self):
        self.imu_.disconnect()
        super().destroy_node()
```

---

## Checklist

- [ ] Abstract interface defined for this sensor type with correct `@dataclasses` dataclass
- [ ] Mock generates physically realistic values (correct units, plausible ranges)
- [ ] Real sensor implementation handles `SensorError` on every I/O call
- [ ] Calibration method available (where applicable: IMU, ADC sensors)
- [ ] Node uses correct `sensor_msgs` type with `header.stamp` and `frame_id` set
- [ ] Dropout handling: log error, count consecutive failures, stop publishing after limit
- [ ] Published with correct QoS profile (`qos_profile_sensor_data` for high-rate sensors)
- [ ] Tests cover: normal reading, sensor failure, consecutive failure halt

---

## Common Mistakes

- **Wrong message type.** Using `std_msgs/Float64` instead of `sensor_msgs/Temperature` loses timestamp, frame, and variance. Always use the appropriate `sensor_msgs` type.
- **Missing `header.stamp`.** Downstream nodes (nav2, EKF) use timestamps for sensor fusion. Never leave `stamp` unset.
- **Not handling I2C address conflicts.** Two devices at the same I2C address cause silent failures. Run `i2cdetect -y 1` to audit before wiring.
- **Calibration not persisted.** Calibration offsets measured at runtime are lost on restart. Save to the ROS2 parameter server or a YAML file.
- **Publishing stale data after sensor dropout.** If the sensor fails, stop publishing rather than republishing the last good reading — downstream nodes interpret stale data as fresh.
