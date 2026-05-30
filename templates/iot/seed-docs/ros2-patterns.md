# ROS2 Patterns — Jazzy Jalisco

## Node Lifecycle

ROS2 managed nodes follow a four-state lifecycle. Unmanaged nodes skip this (common for simple publishers).

```
unconfigured → [configure] → inactive → [activate] → active → [deactivate] → inactive
                                                                              ↓
                                                              [cleanup] → unconfigured
                                                              [shutdown] → finalized
```

**When to use managed lifecycle:** Any node that allocates hardware resources (camera, serial port, actuator) should use managed lifecycle so those resources can be released without killing the process.

```python
import rclpy
from rclpy.lifecycle import LifecycleNode, TransitionCallbackReturn, State

class MyManagedNode(LifecycleNode):
    def __init__(self):
        super().__init__('my_node')

    def on_configure(self, state: State) -> TransitionCallbackReturn:
        self.get_logger().info('Configuring...')
        # Declare parameters, create publishers/subscribers
        self.pub_ = self.create_lifecycle_publisher(String, 'output', 10)
        return TransitionCallbackReturn.SUCCESS

    def on_activate(self, state: State) -> TransitionCallbackReturn:
        # Open hardware resources here
        self.pub_.on_activate(state)
        return TransitionCallbackReturn.SUCCESS

    def on_deactivate(self, state: State) -> TransitionCallbackReturn:
        self.pub_.on_deactivate(state)
        return TransitionCallbackReturn.SUCCESS

    def on_cleanup(self, state: State) -> TransitionCallbackReturn:
        # Release hardware resources
        self.destroy_publisher(self.pub_)
        return TransitionCallbackReturn.SUCCESS
```

---

## Communication Patterns — Decision Guide

| Pattern | Use when | Latency | Reliability |
|---------|----------|---------|-------------|
| **Topic** (pub/sub) | Continuous data streams, state broadcasts | Low overhead | Best-effort or reliable via QoS |
| **Service** | Request/response for discrete operations | Synchronous, blocks caller | Reliable (retry built in) |
| **Action** | Long-running tasks with feedback | Async, preemptable | Reliable with goal/feedback/result |
| **Parameter** | Runtime config without restart | Low | Persistent across restarts |

**Heuristic:** If you need an answer back → service. If it takes >1 second → action. If it's a stream → topic.

---

## Topics (Publisher / Subscriber)

```python
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy

class LidarProcessor(Node):
    def __init__(self):
        super().__init__('lidar_processor')

        # QoS for sensor data: best-effort (drop old messages), keep last 1
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=1
        )

        self.sub_ = self.create_subscription(
            LaserScan, '/scan', self.scan_callback, sensor_qos
        )
        self.pub_ = self.create_publisher(LaserScan, '/scan/filtered', 10)

        # Timer-based publisher: 10 Hz
        self.timer_ = self.create_timer(0.1, self.timer_callback)

    def scan_callback(self, msg: LaserScan):
        # Process and republish
        self.pub_.publish(msg)

    def timer_callback(self):
        self.get_logger().debug('Timer fired')
```

---

## Services (Request / Response)

```python
from rclpy.node import Node
from std_srvs.srv import SetBool

class SafetyController(Node):
    def __init__(self):
        super().__init__('safety_controller')
        self.srv_ = self.create_service(SetBool, 'set_estop', self.estop_callback)

    def estop_callback(self, request, response):
        if request.data:
            self.get_logger().warn('E-STOP ENGAGED')
            response.success = True
            response.message = 'E-stop engaged'
        else:
            response.success = True
            response.message = 'E-stop released'
        return response

# Client side:
class EStopClient(Node):
    def __init__(self):
        super().__init__('estop_client')
        self.client_ = self.create_client(SetBool, 'set_estop')

    def send_estop(self, engage: bool):
        self.client_.wait_for_service(timeout_sec=1.0)
        req = SetBool.Request()
        req.data = engage
        future = self.client_.call_async(req)
        rclpy.spin_until_future_complete(self, future)
        return future.result()
```

---

## Actions (Long-Running with Feedback)

```python
from rclpy.action import ActionServer, ActionClient
from action_tutorials_interfaces.action import Fibonacci  # example; define your own

class NavigationServer(Node):
    def __init__(self):
        super().__init__('navigation_server')
        self._action_server = ActionServer(
            self, Fibonacci, 'navigate_to_pose', self.execute_callback
        )

    async def execute_callback(self, goal_handle):
        self.get_logger().info('Executing goal...')
        feedback_msg = Fibonacci.Feedback()

        for i in range(goal_handle.request.order):
            feedback_msg.partial_sequence = [i]
            goal_handle.publish_feedback(feedback_msg)
            await asyncio.sleep(0.1)  # simulate work

            if goal_handle.is_cancel_requested:
                goal_handle.canceled()
                return Fibonacci.Result()

        goal_handle.succeed()
        result = Fibonacci.Result()
        return result
```

---

## Parameters

```python
class ConfigurableNode(Node):
    def __init__(self):
        super().__init__('configurable_node')

        # Declare with type + description + range constraint
        self.declare_parameter('max_velocity', 1.0,
            ParameterDescriptor(description='Max velocity m/s', floating_point_range=[
                FloatingPointRange(from_value=0.0, to_value=5.0, step=0.01)
            ])
        )
        self.declare_parameter('frame_id', 'base_link')

        # Read
        self.max_vel_ = self.get_parameter('max_velocity').get_parameter_value().double_value

        # Listen for changes
        self.add_on_set_parameters_callback(self.param_callback)

    def param_callback(self, params):
        for param in params:
            if param.name == 'max_velocity':
                self.max_vel_ = param.value
        return SetParametersResult(successful=True)
```

---

## Common Message Types

| Type | Package | Use |
|------|---------|-----|
| `Twist` | `geometry_msgs` | Velocity commands (linear.x, angular.z for differential drive) |
| `TwistStamped` | `geometry_msgs` | Velocity with timestamp + frame_id |
| `PoseStamped` | `geometry_msgs` | Position + orientation in a coordinate frame |
| `LaserScan` | `sensor_msgs` | 2D lidar data (ranges, angle_min/max/increment) |
| `Image` | `sensor_msgs` | Camera images (height, width, encoding, data) |
| `Imu` | `sensor_msgs` | Accelerometer + gyroscope + orientation |
| `Odometry` | `nav_msgs` | Robot position estimate from wheel encoders |
| `JointState` | `sensor_msgs` | Joint positions, velocities, efforts |
| `Bool` | `std_msgs` | Simple boolean signals (e-stop, mode flags) |
| `Float64` | `std_msgs` | Single float value |
| `String` | `std_msgs` | Text messages, status strings |
| `Header` | `std_msgs` | Timestamp + frame_id (embedded in most messages) |

---

## QoS Profiles — Quick Reference

```python
from rclpy.qos import (
    QoSProfile, ReliabilityPolicy, DurabilityPolicy, HistoryPolicy, qos_profile_sensor_data
)

# Sensor data — best effort, volatile (drop old, don't queue)
sensor_qos = qos_profile_sensor_data  # convenience preset

# Command/control — reliable delivery required
reliable_qos = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.VOLATILE,
    depth=10
)

# Late-joiner gets last value (e.g., robot description, map)
latched_qos = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
    depth=1
)
```

**Rule:** Sensor streams → BEST_EFFORT (dropping stale data is fine, retransmit is not). Commands → RELIABLE (every command must arrive). Static data (URDF, map) → TRANSIENT_LOCAL so late-joining nodes get the last published value.

---

## DDS QoS Compatibility

Publisher and subscriber QoS must be compatible or the connection silently fails (no error, no data). Check with `ros2 topic info -v /topic_name`.

| Publisher | Subscriber | Compatible? |
|-----------|-----------|-------------|
| RELIABLE | RELIABLE | Yes |
| RELIABLE | BEST_EFFORT | Yes |
| BEST_EFFORT | RELIABLE | **No** |
| BEST_EFFORT | BEST_EFFORT | Yes |
| TRANSIENT_LOCAL | TRANSIENT_LOCAL | Yes |
| VOLATILE | TRANSIENT_LOCAL | **No** |

---

## Launch Files

```python
# launch/my_system.launch.py
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare

def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),

        Node(
            package='my_package',
            executable='my_node',
            name='my_node',
            parameters=[
                {'use_sim_time': LaunchConfiguration('use_sim_time')},
                PathJoinSubstitution([
                    FindPackageShare('my_package'), 'config', 'params.yaml'
                ]),
            ],
            remappings=[('/old_topic', '/new_topic')],
            output='screen',
        ),

        # Include another launch file
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource([
                FindPackageShare('other_package'), '/launch/other.launch.py'
            ]),
        ),
    ])
```

---

## Unit Testing Pattern

```python
# test/test_my_node.py
import pytest
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

@pytest.fixture(autouse=True)
def ros_setup():
    rclpy.init()
    yield
    rclpy.shutdown()

def test_node_publishes():
    node = rclpy.create_node('test_node')
    received = []

    sub = node.create_subscription(String, '/output', lambda msg: received.append(msg.data), 10)
    pub = node.create_publisher(String, '/input', 10)

    msg = String()
    msg.data = 'hello'
    pub.publish(msg)

    # Spin once to process callbacks
    rclpy.spin_once(node, timeout_sec=0.1)

    node.destroy_node()
    # Note: in CI without hardware, test the logic, not the hardware response
```

---

## colcon Build Reference

```bash
# Build all packages
colcon build --symlink-install

# Build specific package
colcon build --packages-select my_package

# Source the workspace
source install/setup.bash

# Run a node
ros2 run my_package my_node

# Run a launch file
ros2 launch my_package my_system.launch.py

# List active topics/nodes
ros2 topic list
ros2 node list
ros2 topic echo /my_topic
ros2 topic hz /my_topic   # measure publish frequency
```
