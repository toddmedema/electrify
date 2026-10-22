"""Focused import checks: python scripts/research-wildfire-smoke.test.py."""

import importlib.util
import pathlib
import struct
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location(
    "wildfire_smoke_import", pathlib.Path(__file__).with_name("research-wildfire-smoke.py")
)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


def polygon(*rings):
    points = [point for ring in rings for point in ring]
    x_values, y_values = zip(*points)
    starts = []
    for ring in rings:
        starts.append(sum(len(item) for item in rings[: len(starts)]))
    return (
        struct.pack(
            "<iddddii", 5, min(x_values), min(y_values), max(x_values), max(y_values), len(rings), len(points)
        )
        + struct.pack(f"<{len(starts)}i", *starts)
        + b"".join(struct.pack("<dd", *point) for point in points)
    )


def shapes(*bodies):
    content = b"".join(
        struct.pack(">ii", index + 1, len(body) // 2) + body
        for index, body in enumerate(bodies)
    )
    header = bytearray(100)
    struct.pack_into(">i", header, 0, 9994)
    struct.pack_into(">i", header, 24, (100 + len(content)) // 2)
    struct.pack_into("<ii", header, 28, 1000, 5)
    return bytes(header) + content


def records(*rows):
    fields = [("Start", 12), ("Density", 6)]
    header = bytearray(32)
    struct.pack_into("<IHH", header, 4, len(rows), 97, 19)
    for name, size in fields:
        field = bytearray(32)
        field[: len(name)] = name.encode("ascii")
        field[11] = ord("C")
        field[16] = size
        header.extend(field)
    header.append(13)
    for row in rows:
        header.extend(b" " + row[0].encode("ascii").ljust(12) + row[1].encode("ascii").ljust(6))
    return bytes(header)


SQUARE = [(-2, -2), (2, -2), (2, 2), (-2, 2), (-2, -2)]


class SmokeImportTests(unittest.TestCase):
    def test_polygon_holes_boundaries_and_disjoint_parts(self):
        hole = [(-1, -1), (-1, 1), (1, 1), (1, -1), (-1, -1)]
        distant = [(10, 10), (11, 10), (11, 11), (10, 11), (10, 10)]
        body = polygon(SQUARE, hole, distant)
        self.assertFalse(IMPORTER.polygon_covers(body, 0, 0))
        self.assertTrue(IMPORTER.polygon_covers(body, 1.5, 0))
        self.assertTrue(IMPORTER.polygon_covers(body, 2, 0))
        self.assertTrue(IMPORTER.polygon_covers(body, 10.5, 10.5))
        self.assertFalse(IMPORTER.polygon_covers(body, 5, 5))
        self.assertFalse(IMPORTER.polygon_covers(body, 20, 0))

    def test_archive_retains_leap_day_density_maximum_and_unknown_days(self):
        with tempfile.TemporaryDirectory(dir=IMPORTER.ROOT) as directory:
            path = pathlib.Path(directory) / "hms_smoke2020.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("hms_smoke2020.prj", 'GEOGCS["GCS_WGS_1984"]')
                archive.writestr("hms_smoke2020.shp", shapes(polygon(SQUARE), polygon(SQUARE)))
                archive.writestr(
                    "hms_smoke2020.dbf",
                    records(("2020060 1200", "21"), ("2020060 1800", "Light")),
                )
            result = IMPORTER.parse_archive(
                path,
                2020,
                {"near": {"longitude": 0, "latitude": 0}, "far": {"longitude": 40, "latitude": 40}},
            )
        self.assertEqual(result["archiveDaysWithPolygons"], 1)
        self.assertEqual(result["locations"]["near"]["dailyDensity"], "?" * 59 + "3" + "?" * 306)
        self.assertEqual(result["locations"]["far"]["dailyDensity"][59], "0")
        self.assertEqual(result["locations"]["near"]["detectedDaysByMonth"], [0, 1] + [0] * 10)
        self.assertIn(1, result["daysWithoutArchivePolygons"])
        self.assertNotIn(60, result["daysWithoutArchivePolygons"])

    def test_truncated_source_data_fails_instead_of_becoming_no_smoke(self):
        with self.assertRaisesRegex(ValueError, "length"):
            list(IMPORTER.read_shapes(shapes(polygon(SQUARE))[:-8]))
        with self.assertRaisesRegex(ValueError, "Truncated DBF"):
            list(IMPORTER.read_dbf(records(("2020060 1200", "Light"))[:-1]))


if __name__ == "__main__":
    unittest.main()
