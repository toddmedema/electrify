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
            self.respond(True)

        def do_HEAD(self):
            self.respond(False)

        def respond(self, include_body):
            response = responses.get((self.command, self.path), responses.get(self.path, (404, "missing")))
            status, body = response[:2]
            self.send_response(status)
            for name, value in (response[2] if len(response) > 2 else {}).items():
                self.send_header(name, value)
            self.end_headers()
            if include_body:
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

    def run_hosting_check(self, overrides=None, cache="public, max-age=300, must-revalidate"):
        short = {"Cache-Control": cache, "Strict-Transport-Security": "max-age=31536000"}
        responses = {
            "/sitemap.xml": (200, SITEMAP, short),
            "/": (200, PAGE, short),
            "/about": (301, "", {"Location": "/about.html"}),
            "/index.html": (301, "", {"Location": "/"}),
            "/scenarios/deep-freeze/": (301, "", {"Location": "/scenarios/deep-freeze.html"}),
            "/seo-check-does-not-exist.html": (404, '<meta name="robots" content="noindex">'),
            "/fonts/inter/InterVariable.woff2": (200, "", {"Cache-Control": "public, max-age=31536000, immutable"}),
            "/data/FuelPricesRaw.csv": (200, "", {"X-Robots-Tag": "noindex"}),
        }
        responses.update(overrides or {})
        with server(responses) as base:
            return subprocess.run(["python3", "-B", "scripts/seo-check.py", base, "--hosting"], cwd=ROOT,
                                  capture_output=True, text=True, timeout=10)

    def test_hosting_accepts_complete_cache_lifetimes(self):
        for cache in ["public, max-age=300, must-revalidate", 'public, MAX-AGE = "300", must-revalidate']:
            with self.subTest(cache=cache):
                result = self.run_hosting_check(cache=cache)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_hosting_rejects_prefix_matches_for_every_document_check(self):
        for method, route, expected in [
            ("GET", "/", "HTML needs short cache lifetime"),
            ("HEAD", "/", "document needs short cache lifetime"),
            ("HEAD", "/sitemap.xml", "document needs short cache lifetime"),
        ]:
            with self.subTest(method=method, route=route):
                headers = {"Cache-Control": "public, max-age=300000", "Strict-Transport-Security": "max-age=31536000"}
                result = self.run_hosting_check({(method, route): (200, PAGE, headers)})
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn(expected, result.stdout)

    def test_hosting_rejects_ambiguous_or_misnamed_max_age(self):
        for cache in ["public, x-max-age=300", "public, max-age=300, max-age=300000", 'extension="x,max-age=300,y"']:
            with self.subTest(cache=cache):
                result = self.run_hosting_check(cache=cache)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("HTML needs short cache lifetime", result.stdout)

    def test_hosting_compares_the_complete_immutable_lifetime_and_directive(self):
        route = "/fonts/inter/InterVariable.woff2"
        for cache, expected in [
            ("public,max-age=31536000,immutable", 0),
            ("public, max-age=315360000, immutable", 1),
            ("public, max-age=31536000, not-immutable", 1),
        ]:
            with self.subTest(cache=cache):
                result = self.run_hosting_check({route: (200, "", {"Cache-Control": cache})})
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                if expected:
                    self.assertIn("asset needs a one-year immutable cache lifetime", result.stdout)


if __name__ == "__main__":
    unittest.main()
