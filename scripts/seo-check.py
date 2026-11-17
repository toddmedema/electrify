#!/usr/bin/env python3
"""Check sitemap pages after deploy, or a local build served over HTTP.

python3 scripts/seo-check.py [base_url] [--hosting]
Local fetches stay on base_url; canonical URLs must still identify production.
"""
import argparse
import datetime
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

ORIGIN = "https://electrifygame.com"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.descriptions, self.canonicals, self.ld, self.assets = [], [], [], []
        self.h1 = 0
        self.in_title = self.in_ld = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self.in_title = True
        elif tag == "meta" and a.get("name", "").lower() == "description":
            self.descriptions.append(a.get("content", ""))
        elif tag == "link" and "canonical" in a.get("rel", "").split():
            self.canonicals.append(a.get("href"))
        elif tag == "h1":
            self.h1 += 1
        elif tag == "script" and a.get("type") == "application/ld+json":
            self.in_ld = True
            self.ld.append("")
        asset = a.get("src") if tag == "script" else a.get("href") if tag == "link" else None
        if asset:
            self.assets.append(asset)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "script":
            self.in_ld = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_ld:
            self.ld[-1] += data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get(url, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": "Electrify-seo-check"})
    try:
        response = urllib.request.build_opener(NoRedirect).open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode("utf-8", "replace")


def page_errors(html, url):
    page = Page()
    page.feed(html)
    errors = []
    if not 10 <= len(page.title.strip()) <= 60:
        errors.append(f"title length {len(page.title.strip())} (want 10–60)")
    if len(page.descriptions) != 1 or not 70 <= len(page.descriptions[0]) <= 160:
        errors.append("need one description of 70–160 characters")
    if page.canonicals != [url]:
        errors.append(f"canonical {page.canonicals!r} != {[url]!r}")
    if page.h1 != 1:
        errors.append(f"h1 count {page.h1} (want 1)")
    if not page.ld:
        errors.append("missing JSON-LD")
    for blob in page.ld:
        try:
            value = json.loads(blob)
            if not isinstance(value, (dict, list)) or not value:
                raise ValueError()
        except ValueError:
            errors.append("invalid JSON-LD")
    return page, errors


def check(base, hosting=False):
    failing, checked = 0, 0

    def result(label, errors):
        nonlocal failing, checked
        checked += 1
        if errors:
            failing += 1
            print("FAIL", label, "; ".join(errors))

    try:
        status, _, xml = get(base + "/sitemap.xml")
        if status != 200:
            raise ValueError(f"sitemap status {status}")
        entries = ET.fromstring(xml).findall("s:url", NS)
        urls = [entry.findtext("s:loc", default="", namespaces=NS).strip() for entry in entries]
        if not urls or len(urls) != len(set(urls)):
            raise ValueError("empty or duplicate sitemap URLs")
        for entry, url in zip(entries, urls):
            parts = urllib.parse.urlsplit(url)
            if f"{parts.scheme}://{parts.netloc}" != ORIGIN or parts.query or parts.fragment:
                raise ValueError(f"noncanonical sitemap URL {url}")
            modified = entry.findtext("s:lastmod", default="", namespaces=NS)
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", modified):
                raise ValueError(f"missing/invalid lastmod on {url}")
            if datetime.date.fromisoformat(modified) > datetime.datetime.now(datetime.timezone.utc).date():
                raise ValueError(f"future lastmod on {url}")
    except (OSError, ValueError, ET.ParseError) as error:
        result("sitemap.xml", [str(error)])
        print(f"{checked} checks, {failing} failing")
        return 1

    titles, descriptions, assets = set(), set(), set()
    for url in urls:
        try:
            status, headers, html = get(base + urllib.parse.urlsplit(url).path)
            page, errors = page_errors(html, url)
            if status != 200:
                errors.append(f"status {status} (want 200 without redirects)")
            if page.title in titles:
                errors.append("duplicate title")
            titles.add(page.title)
            for description in page.descriptions:
                if description in descriptions:
                    errors.append("duplicate description")
                descriptions.add(description)
            if hosting and "max-age=300" not in headers.get("Cache-Control", ""):
                errors.append("HTML needs short cache lifetime")
            assets.update(page.assets)
            result(url, errors)
        except (OSError, ValueError) as error:
            result(url, [str(error)])

    if hosting:
        cases = [("/about", 301, "/about.html"), ("/index.html", 301, "/"),
                 ("/scenarios/deep-freeze/", 301, "/scenarios/deep-freeze.html"),
                 ("/seo-check-does-not-exist.html", 404, None)]
        for route, expected, location in cases:
            try:
                status, headers, body = get(base + route)
                errors = [] if status == expected else [f"status {status}, want {expected}"]
                if location and headers.get("Location") != location:
                    errors.append(f"location {headers.get('Location')!r}, want {location!r}")
                if expected == 404 and ("noindex" not in body or 'id="root"' in body):
                    errors.append("404 must be a noindex page without the game shell")
                result(route, errors)
            except OSError as error:
                result(route, [str(error)])
        immutable = {"/fonts/inter/InterVariable.woff2"}
        immutable.update(asset for asset in assets if re.match(r"/static/(js|css)/.*\.[a-f0-9]{8,}\.(js|css)$", asset))
        for route in sorted(immutable | {"/", "/sitemap.xml", "/data/FuelPricesRaw.csv"}):
            try:
                status, headers, _ = get(base + route, "HEAD")
                errors = [] if status == 200 else [f"status {status}"]
                if route in immutable and not all(value in headers.get("Cache-Control", "") for value in ["max-age=31536000", "immutable"]):
                    errors.append("asset needs a one-year immutable cache lifetime")
                if route in ["/", "/sitemap.xml"] and "max-age=300" not in headers.get("Cache-Control", ""):
                    errors.append("document needs short cache lifetime")
                if route == "/" and "max-age=31536000" not in headers.get("Strict-Transport-Security", ""):
                    errors.append("missing HSTS")
                if route.startswith("/data/") and "noindex" not in headers.get("X-Robots-Tag", ""):
                    errors.append("data needs X-Robots-Tag noindex")
                result(route, errors)
            except OSError as error:
                result(route, [str(error)])
    print(f"{len(urls)} URLs checked, {checked} checks, {failing} failing")
    return 1 if failing else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", nargs="?", default=ORIGIN)
    parser.add_argument("--hosting", action="store_true", help="also check live redirects, 404s, and headers")
    args = parser.parse_args()
    sys.exit(check(args.base_url.rstrip("/"), args.hosting))
