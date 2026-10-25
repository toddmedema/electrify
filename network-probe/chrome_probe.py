"""Drive Chrome binaries against a loopback HTTP server for Chromium Issue 572515601.

Uses standard library Python only (no external packages or Playwright required).
Launches Chrome processes with --log-net-log and drives page loads via the
DevTools HTTP endpoints (/json/version, /json/new, /json/close), cleanly
shutting down via Browser.close over WebSocket to flush NetLogs to disk.

Usage:
  py -3 chrome_probe.py results/chrome-default --chrome path/to/chrome.exe
  py -3 chrome_probe.py results/chrome-disable --chrome path/to/chrome.exe --feature-mode disable
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from summarize_netlogs import compact, finalize_netlog, summarize_source
from win_tcp import tcp_snapshot, wait_until_idle

HTML = (
    "<!doctype html><title>Chromium Issue 572515601</title>"
    + "".join(f'<script src="/asset-{n}.js"></script>' for n in range(6))
).encode()
SCRIPT = b"window.probeLoaded = (window.probeLoaded || 0) + 1;"
ASSET_PATHS = {f"/asset-{n}.js" for n in range(6)}


def free_port() -> int:
    """Find an available ephemeral TCP port on loopback."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def http_json(url: str, method: str = "GET", timeout: float = 5.0) -> dict | list:
    """Perform an HTTP request and parse the JSON response."""
    request = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}


def wait_debug(port: int, timeout: float = 20.0) -> dict:
    """Poll Chrome's DevTools HTTP endpoint until responsive."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            return http_json(f"http://127.0.0.1:{port}/json/version")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as exc:
            last = repr(exc)
            time.sleep(0.1)
    raise RuntimeError(f"Chrome debug port {port} did not come up: {last}")


def open_tab(debug_port: int, url: str) -> dict:
    """Open a new tab via DevTools HTTP endpoint /json/new."""
    encoded = urllib.request.quote(url, safe=":/")
    last = None
    for method in ("PUT", "GET", "POST"):
        try:
            return http_json(
                f"http://127.0.0.1:{debug_port}/json/new?{encoded}",
                method=method,
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = (method, repr(exc))
    raise RuntimeError(f"Could not open tab for {url}: {last}")


def close_tab(debug_port: int, target_id: str) -> None:
    """Close a target tab via DevTools HTTP endpoint /json/close."""
    try:
        http_json(f"http://127.0.0.1:{debug_port}/json/close/{target_id}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        pass


def _ws_send_text(sock: socket.socket, payload: str) -> None:
    """Send a masked client-to-server text frame over a raw WebSocket (RFC 6455)."""
    data = payload.encode("utf-8")
    header = bytearray([0x81])
    length = len(data)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    mask = os.urandom(4)
    header.extend(mask)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
    sock.sendall(header + masked)


def send_browser_close(ws_url: str, timeout: float = 8.0) -> None:
    """Send DevTools Browser.close command to gracefully flush NetLogs."""
    parsed = urllib.parse.urlparse(ws_url)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {parsed.hostname}:{parsed.port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    with socket.create_connection((parsed.hostname, parsed.port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(request.encode("ascii"))
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError("Chrome closed the DevTools handshake")
            buffer += chunk
        status = buffer.split(b"\r\n", 1)[0]
        if b"101" not in status:
            raise ConnectionError(f"DevTools WebSocket upgrade failed: {status!r}")
        _ws_send_text(sock, json.dumps({"id": 1, "method": "Browser.close"}))
        try:
            sock.recv(256)
        except OSError:
            pass


class ProbeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, format, *args):
        return

    def do_GET(self):
        self.server.paths.append(self.path)
        body = HTML if self.path == "/" else SCRIPT
        self.close_connection = True
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html" if self.path == "/" else "text/javascript")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            pass

    def finish(self):
        try:
            self.connection.setsockopt(
                socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("HH", 1, 0)
            )
        except OSError:
            pass
        super().finish()


class ProbeServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows RSTs SYNs when the listen backlog is full (WSAECONNREFUSED /
    # 10061). Chrome's preload scanner fetches all six scripts plus favicon
    # together; the TCPServer default of 5 is too small.
    request_queue_size = 128


def serve_page() -> tuple[ThreadingHTTPServer, threading.Thread]:
    """Start an ephemeral loopback HTTP server serving the test HTML and script assets."""
    server = ProbeServer(("127.0.0.1", 0), ProbeHandler)
    server.paths = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def stop_server(server: ThreadingHTTPServer, thread: threading.Thread) -> None:
    """Shut down and close the ephemeral HTTP server."""
    server.shutdown()
    server.server_close()
    thread.join(5)


def chrome_args(chrome: Path, profile: Path, netlog: Path, debug_port: int, feature_mode: str) -> list[str]:
    """Construct command-line arguments for launching Chrome in test mode."""
    args = [
        str(chrome),
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={debug_port}",
        "--remote-allow-origins=*",
        f"--log-net-log={netlog}",
        "--net-log-max-size-mb=128",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-field-trial-config",
        "about:blank",
    ]
    name = chrome.name.lower()
    if "headless-shell" not in name:
        args.insert(1, "--headless=new")
    if feature_mode == "disable":
        args.insert(-1, "--disable-features=TcpPortRandomizationWin")
    elif feature_mode == "enable":
        args.insert(-1, "--enable-features=TcpPortRandomizationWin")
    return args


def launch_chrome(args: list[str]) -> subprocess.Popen:
    """Launch a Chrome process detached from the current console window."""
    creation = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creation,
    )


def stop_chrome(proc: subprocess.Popen, ws_url: str | None = None) -> None:
    """Gracefully terminate Chrome via DevTools Browser.close, falling back to process kill."""
    if proc.poll() is not None:
        return
    if ws_url:
        try:
            send_browser_close(ws_url)
            proc.wait(timeout=20)
            return
        except (OSError, TimeoutError, subprocess.TimeoutExpired, ConnectionError, ValueError):
            pass
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def run_worker(index: int, args, stop: threading.Event, result_lock: threading.Lock, workers_out: list[dict]) -> None:
    """Worker thread running sequential page loads against a dedicated Chrome instance."""
    prefix = f"worker-{index}"
    profile = Path(tempfile.mkdtemp(prefix=f"cft-{prefix}-", dir=args.directory))
    netlog = args.directory / f"{prefix}-netlog.json"
    debug_port = free_port()
    command = chrome_args(args.chrome, profile, netlog, debug_port, args.feature_mode)
    observations = {
        "worker": index,
        "completed": 0,
        "failures": [],
        "command": command,
        "debug_port": debug_port,
    }
    proc = launch_chrome(command)
    ws_url = None
    try:
        version = wait_debug(debug_port)
        observations["version"] = version
        ws_url = version.get("webSocketDebuggerUrl")
        for iteration in range(args.iterations):
            if stop.is_set():
                break
            if iteration % 10 == 0:
                state = tcp_snapshot()
                if state.get("total", 0) > 11000:
                    observations["capacity_stop"] = state
                    stop.set()
                    break
            server, thread = serve_page()
            page_port = server.server_address[1]
            url = f"http://127.0.0.1:{page_port}/"
            target = None
            try:
                target = open_tab(debug_port, url)
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    assets = {path for path in server.paths if path in ASSET_PATHS}
                    if "/" in server.paths and len(assets) == 6:
                        break
                    if proc.poll() is not None:
                        raise RuntimeError(f"Chrome exited {proc.returncode}")
                    time.sleep(0.01)
                assets = {path for path in server.paths if path in ASSET_PATHS}
                loaded = len(assets)
                if loaded != 6:
                    observations["failures"].append(
                        {
                            "iteration": iteration,
                            "url": url,
                            "loaded": loaded,
                            "paths": list(server.paths),
                            "tcp": tcp_snapshot(page_port),
                        }
                    )
                    stop.set()
            except Exception as exc:  # noqa: BLE001
                observations["failures"].append(
                    {
                        "iteration": iteration,
                        "url": url,
                        "exception": repr(exc),
                        "paths": list(server.paths),
                        "tcp": tcp_snapshot(page_port),
                    }
                )
                stop.set()
            finally:
                if target and target.get("id"):
                    close_tab(debug_port, target["id"])
                stop_server(server, thread)
            observations["completed"] += 1
            if iteration % 50 == 0:
                print(
                    json.dumps(
                        {
                            "worker": index,
                            "completed": observations["completed"],
                            "failures": len(observations["failures"]),
                        }
                    ),
                    flush=True,
                )
    finally:
        stop_chrome(proc, ws_url)
        try:
            observations["netlog_finalize"] = finalize_netlog(netlog)
        except Exception as exc:  # noqa: BLE001
            observations["netlog_finalize_error"] = repr(exc)
        with result_lock:
            workers_out.append(observations)
        (args.directory / f"{prefix}-result.json").write_text(
            json.dumps(observations, indent=2) + "\n", encoding="utf-8", newline="\n"
        )


def main():
    parser = argparse.ArgumentParser(
        description="stdlib Chrome loopback probe for Chromium Issue 572515601."
    )
    parser.add_argument("directory", type=Path)
    parser.add_argument("--chrome", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=2000)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--feature-mode",
        choices=("default", "enable", "disable"),
        default="default",
    )
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("This probe is Windows-only.")
    args.directory = args.directory.resolve()
    args.chrome = args.chrome.resolve()
    if not args.chrome.is_file():
        parser.error(f"Chrome binary not found: {args.chrome}")
    before = tcp_snapshot()
    # Low hundreds: matches the reproduction claim that 10055 happens with a small TCP table.
    time_wait_limit = 200
    busy_total = 2000
    if before.get("time_wait", 0) > time_wait_limit:
        print(
            f"Waiting for {before.get('time_wait', 0)} prior closed connections "
            f"(TIME_WAIT) from previous run to expire...",
            flush=True,
        )
        # 300s covers default TcpTimedWaitDelay (120s) and 240s 2MSL.
        before = wait_until_idle(
            time_wait_limit=time_wait_limit,
            timeout_s=300,
            poll_s=5,
            on_poll=lambda snap, left: print(
                f"TIME_WAIT {snap.get('time_wait', 0)} rows remaining "
                f"({int(left)}s timeout left)...",
                flush=True,
            ),
        )
        if before.get("time_wait", 0) > time_wait_limit:
            raise RuntimeError(f"Wait for prior TIME_WAIT connections to expire: {before}")
        print(
            f"TIME_WAIT cooled down ({before.get('time_wait', 0)} TIME_WAIT, "
            f"{before.get('total')} total rows). Starting probe...",
            flush=True,
        )
    if before.get("total", 99999) > busy_total:
        raise RuntimeError(f"Host TCP table still too busy to start a clean probe: {before}")
    args.directory.mkdir(parents=True, exist_ok=True)
    stop = threading.Event()
    result_lock = threading.Lock()
    workers_out = []
    started = time.time()
    threads = [
        threading.Thread(
            target=run_worker,
            args=(index, args, stop, result_lock, workers_out),
            daemon=True,
        )
        for index in range(args.workers)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    finished = time.time()
    failures = [row for worker in workers_out for row in worker["failures"]]
    payload = {
        "started": started,
        "finished": finished,
        "seconds": finished - started,
        "chrome": str(args.chrome),
        "feature_mode": args.feature_mode,
        "iterations": args.iterations,
        "worker_count": args.workers,
        "tcp_before": before,
        "tcp_after": tcp_snapshot(),
        "workers": sorted(workers_out, key=lambda row: row["worker"]),
        "completed": sum(row["completed"] for row in workers_out),
        "failure_count": len(failures),
        "failures": failures,
    }
    try:
        reports = summarize_source(args.directory)
        (args.directory / "netlog-summary.json").write_text(
            json.dumps(reports, indent=2) + "\n", encoding="utf-8", newline="\n"
        )
        payload["netlog"] = [compact(row) for row in reports]
        payload["netlog_os_error_10055"] = sum(
            1
            for report in reports
            for item in report.get("os_errors", [])
            if item.get("params", {}).get("os_error") == 10055
        )
        payload["no_buffer_space_count"] = sum(
            report.get("no_buffer_space_count", 0) for report in reports
        )
        payload["netlog_file_errors"] = [
            {"file": report.get("file"), "error": report.get("error")}
            for report in reports
            if report.get("error")
        ]
    except Exception as exc:  # noqa: BLE001
        payload["netlog_error"] = repr(exc)
    if payload.get("netlog_os_error_10055") or payload.get("no_buffer_space_count"):
        payload["status"] = "reproduced"
    elif payload["failure_count"]:
        payload["status"] = "other_failure"
    elif any(row.get("capacity_stop") for row in workers_out):
        payload["status"] = "capacity_stop"
    else:
        payload["status"] = "clean"
    payload["verdict"] = payload["status"]
    (args.directory / "result.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(
        json.dumps(
            {
                "status": payload["status"],
                "completed": payload["completed"],
                "failures": payload["failure_count"],
                "netlog_os_error_10055": payload.get("netlog_os_error_10055"),
                "no_buffer_space_count": payload.get("no_buffer_space_count"),
                "seconds": payload["seconds"],
                "feature_mode": args.feature_mode,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
