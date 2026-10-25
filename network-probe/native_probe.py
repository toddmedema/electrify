"""Loopback SO_RANDOMIZE_PORT A/B testing harness for Chromium Issue 572515601.

This script isolates the Windows kernel socket allocator defect independently
of Chromium. It uses the Python standard library only (no pip dependencies).

The test mirrors Chromium's Windows socket client lifecycle:
  - setsockopt(SOL_SOCKET, SO_RANDOMIZE_PORT, ...)
  - Nonblocking connect()
  - WSAEventSelect / WSAEnumNetworkEvents event-driven completion
  - Abortive close (RST via SO_LINGER) to keep TIME_WAIT rows minimal

Expected behavior:
  - Ordinary phases (SO_RANDOMIZE_PORT=0): 0 errors
  - Randomized phases (SO_RANDOMIZE_PORT=1): intermittent 10055 (WSAENOBUFS)
    while global TCP table rows remain low (~150-200), demonstrating an allocator
    defect rather than ephemeral port exhaustion.

Usage:
  python native_probe.py results/native.json
  python native_probe.py results/native.json --attempts 20000 --modes 0,1,0,1
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import select
import selectors
import socket
import struct
import threading
import time
from collections import Counter
from contextlib import ExitStack
from pathlib import Path

if os.name != "nt":
    raise SystemExit("native_probe.py is Windows-only.")

from win_tcp import tcp_snapshot

SO_RANDOMIZE_PORT = 0x3005
FD_CONNECT = 16
WSAEWOULDBLOCK = 10035
WSAENOBUFS = 10055


class NetworkEvents(ctypes.Structure):
    _fields_ = [("events", ctypes.c_long), ("errors", ctypes.c_int * 10)]


winsock = ctypes.WinDLL("ws2_32")
winsock.WSACreateEvent.restype = ctypes.c_void_p
winsock.WSAEventSelect.argtypes = [ctypes.c_size_t, ctypes.c_void_p, ctypes.c_long]
winsock.WSAEnumNetworkEvents.argtypes = [
    ctypes.c_size_t,
    ctypes.c_void_p,
    ctypes.POINTER(NetworkEvents),
]
winsock.WSACloseEvent.argtypes = [ctypes.c_void_p]


def run(
    randomized: bool,
    attempts: int,
    stop_code: int | None = None,
    event_connect: bool = True,
    abortive: bool = True,
    shared_listener: socket.socket | None = None,
    occupancy_limit: int = 12500,
):
    """Execute a single phase of loopback connects.

    Args:
        randomized: Whether SO_RANDOMIZE_PORT is enabled on client sockets.
        attempts: Number of loopback connects to attempt in this phase.
        stop_code: Optional Winsock error code that halts the phase early.
        event_connect: Whether to use WSAEventSelect/WSAEnumNetworkEvents for completion.
        abortive: Whether to reset connections (SO_LINGER=0) to prevent TIME_WAIT accumulation.
        shared_listener: Optional pre-bound listening socket to reuse across phases.
        occupancy_limit: Safety threshold for system TCP table rows before aborting.
    """
    before = tcp_snapshot()
    if "total" not in before or before["total"] + (6 if abortive else attempts) > occupancy_limit:
        raise RuntimeError(f"Defer probe until TCP occupancy is lower: {before}")
    stop = threading.Event()
    server_errors = []
    listener = shared_listener if shared_listener is not None else socket.socket()
    if shared_listener is None:
        listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    address = listener.getsockname()

    def serve():
        with selectors.DefaultSelector() as poller:
            poller.register(listener, selectors.EVENT_READ)
            try:
                while not stop.is_set():
                    for key, _ in poller.select(0.05):
                        if key.fileobj is listener:
                            conn, _ = listener.accept()
                            conn.setblocking(False)
                            poller.register(conn, selectors.EVENT_READ)
                        else:
                            conn = key.fileobj
                            try:
                                data = conn.recv(4096)
                            except ConnectionResetError:
                                if not abortive:
                                    raise
                                data = b""
                            if data:
                                conn.sendall(b"x")
                            else:
                                poller.unregister(conn)
                                conn.close()
            except Exception as exc:  # noqa: BLE001
                server_errors.append(repr(exc))
            finally:
                for key in list(poller.get_map().values()):
                    if key.fileobj is not listener:
                        key.fileobj.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    errors = Counter()
    detail = []
    ports = Counter()
    started = time.monotonic()
    completed_attempts = 0

    def failed(operation, code, conn, batch):
        errors[f"{operation}:{code}"] += 1
        try:
            local = conn.getsockname()
        except OSError as exc:
            local = {"getsockname_error": exc.winerror}
        sample = tcp_snapshot(local[1] if isinstance(local, tuple) else None)
        row = {
            "operation": operation,
            "error": code,
            "local": local,
            "remote": list(address),
            "batch": batch,
            "tcp_total": sample.get("total"),
            "tcp_time_wait": sample.get("time_wait"),
            "tcp": sample,
        }
        detail.append(row)
        print(json.dumps({k: v for k, v in row.items() if k != "tcp"}), flush=True)

    try:
        for batch in range((attempts + 5) // 6):
            if abortive and batch % 100 == 0 and tcp_snapshot().get("total", 99999) > 3000:
                raise RuntimeError(
                    "TCP table grew above 3000 rows despite RST close (SO_LINGER 0)"
                )
            active = []
            pending = set()
            connected = []
            events = {}
            try:
                for _ in range(min(6, attempts - batch * 6)):
                    completed_attempts += 1
                    conn = socket.socket()
                    active.append(conn)
                    conn.setsockopt(socket.SOL_SOCKET, SO_RANDOMIZE_PORT, int(randomized))
                    conn.setblocking(False)
                    if event_connect:
                        event = winsock.WSACreateEvent()
                        if not event:
                            raise RuntimeError("WSACreateEvent failed")
                        events[conn] = event
                        if winsock.WSAEventSelect(conn.fileno(), event, FD_CONNECT) != 0:
                            raise RuntimeError("WSAEventSelect failed")
                    result = conn.connect_ex(address)
                    if result not in (0, WSAEWOULDBLOCK):
                        failed("connect_ex", result, conn, batch)
                        continue
                    pending.add(conn)
                while pending:
                    _, writable, exceptional = select.select([], list(pending), list(pending), 2)
                    if not writable and not exceptional:
                        errors["completion:timeout"] += len(pending)
                        break
                    for conn in set(writable + exceptional):
                        pending.remove(conn)
                        code = conn.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                        if event_connect:
                            state = NetworkEvents()
                            if (
                                winsock.WSAEnumNetworkEvents(
                                    conn.fileno(), events[conn], ctypes.byref(state)
                                )
                                != 0
                            ):
                                raise RuntimeError("WSAEnumNetworkEvents failed")
                            if not state.events & FD_CONNECT:
                                detail.append(
                                    {
                                        "operation": "missing_fd_connect",
                                        "events": state.events,
                                        "batch": batch,
                                    }
                                )
                            event_code = state.errors[4]
                            if event_code != code:
                                detail.append(
                                    {
                                        "operation": "completion_code_difference",
                                        "error": event_code,
                                        "so_error": code,
                                        "batch": batch,
                                    }
                                )
                            code = event_code
                            winsock.WSAEventSelect(conn.fileno(), None, 0)
                        if code:
                            failed("completion", code, conn, batch)
                            continue
                        ports[conn.getsockname()[1]] += 1
                        conn.settimeout(2)
                        conn.sendall(b"x")
                        connected.append(conn)
                for conn in connected:
                    try:
                        if conn.getpeername():
                            assert conn.recv(1) == b"x"
                            if abortive:
                                conn.setsockopt(
                                    socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("HH", 1, 0)
                                )
                            else:
                                conn.shutdown(socket.SHUT_WR)
                    except OSError as exec_err:
                        errors[f"exchange:{exec_err.winerror}"] += 1
            finally:
                for conn in active:
                    conn.close()
                for event in events.values():
                    winsock.WSACloseEvent(event)
            if server_errors:
                raise RuntimeError(server_errors)
            if stop_code is not None and any(row.get("error") == stop_code for row in detail):
                break
    finally:
        stop.set()
        thread.join(5)
        if shared_listener is None:
            listener.close()
    if thread.is_alive():
        raise RuntimeError("probe server did not stop")
    return {
        "randomized": randomized,
        "event_connect": event_connect,
        "abortive": abortive,
        "remote": list(address),
        "attempts": completed_attempts,
        "requested_attempts": attempts,
        "connected": sum(ports.values()),
        "unique_ports": len(ports),
        "most_reused": ports.most_common(5),
        "errors": dict(errors),
        "error_10055": sum(count for key, count in errors.items() if key.endswith(":10055")),
        "details": detail,
        "server_errors": server_errors,
        "seconds": time.monotonic() - started,
        "tcp_before": before,
        "tcp_after": tcp_snapshot(),
    }


def evaluate_results(results: list[dict]) -> dict:
    """Analyze phase results and produce an A/B reproduction summary."""
    ordinary = [row for row in results if not row["randomized"]]
    randomized = [row for row in results if row["randomized"]]
    ordinary_10055 = sum(row.get("error_10055", 0) for row in ordinary)
    randomized_10055 = sum(row.get("error_10055", 0) for row in randomized)
    if randomized_10055 and ordinary_10055 == 0:
        status = "reproduced"
    elif randomized_10055 == 0 and ordinary_10055 == 0:
        status = "not_seen"
    else:
        status = "inconclusive"
    return {
        "status": status,
        "ordinary_attempts": sum(row["attempts"] for row in ordinary),
        "randomized_attempts": sum(row["attempts"] for row in randomized),
        "ordinary_10055": ordinary_10055,
        "randomized_10055": randomized_10055,
        "note": (
            "reproduced means WSAENOBUFS 10055 occurred only with SO_RANDOMIZE_PORT=1 "
            "at low TCP occupancy. not_seen means this run did not hit the intermittent error."
        ),
    }


def main():
    """Parse CLI arguments and run loopback connect phases."""
    parser = argparse.ArgumentParser(
        description="Loopback SO_RANDOMIZE_PORT comparison (Chromium Issue 572515601)."
    )
    parser.add_argument("destination", type=Path, help="JSON result path")
    parser.add_argument("--attempts", type=int, default=20000)
    parser.add_argument(
        "--modes",
        default="0,1,0,1,0,1",
        help="Phases: 0 disables SO_RANDOMIZE_PORT, 1 enables it",
    )
    parser.add_argument(
        "--stop-code",
        type=int,
        default=None,
        help="Stop a phase after this Winsock error (10055 for faster reproduction)",
    )
    parser.add_argument("--event-connect", action="store_true", default=True)
    parser.add_argument("--no-event-connect", action="store_false", dest="event_connect")
    parser.add_argument("--abortive", action="store_true", default=True)
    parser.add_argument("--no-abortive", action="store_false", dest="abortive")
    parser.add_argument("--shared-listener", action="store_true", default=True)
    parser.add_argument("--no-shared-listener", action="store_false", dest="shared_listener")
    args = parser.parse_args()
    args.destination = args.destination.resolve()
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    stop_code = args.stop_code
    results = []
    with ExitStack() as stack:
        shared_listener = None
        if args.shared_listener:
            shared_listener = stack.enter_context(socket.socket())
            shared_listener.bind(("127.0.0.1", 0))
        for randomized in (bool(int(value)) for value in args.modes.split(",")):
            result = run(
                randomized,
                args.attempts,
                stop_code,
                args.event_connect,
                args.abortive,
                shared_listener,
            )
            results.append(result)
            print(
                json.dumps({key: value for key, value in result.items() if key != "details"}),
                flush=True,
            )
            summary = evaluate_results(results)
            payload = {"phases": results, "summary": summary, "verdict": summary}
            args.destination.write_text(
                json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n"
            )
    print(json.dumps({"summary": summary}), flush=True)


if __name__ == "__main__":
    main()
