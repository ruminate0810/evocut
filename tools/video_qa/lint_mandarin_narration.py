#!/usr/bin/env python3
"""Catch short-video phrases that repeatedly produce ambiguous Mandarin speech."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


RISKY = {
    "钱又挤回": "资金重新集中到",
    "踩刹车": "压力暂时缓和",
    "上涨家数": "上涨股票数量",
    "又坐回": "又跌回",
    "环比变动": "和上期相比的变化",
}


def load_text(path: Path) -> str:
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return "\n".join(str(value) for value in payload)
    return path.read_text(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("narration", type=Path)
    args = parser.parse_args()
    text = load_text(args.narration)
    findings = [
        {"phrase": phrase, "suggestion": suggestion}
        for phrase, suggestion in RISKY.items()
        if phrase in text
    ]
    print(json.dumps({"ok": not findings, "findings": findings}, ensure_ascii=False, indent=2))
    return 0 if not findings else 2


if __name__ == "__main__":
    raise SystemExit(main())
