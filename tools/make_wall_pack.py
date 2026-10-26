"""Builds and checks wall packs: the .zip (a wall photo and holds.json) that the app imports under Walls -> Import wall pack.

    python tools/make_wall_pack.py build photo.jpg holds.csv --name "My wall" [--key my-wall] [--angle 20] [--outlines outlines.json] [--sections sections.json] [-o my-wall.zip]
    python tools/make_wall_pack.py check my-wall.zip

holds.csv has one hold per line, positions in PIXELS of the photo measured from its top-left corner:

    x,y,r              (r, the hold's radius in pixels, is optional)
    812,1304,38
    1020,1288,30

or, to give the holds numbers yourself (do this when you update a wall, so existing holds keep their numbers):

    id,x,y,r
    17,812,1304,38

Without an id column the holds are numbered 1, 2, 3... in file order. Lines starting with # are ignored.
outlines.json (optional) maps a hold's id to the corners of a polygon around it, in pixels: {"17": [[800,1290],[830,1290],[825,1320]]}.
The pixel numbers are turned into fractions of the photo's width and height, which is what holds.json holds.
sections.json (optional, for a long wall made of several faces laid side by side in one photo) lists where each face starts and ends along
the photo, in pixels: [{"name": "Left wall", "angle": 90, "x0": 0, "x1": 1500}, {"name": "Overhang", "angle": 35, "x0": 1500, "x1": 3100}].
The app then shows a map of the wall and a button for each face, and opens climbs zoomed in on their holds. The angle is optional.

Only the Python standard library is needed. `check` applies the same rules as the app, so a pack that passes it will import.
"""
import argparse
import csv
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

DEFAULT_RADIUS = 0.02


def image_size(data: bytes) -> tuple[int, int]:
    """Width and height of a JPEG or PNG, read from its header."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2:i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", data[i + 5:i + 9])
                return width, height
            i += 2 + length
    raise SystemExit("The photo must be a JPEG or a PNG.")


def slug(text: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", text.lower()))


def read_holds(path: Path) -> list[dict]:
    rows = [row for row in csv.reader(line for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip() and not line.lstrip().startswith("#"))]
    if not rows:
        raise SystemExit(f"{path} has no holds in it.")
    header = [cell.strip().lower() for cell in rows[0]]
    named = "x" in header and "y" in header
    columns = header if named else ["x", "y", "r"]
    holds = []
    for number, row in enumerate(rows[1:] if named else rows, start=1):
        values = dict(zip(columns, (cell.strip() for cell in row)))
        try:
            hold = {"id": int(values["id"]) if values.get("id") else number, "x": float(values["x"]), "y": float(values["y"])}
            if values.get("r"):
                hold["r"] = float(values["r"])
        except (KeyError, ValueError):
            raise SystemExit(f"Line {number} of {path} is not numbers: {row}")
        holds.append(hold)
    return holds


def read_sections(path: Path, width: int) -> list[dict]:
    """The faces of a long wall from a JSON file: x0 and x1 in pixels along the photo, turned into fractions of its width."""
    try:
        faces = json.loads(path.read_text(encoding="utf-8-sig"))
    except ValueError:
        raise SystemExit(f"{path} is not valid JSON.")
    if not isinstance(faces, list):
        raise SystemExit(f"{path} must be a list of faces: [{{\"name\": \"Left wall\", \"x0\": 0, \"x1\": 1500}}, ...]")
    out = []
    for number, face in enumerate(faces, start=1):
        if not isinstance(face, dict) or not all(isinstance(face.get(k), (int, float)) for k in ("x0", "x1")):
            raise SystemExit(f"Face number {number} in {path} needs numbers \"x0\" and \"x1\" (pixels along the photo).")
        if not 0 <= face["x0"] < face["x1"] <= width:
            raise SystemExit(f"Face number {number} in {path} has x0 = {face['x0']} and x1 = {face['x1']}: they must satisfy 0 <= x0 < x1 <= {width} (the photo's width).")
        item = {"name": str(face.get("name") or f"Face {number}")[:30], "x0": round(face["x0"] / width, 5), "x1": round(face["x1"] / width, 5)}
        if isinstance(face.get("angle"), (int, float)) and not isinstance(face.get("angle"), bool):
            item["angle"] = round(face["angle"])
        out.append(item)
    return out


def build(args) -> None:
    photo = Path(args.photo)
    data = photo.read_bytes()
    width, height = image_size(data)
    holds = read_holds(Path(args.holds))
    outlines = json.loads(Path(args.outlines).read_text(encoding="utf-8")) if args.outlines else {}
    out = []
    for hold in holds:
        for key in ("x", "y"):
            if not 0 <= hold[key] <= (width if key == "x" else height):
                raise SystemExit(f"Hold {hold['id']} has {key} = {hold[key]}, which is outside the {width} x {height} photo.")
        item = {"id": hold["id"], "x": round(hold["x"] / width, 5), "y": round(hold["y"] / height, 5)}
        if "r" in hold:
            item["r"] = round(hold["r"] / width, 5)
        corners = outlines.get(str(hold["id"]))
        if corners:
            item["outline"] = [[round(px / width, 5), round(py / height, 5)] for px, py in corners]
        out.append(item)
    key = args.key or slug(args.name)
    sections = read_sections(Path(args.sections), width) if args.sections else []
    pack = {"version": 1, "key": key, "name": args.name, "image": photo.name if photo.suffix.lower() in (".jpg", ".jpeg", ".png") else "wall.jpg", "holds": out}
    if args.angle is not None:
        pack["angle"] = args.angle
    if sections:
        pack["sections"] = sections
    target = Path(args.output or f"{key}.zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("holds.json", json.dumps(pack, separators=(",", ":")))
        z.writestr(pack["image"], data)
    faces = f", {len(sections)} faces" if sections else ""
    print(f"Wrote {target}: {len(out)} holds{faces} on a {width} x {height} photo, key '{key}', name '{args.name}'.")
    problems = check_pack(target)
    if problems:
        print("But it has problems:")
        print("\n".join(f"  - {p}" for p in problems))
        raise SystemExit(1)


def in_unit(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1


def check_sections(faces) -> list[str]:
    """The faces of a long wall, checked the way the app does (none is fine)."""
    if faces is None:
        return []
    if not isinstance(faces, list):
        return ['"sections" must be a list of faces.']
    if len(faces) > 24:
        return ["A wall can have at most 24 faces."]
    problems = []
    for number, face in enumerate(faces, start=1):
        if not isinstance(face, dict):
            problems.append(f"Face number {number} is not an object.")
        elif not in_unit(face.get("x0")) or not in_unit(face.get("x1")) or not face["x0"] < face["x1"]:
            problems.append(f'Face number {number} needs "x0" and "x1" between 0 and 1, with x0 smaller.')
    return problems


def check_pack(path: Path) -> list[str]:
    """The problems the app would find with this pack (an empty list means it imports)."""
    problems = []
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return ["That is not a zip file."]
    names = {n.split("/")[-1]: n for n in z.namelist() if not n.endswith("/")}
    if "holds.json" not in names:
        return ["There is no holds.json in the zip."]
    try:
        root = json.loads(z.read(names["holds.json"]))
    except ValueError:
        return ["holds.json is not valid JSON."]
    if not isinstance(root, dict):
        return ["holds.json is not an object."]
    name = root.get("name", "").strip() if isinstance(root.get("name"), str) else ""
    if not name:
        problems.append('holds.json needs a "name".')
    key = (root.get("key", "").strip() if isinstance(root.get("key"), str) else "") or slug(name)
    if not key:
        problems.append('holds.json needs a "key" or a name with letters or digits in it.')
    elif not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", key):
        problems.append(f'The key "{key}" should be letters, digits, dots, dashes or underscores (at most 80): it is used in links and files.')
    image = root.get("image", "").strip() if isinstance(root.get("image"), str) else ""
    if not image:
        problems.append('holds.json needs an "image" (the photo\'s file name inside the zip).')
    elif image.split("/")[-1] not in names:
        problems.append(f'The photo "{image}" named in holds.json is not in the zip.')
    else:
        try:
            width, height = image_size(z.read(names[image.split("/")[-1]]))
            print(f"photo: {width} x {height}")
        except SystemExit as error:
            problems.append(str(error))
    problems.extend(check_sections(root.get("sections")))
    holds = root.get("holds")
    if not isinstance(holds, list) or not holds:
        problems.append('holds.json needs a non-empty "holds" list.')
        return problems
    seen = set()
    for number, hold in enumerate(holds, start=1):
        if not isinstance(hold, dict) or not isinstance(hold.get("id"), int) or isinstance(hold.get("id"), bool):
            problems.append(f"Hold number {number} needs a whole-number id.")
            continue
        if hold["id"] in seen:
            problems.append(f"Hold id {hold['id']} appears more than once.")
        seen.add(hold["id"])
        if not in_unit(hold.get("x")) or not in_unit(hold.get("y")):
            problems.append(f'Hold {hold["id"]} needs "x" and "y" between 0 and 1.')
        r = hold.get("r", DEFAULT_RADIUS)
        if not isinstance(r, (int, float)) or isinstance(r, bool) or not 0 < r <= 0.5:
            problems.append(f'Hold {hold["id"]} has a radius "r" outside 0 to 0.5.')
        if "outline" in hold:
            outline = hold["outline"]
            if not isinstance(outline, list) or len(outline) < 3 or not all(isinstance(p, list) and len(p) == 2 and in_unit(p[0]) and in_unit(p[1]) for p in outline):
                problems.append(f"Hold {hold['id']} has an outline that is not at least 3 points [x, y] between 0 and 1.")
    print(f"{len(holds)} holds, ids {min(seen)} to {max(seen)}" if seen else "no holds")
    return problems[:30]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and check wall packs for SprayWall.")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build", help="make a wall pack from a photo and a list of hold positions")
    make.add_argument("photo")
    make.add_argument("holds", help="CSV of hold positions in pixels")
    make.add_argument("--name", required=True, help='what the wall is called, e.g. "My garage wall"')
    make.add_argument("--key", help="the wall's identity (letters, digits, dashes); default: made from the name. Keep it the same when updating a wall")
    make.add_argument("--angle", type=int, help="degrees of overhang (optional)")
    make.add_argument("--outlines", help="JSON file mapping hold ids to outline corners in pixels (optional)")
    make.add_argument("--sections", help="JSON file listing the faces of a long wall, with x0 and x1 in pixels along the photo (optional)")
    make.add_argument("-o", "--output", help="the zip to write; default: <key>.zip")
    verify = commands.add_parser("check", help="check a wall pack the way the app does")
    verify.add_argument("pack")
    args = parser.parse_args()
    if args.command == "build":
        build(args)
        return 0
    problems = check_pack(Path(args.pack))
    print("OK: this pack will import." if not problems else "Problems:\n" + "\n".join(f"  - {p}" for p in problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
