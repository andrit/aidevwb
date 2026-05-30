---
name: scaffold-ros2-workspace
description: Set up a ROS2 Jazzy colcon workspace inside Docker — package layout, build system, environment sourcing, and first node
metadata:
  type: skill
  domain: iot
  triggers:
    - "scaffold ros2"
    - "set up ros2 workspace"
    - "create ros2 package"
    - "colcon build"
    - "new ros2 project"
---

# Skill: scaffold-ros2-workspace

## When to Use

When starting a new ROS2 project from scratch — you need a working colcon workspace, package structure, and a verified first build before writing any application logic.

---

## Prerequisites

- Project type is `iot`, framework is `ros2-python`
- Docker with `ros:jazzy-ros-base` image available (or internet access to pull it)
- Workbench running (`make up`)

---

## Steps

### 1. Create the workspace directory structure

```
my_robot_ws/
├── src/
│   └── my_package/
│       ├── my_package/
│       │   ├── __init__.py
│       │   └── my_node.py
│       ├── launch/
│       │   └── my_system.launch.py
│       ├── config/
│       │   └── params.yaml
│       ├── test/
│       │   └── test_my_node.py
│       ├── package.xml
│       ├── setup.py
│       └── setup.cfg
├── Dockerfile
├── docker-compose.yml
└── .env
```

### 2. Create `package.xml`

```xml
<?xml version="1.0"?>
<package format="3">
  <name>my_package</name>
  <version>0.1.0</version>
  <description>My ROS2 package</description>
  <maintainer email="you@example.com">Your Name</maintainer>
  <license>Apache-2.0</license>

  <buildtool_depend>ament_python</buildtool_depend>

  <depend>rclpy</depend>
  <depend>std_msgs</depend>
  <depend>sensor_msgs</depend>
  <depend>geometry_msgs</depend>

  <test_depend>ament_copyright</test_depend>
  <test_depend>ament_flake8</test_depend>
  <test_depend>ament_pep257</test_depend>
  <test_depend>pytest</test_depend>

  <export>
    <build_type>ament_python</build_type>
  </export>
</package>
```

### 3. Create `setup.py`

```python
from setuptools import setup
import os
from glob import glob

package_name = 'my_package'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.py')),
        (os.path.join('share', package_name, 'config'), glob('config/*.yaml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    entry_points={
        'console_scripts': [
            'my_node = my_package.my_node:main',
        ],
    },
)
```

### 4. Create `setup.cfg`

```ini
[develop]
script_dir=$base/lib/my_package
[install]
install_scripts=$base/lib/my_package
```

### 5. Create `resource/my_package` (empty marker file)

```bash
mkdir -p src/my_package/resource
touch src/my_package/resource/my_package
```

### 6. Create the Dockerfile

```dockerfile
FROM ros:jazzy-ros-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-colcon-common-extensions \
    python3-pytest \
    ros-jazzy-rclpy \
    ros-jazzy-std-msgs \
    ros-jazzy-sensor-msgs \
    ros-jazzy-geometry-msgs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /ros2_ws
COPY src/ ./src/

RUN . /opt/ros/jazzy/setup.sh && \
    colcon build --symlink-install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### 7. Create `entrypoint.sh`

```bash
#!/bin/bash
set -e
source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash
exec "$@"
```

### 8. Create `docker-compose.yml`

```yaml
services:
  ros2-node:
    build: .
    command: ros2 run my_package my_node
    network_mode: host     # required for ROS2 DDS discovery
    environment:
      - ROS_DOMAIN_ID=0    # isolate from other ROS2 instances on the network
    volumes:
      - ./src:/ros2_ws/src  # hot reload during development
```

### 9. Create the first node (`my_package/my_node.py`)

Use the template in the Templates section below.

### 10. Build and verify

```bash
# Build the Docker image
docker compose build

# Run the node
docker compose up

# Verify: in another terminal
docker compose exec ros2-node ros2 topic list
docker compose exec ros2-node ros2 node list
```

---

## Templates

### Minimal Node Template

```python
# my_package/my_node.py
import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class MyNode(Node):
    def __init__(self):
        super().__init__('my_node')
        self.get_logger().info('Node started')

        self.pub_ = self.create_publisher(String, 'output', 10)
        self.timer_ = self.create_timer(1.0, self.timer_callback)  # 1 Hz

    def timer_callback(self):
        msg = String()
        msg.data = f'Hello from {self.get_name()}'
        self.pub_.publish(msg)
        self.get_logger().debug(f'Published: {msg.data}')


def main(args=None):
    rclpy.init(args=args)
    node = MyNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
```

### Parameter Config File (`config/params.yaml`)

```yaml
my_node:
  ros__parameters:
    publish_rate: 1.0
    frame_id: "base_link"
    max_velocity: 1.0
```

---

## Checklist

- [ ] `package.xml` has correct build type (`ament_python`)
- [ ] `setup.py` lists the package in `packages=` and entry point in `console_scripts`
- [ ] `resource/my_package` marker file exists
- [ ] `docker compose build` completes without errors
- [ ] `ros2 node list` shows `/my_node`
- [ ] `ros2 topic list` shows `/output`
- [ ] `ros2 topic echo /output` shows published messages

---

## Files Involved

| File | Action |
|------|--------|
| `src/my_package/package.xml` | Create |
| `src/my_package/setup.py` | Create |
| `src/my_package/setup.cfg` | Create |
| `src/my_package/resource/my_package` | Create (empty) |
| `src/my_package/my_package/__init__.py` | Create (empty) |
| `src/my_package/my_package/my_node.py` | Create |
| `Dockerfile` | Create |
| `entrypoint.sh` | Create |
| `docker-compose.yml` | Create |

---

## Common Mistakes

- **Forgetting to source the workspace.** `ros2 run` only works after `source install/setup.bash`. The entrypoint.sh handles this in Docker; locally, you must source manually.
- **Missing resource marker file.** Without `resource/my_package`, `colcon build` succeeds but `ros2 run` can't find the package.
- **Wrong network mode.** ROS2 DDS discovery requires `network_mode: host` in Docker unless you configure FastDDS with a discovery server.
- **`setup.py` entry_point doesn't match module path.** `my_package.my_node:main` means `src/my_package/my_package/my_node.py` with a `main()` function.
- **Editing files inside the container without `--symlink-install`.** With `--symlink-install`, Python source files in `src/` are symlinked into `install/`, so edits take effect without rebuilding. Without it, you must `colcon build` after every change.
