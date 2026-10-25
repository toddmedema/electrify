"""Stream and summarize Chromium NetLogs for Chromium Issue 572515601.

Processes Chromium --log-net-log files without loading entire multi-hundred-megabyte
JSON structures into memory. Detects:
  - TCP_CONNECT_ATTEMPT events with os_error == 10055 (WSAENOBUFS)
  - net_error == -176 (net::ERR_NO_BUFFER_SPACE)
  - Ephemeral port reuse and connection statistics
"""

from __future__ import annotations

import argparse
import json
import re
import time
import zipfile
from collections import Counter
from pathlib import Path

IN_PROGRESS_DIR = re.compile(
    r"Logging is in progress writing data to:\s*\n\s*(.+)",
    re.MULTILINE,
)


def is_placeholder(path: Path) -> bool:
    """Check if a NetLog file is an unfinalized pointer to an in-progress directory."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")[:800]
    except OSError:
        return False
    return "Logging is in progress writing data to:" in text


def stitch_netlog(inprogress: Path, destination: Path) -> None:
    """Assemble segmented in-progress NetLog event files into a unified JSON log."""
    constants = inprogress / "constants.json"
    if not constants.is_file():
        raise FileNotFoundError(f"no constants.json in {inprogress}")
    event_files = sorted(
        inprogress.glob("event_file_*.json"),
        key=lambda path: (path.stat().st_mtime, path.name),
    )
    const_text = constants.read_text(encoding="utf-8")
    first_line = const_text.splitlines()[0].strip() if const_text else ""
    try:
        parsed = json.loads(first_line.rstrip(","))
    except json.JSONDecodeError:
        parsed = {}
    ndjson = isinstance(parsed, dict) and parsed.get("type") == "constants"
    with destination.open("w", encoding="utf-8", newline="\n") as out:
        if ndjson:
            out.write(const_text if const_text.endswith("\n") else const_text + "\n")
            for event_file in event_files:
                out.write(event_file.read_text(encoding="utf-8"))
            end = inprogress / "end_netlog.json"
            if end.is_file():
                out.write(end.read_text(encoding="utf-8"))
            return
        out.write(const_text if const_text.endswith("\n") else const_text + "\n")
        last_line = ""
        started = False
        for event_file in event_files:
            with event_file.open(encoding="utf-8") as handle:
                if not started:
                    last_line = handle.readline()
                    started = True
                for next_line in handle:
                    if next_line.strip() == "":
                        last_line += next_line
                    else:
                        out.write(last_line)
                        last_line = next_line
        last_line = last_line.strip()
        if last_line.endswith(","):
            out.write(last_line[:-1] + "\n")
        elif last_line:
            out.write(last_line + "\n")
        end = inprogress / "end_netlog.json"
        if end.is_file():
            out.write(end.read_text(encoding="utf-8"))
        else:
            out.write("]}\n")


def finalize_netlog(path: Path, timeout: float = 20.0) -> str:
    """Ensure a NetLog file has flushed, stitching segmented logs if necessary."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file() and path.stat().st_size > 0 and not is_placeholder(path):
            with path.open("rb") as handle:
                first = handle.read(1)
            if first == b"{":
                return "flushed"
        time.sleep(0.2)
    if path.is_file() and is_placeholder(path):
        match = IN_PROGRESS_DIR.search(
            path.read_text(encoding="utf-8", errors="replace")
        )
        if match is None:
            raise RuntimeError(f"NetLog still in progress with no directory: {path}")
        source = Path(match.group(1).strip())
        if not source.is_dir():
            raise FileNotFoundError(f"in-progress NetLog directory missing: {source}")
        stitch_netlog(source, path)
        return "stitched"
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"NetLog missing: {path}")
    return "present"


def summarize(stream, name: str) -> dict:
    """Parse a NetLog JSON byte stream line-by-line and collect socket error metrics."""
    first = stream.readline().decode("utf-8").strip()
    if first.startswith("Logging is in progress"):
        raise ValueError(f"NetLog {name} was not flushed (Chrome still writing)")
    constants = json.loads(first.rstrip(",") + "}")["constants"]
    event_names = {number: key for key, number in constants["logEventTypes"].items()}
    events = 0
    errors = Counter()
    connects = 0
    source_ports = Counter()
    os_errors = []
    starts = {}
    failures = []
    decoder = json.JSONDecoder()
    for line in stream:
        text = line.decode("utf-8").strip().rstrip(",")
        if not text.startswith("{"):
            continue
        event, end = decoder.raw_decode(text)
        if text[end:].strip() not in ("", "]", "]}"):
            raise ValueError(f"Unexpected NetLog event suffix: {text[end:]!r}")
        events += 1
        kind = event_names[event["type"]]
        params = event.get("params", {})
        if kind == "TCP_CONNECT_ATTEMPT" and event["phase"] == 1:
            starts[event["source"]["id"]] = params
        if "os_error" in params:
            os_errors.append(
                {"type_name": kind, **event, "attempt": starts.get(event["source"]["id"])}
            )
        code = params.get("net_error")
        if isinstance(code, int) and code < 0:
            errors[(kind, code)] += 1
        if code == -176:
            failures.append({"type_name": kind, **event})
        if kind == "TCP_CONNECT" and event["phase"] == 2 and "local_address" in params:
            connects += 1
            source_ports[int(params["local_address"].rsplit(":", 1)[-1])] += 1
    client = constants.get("clientInfo", {})
    os_error_counts = dict(
        Counter(
            (item["type_name"], item.get("params", {}).get("os_error")) for item in os_errors
        )
    )
    return {
        "file": name,
        "events": events,
        "tcp_connects": connects,
        "unique_source_ports": len(source_ports),
        "source_ports_min_max": [min(source_ports, default=0), max(source_ports, default=0)],
        "source_port_max_uses": max(source_ports.values(), default=0),
        "os_errors": os_errors,
        "os_error_counts": {f"{kind}:{code}": count for (kind, code), count in os_error_counts.items()},
        "no_buffer_space": failures,
        "no_buffer_space_count": len(failures),
        "errors": [
            {"type": kind, "net_error": code, "count": count}
            for (kind, code), count in errors.most_common()
        ],
        "client": client,
    }


def summarize_source(source: Path) -> list[dict]:
    """Scan a directory or zip archive for NetLog JSON files and summarize each."""
    reports = []
    if source.suffix == ".zip":
        with zipfile.ZipFile(source) as archive:
            for name in archive.namelist():
                if name.endswith(".json"):
                    with archive.open(name) as stream:
                        reports.append(summarize(stream, name))
        return reports
    for path in sorted(set(source.glob("netlog-*.json")) | set(source.glob("*-netlog.json"))):
        if path.name == "netlog-summary.json":
            continue
        try:
            with path.open("rb") as stream:
                reports.append(summarize(stream, path.name))
        except Exception as exc:  # noqa: BLE001
            reports.append({"file": path.name, "error": repr(exc)})
    return reports


def compact(row: dict) -> dict:
    """Strip verbose sub-objects from a report row for compact summary displays."""
    return {
        key: value
        for key, value in row.items()
        if key not in ("errors", "client", "os_errors", "no_buffer_space")
    }


def main():
    """CLI entrypoint for summarizing Chromium NetLog files."""
    parser = argparse.ArgumentParser(description="Summarize Chromium NetLogs.")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    reports = summarize_source(args.source)
    args.destination.write_text(
        json.dumps(reports, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    for row in reports:
        print(json.dumps(compact(row), sort_keys=True), flush=True)
        print("OS error counts:", row.get("os_error_counts"), flush=True)
        print("NO_BUFFER_SPACE:", row.get("no_buffer_space_count"), flush=True)


if __name__ == "__main__":
    main()
