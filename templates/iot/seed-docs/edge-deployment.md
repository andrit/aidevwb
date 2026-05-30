# Edge Deployment — Docker on ARM, systemd, OTA, Hardware Access

## Target Platforms

| Hardware | Architecture | OS | Typical use |
|----------|-------------|-----|------------|
| Raspberry Pi 4/5 | ARM64 (aarch64) | Raspberry Pi OS, Ubuntu 22.04 | Lightweight sensors, vision |
| NVIDIA Jetson Nano/Orin | ARM64 + GPU | JetPack (Ubuntu-based) | Edge ML, computer vision |
| Raspberry Pi 3/Zero 2 | ARM32 (armv7l) | Raspberry Pi OS 32-bit | Very constrained environments |
| Industrial PC (x86) | x86_64 | Ubuntu, Debian | High-compute, near-standard Docker |
| BeagleBone Black | ARM32 | Debian | I/O-intensive, real-time |

---

## Multi-Architecture Docker Builds

### Setting Up buildx

```bash
# On your development machine (not the edge device)
docker buildx create --name multiarch --use
docker buildx inspect --bootstrap

# Build for ARM64 + AMD64 and push to registry
docker buildx build \
  --platform linux/arm64,linux/amd64 \
  --tag registry.example.com/myapp:latest \
  --push \
  .
```

### Dockerfile for Edge (Minimal Final Image)

```dockerfile
# Build stage: use full image for compilation
FROM python:3.11-slim AS builder
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Runtime stage: minimal image, no build tools
FROM python:3.11-slim
WORKDIR /app

# Only copy what's needed to run
COPY --from=builder /root/.local /root/.local
COPY src/ ./src/

# Run as non-root
RUN useradd -r -s /bin/false appuser
USER appuser

ENV PATH=/root/.local/bin:$PATH
CMD ["python", "-m", "src.main"]
```

**Size targets:** Keep final images under 200MB for edge devices. Use `docker history` to find large layers. Avoid installing `apt-get` packages in the final stage.

### QEMU Emulation vs Cross-Compilation

| Approach | Build time | Compatibility | Use when |
|----------|-----------|---------------|----------|
| QEMU emulation (buildx default) | Slow (~5× slower) | Perfect | Infrequent builds, scripts/Python |
| Cross-compiler (gcc-aarch64-linux-gnu) | Fast | Requires careful setup | C/C++ with frequent rebuilds |
| Build on device | Fast, no setup | Can't automate easily | One-off builds during dev |

For Python projects, QEMU emulation is fine. For C++ ROS2 nodes, set up native ARM64 CI runners or a cross-compilation toolchain.

---

## Dockerfile for ROS2 on ARM

```dockerfile
FROM ros:jazzy-ros-base AS builder

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-colcon-common-extensions \
    ros-jazzy-rclpy \
    ros-jazzy-std-msgs \
    ros-jazzy-sensor-msgs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /ros2_ws
COPY src/ ./src/
RUN . /opt/ros/jazzy/setup.sh && \
    colcon build --symlink-install --cmake-args -DCMAKE_BUILD_TYPE=Release

# Runtime stage
FROM ros:jazzy-ros-base
WORKDIR /ros2_ws
COPY --from=builder /ros2_ws/install ./install

# Source ROS2 on every container start
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["ros2", "run", "my_package", "my_node"]
```

```bash
# entrypoint.sh
#!/bin/bash
set -e
source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash
exec "$@"
```

---

## systemd Service Unit

systemd manages your container as a service: auto-start on boot, restart on failure, watchdog, and journal logging.

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My IoT Application
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
Restart=on-failure
RestartSec=10s
StartLimitBurst=5
StartLimitIntervalSec=300

# Watchdog: service must notify systemd within 30s or it's killed and restarted
WatchdogSec=30s
NotifyAccess=all

ExecStartPre=-/usr/bin/docker stop myapp
ExecStartPre=-/usr/bin/docker rm myapp
ExecStart=/usr/bin/docker run \
    --name myapp \
    --rm \
    --network host \
    --device /dev/ttyUSB0:/dev/ttyUSB0 \
    --env-file /etc/myapp/config.env \
    --log-driver=journald \
    registry.example.com/myapp:latest

ExecStop=/usr/bin/docker stop myapp

# Resource limits (cgroup v2)
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

```bash
# Install and enable
sudo cp myapp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp

# Monitor
sudo systemctl status myapp
sudo journalctl -u myapp -f    # follow logs
```

### Sending Watchdog Notifications from Python

```python
import os
import time
import sdnotify  # pip install sdnotify

notifier = sdnotify.SystemdNotifier()
notifier.notify("READY=1")  # signal startup complete

while True:
    try:
        # Do work
        result = do_thing()
        notifier.notify("WATCHDOG=1")  # reset watchdog timer
    except Exception as e:
        notifier.notify(f"STATUS=Error: {e}")
        # Don't notify watchdog → systemd will restart after WatchdogSec
        time.sleep(1)
```

---

## OTA Update Pattern

Never push to a running production edge device without a rollback plan.

### A/B Partition Update

```bash
#!/bin/bash
# deploy-ota.sh — runs on the edge device, triggered by remote management
set -e

NEW_IMAGE="registry.example.com/myapp:${1:?version required}"
CURRENT_TAG=$(docker inspect myapp --format='{{.Config.Image}}' 2>/dev/null || echo "none")

echo "Pulling $NEW_IMAGE..."
docker pull "$NEW_IMAGE"

echo "Stopping current service..."
systemctl stop myapp

# Tag current as rollback target
if [ "$CURRENT_TAG" != "none" ]; then
    docker tag "$CURRENT_TAG" myapp:rollback
fi

# Update the image reference in the service
sed -i "s|registry.example.com/myapp:.*|$NEW_IMAGE|" /etc/systemd/system/myapp.service
systemctl daemon-reload

echo "Starting new version..."
systemctl start myapp

# Health check: wait up to 60s for service to become healthy
for i in $(seq 1 12); do
    sleep 5
    if systemctl is-active --quiet myapp; then
        echo "Deploy successful: $NEW_IMAGE"
        docker rmi myapp:rollback 2>/dev/null || true
        exit 0
    fi
done

# Failed health check — rollback
echo "Health check failed. Rolling back..."
systemctl stop myapp
sed -i "s|$NEW_IMAGE|$CURRENT_TAG|" /etc/systemd/system/myapp.service
systemctl daemon-reload
systemctl start myapp
exit 1
```

---

## Hardware Access from Containers

### USB and Serial Devices

```yaml
# docker-compose.yml
services:
  myapp:
    image: myapp:latest
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0   # USB serial device
      - /dev/ttyACM0:/dev/ttyACM0   # ACM (Arduino-style)
    group_add:
      - dialout  # required for serial port access
```

**Problem:** USB device node paths (`/dev/ttyUSB0`) change if devices are unplugged and re-plugged. Use udev rules to assign a stable symlink.

```bash
# /etc/udev/rules.d/99-mydevice.rules
# Match by vendor/product ID → create stable symlink
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", \
    SYMLINK+="mydevice", MODE="0666"

# Apply rule
sudo udevadm control --reload-rules && sudo udevadm trigger

# Now use /dev/mydevice instead of /dev/ttyUSB0
```

### GPIO (Raspberry Pi)

```yaml
# Option 1: privileged (simple, not recommended for production)
services:
  myapp:
    privileged: true

# Option 2: specific device access (preferred)
services:
  myapp:
    devices:
      - /dev/gpiomem:/dev/gpiomem
    group_add:
      - gpio
```

### I2C

```yaml
services:
  myapp:
    devices:
      - /dev/i2c-1:/dev/i2c-1
    group_add:
      - i2c
```

---

## Resource Limits for Constrained Hardware

```yaml
# docker-compose.yml
services:
  myapp:
    image: myapp:latest
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "0.5"          # 50% of one core
        reservations:
          memory: 256M
          cpus: "0.25"
```

**Raspberry Pi 4 budget (4GB model):**
- OS baseline: ~300MB RAM
- Your app: <512MB RAM
- Leave 1GB+ free for OS file cache (dramatically speeds up reads)
- Keep CPU <50% average or you'll hit thermal throttling

---

## Real-Time Considerations

Standard Docker on a standard Linux kernel cannot guarantee sub-10ms latency. If your application needs hard real-time:

| Requirement | Solution |
|------------|---------|
| <10ms jitter | PREEMPT_RT kernel patch + isolate CPUs with `isolcpus=` |
| <1ms jitter | Xenomai or RTAI (requires special kernel) |
| ROS2 control loop | Disable CFS scheduler for that thread: `SCHED_FIFO` + `mlockall()` |
| DDS latency | Tune DDS QoS: BEST_EFFORT, depth=1, `fast_rtps` transport |

For most IoT use cases (>10ms is fine), standard Docker is sufficient. Flag real-time requirements in the design phase — they affect hardware selection and deployment significantly.

---

## Checklist Before Deploying to Edge

- [ ] Image built for correct architecture (`docker inspect --format='{{.Architecture}}'`)
- [ ] Final image size is reasonable (<200MB for Python apps)
- [ ] systemd unit file installed and enabled with `WantedBy=multi-user.target`
- [ ] Watchdog timeout set and application sends `WATCHDOG=1` on each healthy loop
- [ ] Device node symlinks created via udev rules (stable `/dev/mydevice` paths)
- [ ] OTA rollback tested: deploy broken image → verify rollback fires
- [ ] Resource limits set appropriate to hardware
- [ ] Logs going to journald (`--log-driver=journald`)
- [ ] Secrets in `/etc/myapp/config.env`, not baked into image
- [ ] Application starts cleanly after a hard power cycle (not just a graceful restart)
