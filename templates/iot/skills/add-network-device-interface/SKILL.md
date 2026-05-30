---
name: add-network-device-interface
description: Add monitoring and configuration for network devices — SNMP for legacy, SSH/CLI for multi-vendor, REST for modern APIs, gNMI for streaming telemetry
metadata:
  type: skill
  domain: iot
  triggers:
    - "network device"
    - "snmp"
    - "netmiko"
    - "network monitoring"
    - "ssh device"
    - "network configuration"
    - "gnmi"
    - "device telemetry"
---

# Skill: add-network-device-interface

## When to Use

When your IoT or infrastructure application needs to monitor, query, or configure network equipment — switches, routers, firewalls, load balancers, or any device with a management interface.

---

## Prerequisites

- Python environment with dependencies in `requirements.txt`
- Network device reachable from the development environment
- Credentials (community string, username/password, API key) available in `.env`

---

## Protocol Selection

Choose based on the device's management capabilities:

1. **Check: does the device have a REST API?** → Use REST (fastest to implement)
2. **Check: does the device support gNMI?** → Use gNMI (best for streaming metrics)
3. **Check: is SSH/CLI the only config interface?** → Use netmiko
4. **Check: is it a legacy device or UPS/printer?** → Use SNMP

Many real-world deployments need multiple protocols for different devices in the same fleet.

---

## Steps

### 1. Install dependencies

```txt
# requirements.txt additions:
pysnmp==6.2.4
netmiko==4.4.0
httpx==0.27.0
pygnmi==0.8.14
tenacity==8.2.3   # retry decorator
```

### 2. Create the device interface abstraction

Apply the same mock/real pattern as sensors:

```python
# network/device_interface.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class DeviceStatus:
    hostname: str
    reachable: bool
    uptime_seconds: int | None
    interfaces: dict[str, dict]    # name → {status, in_bps, out_bps}
    extra: dict[str, Any]


class NetworkDeviceInterface(ABC):
    @abstractmethod
    def connect(self) -> None: ...
    @abstractmethod
    def disconnect(self) -> None: ...
    @abstractmethod
    def get_status(self) -> DeviceStatus: ...
    @abstractmethod
    def get_config(self) -> str: ...
    @abstractmethod
    def apply_config(self, commands: list[str]) -> bool: ...
```

### 3. SNMP implementation

```python
# network/snmp_device.py
from pysnmp.hlapi import (
    getCmd, nextCmd, SnmpEngine, CommunityData,
    UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
)
from .device_interface import NetworkDeviceInterface, DeviceStatus


class SnmpDevice(NetworkDeviceInterface):
    def __init__(self, host: str, community: str = 'public', port: int = 161):
        self.host = host
        self.community = community
        self.port = port

    def connect(self) -> None:
        pass  # SNMP is stateless; verify reachability here if needed

    def disconnect(self) -> None:
        pass

    def get_status(self) -> DeviceStatus:
        oids = {
            'sysDescr': ('SNMPv2-MIB', 'sysDescr', 0),
            'sysUpTime': ('SNMPv2-MIB', 'sysUpTime', 0),
        }
        values = {}
        for key, oid in oids.items():
            it = getCmd(
                SnmpEngine(),
                CommunityData(self.community, mpModel=1),
                UdpTransportTarget((self.host, self.port), timeout=2, retries=1),
                ContextData(),
                ObjectType(ObjectIdentity(*oid)),
            )
            err_ind, err_status, _, varBinds = next(it)
            if not err_ind and not err_status:
                values[key] = str(varBinds[0][1])

        uptime_ticks = int(values.get('sysUpTime', 0))
        return DeviceStatus(
            hostname=self.host,
            reachable=bool(values),
            uptime_seconds=uptime_ticks // 100 if uptime_ticks else None,
            interfaces=self._get_interfaces(),
            extra={'sysDescr': values.get('sysDescr', '')},
        )

    def _get_interfaces(self) -> dict:
        interfaces = {}
        for (_, _, _, varBinds) in nextCmd(
            SnmpEngine(),
            CommunityData(self.community, mpModel=1),
            UdpTransportTarget((self.host, self.port), timeout=2),
            ContextData(),
            ObjectType(ObjectIdentity('IF-MIB', 'ifDescr')),
            lexicographicMode=False,
        ):
            for varBind in varBinds:
                idx = str(varBind[0]).split('.')[-1]
                interfaces[idx] = {'name': str(varBind[1])}
        return interfaces

    def get_config(self) -> str:
        return ""  # SNMP doesn't expose running config

    def apply_config(self, commands: list[str]) -> bool:
        raise NotImplementedError("SNMP doesn't support config changes via this interface")
```

### 4. SSH/CLI implementation (netmiko)

```python
# network/ssh_device.py
import hashlib
from netmiko import ConnectHandler
from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException
from .device_interface import NetworkDeviceInterface, DeviceStatus


class SshDevice(NetworkDeviceInterface):
    DEVICE_TYPE_MAP = {
        'cisco_ios': 'show version',
        'arista_eos': 'show version',
        'juniper_junos': 'show version',
        'cisco_nxos': 'show version',
    }

    def __init__(self, host: str, username: str, password: str,
                 device_type: str = 'cisco_ios', secret: str = ''):
        self.params = {
            'device_type': device_type,
            'host': host,
            'username': username,
            'password': password,
            'secret': secret,
            'timeout': 30,
            'fast_cli': True,
        }
        self._conn = None

    def connect(self) -> None:
        try:
            self._conn = ConnectHandler(**self.params)
        except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:
            raise ConnectionError(f"SSH connect failed to {self.params['host']}: {e}") from e

    def disconnect(self) -> None:
        if self._conn:
            self._conn.disconnect()
            self._conn = None

    def get_status(self) -> DeviceStatus:
        version_output = self._conn.send_command('show version')
        interfaces = self._conn.send_command('show interfaces status', use_textfsm=True)
        return DeviceStatus(
            hostname=self.params['host'],
            reachable=True,
            uptime_seconds=None,
            interfaces={iface['port']: iface for iface in (interfaces or [])
                       if isinstance(interfaces, list)},
            extra={'version': version_output[:200]},
        )

    def get_config(self) -> str:
        return self._conn.send_command('show running-config')

    def apply_config(self, commands: list[str]) -> bool:
        self._conn.enable()
        output = self._conn.send_config_set(commands)
        self._conn.save_config()
        return 'error' not in output.lower() and 'invalid' not in output.lower()

    def config_hash(self) -> str:
        config = self.get_config()
        return hashlib.sha256(config.encode()).hexdigest()[:12]
```

### 5. REST implementation

```python
# network/rest_device.py
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
from .device_interface import NetworkDeviceInterface, DeviceStatus


class RestDevice(NetworkDeviceInterface):
    def __init__(self, base_url: str, api_key: str | None = None,
                 username: str | None = None, password: str | None = None):
        auth = (username, password) if username else None
        headers = {}
        if api_key:
            headers['X-API-Key'] = api_key

        self._client = httpx.Client(
            base_url=base_url,
            auth=auth,
            headers=headers,
            timeout=30.0,
            verify=False,  # common for internal gear; set to CA cert path in production
        )

    def connect(self) -> None:
        # Verify connectivity
        self._client.get('/api/health').raise_for_status()

    def disconnect(self) -> None:
        self._client.close()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=10))
    def get_status(self) -> DeviceStatus:
        resp = self._client.get('/api/v1/devices/1').json()
        return DeviceStatus(
            hostname=resp.get('hostname', ''),
            reachable=True,
            uptime_seconds=resp.get('uptimeSeconds'),
            interfaces=resp.get('interfaces', {}),
            extra=resp,
        )

    def get_config(self) -> str:
        return self._client.get('/api/v1/config').text

    def apply_config(self, commands: list[str]) -> bool:
        resp = self._client.post('/api/v1/config', json={'commands': commands})
        return resp.status_code == 200
```

### 6. Mock implementation for testing

```python
# network/mock_device.py
from .device_interface import NetworkDeviceInterface, DeviceStatus


class MockNetworkDevice(NetworkDeviceInterface):
    def __init__(self, hostname='switch-01', reachable=True):
        self.hostname = hostname
        self.reachable = reachable
        self._config = "interface GigabitEthernet0/1\n description Test\n"
        self.applied_commands: list[list[str]] = []

    def connect(self) -> None:
        if not self.reachable:
            raise ConnectionError(f"Mock: {self.hostname} unreachable")

    def disconnect(self) -> None:
        pass

    def get_status(self) -> DeviceStatus:
        return DeviceStatus(
            hostname=self.hostname,
            reachable=self.reachable,
            uptime_seconds=86400,
            interfaces={'Gi0/1': {'status': 'connected', 'in_bps': 1000, 'out_bps': 500}},
            extra={},
        )

    def get_config(self) -> str:
        return self._config

    def apply_config(self, commands: list[str]) -> bool:
        self.applied_commands.append(commands)
        return True
```

### 7. Write the monitoring service

```python
# network/device_monitor.py
import logging
from .device_interface import NetworkDeviceInterface

logger = logging.getLogger(__name__)


class DeviceMonitor:
    def __init__(self, devices: dict[str, NetworkDeviceInterface]):
        self.devices = devices
        self._prev_configs: dict[str, str] = {}

    def poll_all(self) -> dict:
        results = {}
        for name, device in self.devices.items():
            try:
                status = device.get_status()
                results[name] = {'status': 'ok', 'data': status}
            except Exception as e:
                logger.error(f"Poll failed for {name}: {e}")
                results[name] = {'status': 'error', 'error': str(e)}
        return results

    def check_config_drift(self) -> dict[str, bool]:
        drifted = {}
        for name, device in self.devices.items():
            try:
                current = device.get_config()
                prev = self._prev_configs.get(name)
                if prev is not None and current != prev:
                    logger.warning(f"Config drift detected on {name}")
                    drifted[name] = True
                else:
                    drifted[name] = False
                self._prev_configs[name] = current
            except Exception as e:
                logger.error(f"Config check failed for {name}: {e}")
        return drifted
```

---

## Checklist

- [ ] Protocol chosen based on device capabilities (REST > gNMI > SSH > SNMP)
- [ ] Abstract `NetworkDeviceInterface` implemented for chosen protocol
- [ ] Mock device created for CI testing
- [ ] Credentials in `.env`, not hardcoded
- [ ] Retry logic applied (tenacity or manual) for transient network failures
- [ ] Tests use mock device — no real network equipment in CI
- [ ] Config drift detection wired to alerting if changes are unexpected

---

## Common Mistakes

- **SNMP v2c in production.** SNMP v2c sends the community string in plaintext. Use SNMPv3 with auth + privacy in any production environment.
- **No retry on network errors.** Network gear can be briefly unresponsive during maintenance. Always wrap device calls in retry logic.
- **Single connection for all polling.** SSH connections to network gear often have idle timeouts. Reconnect gracefully rather than assuming the connection is still alive.
- **Storing credentials in code.** Every credential must come from environment variables. Treat network gear passwords the same as database passwords.
