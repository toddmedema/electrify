#!/usr/bin/env python3
"""Reproduce the optional Latin webfont artifact; fontTools[woff]==4.61.1 is required."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RANGES = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212,U+2215,U+FEFF,U+FFFD"
with tempfile.TemporaryDirectory() as directory:
    target = Path(directory) / "latin.woff2"
    subprocess.run([
        sys.executable, "-m", "fontTools.subset",
        str(ROOT / "public/fonts/inter/InterVariable.woff2"),
        "--unicodes=" + RANGES, "--flavor=woff2", "--layout-features=*",
        "--no-recalc-timestamp", "--output-file=" + str(target),
    ], check=True)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    name = "InterVariable-latin." + digest[:8] + ".woff2"
    shutil.copyfile(target, ROOT / "public/fonts/inter" / name)
    print(name, digest)
