---
name: write-robot-controller
description: Implement a robot controller with mandatory safety layer — velocity clamping, e-stop, watchdog timer, and circuit breaker
metadata:
  type: skill
  domain: iot
  triggers:
    - "robot controller"
    - "velocity controller"
    - "differential drive"
    - "motor control"
    - "robot navigation"
    - "cmd_vel"
    - "write controller"
---

# Skill: write-robot-controller

## When to Use

When writing any node that outputs actuation commands to a robot — wheels, arms, grippers, pumps, or any actuator. **Safety mechanisms are mandatory, not optional.** This skill treats the safety layer as a pre-condition, not an afterthought.

---

## Prerequisites

- Sensor interfaces exist and publish at known rates (`add-sensor-interface` applied)
- ROS2 workspace builds and tests pass
- Know: max safe velocity, safe deceleration rate, sensor timeout threshold

---

## Safety Requirements (Non-Negotiable)

Every controller written with this skill MUST implement all four:

| Mechanism | What it does | Failure if missing |
|-----------|-------------|-------------------|
| **Velocity clamping** | Hard limits on velocity and acceleration | Robot moves faster than hardware or environment can handle |
| **E-stop subscriber** | Any message on `/e_stop` zeros all commands immediately | No way to halt robot remotely |
| **Watchdog timer** | If no new sensor data arrives within N ms, stop actuators | Sensor cable unplugged → robot drives blind forever |
| **Circuit breaker** | N consecutive sensor failures → halt and alert | Transient error masking real hardware failure |

---

## Steps

### 1. Create the safety layer module

```python
# safety/safety_monitor.py
import time
import threading
from dataclasses import dataclass, field


@dataclass
class SafetyConfig:
    max_linear_vel: float = 1.0      # m/s
    max_angular_vel: float = 1.5     # rad/s
    max_linear_accel: float = 0.5    # m/s²/step
    max_angular_accel: float = 1.0   # rad/s²/step
    sensor_timeout_ms: float = 500   # ms before watchdog fires
    failure_threshold: int = 5       # consecutive failures before circuit break


class SafetyMonitor:
    def __init__(self, cfg: SafetyConfig):
        self.cfg = cfg
        self._estop = threading.Event()
        self._last_sensor_time: float = time.monotonic()
        self._failure_count: int = 0
        self._circuit_open: bool = False   # True = tripped, stop motors

    # ── E-stop ────────────────────────────────────────────────
    def engage_estop(self):
        self._estop.set()

    def release_estop(self):
        self._estop.clear()
        self.reset_circuit()

    @property
    def estop_active(self) -> bool:
        return self._estop.is_set()

    # ── Watchdog ──────────────────────────────────────────────
    def sensor_heartbeat(self):
        """Call every time valid sensor data arrives."""
        self._last_sensor_time = time.monotonic()
        self._failure_count = 0

    def sensor_failure(self):
        """Call every time a sensor read fails."""
        self._failure_count += 1
        if self._failure_count >= self.cfg.failure_threshold:
            self._circuit_open = True

    @property
    def watchdog_fired(self) -> bool:
        elapsed_ms = (time.monotonic() - self._last_sensor_time) * 1000
        return elapsed_ms > self.cfg.sensor_timeout_ms

    # ── Circuit breaker ───────────────────────────────────────
    @property
    def circuit_open(self) -> bool:
        return self._circuit_open

    def reset_circuit(self):
        self._circuit_open = False
        self._failure_count = 0

    # ── Velocity clamping ─────────────────────────────────────
    def clamp_velocity(self, linear: float, angular: float,
                       prev_linear: float, prev_angular: float) -> tuple[float, float]:
        """Clamp velocity and acceleration. Returns (linear, angular)."""
        if self.estop_active or self.watchdog_fired or self.circuit_open:
            return 0.0, 0.0

        # Clamp velocity magnitude
        linear = max(-self.cfg.max_linear_vel, min(self.cfg.max_linear_vel, linear))
        angular = max(-self.cfg.max_angular_vel, min(self.cfg.max_angular_vel, angular))

        # Clamp acceleration (rate of change)
        linear = max(prev_linear - self.cfg.max_linear_accel,
                     min(prev_linear + self.cfg.max_linear_accel, linear))
        angular = max(prev_angular - self.cfg.max_angular_accel,
                     min(prev_angular + self.cfg.max_angular_accel, angular))

        return linear, angular

    def is_safe(self) -> bool:
        return not self.estop_active and not self.watchdog_fired and not self.circuit_open

    def status_string(self) -> str:
        reasons = []
        if self.estop_active: reasons.append("ESTOP")
        if self.watchdog_fired: reasons.append("WATCHDOG")
        if self.circuit_open: reasons.append("CIRCUIT_OPEN")
        return "SAFE" if not reasons else f"HALT({','.join(reasons)})"
```

### 2. Create the controller node

```python
# differential_drive_controller.py
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from std_msgs.msg import Bool, String
from sensor_msgs.msg import LaserScan
from rclpy.qos import qos_profile_sensor_data
from .safety.safety_monitor import SafetyMonitor, SafetyConfig


class DifferentialDriveController(Node):
    def __init__(self):
        super().__init__('differential_drive_controller')

        # Safety configuration via parameters
        cfg = SafetyConfig(
            max_linear_vel=self.declare_parameter('max_linear_vel', 1.0).value,
            max_angular_vel=self.declare_parameter('max_angular_vel', 1.5).value,
            max_linear_accel=self.declare_parameter('max_linear_accel', 0.5).value,
            max_angular_accel=self.declare_parameter('max_angular_accel', 1.0).value,
            sensor_timeout_ms=self.declare_parameter('sensor_timeout_ms', 500.0).value,
            failure_threshold=self.declare_parameter('failure_threshold', 5).value,
        )
        self.safety_ = SafetyMonitor(cfg)

        self._prev_linear = 0.0
        self._prev_angular = 0.0

        # ── Subscribers ──────────────────────────────────────────
        # Command input
        self.cmd_sub_ = self.create_subscription(
            Twist, '/cmd_vel_input', self.cmd_callback, 10
        )
        # E-stop: any message on this topic engages e-stop
        self.estop_sub_ = self.create_subscription(
            Bool, '/e_stop', self.estop_callback, 10
        )
        # Sensor for watchdog
        self.scan_sub_ = self.create_subscription(
            LaserScan, '/scan', self.scan_callback, qos_profile_sensor_data
        )

        # ── Publishers ───────────────────────────────────────────
        # Actual motor commands (after safety filter)
        self.cmd_pub_ = self.create_publisher(Twist, '/cmd_vel', 10)
        # Safety status for monitoring
        self.status_pub_ = self.create_publisher(String, '/controller/status', 10)

        # ── Watchdog timer ───────────────────────────────────────
        self.watchdog_timer_ = self.create_timer(0.05, self.watchdog_check)

        self.get_logger().info('Differential drive controller started')

    def cmd_callback(self, msg: Twist):
        linear, angular = self.safety_.clamp_velocity(
            msg.linear.x, msg.angular.z,
            self._prev_linear, self._prev_angular,
        )

        out = Twist()
        out.linear.x = linear
        out.angular.z = angular
        self.cmd_pub_.publish(out)

        self._prev_linear = linear
        self._prev_angular = angular

    def estop_callback(self, msg: Bool):
        if msg.data:
            self.safety_.engage_estop()
            # Publish zero velocity immediately, don't wait for next cmd
            self.cmd_pub_.publish(Twist())
            self.get_logger().warn('E-STOP ENGAGED')
        else:
            self.safety_.release_estop()
            self.get_logger().info('E-stop released')

    def scan_callback(self, msg: LaserScan):
        # Tell safety monitor sensor is alive
        self.safety_.sensor_heartbeat()

    def watchdog_check(self):
        status = String()
        status.data = self.safety_.status_string()
        self.status_pub_.publish(status)

        if self.safety_.watchdog_fired and not self.safety_.estop_active:
            self.get_logger().warn(f'Watchdog: no sensor data — stopping motors')
            self.cmd_pub_.publish(Twist())

        if self.safety_.circuit_open:
            self.get_logger().error('Circuit breaker open — sensor failure threshold exceeded')
            self.cmd_pub_.publish(Twist())


def main(args=None):
    rclpy.init(args=args)
    node = DifferentialDriveController()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

### 3. Test the safety layer thoroughly

```python
# test/test_safety_monitor.py
import pytest
import time
from my_package.safety.safety_monitor import SafetyMonitor, SafetyConfig


@pytest.fixture
def safety():
    return SafetyMonitor(SafetyConfig(
        max_linear_vel=1.0,
        max_angular_vel=1.5,
        sensor_timeout_ms=100,
        failure_threshold=3,
    ))


def test_velocity_clamping(safety):
    safety.sensor_heartbeat()
    lin, ang = safety.clamp_velocity(5.0, 3.0, 0.0, 0.0)
    assert lin <= 1.0
    assert ang <= 1.5


def test_acceleration_clamping(safety):
    safety.sensor_heartbeat()
    lin, ang = safety.clamp_velocity(10.0, 10.0, 0.0, 0.0)
    assert lin <= safety.cfg.max_linear_accel
    assert ang <= safety.cfg.max_angular_accel


def test_estop_zeros_velocity(safety):
    safety.sensor_heartbeat()
    safety.engage_estop()
    lin, ang = safety.clamp_velocity(1.0, 1.0, 0.0, 0.0)
    assert lin == 0.0
    assert ang == 0.0


def test_watchdog_fires_on_timeout(safety):
    # Don't call sensor_heartbeat — watchdog should fire immediately
    time.sleep(0.15)  # > sensor_timeout_ms (100ms)
    assert safety.watchdog_fired


def test_watchdog_does_not_fire_with_data(safety):
    safety.sensor_heartbeat()
    assert not safety.watchdog_fired


def test_circuit_breaker_opens_after_failures(safety):
    for _ in range(3):
        safety.sensor_failure()
    assert safety.circuit_open


def test_circuit_breaker_resets(safety):
    for _ in range(3):
        safety.sensor_failure()
    safety.reset_circuit()
    assert not safety.circuit_open
```

---

## Checklist

- [ ] `SafetyConfig` parameters declared via ROS2 parameter server (tunable without rebuild)
- [ ] E-stop subscriber on `/e_stop` — publishes `Twist()` zero immediately on engage
- [ ] Watchdog timer at ≥10 Hz — fires if sensor data stops arriving
- [ ] Circuit breaker trips after N consecutive sensor failures
- [ ] Velocity and acceleration clamping applied before every `cmd_vel` publish
- [ ] Safety status published on `/controller/status` for monitoring
- [ ] Safety layer unit tests all pass (clamping, e-stop, watchdog, circuit breaker)
- [ ] Parameters tuned conservatively — start with max_velocity = 30% of hardware limit

---

## Files Involved

| File | Action |
|------|--------|
| `src/my_package/my_package/safety/safety_monitor.py` | Create |
| `src/my_package/my_package/safety/__init__.py` | Create (empty) |
| `src/my_package/my_package/differential_drive_controller.py` | Create |
| `src/my_package/setup.py` | Modify — add console_scripts entry |
| `src/my_package/test/test_safety_monitor.py` | Create |
| `src/my_package/config/controller_params.yaml` | Create — safety config values |

---

## Common Mistakes

- **Treating safety as optional.** Velocity clamping, e-stop, watchdog, and circuit breaker are all required. Removing any one of them means the robot can move uncontrolled.
- **E-stop on same QoS as sensor data.** E-stop must be RELIABLE QoS so it is never dropped. Use the default reliable QoS for the e-stop subscriber.
- **Watchdog on a slow timer.** A 1Hz watchdog check with a 500ms sensor timeout means the robot could move for up to 2 seconds after sensor data stops. Run the watchdog timer at ≥10 Hz.
- **Not publishing zero on watchdog fire.** Checking `watchdog_fired` without publishing `Twist()` leaves the last command active. Always publish zeros when halting.
- **Acceleration clamping with time-varying dt.** The `clamp_velocity` function above uses a fixed step size. For variable timer rates, scale `max_accel` by the actual `dt` measured each cycle.
- **Hardware limits in code, not parameters.** Hard-coding `max_velocity = 1.0` makes it impossible to tune for a different robot. Always use ROS2 parameters.
