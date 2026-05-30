---
name: iot-ros2
description: Build ROS2 (Humble/Iron) nodes in Python with rclpy — publishers, subscribers, services, actions, launch files, and a bridge that sends sensor data to the workbench message bus and RAG ingest API
domain: iot
type: cross-cutting
triggers:
  - "ROS2"
  - "robot"
  - "ROS"
  - "ros2 node"
  - "robotic operating system"
  - "rclpy"
  - "ROS2 node"
  - "robot operating system"
---

# ROS2 with Workbench Integration

## When to use

Activate when the user is building a robotics application with ROS2 (Robot Operating System 2), wants to integrate sensor data into the workbench knowledgebase, or needs to publish robot state/observations for AI-assisted analysis. This skill covers `rclpy` (Python), publisher/subscriber nodes, service servers, launch files, and a bridge script that connects ROS2 topics to the workbench message bus and RAG ingest API.

## Prerequisites

- ROS2 Humble (Ubuntu 22.04) or ROS2 Iron (Ubuntu 23.04) installed; source `/opt/ros/humble/setup.bash`
- Python 3.10+ (ships with Ubuntu 22.04; ROS2 Humble uses this by default)
- Workbench running (`make up`) — `http://localhost:3100`
- `requests` Python package: `pip3 install requests` (for the bridge script)
- A ROS2 workspace: `mkdir -p ~/ros2_ws/src && cd ~/ros2_ws`

## Package Layout

```
~/ros2_ws/src/
└── workbench_bridge/
    ├── package.xml
    ├── setup.py
    ├── setup.cfg
    ├── resource/
    │   └── workbench_bridge
    └── workbench_bridge/
        ├── __init__.py
        ├── sensor_publisher.py
        ├── sensor_subscriber.py
        ├── query_service.py
        └── workbench_bridge_node.py
```

## package.xml

```xml
<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>workbench_bridge</name>
  <version>0.1.0</version>
  <description>Bridge ROS2 sensor topics to the AI Dev Workbench API</description>
  <maintainer email="dev@example.com">developer</maintainer>
  <license>MIT</license>

  <exec_depend>rclpy</exec_depend>
  <exec_depend>std_msgs</exec_depend>
  <exec_depend>sensor_msgs</exec_depend>
  <exec_depend>example_interfaces</exec_depend>

  <test_depend>ament_copyright</test_depend>
  <test_depend>ament_flake8</test_depend>
  <test_depend>ament_pep257</test_depend>
  <test_depend>pytest</test_depend>

  <export>
    <build_type>ament_python</build_type>
  </export>
</package>
```

## setup.py

```python
# setup.py
from setuptools import find_packages, setup
import os
from glob import glob

package_name = 'workbench_bridge'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        # Install launch files
        (os.path.join('share', package_name, 'launch'),
         glob(os.path.join('launch', '*launch.[pxy][yma]*'))),
    ],
    install_requires=['setuptools', 'requests'],
    zip_safe=True,
    entry_points={
        'console_scripts': [
            'sensor_publisher = workbench_bridge.sensor_publisher:main',
            'sensor_subscriber = workbench_bridge.sensor_subscriber:main',
            'query_service = workbench_bridge.query_service:main',
            'workbench_bridge = workbench_bridge.workbench_bridge_node:main',
        ],
    },
)
```

## Publisher + Subscriber Node Template

```python
# workbench_bridge/sensor_publisher.py
"""Publishes simulated sensor data on /sensor/temperature every second."""
import rclpy
from rclpy.node import Node
from std_msgs.msg import Float64
import random


class SensorPublisher(Node):
    def __init__(self):
        super().__init__('sensor_publisher')

        # Declare parameters (can be overridden at launch time)
        self.declare_parameter('publish_rate_hz', 1.0)
        self.declare_parameter('sensor_id', 'sensor_01')

        rate = self.get_parameter('publish_rate_hz').get_parameter_value().double_value
        self.sensor_id = self.get_parameter('sensor_id').get_parameter_value().string_value

        self.publisher_ = self.create_publisher(Float64, '/sensor/temperature', 10)
        self.timer = self.create_timer(1.0 / rate, self.publish_reading)
        self.get_logger().info(f'SensorPublisher started: {self.sensor_id} @ {rate}Hz')

    def publish_reading(self):
        msg = Float64()
        # Replace with real sensor read (GPIO, I2C, serial) in production
        msg.data = 20.0 + random.gauss(0, 0.5)
        self.publisher_.publish(msg)
        self.get_logger().debug(f'Published: {msg.data:.2f}°C')


def main(args=None):
    rclpy.init(args=args)
    node = SensorPublisher()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

```python
# workbench_bridge/sensor_subscriber.py
"""Subscribes to /sensor/temperature and logs readings."""
import rclpy
from rclpy.node import Node
from std_msgs.msg import Float64


class SensorSubscriber(Node):
    def __init__(self):
        super().__init__('sensor_subscriber')
        self.subscription = self.create_subscription(
            Float64,
            '/sensor/temperature',
            self.listener_callback,
            10   # QoS depth
        )
        self.get_logger().info('SensorSubscriber listening on /sensor/temperature')

    def listener_callback(self, msg: Float64):
        self.get_logger().info(f'Received temperature: {msg.data:.2f}°C')


def main(args=None):
    rclpy.init(args=args)
    node = SensorSubscriber()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

## Service Server Template

```python
# workbench_bridge/query_service.py
"""
ROS2 service server that accepts a string query and returns a string response
by calling the workbench RAG API.
Uses the example_interfaces/srv/SetBool as a simple on/off trigger example,
or a custom service for query/response.
"""
import rclpy
from rclpy.node import Node
from example_interfaces.srv import SetBool
import requests


class WorkbenchQueryService(Node):
    def __init__(self):
        super().__init__('workbench_query_service')
        self.declare_parameter('workbench_url', 'http://localhost:3100')
        self.declare_parameter('project', 'default')

        self.wb_url = self.get_parameter('workbench_url').get_parameter_value().string_value
        self.project = self.get_parameter('project').get_parameter_value().string_value

        self.srv = self.create_service(
            SetBool,
            'workbench/trigger_knowledge_refresh',
            self.handle_trigger
        )
        self.get_logger().info('WorkbenchQueryService ready')

    def handle_trigger(self, request: SetBool.Request, response: SetBool.Response):
        if not request.data:
            response.success = False
            response.message = 'data=False: no-op'
            return response

        try:
            r = requests.post(
                f'{self.wb_url}/api/projects/{self.project}/rag/query',
                json={'query': 'latest sensor anomalies', 'top_k': 3},
                timeout=10
            )
            r.raise_for_status()
            results = r.json().get('results', [])
            response.success = True
            response.message = f'Found {len(results)} results'
        except Exception as e:
            response.success = False
            response.message = str(e)
        return response


def main(args=None):
    rclpy.init(args=args)
    node = WorkbenchQueryService()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

## Workbench Bridge Node

This is the key integration: subscribes to sensor topics and pushes data to the workbench bus and ingest API.

```python
# workbench_bridge/workbench_bridge_node.py
"""
Subscribes to /sensor/temperature, publishes readings to the workbench
message bus every N messages, and ingests a summary document every M seconds.
"""
import json
import threading
import requests
import rclpy
from rclpy.node import Node
from std_msgs.msg import Float64


class WorkbenchBridgeNode(Node):
    def __init__(self):
        super().__init__('workbench_bridge')

        self.declare_parameter('workbench_url', 'http://localhost:3100')
        self.declare_parameter('project', 'default')
        self.declare_parameter('bus_publish_every_n', 5)   # publish to bus every N readings
        self.declare_parameter('ingest_interval_sec', 60.0) # ingest summary every 60s

        self.wb_url = self.get_parameter('workbench_url').get_parameter_value().string_value
        self.project = self.get_parameter('project').get_parameter_value().string_value
        every_n = self.get_parameter('bus_publish_every_n').get_parameter_value().integer_value
        ingest_interval = self.get_parameter('ingest_interval_sec').get_parameter_value().double_value

        self.readings: list[float] = []
        self.reading_count = 0
        self.every_n = every_n

        self.subscription = self.create_subscription(
            Float64,
            '/sensor/temperature',
            self.on_reading,
            10
        )

        # Timer for periodic RAG ingest
        self.ingest_timer = self.create_timer(ingest_interval, self.ingest_summary)
        self.get_logger().info(f'WorkbenchBridge started → {self.wb_url}')

    def on_reading(self, msg: Float64):
        self.readings.append(msg.data)
        self.reading_count += 1
        if self.reading_count % self.every_n == 0:
            # Publish to workbench bus in a background thread (non-blocking)
            threading.Thread(target=self._publish_to_bus, args=(msg.data,), daemon=True).start()

    def _publish_to_bus(self, value: float):
        """POST sensor reading to the workbench message bus."""
        try:
            payload = {
                'channel': f'{self.project}.sensors.temperature',
                'message': {
                    'value': value,
                    'unit': 'celsius',
                    'node': self.get_name(),
                    'timestamp': self.get_clock().now().nanoseconds,
                }
            }
            r = requests.post(
                f'{self.wb_url}/api/projects/{self.project}/bus/publish',
                json=payload,
                timeout=5
            )
            if r.ok:
                self.get_logger().debug(f'Bus publish OK: {value:.2f}°C')
            else:
                self.get_logger().warning(f'Bus publish failed: {r.status_code}')
        except Exception as e:
            self.get_logger().error(f'Bus publish error: {e}')

    def ingest_summary(self):
        """Ingest a rolling summary of readings into the RAG knowledgebase."""
        if not self.readings:
            return
        recent = self.readings[-60:]  # last 60 readings
        avg = sum(recent) / len(recent)
        min_val = min(recent)
        max_val = max(recent)
        summary = (
            f"Temperature summary ({len(recent)} readings): "
            f"avg={avg:.2f}°C, min={min_val:.2f}°C, max={max_val:.2f}°C. "
            f"Node: {self.get_name()}, project: {self.project}."
        )
        threading.Thread(target=self._ingest_doc, args=(summary,), daemon=True).start()

    def _ingest_doc(self, content: str):
        """POST a document to the workbench RAG ingest endpoint."""
        try:
            r = requests.post(
                f'{self.wb_url}/api/projects/{self.project}/rag/ingest',
                json={
                    'content': content,
                    'title': f'Sensor summary — {self.get_name()}',
                    'metadata': {'source': 'ros2_bridge', 'node': self.get_name()}
                },
                timeout=15
            )
            if r.ok:
                data = r.json()
                self.get_logger().info(
                    f'Ingested summary: {data.get("chunk_count", "?")} chunks'
                )
            else:
                self.get_logger().warning(f'Ingest failed: {r.status_code}')
        except Exception as e:
            self.get_logger().error(f'Ingest error: {e}')


def main(args=None):
    rclpy.init(args=args)
    node = WorkbenchBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
```

## Launch File Template

```python
# launch/workbench_bridge.launch.py
from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('workbench_url', default_value='http://localhost:3100'),
        DeclareLaunchArgument('project', default_value='default'),

        Node(
            package='workbench_bridge',
            executable='sensor_publisher',
            name='temperature_sensor',
            parameters=[{
                'publish_rate_hz': 2.0,
                'sensor_id': 'sensor_01',
            }]
        ),
        Node(
            package='workbench_bridge',
            executable='workbench_bridge',
            name='workbench_bridge',
            parameters=[{
                'workbench_url': LaunchConfiguration('workbench_url'),
                'project': LaunchConfiguration('project'),
                'bus_publish_every_n': 5,
                'ingest_interval_sec': 60.0,
            }]
        ),
    ])
```

## Build and Run

```bash
# Source ROS2
source /opt/ros/humble/setup.bash

# Build the package
cd ~/ros2_ws
colcon build --packages-select workbench_bridge
source install/setup.bash

# Run individually
ros2 run workbench_bridge sensor_publisher
ros2 run workbench_bridge workbench_bridge \
  --ros-args -p workbench_url:=http://localhost:3100 -p project:=default

# Or with the launch file
ros2 launch workbench_bridge workbench_bridge.launch.py \
  workbench_url:=http://localhost:3100 project:=myproject

# Inspect the topic
ros2 topic echo /sensor/temperature
ros2 topic hz /sensor/temperature
```

## Checklist

- [ ] `source /opt/ros/humble/setup.bash` before every build/run
- [ ] `colcon build` succeeds with zero errors
- [ ] `source install/setup.bash` after build
- [ ] `workbench_url` parameter points to correct host (not `localhost` from inside Docker)
- [ ] Bridge node threads are daemon threads (won't block shutdown)
- [ ] `requests` package installed in the same Python environment ROS2 uses
- [ ] Launch file installs into `share/<pkg>/launch/` via `data_files` in `setup.py`
- [ ] Bus publish channel name is namespaced: `<project>.sensors.<type>`

## Files involved

| File | Action |
|------|--------|
| `workbench_bridge/package.xml` | Create: ROS2 package manifest |
| `workbench_bridge/setup.py` | Create: Python package setup with entry points |
| `workbench_bridge/workbench_bridge/sensor_publisher.py` | Create: sensor publisher node |
| `workbench_bridge/workbench_bridge/sensor_subscriber.py` | Create: sensor subscriber node |
| `workbench_bridge/workbench_bridge/query_service.py` | Create: ROS2 service server |
| `workbench_bridge/workbench_bridge/workbench_bridge_node.py` | Create: bus + ingest bridge |
| `workbench_bridge/launch/workbench_bridge.launch.py` | Create: launch file |

## Common mistakes

**Forgetting to source the ROS2 setup and workspace overlay** — every new terminal needs `source /opt/ros/humble/setup.bash` AND `source ~/ros2_ws/install/setup.bash`. Without the workspace overlay, `ros2 run workbench_bridge ...` fails with "package not found" even after a successful build.

**Making blocking HTTP calls in the ROS2 callback** — `rclpy.spin()` is single-threaded by default. A slow `requests.post()` in the subscriber callback blocks all other message processing. Always dispatch HTTP calls to a background `threading.Thread` or use a `MultiThreadedExecutor`.

**Using `localhost` from inside a Docker container** — if ROS2 nodes run inside Docker and the workbench also runs in Docker, `localhost` in the node refers to the container itself. Use the Docker service name `http://mcp-server:3100` (if on the same network) or the host machine's LAN IP with `--network host`.

**Not declaring parameters before getting them** — in ROS2 Humble+, `get_parameter()` throws `ParameterNotDeclaredException` if `declare_parameter()` was not called first. Declare all parameters in `__init__` before reading them.

**`colcon build` picking up the wrong Python** — ROS2 Humble uses the system Python3. If you have a virtual environment activated, `colcon build` may use the venv Python while `ros2 run` uses the system Python, causing import errors. Deactivate any venv before building and running ROS2 packages.
