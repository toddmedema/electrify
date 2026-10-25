"""Windows TCP table snapshots and host facts for Chromium Issue 572515601."""

from __future__ import annotations

import ctypes
import json
import os
import platform
import socket
import struct
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

TCP_STATES = {
    1: "CLOSED",
    2: "LISTEN",
    3: "SYN_SENT",
    4: "SYN_RECEIVED",
    5: "ESTABLISHED",
    6: "FIN_WAIT1",
    7: "FIN_WAIT2",
    8: "CLOSE_WAIT",
    9: "CLOSING",
    10: "LAST_ACK",
    11: "TIME_WAIT",
    12: "DELETE_TCB",
}


def tcp_snapshot(port: int | None = None) -> dict:
    """Retrieve an instantaneous snapshot of the Windows TCP table.

    Uses the Win32 GetExtendedTcpTable API (iphlpapi.dll) to read active
    connections, TCP states, and owning process IDs without requiring
    administrator privileges.

    Args:
        port: Optional port number to filter connection rows for.
    """
    api = ctypes.WinDLL("iphlpapi").GetExtendedTcpTable
    api.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.c_bool,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    api.restype = ctypes.c_ulong
    size = ctypes.c_ulong()
    result = api(None, ctypes.byref(size), False, 2, 5, 0)
    if result not in (0, 122):
        return {"error": result}
    buf = ctypes.create_string_buffer(size.value)
    result = api(buf, ctypes.byref(size), False, 2, 5, 0)
    if result:
        return {"error": result}
    count = struct.unpack_from("<I", buf)[0]
    states = Counter()
    named = Counter()
    owners = Counter()
    relevant = []
    for index in range(count):
        state, _local_addr, local_port, _remote_addr, remote_port, pid = struct.unpack_from(
            "<6I", buf, 4 + index * 24
        )
        local_port, remote_port = (
            socket.ntohs(local_port & 65535),
            socket.ntohs(remote_port & 65535),
        )
        states[state] += 1
        named[TCP_STATES.get(state, str(state))] += 1
        owners[pid] += 1
        if port is not None and port in (local_port, remote_port):
            relevant.append(
                {
                    "state": TCP_STATES.get(state, str(state)),
                    "local_port": local_port,
                    "remote_port": remote_port,
                    "pid": pid,
                }
            )
    return {
        "total": count,
        "states": dict(states),
        "named_states": dict(named),
        "time_wait": named.get("TIME_WAIT", 0),
        "top_owners": owners.most_common(12),
        "port_rows": relevant,
    }


def _powershell(command):
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def _netsh(*args):
    completed = subprocess.run(
        ["netsh", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "args": ["netsh", *args],
        "returncode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def file_version(path: Path) -> dict | None:
    """Extract Windows PE VersionInfo for a system file (e.g. tcpip.sys)."""
    if not path.is_file():
        return None
    info = _powershell(
        f"(Get-Item -LiteralPath '{path}').VersionInfo | "
        "Select-Object -Property FileVersion, ProductVersion, FileVersionRaw | ConvertTo-Json -Compress"
    )
    if info["returncode"] != 0:
        return {"error": info}
    try:
        return json.loads(info["stdout"])
    except json.JSONDecodeError:
        return {"raw": info["stdout"]}


def wait_until_idle(
    time_wait_limit: int = 200,
    timeout_s: float = 300.0,
    poll_s: float = 5.0,
    on_poll=None,
) -> dict:
    """Wait until TIME_WAIT rows fall to a quiet level.

    Windows keeps closed connections in TIME_WAIT for TcpTimedWaitDelay
    (default 120 seconds; some hosts use 240). Poll until time_wait is at
    or below time_wait_limit, or until timeout_s elapses.

    on_poll, if set, is called as on_poll(snapshot, seconds_remaining)
    after each poll.
    """
    deadline = time.monotonic() + timeout_s
    last = tcp_snapshot()
    while last.get("time_wait", 0) > time_wait_limit:
        if time.monotonic() >= deadline:
            return last
        time.sleep(poll_s)
        last = tcp_snapshot()
        if on_poll is not None:
            on_poll(last, max(0.0, deadline - time.monotonic()))
    return last


def host_snapshot() -> dict:
    """Collect system version, tcpip.sys version, dynamic port ranges, and TCP state."""
    nt = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    version_key = r"HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    return {
        "utc": time.time(),
        "python": sys.version,
        "executable": sys.executable,
        "platform": platform.platform(),
        "windows": _powershell(
            f"Get-ItemProperty '{version_key}' | "
            "Select-Object ProductName, DisplayVersion, CurrentBuild, UBR, BuildLabEx | "
            "ConvertTo-Json -Compress"
        ),
        "tcpip_sys": file_version(nt / "System32" / "drivers" / "tcpip.sys"),
        "dynamicport_ipv4": _netsh("int", "ipv4", "show", "dynamicport", "tcp"),
        "dynamicport_ipv6": _netsh("int", "ipv6", "show", "dynamicport", "tcp"),
        "excluded_ipv4": _netsh("int", "ipv4", "show", "excludedportrange", "tcp"),
        "tcp_now": tcp_snapshot(),
    }
