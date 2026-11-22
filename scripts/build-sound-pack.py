"""Build the optional Studio ZIP from verified audio; never walk the input tree."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "sound-packs/studio-617"
NAME = "evocut-studio-sfx-617-v1"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source", type=Path, help="folder containing audio/")
    p.add_argument("output", type=Path, help="release asset directory")
    args = p.parse_args()
    source = args.source.resolve(strict=True)
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / (NAME + ".zip")
    items = json.loads((DOC / "catalog.json").read_text())["items"]
    assert len(items) == len({r["path"] for r in items}) == len({r["sha256"] for r in items}) == 617
    with zipfile.ZipFile(archive.with_suffix(".part"), "w") as z:
        def add(key, data, method=zipfile.ZIP_DEFLATED):
            meta = zipfile.ZipInfo(NAME + "/" + key, (2026, 1, 1, 0, 0, 0))
            meta.create_system = 3
            meta.external_attr = 0o100644 << 16
            z.writestr(meta, data, compress_type=method)
        for r in items:
            f = source / r["path"]
            if f.resolve(strict=True) != f or not f.is_relative_to(source):
                raise ValueError("Unexpected path: " + r["path"])
            data = f.read_bytes()
            if len(data) != r["bytes"] or hashlib.sha256(data).hexdigest() != r["sha256"]:
                raise ValueError("Audio mismatch: " + r["id"])
            add(r["path"], data, zipfile.ZIP_STORED)
        for key in ("README.md", "NOTICES.md", "catalog.json", "licenses/CC0-1.0.txt", "licenses/CC-BY-4.0.txt"):
            add(key, (DOC / key).read_bytes())
        add("licenses/Apache-2.0.txt", (ROOT / "LICENSE").read_bytes())
        add("NOTICE", (ROOT / "NOTICE").read_bytes())
        gallery = (DOC / "gallery.html").read_text()
        assert gallery.count("__EVOCUT_ITEMS__") == 1
        payload = json.dumps(items, ensure_ascii=True).replace("<", r"\u003c")
        add("index.html", gallery.replace("__EVOCUT_ITEMS__", payload).encode())
    archive.with_suffix(".part").replace(archive)
    with archive.open("rb") as f:
        h = hashlib.sha256()
        while block := f.read(1024 * 1024):
            h.update(block)
    (args.output / "SHA256SUMS").write_text(f"{h.hexdigest()}  {archive.name}\n")
    print(f"{len(items)} tracks, {archive.stat().st_size} bytes, {h.hexdigest()}")


if __name__ == "__main__":
    main()
