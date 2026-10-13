#!/usr/bin/env python3
"""Bind final-file QA evidence; never infer human review from file existence.

prepare extracts artifacts from a completed render. run-asr executes an actual
ASR/coverage command with {audio}, {script}, {report} argv placeholders. review
records an explicit operator attestation, not an automated quality score.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "evocut.qa-evidence/v1"
PCM_FORMAT = "s16le/48000Hz/stereo"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def record(path: Path) -> dict:
    path = path.resolve()
    if not path.is_file() or not path.stat().st_size:
        raise ValueError(f"Missing or empty evidence: {path}")
    return {"path": str(path), "sha256": sha256(path), "size_bytes": path.stat().st_size}


def verify_record(value: dict) -> Path:
    path = Path(value["path"])
    if record(path)["sha256"] != value.get("sha256"):
        raise ValueError(f"Evidence changed since capture: {path}")
    return path


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, check=True, text=True, capture_output=True)


def probe(path: Path) -> dict:
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]).stdout)


def audio_pcm_sha256(path: Path) -> str:
    result = run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path), "-map", "0:a:0",
                  "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "hash", "-hash", "sha256", "-"])
    prefix, separator, digest = result.stdout.strip().partition("=")
    if prefix != "SHA256" or not separator or len(digest) != 64:
        raise ValueError("ffmpeg did not return a valid decoded-audio hash")
    return digest


def coverage_value(report: dict, minimum: float) -> float:
    value = report.get("coverage", report.get("transcript_coverage"))
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("ASR coverage must be a finite number, not a Boolean/string")
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 1 or value < minimum:
        raise ValueError(f"ASR coverage failed: {value!r}; expected {minimum}..1")
    return value


def evidence_digest(manifest: dict) -> str:
    immutable = {key: manifest.get(key) for key in ("video", "audio", "script", "artifacts", "capture", "asr")}
    return hashlib.sha256(json.dumps(immutable, sort_keys=True, allow_nan=False).encode()).hexdigest()


def validate_manifest(manifest: dict, video: Path | None = None, verify_pcm: bool = True) -> None:
    if manifest.get("schema") != SCHEMA:
        raise ValueError("Unsupported QA evidence schema; use qa_evidence.py prepare")
    final, audio = verify_record(manifest["video"]), verify_record(manifest["audio"])
    verify_record(manifest["script"])
    if video is not None and (video.resolve() != final.resolve() or sha256(video) != manifest["video"]["sha256"]):
        raise ValueError("Evidence does not belong to this campaign's final video")
    capture = manifest.get("capture", {})
    if capture.get("method") != "ffmpeg_from_final" or capture.get("video_sha256") != manifest["video"]["sha256"]:
        raise ValueError("Visual evidence lacks matching final-video provenance")
    artifacts = manifest.get("artifacts", {})
    verify_record(artifacts["first_screen"])
    if not artifacts.get("contact_sheets"):
        raise ValueError("Missing whole-video contact sheets")
    for value in artifacts["contact_sheets"]:
        verify_record(value)
    if artifacts.get("last_frame"):
        verify_record(artifacts["last_frame"])
    expected_pcm = manifest["audio"].get("decoded_pcm_sha256")
    if manifest["audio"].get("pcm_format") != PCM_FORMAT or not expected_pcm:
        raise ValueError("Missing canonical audio fingerprint")
    if verify_pcm and (audio_pcm_sha256(final) != expected_pcm or audio_pcm_sha256(audio) != expected_pcm):
        raise ValueError("QA audio does not match the final video's decoded audio")
    asr = manifest.get("asr")
    if asr:
        verify_record(asr["report"])
        expected = {"video_sha256": manifest["video"]["sha256"], "audio_sha256": manifest["audio"]["sha256"],
                    "audio_pcm_sha256": expected_pcm, "script_sha256": manifest["script"]["sha256"]}
        if asr.get("source") != expected or asr.get("method") != "executed_command_with_bound_inputs":
            raise ValueError("ASR provenance does not match current video/audio/script")


def review_status(manifest: dict, aspect: str) -> str:
    review = manifest.get("reviews", {}).get(aspect, {})
    status = review.get("status", "pending")
    if status not in ("pass", "fail"):
        return "pending"
    if not all(review.get(key) for key in ("reviewer", "notes", "reviewed_at")) or review.get("attested_performed") is not True:
        return "pending"
    return status if review.get("evidence_sha256") == evidence_digest(manifest) else "pending"


def prepare(video: Path, script: Path, directory: Path) -> Path:
    video, script, directory = video.resolve(), script.resolve(), directory.resolve()
    if directory.exists() and any(directory.iterdir()):
        raise ValueError("Use a new or empty QA directory; existing evidence is never overwritten")
    before_video, before_script = record(video), record(script)
    duration = float(probe(video).get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Invalid final-file duration")
    directory.mkdir(parents=True, exist_ok=True)
    audio, first, end = directory / "final-audio.wav", directory / "first-screen.png", directory / "last-frame.png"
    run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(video), "-map", "0:a:0",
         "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(audio)])
    run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(video), "-frames:v", "1", "-update", "1", str(first)])
    run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(video), "-an", "-vf",
         "fps=1,scale=240:-2,tile=4x5:padding=3:margin=3", str(directory / "contact-%03d.jpg")])
    run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-sseof", "-0.15", "-i", str(video),
         "-frames:v", "1", "-update", "1", str(end)])
    if record(video) != before_video or record(script) != before_script:
        raise ValueError("Video/script changed while collecting evidence; discard this QA directory")
    pcm_hash = audio_pcm_sha256(video)
    if audio_pcm_sha256(audio) != pcm_hash:
        raise ValueError("Extracted audio differs from final audio")
    manifest = {
        "schema": SCHEMA, "created_at": now(), "video": before_video,
        "audio": {**record(audio), "decoded_pcm_sha256": pcm_hash, "pcm_format": PCM_FORMAT}, "script": before_script,
        "artifacts": {"first_screen": record(first), "contact_sheets": [record(p) for p in sorted(directory.glob("contact-*.jpg"))], "last_frame": record(end)},
        "capture": {"method": "ffmpeg_from_final", "video_sha256": before_video["sha256"], "duration": duration, "sample_interval_seconds": 1},
        "asr": None, "reviews": {"visual": {"status": "pending"}, "listening": {"status": "pending"}},
        "notice": "Technical capture only. No human viewing, listening, acting or voice-identity approval has occurred.",
    }
    manifest_path = directory / "manifest.json"
    validate_manifest(manifest, verify_pcm=False)
    write_json(manifest_path, manifest)
    return manifest_path


def run_asr(manifest_path: Path, command: list[str]) -> None:
    manifest = json.loads(manifest_path.read_text())
    validate_manifest(manifest)
    if command and command[0] == "--":
        command = command[1:]
    if not command or any(not any(token in arg for arg in command) for token in ("{audio}", "{script}", "{report}")):
        raise ValueError("ASR argv must contain {audio}, {script}, {report}; an old output cannot be sealed as newly verified")
    output = manifest_path.parent / ("asr-raw-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f") + ".json")
    if output.exists():
        raise ValueError("ASR output must be new")
    replacements = {"{audio}": manifest["audio"]["path"], "{script}": manifest["script"]["path"], "{report}": str(output.resolve())}
    argv = []
    for arg in command:
        for source, target in replacements.items():
            arg = arg.replace(source, target)
        argv.append(arg)
    started = now()
    # A new attempted ASR run cannot leave earlier approvals looking current.
    manifest["asr"] = None
    manifest["reviews"] = {"visual": {"status": "pending"}, "listening": {"status": "pending"}}
    write_json(manifest_path, manifest)
    try:
        run(argv)
    except subprocess.CalledProcessError as exc:
        # argv may contain provider credentials; do not include it in errors.
        raise ValueError(f"ASR executable {Path(argv[0]).name} failed (exit {exc.returncode}); no evidence bound") from exc
    report = record(output)
    coverage_value(json.loads(output.read_text()), 0)
    validate_manifest(manifest)
    manifest["asr"] = {
        "method": "executed_command_with_bound_inputs", "started_at": started, "finished_at": now(),
        "executable": Path(argv[0]).name, "report": report,
        "source": {"video_sha256": manifest["video"]["sha256"], "audio_sha256": manifest["audio"]["sha256"],
                   "audio_pcm_sha256": manifest["audio"]["decoded_pcm_sha256"], "script_sha256": manifest["script"]["sha256"]},
    }
    manifest["reviews"] = {"visual": {"status": "pending"}, "listening": {"status": "pending"}}
    write_json(manifest_path, manifest)


def record_review(manifest_path: Path, aspect: str, decision: str, reviewer: str, notes: str, attest: bool) -> None:
    if not attest or not reviewer.strip() or not notes.strip():
        raise ValueError("Review requires explicit performed-review attestation, reviewer and substantive notes")
    manifest = json.loads(manifest_path.read_text())
    validate_manifest(manifest)
    manifest.setdefault("reviews", {})[aspect] = {
        "status": decision, "reviewer": reviewer.strip(), "notes": notes.strip(), "reviewed_at": now(),
        "attested_performed": True, "evidence_sha256": evidence_digest(manifest),
    }
    write_json(manifest_path, manifest)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="action", required=True)
    capture = subs.add_parser("prepare", help="Fresh final-file artifacts; subjective reviews pending")
    capture.add_argument("--video", type=Path, required=True)
    capture.add_argument("--script", type=Path, required=True)
    capture.add_argument("--directory", type=Path, required=True)
    asr = subs.add_parser("run-asr", help="Run real ASR+coverage against bound final audio")
    asr.add_argument("--manifest", type=Path, required=True)
    asr.add_argument("command", nargs=argparse.REMAINDER)
    review = subs.add_parser("review", help="Operator attestation only after review actually happened")
    review.add_argument("--manifest", type=Path, required=True)
    review.add_argument("--aspect", choices=["visual", "listening"], required=True)
    review.add_argument("--decision", choices=["pass", "fail"], required=True)
    review.add_argument("--reviewer", required=True)
    review.add_argument("--notes", required=True)
    review.add_argument("--attest-performed", action="store_true", required=True)
    args = parser.parse_args()
    try:
        if args.action == "prepare":
            print(json.dumps({"manifest": str(prepare(args.video, args.script, args.directory)), "review_status": "pending"}))
        elif args.action == "run-asr":
            run_asr(args.manifest.resolve(), args.command)
            print(json.dumps({"manifest": str(args.manifest.resolve()), "review_status": "pending"}))
        else:
            record_review(args.manifest.resolve(), args.aspect, args.decision, args.reviewer, args.notes, args.attest_performed)
            print(json.dumps({"recorded_aspect": args.aspect, "status": args.decision, "operator_attestation": True}))
        return 0
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(2, f"QA evidence failed: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
