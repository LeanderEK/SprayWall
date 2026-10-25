"""Runs every test page in a real (invisible) Chrome and prints the result.

    tools\\.venv\\Scripts\\python.exe tools\\run_tests.py

Starts its own server on port 8091, so it does not matter whether the one on 8080 is running. Exit code 1 if any test fails.
"""
import json
import sys

from browser import Browser, Server

PAGES = ["/tests/", "/tests/ui.html"]


def main() -> int:
    server = Server(8091).start()
    browser = Browser()
    failed = 0
    try:
        for page in PAGES:
            browser.go(f"http://localhost:8091{page}")
            results = browser.wait_for("window.__results ? JSON.stringify(window.__results) : ''", seconds=90, what=f"{page} to finish")
            data = json.loads(results)
            print(f"{page}: {data['passed']} of {data['total']} passed")
            for failure in data["failures"]:
                print(f"   FAIL {failure['name']}\n        {failure['error']}")
            failed += data["failed"]
        errors = browser.console_errors()
        if errors:
            print(f"{len(errors)} uncaught error(s) in the pages:")
            for error in errors[:5]:
                print("  ", error.splitlines()[0])
    finally:
        browser.close()
        server.stop()
    print("ALL PASSED" if failed == 0 else f"{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
