# Network Device Patterns — SNMP, SSH, REST, gNMI

## Protocol Decision Guide

| Protocol | Era | Typical devices | Data model | Use when |
|----------|-----|----------------|------------|----------|
| SNMP v2c/v3 | Legacy | Switches, routers, UPS, printers | MIB (OID tree) | Device doesn't support anything newer |
| SSH/CLI | Legacy–Modern | Cisco IOS, Arista EOS, Junos, NX-OS | Vendor-specific text | Vendor CLI is the only management interface |
| REST | Modern | Cisco DNA Center, Arista eAPI, Meraki | JSON, vendor-defined | Modern gear with HTTP API |
| gNMI | Modern | Arista, Juniper, Cisco IOS-XE, Nokia | YANG/OpenConfig | Streaming telemetry, vendor-neutral config |

**Rule of thumb:** New deployment → prefer gNMI or REST. Existing infrastructure → SNMP + SSH covers 90% of devices.

---

## SNMP

### GET / GETNEXT / WALK

```python
from pysnmp.hlapi import (
    getCmd, nextCmd, bulkCmd,
    SnmpEngine, CommunityData, UsmUserData,
    UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
)

# SNMPv2c GET
iterator = getCmd(
    SnmpEngine(),
    CommunityData('public', mpModel=1),          # v2c
    UdpTransportTarget(('192.168.1.1', 161), timeout=2, retries=2),
    ContextData(),
    ObjectType(ObjectIdentity('SNMPv2-MIB', 'sysDescr', 0)),
    ObjectType(ObjectIdentity('SNMPv2-MIB', 'sysUpTime', 0)),
)
errorIndication, errorStatus, errorIndex, varBinds = next(iterator)
if not errorIndication and not errorStatus:
    for varBind in varBinds:
        print(f"{varBind[0]} = {varBind[1]}")

# SNMPv3 (recommended for new deployments)
iterator = getCmd(
    SnmpEngine(),
    UsmUserData('admin', authKey='authpass', privKey='privpass',
                authProtocol=usmHMACSHAAuthProtocol,
                privProtocol=usmAesCfb128Protocol),
    UdpTransportTarget(('192.168.1.1', 161)),
    ContextData(),
    ObjectType(ObjectIdentity('IF-MIB', 'ifInOctets', 1)),
)

# WALK — iterate a subtree
for (errorIndication, errorStatus, errorIndex, varBinds) in nextCmd(
    SnmpEngine(),
    CommunityData('public'),
    UdpTransportTarget(('192.168.1.1', 161)),
    ContextData(),
    ObjectType(ObjectIdentity('IF-MIB', 'ifTable')),
    lexicographicMode=False,  # stop at end of table
):
    if not errorIndication and not errorStatus:
        for varBind in varBinds:
            print(f"{varBind[0]} = {varBind[1]}")
```

### Interface Statistics Poller

```python
import time
from collections import defaultdict

class InterfacePollPoller:
    def __init__(self, host, community='public'):
        self.host = host
        self.community = community
        self.prev = defaultdict(int)

    def get_interface_counters(self):
        counters = {}
        for (_, _, _, varBinds) in nextCmd(
            SnmpEngine(),
            CommunityData(self.community),
            UdpTransportTarget((self.host, 161), timeout=5),
            ContextData(),
            ObjectType(ObjectIdentity('IF-MIB', 'ifInOctets')),
            ObjectType(ObjectIdentity('IF-MIB', 'ifOutOctets')),
            lexicographicMode=False,
        ):
            for varBind in varBinds:
                oid_str = str(varBind[0])
                counters[oid_str] = int(varBind[1])
        return counters

    def poll_rates(self, interval=60):
        while True:
            current = self.get_interface_counters()
            rates = {}
            for oid, value in current.items():
                if oid in self.prev:
                    delta = value - self.prev[oid]
                    rates[oid] = delta / interval  # bytes/sec
            self.prev = current
            yield rates
            time.sleep(interval)
```

---

## SSH / CLI Automation (netmiko)

```python
from netmiko import ConnectHandler
from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException

# Connect — device_type determines how output is parsed
device = {
    "device_type": "cisco_ios",    # or arista_eos, juniper_junos, cisco_nxos
    "host": "192.168.1.1",
    "username": "admin",
    "password": "password",
    "secret": "enable_secret",     # for privilege escalation
    "timeout": 30,
}

with ConnectHandler(**device) as conn:
    # Read operations — send a command, get text output
    output = conn.send_command("show interfaces status")
    bgp_summary = conn.send_command("show bgp summary", use_textfsm=True)  # structured

    # Config push — enter config mode, send lines, save
    conn.enable()  # enter privileged EXEC
    config_commands = [
        "interface GigabitEthernet0/1",
        "description Link to Core",
        "no shutdown",
    ]
    conn.send_config_set(config_commands)
    conn.save_config()

    # Multi-vendor: same pattern, different device_type
```

### Golden Config Diff

```python
import difflib

def backup_and_diff(device_params: dict, golden_config_path: str) -> list[str]:
    with ConnectHandler(**device_params) as conn:
        running = conn.send_command("show running-config")

    with open(golden_config_path) as f:
        golden = f.read()

    diff = list(difflib.unified_diff(
        golden.splitlines(keepends=True),
        running.splitlines(keepends=True),
        fromfile="golden",
        tofile="running",
        lineterm=""
    ))
    return diff

# Alert on drift
diff = backup_and_diff(device, "/configs/core-switch-01.conf")
if diff:
    print("DRIFT DETECTED:")
    print("".join(diff))
```

### Multi-Device Parallel Execution

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

devices = [
    {"device_type": "cisco_ios", "host": "192.168.1.1", ...},
    {"device_type": "arista_eos", "host": "192.168.1.2", ...},
]

def run_command(device_params, command):
    with ConnectHandler(**device_params) as conn:
        return conn.send_command(command)

with ThreadPoolExecutor(max_workers=10) as executor:
    futures = {executor.submit(run_command, d, "show version"): d["host"] for d in devices}
    for future in as_completed(futures):
        host = futures[future]
        try:
            result = future.result()
            print(f"{host}: {result[:100]}")
        except Exception as e:
            print(f"{host}: FAILED — {e}")
```

---

## REST APIs

```python
import httpx
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

class NetworkApiClient:
    def __init__(self, base_url: str, api_key: str):
        self.client = httpx.AsyncClient(
            base_url=base_url,
            headers={"X-API-Key": api_key, "Content-Type": "application/json"},
            timeout=30.0,
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=10))
    async def get(self, path: str, params: dict = None):
        resp = await self.client.get(path, params=params)
        resp.raise_for_status()
        return resp.json()

    async def get_all_pages(self, path: str):
        results = []
        page = 0
        while True:
            data = await self.get(path, params={"offset": page * 100, "limit": 100})
            items = data.get("items", data.get("response", []))
            results.extend(items)
            if len(items) < 100:
                break
            page += 1
        return results

# Arista eAPI
arista_client = httpx.Client(
    base_url="https://192.168.1.1/command-api",
    auth=("admin", "password"),
    verify=False,  # self-signed cert is common
)
resp = arista_client.post("", json={
    "jsonrpc": "2.0", "method": "runCmds",
    "params": {"version": 1, "cmds": ["show interfaces status"], "format": "json"},
    "id": 1
})
interfaces = resp.json()["result"][0]["interfaceStatuses"]
```

---

## gNMI — Streaming Telemetry

```python
import asyncio
from pygnmi.client import gNMIclient

async def stream_telemetry():
    target = ("192.168.1.1", 6030)  # Arista default gNMI port

    async with gNMIclient(target=target, username="admin", password="password",
                           insecure=True) as gc:
        # Get a specific value
        result = await gc.get(path=["/interfaces/interface[name=Ethernet1]/state"])
        print(result)

        # Subscribe to streaming updates
        subscription_list = {
            "subscription": [
                {
                    "path": "/interfaces/interface/state/counters",
                    "mode": "sample",
                    "sample_interval": 10_000_000_000,  # 10 seconds in nanoseconds
                },
                {
                    "path": "/system/memory/state",
                    "mode": "on_change",
                }
            ],
            "mode": "stream",
            "encoding": "json_ietf",
        }

        async for update in gc.subscribe(subscribe=subscription_list):
            timestamp = update.get("timestamp")
            for prefix, values in update.get("update", {}).items():
                for path, value in values.items():
                    print(f"{timestamp} {prefix}/{path} = {value}")

asyncio.run(stream_telemetry())
```

**OpenConfig YANG paths (common):**
```
/interfaces/interface[name=*]/state/counters/in-octets
/interfaces/interface[name=*]/state/oper-status
/network-instances/network-instance[name=default]/protocols/protocol/bgp/neighbors/neighbor/state
/system/memory/state/used
/platform/components/component/state/temperature/instant
```

---

## Configuration Backup Automation

```python
import os
import hashlib
from datetime import datetime
from pathlib import Path

BACKUP_DIR = Path("/backups/configs")

def backup_device(device_params: dict, device_name: str) -> dict:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    with ConnectHandler(**device_params) as conn:
        config = conn.send_command("show running-config")

    config_hash = hashlib.sha256(config.encode()).hexdigest()[:12]
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = BACKUP_DIR / f"{device_name}-{timestamp}-{config_hash}.conf"

    filename.write_text(config)
    return {"device": device_name, "file": str(filename), "hash": config_hash}

def find_latest_backup(device_name: str) -> Path | None:
    files = sorted(BACKUP_DIR.glob(f"{device_name}-*.conf"), reverse=True)
    return files[0] if files else None
```
