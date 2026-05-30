---
name: create-ros2-node
description: Add a new ROS2 node to an existing workspace — publisher/subscriber, service, action, or parameter-driven, with tests
metadata:
  type: skill
  domain: iot
  triggers:
    - "create ros2 node"
    - "add ros2 node"
    - "new publisher"
    - "new subscriber"
    - "ros2 service"
    - "ros2 action"
---

# Skill: create-ros2-node

## When to Use

When adding a new ROS2 node to an existing workspace — whether it's a sensor reader, a controller, a data transformer, or a service handler.

---

## Prerequisites

- Workspace scaffolded (`scaffold-ros2-workspace` complete)
- Workspace builds cleanly (`colcon build` passes)
- Know which communication pattern fits (see decision guide below)

---

## Communication Pattern Decision

| Pattern | Use when | Skip when |
|---------|----------|-----------|
| **Publisher/Subscriber** | Continuous data (sensor readings, state broadcasts) | You need confirmation of delivery |
| **Service** | Discrete request/response (enable motor, get status) | Operation takes >1 second |
| **Action** | Long-running with feedback (navigate to pose, pick object) | Operation is instant |
| **Parameter** | Runtime config values that users tune | The value changes faster than ~1 Hz |

---

## Steps

### 1. Create the node file

Create `src/my_package/my_package/<node_name>.py` using the appropriate template below.

### 2. Register in `setup.py`

Add to `console_scripts`:
```python
'<node_name> = my_package.<node_name>:main',
```

### 3. Create a launch file if this node needs parameters or remappings

See launch file template below.

### 4. Add a unit test

Create `src/my_package/test/test_<node_name>.py` using the test template below.

### 5. Rebuild and verify

```bash
docker compose build
docker compose exec ros2-node ros2 node list
ros2 run my_package <node_name>
```

---

## Templates

### Publisher / Subscriber Node

```python
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan
from std_msgs.msg import Float64
from rclpy.qos import qos_profile_sensor_data


class RangeFilter(Node):
    """Reads LaserScan, publishes minimum range as Float64."""

    def __init__(self):
        super().__init__('range_filter')

        # Parameters — declare before reading
        self.declare_parameter('min_angle', -1.57)
        self.declare_parameter('max_angle', 1.57)
        self.declare_parameter('max_range', 10.0)

        self.min_angle_ = self.get_parameter('min_angle').value
        self.max_angle_ = self.get_parameter('max_angle').value
        self.max_range_ = self.get_parameter('max_range').value

        self.sub_ = self.create_subscription(
            LaserScan, '/scan', self.scan_callback, qos_profile_sensor_data
        )
        self.pub_ = self.create_publisher(Float64, '/range/min', 10)

    def scan_callback(self, msg: LaserScan):
        ranges = [
            r for i, r in enumerate(msg.ranges)
            if (msg.angle_min + i * msg.angle_increment) >= self.min_angle_
            and (msg.angle_min + i * msg.angle_increment) <= self.max_angle_
            and r < self.max_range_
            and r > 0.0
        ]
        if not ranges:
            return

        out = Float64()
        out.data = min(ranges)
        self.pub_.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = RangeFilter()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

### Service Node (Server Side)

```python
import rclpy
from rclpy.node import Node
from std_srvs.srv import SetBool
from geometry_msgs.msg import Twist


class MotorController(Node):
    def __init__(self):
        super().__init__('motor_controller')
        self.enabled_ = False
        self.cmd_pub_ = self.create_publisher(Twist, '/cmd_vel', 10)
        self.srv_ = self.create_service(SetBool, 'enable_motors', self.enable_callback)

    def enable_callback(self, request: SetBool.Request, response: SetBool.Response):
        self.enabled_ = request.data
        if not self.enabled_:
            # Zero velocity immediately on disable
            self.cmd_pub_.publish(Twist())
        self.get_logger().info(f"Motors {'enabled' if self.enabled_ else 'disabled'}")
        response.success = True
        response.message = f"Motors {'enabled' if self.enabled_ else 'disabled'}"
        return response


def main(args=None):
    rclpy.init(args=args)
    node = MotorController()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()
```

### Action Server Node

```python
import rclpy
import asyncio
from rclpy.node import Node
from rclpy.action import ActionServer, CancelResponse, GoalResponse
# Define your action: ros2 interface show <pkg>/action/<ActionName>
# Example uses a hypothetical MoveDistance action:
# float64 distance     # goal
# float64 remaining    # feedback
# bool success         # result

class MoveDistanceServer(Node):
    def __init__(self):
        super().__init__('move_distance_server')
        self._action_server = ActionServer(
            self,
            MoveDistance,          # replace with your action type
            'move_distance',
            execute_callback=self.execute_callback,
            goal_callback=self.goal_callback,
            cancel_callback=self.cancel_callback,
        )

    def goal_callback(self, goal_request):
        self.get_logger().info(f"Received goal: {goal_request.distance}m")
        return GoalResponse.ACCEPT

    def cancel_callback(self, goal_handle):
        self.get_logger().info("Cancel requested")
        return CancelResponse.ACCEPT

    async def execute_callback(self, goal_handle):
        self.get_logger().info("Executing...")
        feedback = MoveDistance.Feedback()
        remaining = goal_handle.request.distance

        while remaining > 0.01:
            if goal_handle.is_cancel_requested:
                goal_handle.canceled()
                return MoveDistance.Result(success=False)

            # Simulate movement
            step = min(0.1, remaining)
            remaining -= step
            feedback.remaining = remaining
            goal_handle.publish_feedback(feedback)
            await asyncio.sleep(0.1)

        goal_handle.succeed()
        return MoveDistance.Result(success=True)


def main(args=None):
    rclpy.init(args=args)
    node = MoveDistanceServer()
    rclpy.spin(node)
```

### Launch File with Parameters

```python
# launch/range_filter.launch.py
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('max_range', default_value='10.0', description='Maximum range to consider'),

        Node(
            package='my_package',
            executable='range_filter',
            name='range_filter',
            parameters=[
                PathJoinSubstitution([FindPackageShare('my_package'), 'config', 'params.yaml']),
                {'max_range': LaunchConfiguration('max_range')},
            ],
            remappings=[('/scan', '/lidar/scan')],
            output='screen',
        ),
    ])
```

### Unit Test Template

```python
# test/test_range_filter.py
import pytest
import rclpy
from std_msgs.msg import Float64
from sensor_msgs.msg import LaserScan


@pytest.fixture(autouse=True)
def ros_init():
    rclpy.init()
    yield
    rclpy.shutdown()


def make_scan(ranges: list[float], angle_min=-1.57, angle_increment=0.01):
    msg = LaserScan()
    msg.angle_min = angle_min
    msg.angle_max = angle_min + len(ranges) * angle_increment
    msg.angle_increment = angle_increment
    msg.range_min = 0.1
    msg.range_max = 30.0
    msg.ranges = [float(r) for r in ranges]
    return msg


def test_range_filter_publishes_minimum():
    from my_package.range_filter import RangeFilter
    node = RangeFilter()
    received: list[float] = []

    node.create_subscription(Float64, '/range/min', lambda m: received.append(m.data), 10)

    scan = make_scan([5.0, 2.0, 8.0, 3.0])
    node.scan_callback(scan)
    rclpy.spin_once(node, timeout_sec=0.1)

    node.destroy_node()
    assert len(received) == 1
    assert received[0] == pytest.approx(2.0)


def test_range_filter_ignores_out_of_range():
    from my_package.range_filter import RangeFilter
    node = RangeFilter()
    received: list[float] = []
    node.create_subscription(Float64, '/range/min', lambda m: received.append(m.data), 10)

    # All ranges exceed max_range (10.0)
    scan = make_scan([15.0, 20.0])
    node.scan_callback(scan)
    rclpy.spin_once(node, timeout_sec=0.1)

    node.destroy_node()
    assert len(received) == 0
```

---

## Checklist

- [ ] Node file created in the package directory
- [ ] Entry point added to `setup.py`
- [ ] Node starts: `ros2 run my_package <node_name>`
- [ ] Topic/service/action visible: `ros2 topic list` / `ros2 service list` / `ros2 action list`
- [ ] Unit tests pass: `colcon test --packages-select my_package && colcon test-result`
- [ ] Parameters declared with types and ranges
- [ ] Logger used instead of `print()`

---

## Files Involved

| File | Action |
|------|--------|
| `src/my_package/my_package/<node_name>.py` | Create |
| `src/my_package/setup.py` | Modify — add console_scripts entry |
| `src/my_package/launch/<node_name>.launch.py` | Create (if parameters or remappings needed) |
| `src/my_package/config/params.yaml` | Create or modify |
| `src/my_package/test/test_<node_name>.py` | Create |

---

## Common Mistakes

- **Using `print()` instead of `self.get_logger().info()`** — ROS2 log messages are visible with `ros2 node log`, `journalctl`, and the Grafana OTel pipeline. `print()` goes only to stdout.
- **QoS mismatch silently drops all messages.** If a subscriber uses RELIABLE but the publisher uses BEST_EFFORT, the connection is silently incompatible. Check with `ros2 topic info -v /topic`.
- **Blocking in a callback.** ROS2 uses a single-threaded executor by default. Any blocking call (sleep, I/O, HTTP request) in a callback blocks all other callbacks. Use `rclpy.executors.MultiThreadedExecutor` or offload to a thread.
- **Not destroying the node.** Always call `node.destroy_node()` before `rclpy.shutdown()` or you'll see "node already destroyed" warnings on the next test run.
- **Actions require an async executor.** Use `rclpy.spin(node)` with a `MultiThreadedExecutor` for action servers, or `rclpy.executors.SingleThreadedExecutor` with `asyncio.run()`.
