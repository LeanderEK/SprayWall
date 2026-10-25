"""Updates site/sw.js: the list of files to save for offline use, and a version number made from what is in them.

    python tools/stamp.py

Run it whenever anything in `site` has changed, before putting the site online. If a file is forgotten, the test page
(http://localhost:8080/tests/) says so. The version is a fingerprint of the files, so it changes exactly when they do,
and phones that have the app notice and offer the update.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

# A different site folder can be given as the first argument (the offline check uses a throwaway copy).
SITE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "site"


def main() -> None:
    files = sorted(p.relative_to(SITE).as_posix() for p in SITE.rglob("*") if p.is_file() and p.name != "sw.js")
    digest = hashlib.sha256()
    for name in files:
        digest.update(name.encode())
        digest.update((SITE / name).read_bytes())
    version = digest.hexdigest()[:12]
    assets = ["./"] + [f"./{name}" for name in files]
    sw = (SITE / "sw.js").read_text(encoding="utf-8")
    sw = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", sw)
    sw = re.sub(r"const ASSETS = \[.*?\];", "const ASSETS = " + json.dumps(assets, indent=2) + ";", sw, flags=re.S)
    (SITE / "sw.js").write_text(sw, encoding="utf-8", newline="\n")
    print(f"version {version}, {len(assets)} files saved for offline use")


if __name__ == "__main__":
    main()
