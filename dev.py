"""Develop with live reload:  python dev.py  ->  http://localhost:3000

Starts Flask on 5050 with its reloader (restarts on Python changes) and `next dev` on 3000 (updates the page on
frontend changes; proxies /api and /bench to Flask). Ctrl-C stops both. Runs in progress are lost when Flask
reloads, since they live in memory. For the production build instead: (cd web && npm run build) && python run.py
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent


def main():
    env = {**os.environ, "PORT": "5050", "DEBUG": "1", "PYTHONUNBUFFERED": "1"}
    procs = [
        subprocess.Popen([sys.executable, str(ROOT / "run.py")], env=env),
        subprocess.Popen(["npm", "run", "dev"], cwd=ROOT / "web", env={**os.environ, "FLASK_URL": "http://127.0.0.1:5050"}),
    ]
    print("\n  Persona Lab (dev)  ->  http://localhost:3000   (Ctrl-C stops both servers)\n", flush=True)
    try:
        while all(p.poll() is None for p in procs):  # if either server exits, stop the other too
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()
