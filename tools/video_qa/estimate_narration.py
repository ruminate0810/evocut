#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


def speech_units(text: str) -> int:
    cleaned = re.sub(r"\s+", "", text)
    return len(cleaned)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Estimate Mandarin narration duration using an explicitly calibrated voice rate. No TTS call."
    )
    parser.add_argument("narration", type=Path)
    parser.add_argument("--target", type=float, default=60.0, help="Target spoken duration in seconds")
    parser.add_argument("--base-cps", type=float, required=True, help="Your measured chars/sec at 1.0x")
    parser.add_argument("--min-speed", type=float, default=1.0)
    parser.add_argument("--max-speed", type=float, default=1.0)
    args = parser.parse_args()
    if not all(math.isfinite(x) and x > 0 for x in (args.target,args.base_cps,args.min_speed,args.max_speed)) or args.min_speed > args.max_speed:
        parser.error("Rates and target must be positive finite values, with min-speed <= max-speed")

    text = args.narration.read_text(encoding="utf-8").strip()
    units = speech_units(text)
    required_speed = units / (args.base_cps * args.target)
    recommended_speed = min(args.max_speed, max(args.min_speed, required_speed))
    estimated_duration = units / (args.base_cps * recommended_speed)
    max_units = math.floor(args.target * args.base_cps * args.max_speed)
    cut_units = max(0, units - max_units)

    result = {
        "file": str(args.narration.resolve()),
        "speech_units": units,
        "target_seconds": args.target,
        "recommended_speed": round(recommended_speed, 2),
        "estimated_seconds": round(estimated_duration, 1),
        "fits_target": cut_units == 0,
        "max_units_at_speed_limit": max_units,
        "suggested_units_to_cut": cut_units,
        "calibration": {
            "base_chars_per_second": args.base_cps,
            "speed_range": [args.min_speed, args.max_speed],
            "profile": "user-calibrated Mandarin narration",
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if cut_units == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
