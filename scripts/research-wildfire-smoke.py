"""Regenerate city smoke detection history from NOAA HMS annual polygon archives.

Python 3 standard library only. Run from the repository root:
  python scripts/research-wildfire-smoke.py
  python scripts/research-wildfire-smoke.py --cache-dir /path/to/downloaded/bundles

Archives are cached outside the repository. The JSON stores maximum detected plume
density per UTC Start date at each canonical city point. A missing local polygon
is NOT a verified smoke-free observation. Dates with no polygons anywhere in the
annual archive remain explicitly unknown. HMS does not provide a local cloud mask.
"""

import argparse
import calendar
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import struct
import tempfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE_URL = (
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/"
    "Smoke_Polygons/Shapefile/Annual_Bundles/"
)
DENSITY = {"light": 1, "5": 1, "medium": 2, "16": 2, "heavy": 3, "21": 3}


def read_dbf(data):
    """Read the fixed-width character fields used by the NOAA dBASE tables."""
    if len(data) < 33:
        raise ValueError("Truncated DBF header")
    count, header_size, record_size = struct.unpack_from("<IHH", data, 4)
    fields = []
    offset = 32
    while offset < header_size - 1:
        field = data[offset : offset + 32]
        if len(field) != 32 or field[11] != ord("C"):
            raise ValueError("Expected NOAA character fields in DBF")
        fields.append((field[:11].split(b"\0")[0].decode("ascii"), field[16]))
        offset += 32
    if data[header_size - 1] != 13 or 1 + sum(n for _, n in fields) != record_size:
        raise ValueError("Invalid DBF field layout")
    if len(data) < header_size + count * record_size:
        raise ValueError("Truncated DBF records")
    for index in range(count):
        start = header_size + index * record_size
        record = data[start : start + record_size]
        if record[:1] == b"*":
            yield None
            continue
        values = {}
        cursor = 1
        for name, width in fields:
            values[name] = record[cursor : cursor + width].decode("ascii").strip()
            cursor += width
        yield values


def read_shapes(data):
    """Yield aligned polygon record bodies without unpacking distant vertices."""
    if len(data) < 100 or struct.unpack_from(">i", data)[0] != 9994:
        raise ValueError("Invalid SHP header")
    if struct.unpack_from("<ii", data, 28) != (1000, 5):
        raise ValueError("Expected version 1000 Polygon shapefile")
    if struct.unpack_from(">i", data, 24)[0] * 2 != len(data):
        raise ValueError("SHP file length does not match header")
    offset = 100
    expected_index = 1
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated SHP record header")
        index, words = struct.unpack_from(">ii", data, offset)
        size = words * 2
        if index != expected_index or size < 4 or offset + 8 + size > len(data):
            raise ValueError("Invalid SHP record")
        body = memoryview(data)[offset + 8 : offset + 8 + size]
        shape_type = struct.unpack_from("<i", body)[0]
        if shape_type not in (0, 5):
            raise ValueError(f"Unsupported shape type {shape_type}")
        yield body if shape_type else None
        expected_index += 1
        offset += 8 + size


def polygon_covers(body, longitude, latitude):
    """Even/odd ring containment, including boundaries and polygon holes."""
    if len(body) < 44:
        raise ValueError("Truncated polygon")
    left, bottom, right, top = struct.unpack_from("<dddd", body, 4)
    if not (left <= longitude <= right and bottom <= latitude <= top):
        return False
    parts, points = struct.unpack_from("<ii", body, 36)
    if parts < 1 or points < 4 or len(body) != 44 + parts * 4 + points * 16:
        raise ValueError("Invalid polygon size")
    starts = list(struct.unpack_from(f"<{parts}i", body, 44)) + [points]
    if starts[0] != 0 or any(a >= b for a, b in zip(starts, starts[1:])):
        raise ValueError("Invalid polygon ring offsets")
    points_start = 44 + parts * 4
    inside = False
    for start, end in zip(starts, starts[1:]):
        if end - start < 4:
            raise ValueError("Polygon ring has fewer than four vertices")
        previous = struct.unpack_from("<dd", body, points_start + 16 * (end - 1))
        for point in range(start, end):
            current = struct.unpack_from("<dd", body, points_start + 16 * point)
            x1, y1 = previous
            x2, y2 = current
            cross = (longitude - x1) * (y2 - y1) - (latitude - y1) * (x2 - x1)
            if (
                abs(cross) < 1e-12
                and min(x1, x2) <= longitude <= max(x1, x2)
                and min(y1, y2) <= latitude <= max(y1, y2)
            ):
                return True
            if (y1 > latitude) != (y2 > latitude):
                crossing = x1 + (latitude - y1) * (x2 - x1) / (y2 - y1)
                if longitude < crossing:
                    inside = not inside
            previous = current
    return inside


def parse_archive(path, year, locations):
    days = 366 if calendar.isleap(year) else 365
    represented = set()
    daily = {key: [0] * days for key in locations}
    polygon_count = 0
    with zipfile.ZipFile(path) as archive:
        base = f"hms_smoke{year}"
        projection = archive.read(f"{base}.prj").decode("ascii")
        if 'GEOGCS["GCS_WGS_1984"' not in projection:
            raise ValueError("Expected unprojected WGS84 coordinates")
        records = list(read_dbf(archive.read(f"{base}.dbf")))
        shapes = read_shapes(archive.read(f"{base}.shp"))
        shape_count = 0
        for index, body in enumerate(shapes):
            shape_count += 1
            if index >= len(records):
                raise ValueError("SHP has more records than DBF")
            record = records[index]
            if record is None or body is None:
                continue
            date = datetime.datetime.strptime(record["Start"], "%Y%j %H%M")
            if date.year != year:
                raise ValueError(f"Observation date outside archive year: {date}")
            day = date.timetuple().tm_yday - 1
            density = DENSITY[record["Density"].lower()]
            represented.add(day)
            polygon_count += 1
            for key, location in locations.items():
                if daily[key][day] < density and polygon_covers(
                    body, location["longitude"], location["latitude"]
                ):
                    daily[key][day] = density
        if shape_count != len(records):
            raise ValueError("SHP/DBF record count mismatch")
    return {
        "year": year,
        "source": {
            "url": BASE_URL + path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
        },
        "polygonCount": polygon_count,
        "archiveDaysWithPolygons": len(represented),
        "daysWithoutArchivePolygons": [day + 1 for day in range(days) if day not in represented],
        "locations": {
            key: {
                "dailyDensity": "".join(
                    str(value) if day in represented else "?"
                    for day, value in enumerate(values)
                ),
                "detectedDaysByMonth": [
                    sum(
                        values[(date - datetime.date(year, 1, 1)).days] > 0
                        for date in (
                            datetime.date(year, month, day)
                            for day in range(1, calendar.monthrange(year, month)[1] + 1)
                        )
                    )
                    for month in range(1, 13)
                ],
            }
            for key, values in daily.items()
        },
    }


def download(year, cache):
    path = cache / f"hms_smoke{year}.zip"
    if not path.exists():
        request = urllib.request.Request(
            BASE_URL + path.name, headers={"User-Agent": "Electrify research import"}
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            content = response.read()
        path.write_bytes(content)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        type=pathlib.Path,
        default=pathlib.Path(tempfile.gettempdir()) / "electrify-wildfire-research",
    )
    parser.add_argument("--first-year", type=int, default=2017)
    parser.add_argument("--last-year", type=int, default=2025)
    parser.add_argument(
        "--output", type=pathlib.Path, default=ROOT / "src/data/WildfireSmokeHistory.json"
    )
    args = parser.parse_args()
    if args.first_year > args.last_year or args.last_year >= datetime.date.today().year:
        parser.error("Select complete historical years in chronological order")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    cities = json.loads((ROOT / "scripts/cities.json").read_text(encoding="utf-8"))["cities"]
    locations = {
        city["id"]: {
            "name": city["city"],
            "latitude": city["lat"],
            "longitude": city["long"],
        }
        for city in cities
        if city["id"] in ("LA", "SF")
    }
    if set(locations) != {"LA", "SF"}:
        raise ValueError("Canonical LA/SF locations missing from scripts/cities.json")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        paths = list(
            pool.map(
                lambda year: download(year, args.cache_dir),
                range(args.first_year, args.last_year + 1),
            )
        )
    years = []
    for year, path in zip(range(args.first_year, args.last_year + 1), paths):
        result = parse_archive(path, year, locations)
        years.append(result)
        counts = {
            key: sum(character in "123" for character in value["dailyDensity"])
            for key, value in result["locations"].items()
        }
        print(f"{year}: {counts}, {result['archiveDaysWithPolygons']} archive days", flush=True)
    output = {
        "schemaVersion": 1,
        "sourceProduct": "NOAA NESDIS Hazard Mapping System smoke polygons",
        "sourceDocumentation": "https://www.ospo.noaa.gov/products/land/hms.html",
        "sampling": "Maximum polygon density covering each canonical city point per UTC Start date",
        "attenuationReference": {
            "sourceUrl": "https://www.nlr.gov/docs/fy23osti/86640.pdf#page=38",
            "report": "NREL/TP-5D00-86640 (June 2023)",
            "figure": 18,
            "referenceStartDate": "2020-09-10",
            "localStartHour": 10,
            "localEndHour": 18,
            "quantity": "Modeled regional mean clear-sky global horizontal irradiance loss versus no-wildfire counterfactual",
            "dailyIrradianceLoss": {
                "SF": [0.23, 0.22, 0.17, 0.15, 0.10],
                "LA": [0.19, 0.18, 0.12, 0.16, 0.16],
            },
            "regions": {"SF": "Greater Bay Area", "LA": "Los Angeles metropolitan area"},
            "limitations": "Rounded daily regional means for one severe episode; not hourly observations, plant-specific losses, or calibrated density-to-loss coefficients",
        },
        "densityCodes": {
            "?": "No polygons anywhere in annual archive on this date; observation status unknown",
            "0": "No plume detected over the city point; not a verified smoke-free observation",
            "1": "Light smoke detected",
            "2": "Medium smoke detected",
            "3": "Heavy smoke detected",
        },
        "limitations": [
            "HMS daytime satellite detection can miss smoke under clouds; no local clear-sky mask is available here.",
            "Observed plume detection frequency is not an unbiased estimate of true smoke, ignition, or outage frequency.",
            "Density is a qualitative satellite plume class; it is not an irradiance-loss percentage.",
            "UTC observation Start dates can differ from local dates; consecutive detected days do not establish uninterrupted smoke hours.",
            "City-point exposure is a coarse approximation for colocated solar; it does not locate remote utility resources.",
        ],
        "locations": locations,
        "years": years,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
