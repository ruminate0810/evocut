#!/usr/bin/env python3
"""Preserve a measured EvoCut mix across rebuilds; refuse stale inputs.

Capture is not listening approval and does not invent effects. It serializes
the existing root audio mix, including the carve-generated chain/envelopes.
Changed stems, membership or timing require a new mix, not silent dry playback.
"""
from __future__ import annotations

import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
from urllib.parse import unquote, urlsplit

MIX = ("data-volume", "data-fx-chain", "data-automation", "data-fx-carve")
CLOCK = ("data-start", "data-duration", "data-media-start", "data-playback-rate")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class AudioTags(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags = {}
        self.feed(text)

    def handle_starttag(self, tag, pairs):
        if tag == "hf-audio-group":
            raise ValueError("Submix buses need an explicit bus-aware plan; refusing partial capture")
        if tag != "audio":
            return
        attrs = dict(pairs)
        ident = attrs.get("id")
        if not ident or ident in self.tags or len(attrs) != len(pairs):
            raise ValueError("Audio IDs/attributes must be unique and explicit")
        self.tags[ident] = (attrs, self.get_starttag_text())


def source_file(root, src):
    url = urlsplit(src or "")
    if url.scheme or url.netloc or url.query or url.fragment:
        raise ValueError("Freeze audio locally before capturing its mix")
    path = (root / unquote(url.path)).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"Missing or non-project-local audio source: {src}")
    return path


def clock(attrs):
    result = {}
    for key in CLOCK:
        value = float(attrs.get(key, "1" if key == "data-playback-rate" else "0"))
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"Invalid audio clock: {key}")
        result[key] = value
    if result["data-duration"] <= 0 or result["data-playback-rate"] <= 0:
        raise ValueError("Audio duration/rate must be positive")
    return result


def validate_settings(settings):
    if not isinstance(settings, dict) or set(settings) - set(MIX):
        raise ValueError("Unknown or malformed mix setting")
    if "data-volume" in settings:
        volume = float(settings["data-volume"])
        if not math.isfinite(volume) or volume < 0:
            raise ValueError("Invalid mix volume")
    parsed = {}
    def invalid_constant(value):
        raise ValueError(f"Non-finite value in mix settings: {value}")
    for key in MIX[1:]:
        if key in settings:
            parsed[key] = json.loads(settings[key], parse_constant=invalid_constant)
            if not isinstance(parsed[key], dict):
                raise ValueError(f"{key} must contain a JSON object")
    if "data-fx-carve" in parsed:
        carve = parsed["data-fx-carve"]
        if carve.get("enabled", True) and not all(k in settings for k in ("data-fx-chain", "data-automation")):
            raise ValueError("Carve configuration without derived effects/envelopes is not a finished mix")


def capture_mix(text, root):
    root = Path(root).resolve()
    tags = AudioTags(text).tags
    if not tags:
        raise ValueError("No root audio tracks; nested composition audio needs its own plan")
    tracks = {}
    for ident, (attrs, _) in tags.items():
        path = source_file(root, attrs.get("src"))
        settings = {key: attrs[key] for key in MIX if key in attrs}
        validate_settings(settings)
        tracks[ident] = {
            "source": str(path.relative_to(root)), "source_sha256": digest(path),
            "clock": clock(attrs), "group": attrs.get("data-audio-group"),
            "hidden": attrs.get("data-hidden"), "settings": settings,
        }
    return {"schema_version": 1, "status": "captured_not_listening_approved",
            "tracks": tracks, "source_html_sha256": hashlib.sha256(text.encode()).hexdigest()}


def apply_mix(text, root, plan):
    root = Path(root).resolve()
    if plan.get("schema_version") != 1:
        raise ValueError("Unsupported mix plan")
    tags = AudioTags(text).tags
    if set(tags) != set(plan.get("tracks", {})):
        raise ValueError("Audio track membership changed: recarve and recapture the mix")
    replacements = []
    for ident, (attrs, raw) in tags.items():
        saved = plan["tracks"][ident]
        path = source_file(root, attrs.get("src"))
        if str(path.relative_to(root)) != saved["source"] or digest(path) != saved["source_sha256"]:
            raise ValueError(f"{ident}: audio changed; reanalyse mix before rebuilding")
        now = clock(attrs)
        if set(saved["clock"]) != set(CLOCK):
            raise ValueError("Incomplete saved audio clock")
        then = clock(saved["clock"])
        if any(abs(now[k] - then[k]) > 1e-7 for k in CLOCK):
            raise ValueError(f"{ident}: timing changed; reanalyse mix before rebuilding")
        if attrs.get("data-audio-group") != saved["group"] or attrs.get("data-hidden") != saved["hidden"]:
            raise ValueError(f"{ident}: routing changed; reanalyse mix before rebuilding")
        validate_settings(saved["settings"])
        for key in MIX:
            attrs.pop(key, None)
        attrs.update(saved["settings"])
        rendered = " ".join(key if value is None else f'{key}="{html.escape(str(value), quote=True)}"'
                            for key, value in attrs.items())
        replacements.append((raw, f"<audio {rendered}>"))
    for before, after in replacements:
        text = text.replace(before, after, 1)
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["capture", "verify"])
    parser.add_argument("project", type=Path)
    parser.add_argument("--html", default="index.html")
    parser.add_argument("--plan", type=Path, required=True)
    args = parser.parse_args()
    root = args.project.resolve()
    text = (root / args.html).read_text()
    if args.command == "capture":
        if args.plan.exists():
            raise SystemExit("Plan exists; use a new plan name to preserve the accepted mix")
        plan = capture_mix(text, root)
        args.plan.parent.mkdir(parents=True, exist_ok=True)
        args.plan.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    else:
        plan = json.loads(args.plan.read_text())
        restored = apply_mix(text, root, plan)
        if capture_mix(restored, root)["tracks"] != capture_mix(text, root)["tracks"]:
            raise SystemExit("Current HTML lost/changed its saved mix settings")
    print(json.dumps({"status": "pass", "tracks": len(plan["tracks"]), "listening_review": "not_certified"}))


if __name__ == "__main__":
    main()
