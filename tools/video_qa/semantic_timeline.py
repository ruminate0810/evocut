#!/usr/bin/env python3
"""Resolve editorial cues from an EXISTING final-clock transcript, without ASR.

Timestamps are bounds of actual supplied tokens/segments, never character-time
interpolation. This binds two input artifacts; it does not independently prove
that the transcript was made from that audio. Human semantic review stays pending.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import unicodedata
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite(value, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name}: expected a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{name}: expected a finite number")
    return value


def normalize(text: str) -> str:
    # No fuzzy spelling, automatic number translation, or simplified/traditional
    # conversion: the spec must explicitly declare any editorial alias.
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold()
                   if c.isalnum())


def transcript_units(transcript: dict | list, duration: float) -> list[dict]:
    if isinstance(transcript, list):
        segments = transcript
    elif transcript.get("segments"):
        segments = transcript["segments"]
    elif transcript.get("words"):
        segments = [{"words": transcript["words"]}]
    else:
        raise ValueError("Transcript needs segments or words with measured timestamps")
    units = []
    for segment_index, segment in enumerate(segments):
        words = segment.get("words")
        for item in words or [segment]:
            text = str(item.get("text", item.get("word", "")))
            if not normalize(text):
                continue
            start, end = finite(item["start"], "start"), finite(item["end"], "end")
            if start < 0 or end <= start or end > duration + 0.10:
                raise ValueError(f"Invalid transcript interval {start}–{end}: {text}")
            if units and start < units[-1]["start"]:
                raise ValueError("Transcript timestamps must be monotonic")
            units.append({"text": text, "start": start, "end": end,
                          "precision": "word_span" if words else "segment_span",
                          "segment": segment_index})
    if not units:
        raise ValueError("Transcript has no timed text")
    return units


def align_cues(units: list[dict], requests: list[dict]) -> list[dict]:
    text, owners = "", []
    for index, unit in enumerate(units):
        part = normalize(unit["text"])
        text += part
        owners.extend([index] * len(part))
    results, ids = [], set()
    for request in requests:
        cue_id = request["id"]
        if not isinstance(cue_id, str) or not cue_id or cue_id in ids:
            raise ValueError("Cue IDs must be nonempty and unique")
        ids.add(cue_id)
        phrases = [request["phrase"], *request.get("aliases", [])]
        matches = {}
        for phrase in phrases:
            needle = normalize(phrase)
            if not needle:
                raise ValueError(f"{cue_id}: empty phrase")
            offset = 0
            while (at := text.find(needle, offset)) >= 0:
                first, last = owners[at], owners[at + len(needle) - 1]
                chunk = units[first:last + 1]
                start, end = chunk[0]["start"], chunk[-1]["end"]
                window = request.get("within", [0, math.inf])
                if start >= window[0] and end <= window[1]:
                    expanded = ((at > 0 and owners[at - 1] == first) or
                                (at + len(needle) < len(owners) and
                                 owners[at + len(needle)] == last))
                    candidate = {"start": start, "end": end,
                                 "matched_phrase": phrase,
                                 "matched_text": "".join(u["text"] for u in chunk),
                                 "unit_range": [first, last],
                                 "timing_precision": "segment_span" if any(
                                     u["precision"] == "segment_span" for u in chunk)
                                     else "word_span",
                                 "expanded_to_token_boundaries": expanded}
                    # Multiple aliases pointing at the same measured span are one match.
                    matches[(first, last)] = candidate
                offset = at + 1
        candidates = sorted(matches.values(), key=lambda m: (m["start"], m["end"]))
        occurrence = request.get("occurrence")
        if occurrence is not None:
            if not isinstance(occurrence, int) or isinstance(occurrence, bool) or occurrence < 1:
                raise ValueError(f"{cue_id}: occurrence must be a positive 1-based integer")
            candidates = candidates[occurrence - 1:occurrence]
        result = {"id": cue_id, "phrase": request["phrase"], "status": "pending"}
        if len(candidates) != 1:
            result.update(reason="not_found" if not candidates else "ambiguous",
                          candidates=candidates)
        else:
            candidate = candidates[0]
            if candidate["timing_precision"] == "segment_span" and not request.get("allow_segment_span", False):
                result.update(reason="only_segment_timing_available", candidates=candidates)
            else:
                result.update(candidate, status="aligned")
        results.append(result)
    return results


def resolve_events(cues: list[dict], events: list[dict], duration: float) -> list[dict]:
    lookup = {cue["id"]: cue for cue in cues}
    result, ids = [], set()
    for event in events:
        event_id = event["id"]
        if not isinstance(event_id, str) or not event_id or event_id in ids:
            raise ValueError("Event IDs must be nonempty and unique")
        ids.add(event_id)
        cue = lookup.get(event["cue"])
        if cue is None:
            raise ValueError(f"{event_id}: unknown cue {event['cue']}")
        edge = event.get("edge", "start")
        if edge not in ("start", "end"):
            raise ValueError(f"{event_id}: edge must be start or end")
        offset = finite(event.get("offset", 0), "offset")
        hold = finite(event.get("duration", 0), "duration")
        if hold < 0:
            raise ValueError(f"{event_id}: negative event duration")
        output = {**event, "edge": edge, "offset": offset, "duration": hold}
        if cue["status"] != "aligned":
            output.update(status="pending", reason="unresolved_cue")
        else:
            start = cue[edge] + offset
            if start < 0 or start + hold > duration + 1e-6:
                raise ValueError(f"{event_id}: event outside final timeline")
            output.update(status="resolved", start=round(start, 9), end=round(start + hold, 9))
        result.append(output)
    return result


def qa_sample_plan(duration: float, fps: float, cuts=(), cues=(), events=()) -> list[dict]:
    if duration <= 0 or fps <= 0:
        raise ValueError("duration and fps must be positive")
    last_frame = max(0, math.ceil(duration * fps - 1e-8) - 1)
    frames: dict[int, set[str]] = {}

    def add(time, reason, frame_delta=0):
        frame = max(0, min(last_frame, round(time * fps) + frame_delta))
        frames.setdefault(frame, set()).add(reason)

    for step in range(math.floor(min(15, duration) * 2) + 1):
        add(step / 2, "first_15_seconds")
    for cut in cuts:
        cut = finite(cut, "cut")
        if not 0 <= cut <= duration:
            raise ValueError("cut outside duration")
        for delta in (-1, 0, 1):
            add(cut, f"cut:{cut:g}:{delta:+d}f", delta)
    for cue in cues:
        if cue.get("status") == "aligned":
            for key, time in (("start", cue["start"]), ("middle", (cue["start"] + cue["end"]) / 2), ("end", cue["end"])):
                add(time, f"cue:{cue['id']}:{key}")
    for event in events:
        if event.get("status") == "resolved":
            add(event["start"], f"event:{event['id']}:start")
            add(event["start"], f"event:{event['id']}:inside", 1)
    frames.setdefault(last_frame, set()).add("last_frame")
    return [{"frame": frame, "time": round(frame / fps, 9), "reasons": sorted(reasons)}
            for frame, reasons in sorted(frames.items())]


def build_timeline(transcript: Path, audio: Path, spec: dict, duration: float, fps: float) -> dict:
    duration, fps = finite(duration, "duration"), finite(fps, "fps")
    if duration <= 0 or fps <= 0:
        raise ValueError("duration and fps must be positive")
    audio_hash = sha256(audio)
    if spec.get("expected_audio_sha256") not in (None, audio_hash):
        raise ValueError("Final audio changed: expected_audio_sha256 mismatch")
    units = transcript_units(json.loads(transcript.read_text(encoding="utf-8")), duration)
    cues = align_cues(units, spec["cues"])
    events = resolve_events(cues, spec.get("events", []), duration)
    pending = [c["id"] for c in cues if c["status"] != "aligned"]
    return {
        "schema_version": 1,
        "duration": duration, "fps": fps, "cuts": spec.get("cuts", []),
        "audio": {"path": str(audio.resolve()), "sha256": audio_hash},
        "transcript": {"path": str(transcript.resolve()), "sha256": sha256(transcript),
                       "source": "existing_supplied_timestamps", "asr_invoked": False,
                       "pairing_provenance": spec.get("pairing_provenance", "supplied_pair_not_independently_attested")},
        "cues": cues, "events": events,
        "qa_samples": qa_sample_plan(duration, fps, spec.get("cuts", []), cues, events),
        "technical": {"status": "pending" if pending else "pass", "unresolved_cue_ids": pending},
        "human_semantic_review": {"status": "pending", "checks": [
            "transcript/audio provenance and perceived word timing", "visual information matches spoken meaning",
            "first 5/15 seconds at normal speed", "voice continuity and acting, not just ASR text"]},
        "limits": "Token-span bounds only; no interpolated character timestamps. Technical pass is not release approval."
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transcript", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--fps", required=True, type=float)
    parser.add_argument("--allow-pending", action="store_true", help="Write unresolved cues explicitly; never fabricate timestamps")
    args = parser.parse_args()
    try:
        result = build_timeline(args.transcript, args.audio, json.loads(args.spec.read_text(encoding="utf-8")), args.duration, args.fps)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(args.output), "technical": result["technical"], "human_semantic_review": "pending"}, ensure_ascii=False))
        return 0 if result["technical"]["status"] == "pass" or args.allow_pending else 2
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(2, f"semantic_timeline: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
