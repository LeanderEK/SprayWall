"""Shows how far a test page has got (for finding a test that never finishes).

    tools\\.venv\\Scripts\\python.exe tools\\peek_tests.py [/tests/] [seconds]
"""
import sys
import time

from browser import Browser, Server


def main():
    page = sys.argv[1] if len(sys.argv) > 1 else "/tests/"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 20
    server = Server(8097).start()
    browser = Browser(port=9340)
    try:
        browser.go(f"http://localhost:8097{page}")
        time.sleep(seconds)
        text = browser.eval("document.getElementById('summary').innerText + '\\n' + document.getElementById('results').innerText")
        lines = text.splitlines()
        print("\n".join(lines[-12:]))
        print(f"... {len(lines) - 1} results so far")
        print("console errors:", browser.console_errors()[:3])
    finally:
        browser.close()
        server.stop()


if __name__ == "__main__":
    main()
