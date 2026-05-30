---
name: deploy-to-edge
description: Deploy a ROS2 node or IoT application to ARM edge hardware — multi-arch build, systemd service, OTA update with rollback, hardware device access
metadata:
  type: skill
  domain: iot
  triggers:
    - "deploy to edge"
    - "deploy to raspberry pi"
    - "deploy to jetson"
    - "arm docker build"
    - "edge deployment"
    - "systemd service"
    - "ota update"
---

# Skill: deploy-to-edge

## When to Use

When you're ready to move from Docker-on-laptop development to deployment on physical edge hardware — Raspberry Pi, Jetson Nano/Orin, industrial PC, or any ARM-based system.

---

## Prerequisites

- Application builds and tests pass in Docker on x86 dev machine
- Target hardware identified (architecture: ARM64 or ARM32)
- SSH access to the target device
- Docker and Docker Compose installed on the target device
- Container registry accessible from both dev machine and edge device (or use `docker save/load`)

---

## Steps

### 1. Verify your Dockerfile is edge-ready

Check against this list before building for ARM:
- [ ] Uses multi-stage build (builder → runtime)
- [ ] Final stage has NO build tools (`gcc`, `build-essential`, `*-dev` packages)
- [ ] Final image is under 500MB (use `docker images` to check)
- [ ] Runs as non-root user
- [ ] No secrets baked in (use `--env-file` at runtime)
- [ ] For ROS2: entrypoint sources `setup.bash`

### 2. Set up multi-arch buildx

```bash
# One-time setup on your development machine
docker buildx create --name edge-builder --use
docker buildx inspect --bootstrap

# Verify QEMU emulation is available
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
```

### 3. Build and push the multi-arch image

```bash
# Build for ARM64 (Pi 4/5, Jetson) + AMD64 (CI/dev)
docker buildx build \
  --platform linux/arm64,linux/amd64 \
  --tag your-registry.example.com/myapp:1.0.0 \
  --tag your-registry.example.com/myapp:latest \
  --push \
  .

# Verify the manifest
docker buildx imagetools inspect your-registry.example.com/myapp:latest
```

**No registry?** Transfer the image directly:
```bash
# On dev machine
docker save your-image:latest | gzip > myapp-1.0.0.tar.gz
scp myapp-1.0.0.tar.gz pi@device-ip:/home/pi/

# On edge device
docker load < myapp-1.0.0.tar.gz
```

### 4. Create the systemd service file

```bash
# Create on the edge device at: /etc/systemd/system/myapp.service
sudo tee /etc/systemd/system/myapp.service > /dev/null << 'EOF'
[Unit]
Description=My IoT Application
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
Restart=on-failure
RestartSec=15s
StartLimitBurst=5
StartLimitIntervalSec=300

WatchdogSec=60s
NotifyAccess=all

ExecStartPre=-/usr/bin/docker stop myapp
ExecStartPre=-/usr/bin/docker rm myapp
ExecStart=/usr/bin/docker run \
    --name myapp \
    --rm \
    --network host \
    --device /dev/mydevice:/dev/mydevice \
    --group-add dialout \
    --env-file /etc/myapp/config.env \
    --log-driver=journald \
    --log-opt tag=myapp \
    your-registry.example.com/myapp:latest

ExecStop=/usr/bin/docker stop myapp

MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF
```

### 5. Create the secrets/config file

```bash
# /etc/myapp/config.env — never commit this file
sudo mkdir -p /etc/myapp
sudo tee /etc/myapp/config.env > /dev/null << 'EOF'
DEVICE_ID=sensor-01
MQTT_HOST=broker.example.com
MQTT_USERNAME=device-sensor-01
MQTT_PASSWORD=changeme
ROS_DOMAIN_ID=0
EOF
sudo chmod 600 /etc/myapp/config.env
```

### 6. Create stable device symlinks (udev)

```bash
# Find device identifiers
udevadm info -a -n /dev/ttyUSB0 | grep -E "idVendor|idProduct|serial"

# Create udev rule for stable symlink
sudo tee /etc/udev/rules.d/99-mydevice.rules > /dev/null << 'EOF'
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", \
    ATTRS{serial}=="A1B2C3D4", SYMLINK+="mydevice", MODE="0660", GROUP="dialout"
EOF

sudo udevadm control --reload-rules && sudo udevadm trigger
ls -la /dev/mydevice   # verify symlink exists
```

### 7. Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp

# Verify it started
sudo systemctl status myapp
sudo journalctl -u myapp -f --no-pager
```

### 8. Create the OTA update script

```bash
# /usr/local/bin/deploy-myapp.sh
sudo tee /usr/local/bin/deploy-myapp.sh > /dev/null << 'SCRIPT'
#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: deploy-myapp.sh <version>}"
IMAGE="your-registry.example.com/myapp:${VERSION}"
CURRENT=$(docker inspect myapp --format='{{.Config.Image}}' 2>/dev/null || echo "none")

echo "[OTA] Pulling ${IMAGE}..."
docker pull "${IMAGE}"

echo "[OTA] Stopping current service..."
systemctl stop myapp

# Save rollback reference
if [ "${CURRENT}" != "none" ]; then
    echo "${CURRENT}" > /etc/myapp/rollback-image
fi

# Update service to new image
sed -i "s|your-registry.example.com/myapp:.*|${IMAGE}|" /etc/systemd/system/myapp.service
systemctl daemon-reload

echo "[OTA] Starting ${VERSION}..."
systemctl start myapp

# Health check: 60 seconds to become active
for i in $(seq 1 12); do
    sleep 5
    if systemctl is-active --quiet myapp; then
        echo "[OTA] Success: ${IMAGE}"
        docker rmi "${CURRENT}" 2>/dev/null || true
        exit 0
    fi
    echo "[OTA] Waiting... (${i}/12)"
done

# Rollback
echo "[OTA] FAILED — rolling back..."
ROLLBACK=$(cat /etc/myapp/rollback-image 2>/dev/null || echo "${CURRENT}")
systemctl stop myapp
sed -i "s|${IMAGE}|${ROLLBACK}|" /etc/systemd/system/myapp.service
systemctl daemon-reload
systemctl start myapp
echo "[OTA] Rolled back to ${ROLLBACK}"
exit 1
SCRIPT

sudo chmod +x /usr/local/bin/deploy-myapp.sh
```

### 9. Add watchdog heartbeat to your application

```python
# In your main loop (Python)
import os
import socket

def notify_systemd(message: str):
    """Send sd_notify message to systemd watchdog."""
    sock_path = os.environ.get('NOTIFY_SOCKET')
    if not sock_path:
        return
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
        sock.connect(sock_path)
        sock.send(message.encode())

# At startup:
notify_systemd("READY=1")

# In your main loop:
notify_systemd("WATCHDOG=1")
```

Or use `sdnotify` package:
```python
import sdnotify
n = sdnotify.SystemdNotifier()
n.notify("READY=1")
# In loop:
n.notify("WATCHDOG=1")
```

---

## Testing the Deployment

```bash
# Verify the right architecture was pulled
docker inspect your-registry.example.com/myapp:latest | grep Architecture

# Test OTA: deploy a known-broken image and verify rollback
sudo /usr/local/bin/deploy-myapp.sh 0.0.0-broken
# Should: stop service, pull broken image, fail health check, rollback to previous

# Simulate power cycle
sudo reboot
# After reboot: systemctl status myapp should show "active (running)"
```

---

## Checklist

- [ ] Multi-arch image built for correct platform (`linux/arm64` for Pi 4/5)
- [ ] Final image size verified (run `docker images` on the edge device)
- [ ] systemd service file installed and enabled
- [ ] `WatchdogSec` set and application sends `WATCHDOG=1` heartbeat
- [ ] Secrets in `/etc/myapp/config.env` with `chmod 600`
- [ ] udev rules create stable `/dev/mydevice` symlink
- [ ] OTA script tested: successful deploy + rollback on failure
- [ ] Service auto-starts after `sudo reboot`
- [ ] Logs flowing to journald: `journalctl -u myapp` shows output
- [ ] Resource limits set appropriate for target hardware

---

## Files Involved

| File | Location | Action |
|------|----------|--------|
| `Dockerfile` | Project root | Verify edge-ready (multi-stage, non-root) |
| `/etc/systemd/system/myapp.service` | Edge device | Create |
| `/etc/myapp/config.env` | Edge device | Create (secrets, never commit) |
| `/etc/udev/rules.d/99-mydevice.rules` | Edge device | Create (stable device paths) |
| `/usr/local/bin/deploy-myapp.sh` | Edge device | Create (OTA script) |

---

## Common Mistakes

- **Building for wrong architecture.** A `linux/amd64` image on a Raspberry Pi either fails to start or runs extremely slowly under QEMU. Always verify with `docker inspect --format='{{.Architecture}}'`.
- **`NOTIFY_SOCKET` not set.** systemd sets `NOTIFY_SOCKET` automatically when `Type=notify` or `WatchdogSec` is present. If your app doesn't send `WATCHDOG=1`, systemd will kill and restart it every `WatchdogSec` seconds.
- **Device node path changes on reboot.** `/dev/ttyUSB0` becomes `/dev/ttyUSB1` if devices are plugged in a different order. udev rules prevent this.
- **OTA without rollback.** Never deploy to edge hardware without a tested rollback path. Edge devices are often physically inaccessible.
- **Not testing after power cycle.** A service that starts after `systemctl start` may fail after a hard reboot if it starts before networking or other dependencies are ready. Always test with `sudo reboot`.
