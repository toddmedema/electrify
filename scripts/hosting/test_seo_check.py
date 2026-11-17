"""Black-box smoke-check tests: serve real HTTP responses, then run the public CLI."""
import contextlib
import http.server
import pathlib
import subprocess
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SITEMAP = '''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url>
<loc>https://electrifygame.com/</loc><lastmod>2026-01-01</lastmod></url></urlset>'''
PAGE = '''<!doctype html><html lang="en"><head><title>Electrify — Electricity Strategy Game</title>
<meta name="description" content="Build a reliable electricity grid in a free strategy game about power plants, demand, and a cleaner future.">
<link rel="canonical" href="https://electrifygame.com/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoGame","name":"Electrify"}</script>
</head><body><h1>Electrify</h1></body></html>'''


@contextlib.contextmanager
def server(responses):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            status, body = responses.get(self.path, (404, "missing"))
            self.send_response(status)
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *args):
            pass

    instance = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=instance.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{instance.server_port}"
    finally:
        instance.shutdown()
        instance.server_close()
        worker.join()


class SmokeTest(unittest.TestCase):
    def run_check(self, page=PAGE, sitemap=SITEMAP, status=200):
        with server({"/sitemap.xml": (200, sitemap), "/": (status, page)}) as base:
            return subprocess.run(["python3", "-B", "scripts/seo-check.py", base], cwd=ROOT,
                                  capture_output=True, text=True, timeout=10)

    def test_valid_local_build_is_checked_locally(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1 URLs checked", result.stdout)
        self.assertIn("0 failing", result.stdout)

    def test_page_contract_mutations_are_rejected(self):
        for mutated, expected in [
            (PAGE.replace("<h1>Electrify</h1>", ""), "h1 count 0"),
            (PAGE.replace('href="https://electrifygame.com/"', 'href="https://example.com/"'), "canonical"),
            (PAGE.replace('"@type":"VideoGame"', '"@type":'), "invalid JSON-LD"),
            (PAGE.replace('application/ld+json', 'text/plain'), "missing JSON-LD"),
            (PAGE.replace("Build a reliable electricity grid in a free strategy game about power plants, demand, and a cleaner future.", "short"), "description"),
        ]:
            with self.subTest(expected=expected):
                result = self.run_check(page=mutated)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn(expected, result.stdout)

    def test_bad_status_is_reported_without_crashing(self):
        result = self.run_check(status=404)
        self.assertEqual(result.returncode, 1)
        self.assertIn("status 404", result.stdout)

    def test_sitemap_guard_mutations_are_rejected(self):
        for sitemap, expected in [
            (SITEMAP.replace("<lastmod>2026-01-01</lastmod>", ""), "lastmod"),
            (SITEMAP.replace("2026-01-01", "2026-99-99"), "month"),
            ('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>', "empty"),
            ("not xml", "syntax error"),
            (SITEMAP.replace("electrifygame.com", "example.com"), "noncanonical"),
        ]:
            with self.subTest(expected=expected):
                result = self.run_check(sitemap=sitemap)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn(expected, result.stdout)


if __name__ == "__main__":
    unittest.main()
