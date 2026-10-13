#!/usr/bin/env python3
"""Offline export-integrity audit against a locked reference mix and edit plan.

No ASR, network calls, media edits or subjective approval. Supports the existing
cargo QA plan (shots/global_start, approved_caption_cues_global, wav_sha256) and
generic plans with duration, shots/start, cues and optional width/height/fps.
"""
from __future__ import annotations
import argparse
import json
import math
import re
import subprocess
from pathlib import Path

from qa_evidence import now, probe, record, sha256, write_json


def run(args: list[str], text: bool = True):
    return subprocess.run(args, check=True, capture_output=True, text=text)


def decode(path: Path, sample_rate: int):
    import numpy as np
    result = run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path), "-map", "0:a:0",
                  "-ar", str(sample_rate), "-ac", "2", "-f", "f32le", "pipe:1"], text=False)
    return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, 2).astype(float)


def compare(reference, final, sample_rate: int, search_ms: float = 100):
    import numpy as np
    from scipy import signal
    n = min(len(reference), len(final))
    if n < 100:
        return {"status": "too_short"}
    x, y = reference[:n].mean(axis=1), final[:n].mean(axis=1)
    x, y = x - x.mean(), y - y.mean()
    xx, yy = float(x @ x), float(y @ y)
    if min(xx, yy) < 1e-14:
        # Silence is not proof that a spoken sentence survived export.
        return {"status": "insufficient_signal"}
    radius = min(round(sample_rate * search_ms / 1000), n // 4)
    correlation = signal.correlate(y, x, mode="full", method="fft")
    lag = int(np.argmax(correlation[n - 1 - radius:n + radius])) - radius
    if lag >= 0:
        x, y = x[:n-lag], y[lag:]
    else:
        x, y = x[-lag:], y[:n+lag]
    xx, yy, xy = float(x @ x), float(y @ y), float(x @ y)
    gain = xy / xx
    return {"status": "measured", "lag_samples": lag, "lag_ms": 1000 * lag / sample_rate,
            "correlation": xy / math.sqrt(xx * yy), "gain_db": 20 * math.log10(max(abs(gain), 1e-15)),
            "lag_search_limit_reached": abs(lag) == radius}


def aligned(result: dict, correlation: float, lag_ms: float, gain_db: float) -> bool:
    return (result.get("status") == "measured" and result["correlation"] >= correlation
            and abs(result["lag_ms"]) <= lag_ms and abs(result["gain_db"]) <= gain_db
            and not result["lag_search_limit_reached"])


def meter(path: Path) -> dict:
    result = run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-xerror", "-i", str(path),
                  "-map", "0:a:0", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    match = re.search(r'\{\s*"input_i".*?\}', result.stderr, re.S)
    if not match:
        raise ValueError("Loudness measurement did not return JSON")
    raw = json.loads(match.group())
    levels = {key: float(raw[source]) for key, source in {"integrated_lufs": "input_i", "true_peak_dbtp": "input_tp", "lra_lu": "input_lra"}.items()}
    if not all(math.isfinite(value) for value in levels.values()):
        raise ValueError("Non-finite loudness measurement (possibly silent audio)")
    return levels


def bounds(plan: dict, duration: float) -> tuple[list[dict], list[dict]]:
    shots = []
    for index, shot in enumerate(plan.get("shots", [])):
        start = float(shot.get("global_start", shot.get("start", 0)))
        shots.append({"id": shot.get("id", str(index)), "start": start, "end": start + float(shot["duration"])})
    cues = plan.get("approved_caption_cues_global", plan.get("cues", []))
    for window in shots + cues:
        start, end = float(window["start"]), float(window["end"])
        if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= duration + 1e-6:
            raise ValueError(f"Invalid plan window: {window}")
    return shots, cues


def audit(args) -> dict:
    video, reference, plan_path = args.video.resolve(), args.reference.resolve(), args.plan.resolve()
    before = {"video": record(video), "reference": record(reference), "plan": record(plan_path)}
    plan = json.loads(plan_path.read_text())
    expected_hash = plan.get("wav_sha256", plan.get("reference_sha256"))
    if not expected_hash or expected_hash != before["reference"]["sha256"]:
        raise ValueError("Plan must bind the current reference with wav_sha256 or reference_sha256")
    if args.edl and sha256(args.edl) != plan.get("edl_sha256"):
        raise ValueError("EDL changed; rebuild the locked reference plan")
    duration = float(plan["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Plan duration must be finite and positive")
    shots, cues = bounds(plan, duration)
    info = probe(video)
    vs = [s for s in info["streams"] if s["codec_type"] == "video"]
    aa = [s for s in info["streams"] if s["codec_type"] == "audio"]
    if len(vs) != 1 or len(aa) != 1:
        raise ValueError("Expected exactly one video and one audio stream")
    v, a = vs[0], aa[0]
    result = run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode", "-i", str(video), "-f", "null", "-"])
    if result.stderr.strip():
        raise ValueError("Full decode reported errors: " + result.stderr[:1000])
    expected, actual = decode(reference, args.sample_rate), decode(video, args.sample_rate)
    whole = compare(expected, actual, args.sample_rate)

    def measure_windows(windows):
        measured = []
        for window in windows:
            selection = slice(round(float(window["start"]) * args.sample_rate), round(float(window["end"]) * args.sample_rate))
            measured.append({**window, "alignment": compare(expected[selection], actual[selection], args.sample_rate)})
        return measured

    segments, sentences = measure_windows(shots), measure_windows(cues)
    tail_range = plan.get("tail_range", [max(0, duration - args.tail_seconds), duration])
    if len(tail_range) != 2 or abs(float(tail_range[1]) - duration) > 1e-6:
        raise ValueError("Tail range must end at the final frame time")
    tail_start = float(tail_range[0])
    if not 0 <= tail_start < duration:
        raise ValueError("Invalid tail window")
    tail = measure_windows([{"start": tail_start, "end": duration}])[0]
    levels, reference_levels = meter(video), meter(reference)
    lag_values = [item["alignment"]["lag_ms"] for item in segments if item["alignment"].get("status") == "measured"]
    spread = max(lag_values) - min(lag_values) if lag_values else 0
    passes = lambda value, correlation: aligned(value, correlation, args.max_lag_ms, args.max_gain_db)
    source_sample_rate = int(a["sample_rate"])
    audio_tolerance = max(1024 / source_sample_rate, 1 / args.sample_rate)
    checks = {
        "full_decode": True,
        "reference_duration_matches_plan": abs(len(expected) / args.sample_rate - duration) <= 1 / args.sample_rate,
        "audio_duration_matches_plan": abs(len(actual) / args.sample_rate - duration) <= audio_tolerance,
        "whole_audio_aligned": passes(whole, args.min_correlation),
        "all_defined_segments_aligned": all(passes(item["alignment"], args.min_correlation) for item in segments),
        "all_defined_sentences_aligned": all(passes(item["alignment"], args.sentence_correlation) for item in sentences),
        "segment_drift_within_limit": spread <= args.max_lag_ms,
        "tail_retained": len(actual) / args.sample_rate >= duration - 1 / args.sample_rate and passes(tail["alignment"], args.tail_correlation),
        "loudness_close_to_reference": abs(levels["integrated_lufs"] - reference_levels["integrated_lufs"]) <= args.max_lufs_delta,
        "true_peak_below_ceiling": levels["true_peak_dbtp"] <= args.max_true_peak,
    }
    fps = args.fps if args.fps is not None else plan.get("fps")
    if fps is not None:
        fps = float(fps)
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("Expected fps must be finite and positive")
        numerator, denominator = v["avg_frame_rate"].split("/")
        checks["expected_fps"] = abs(float(numerator) / float(denominator) - fps) < .001
        checks["expected_frame_count"] = int(v.get("nb_frames", -1)) == round(duration * fps)
    else:
        numerator, denominator = v["avg_frame_rate"].split("/")
        fps = float(numerator) / float(denominator)
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("Invalid video frame rate")
    checks["video_duration_matches_plan"] = abs(float(v.get("duration", info["format"]["duration"])) - duration) <= 1 / fps + 1e-6
    for dimension in ("width", "height"):
        target = getattr(args, dimension) or plan.get(dimension)
        if target is not None:
            checks["expected_" + dimension] = v[dimension] == int(target)
    if before != {"video": record(video), "reference": record(reference), "plan": record(plan_path)}:
        raise ValueError("Input changed during verification")
    if args.edl and sha256(args.edl) != plan.get("edl_sha256"):
        raise ValueError("EDL changed during verification")
    return {"schema": "evocut.audio-audit/v1", "status": "technical_pass" if all(checks.values()) else "technical_fail",
            "approved": False, "subjective_review": "pending", "checked_at": now(), "inputs": before, "checks": checks,
            "probe": info, "whole_alignment": whole, "segment_alignments": segments, "sentence_alignments": sentences,
            "tail": tail, "segment_lag_spread_ms": spread, "final_levels": levels, "reference_levels": reference_levels,
            "defined_segment_count": len(segments), "defined_sentence_count": len(sentences), "new_asr_runs": 0,
            "human_listening_performed": False, "media_modified": False,
            "limits": "Verifies a locked reference survived export; does not certify voice identity, lip sync, acting, pronunciation or script accuracy. Empty cue/shot lists do not constitute sentence/segment verification."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("video", "reference", "plan", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    parser.add_argument("--edl", type=Path)
    parser.add_argument("--fps", type=float)
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--tail-seconds", type=float, default=1.0)
    parser.add_argument("--min-correlation", type=float, default=.99)
    parser.add_argument("--sentence-correlation", type=float, default=.985)
    parser.add_argument("--tail-correlation", type=float, default=.98)
    parser.add_argument("--max-lag-ms", type=float, default=2)
    parser.add_argument("--max-gain-db", type=float, default=.25)
    parser.add_argument("--max-lufs-delta", type=float, default=.2)
    parser.add_argument("--max-true-peak", type=float, default=-1)
    args = parser.parse_args()
    if args.output.resolve() in {path.resolve() for path in (args.video, args.reference, args.plan, args.edl) if path}:
        parser.error("Audit output must not overwrite any input")
    try:
        for key, value in vars(args).items():
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"{key} must be finite")
        if args.sample_rate < 8000 or args.tail_seconds <= 0 or (args.fps is not None and args.fps <= 0):
            raise ValueError("Invalid sample-rate, tail-seconds or fps")
        for key in ("min_correlation", "sentence_correlation", "tail_correlation"):
            if not 0 <= getattr(args, key) <= 1:
                raise ValueError(f"{key} must be within 0..1")
        if any(getattr(args, key) < 0 for key in ("max_lag_ms", "max_gain_db", "max_lufs_delta")):
            raise ValueError("Lag/gain/loudness tolerances must be nonnegative")
        report = audit(args)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        report = {"schema": "evocut.audio-audit/v1", "status": "technical_fail", "approved": False, "error": str(exc), "subjective_review": "pending"}
    write_json(args.output.resolve(), report)
    print(json.dumps({"report": str(args.output.resolve()), "status": report["status"], "checks": report.get("checks"), "levels": report.get("final_levels")}, indent=2))
    return 0 if report["status"] == "technical_pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
