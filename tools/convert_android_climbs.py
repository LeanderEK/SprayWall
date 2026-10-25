"""Turns climbs saved by the Android SprayWall app into a file the web app can import (the "Share and import" button).

    python tools/convert_android_climbs.py <folder holding a copy of spraywall.db> [out.json]

It only READS the copy of the database (spraywall.db, with its -wal and -shm files, copied off the phone). The Android app
and its data are never touched. Each climb gets a fixed id made from the wall and the climb's number, so running this
again, or importing the file twice, never duplicates a climb.
"""
import json
import shutil
import sqlite3
import sys
import tempfile
import uuid
from pathlib import Path

WALL_KEY = "home-wall"
NAMESPACE = uuid.UUID("5f0c3a53-8e57-4d0c-a5a6-0d53b3d8c6a1")  # only ever used to make the same ids from the same climbs


def main() -> None:
    source = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "private" / "my-climbs.spraywall.json"
    work = Path(tempfile.mkdtemp())  # work on a copy of the copy, so even opening the database changes nothing
    for name in ("spraywall.db", "spraywall.db-wal", "spraywall.db-shm"):
        if (source / name).exists():
            shutil.copy(source / name, work / name)
    con = sqlite3.connect(work / "spraywall.db")
    wall = con.execute("select packKey, name from walls limit 1").fetchone()
    rows = con.execute("select id, name, grade, stars, comment, holds, createdAt, updatedAt from climbs order by id").fetchall()
    climbs = [
        {
            "id": str(uuid.uuid5(NAMESPACE, f"{WALL_KEY}/{row[0]}")),
            "name": row[1],
            "grade": row[2],
            "comment": row[4] or "",
            "author": "",
            "holds": row[5],
            "createdAt": row[6],
            "updatedAt": row[7],
        }
        for row in rows
    ]
    share = {"format": "spraywall-climbs", "version": 1, "wall": {"key": WALL_KEY, "name": wall[1] if wall else WALL_KEY}, "climbs": climbs}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(share, indent=1), encoding="utf-8")
    print(f"{len(climbs)} climbs from wall '{wall[1] if wall else '?'}' written to {out}")
    for climb in climbs:
        print(f"  {climb['name']!r}: V{climb['grade']}, {len(climb['holds'].split(','))} holds, id {climb['id']}")


if __name__ == "__main__":
    main()
