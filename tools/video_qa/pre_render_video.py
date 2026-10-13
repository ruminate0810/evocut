#!/usr/bin/env python3
"""Read-only EvoCut composition QA: pinned engine, semantic samples, human gates.

Writes reports/snapshots only. Never transcribes, renders, edits compositions,
approves release, or claims that background motion is information progression.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import uuid
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

try:
    from .semantic_timeline import finite, qa_sample_plan, sha256
except ImportError:
    from semantic_timeline import finite, qa_sample_plan, sha256

VERSION = re.compile(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\Z")
CONTENT_TYPES = ("talking_head", "drama", "documentary", "motion_graphics", "static_card")
SNAPSHOT_NAME = re.compile(r"frame-(\d+)-at-(\d+(?:\.\d+)?)s\.png\Z")


def natural_key(path: Path) -> list:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", path.name)]


def snapshot_inventory(folder: Path, expected_times: list[float]) -> dict:
    """Check fresh snapshot indices AND timestamps (CLI names round to 3 decimals)."""
    frames, problems = [], []
    for path in sorted(folder.glob("frame-*.png"), key=natural_key):
        match = SNAPSHOT_NAME.fullmatch(path.name)
        if not match:
            problems.append(f"Unrecognized frame filename: {path.name}")
            continue
        index, time = int(match[1]), float(match[2])
        frames.append({"path": str(path), "index": index, "time_from_filename": time})
        if index >= len(expected_times) or abs(time - expected_times[index]) > .000501:
            problems.append(f"Unexpected timestamp/index: {path.name}")
    if [item["index"] for item in frames] != list(range(len(expected_times))):
        problems.append("Snapshot indices do not exactly cover requested times")
    return {"expected": len(expected_times), "observed": len(frames), "frames": frames,
            "status": "pass" if not problems else "fail", "problems": problems}


def sample_times(duration: float, fps: float, cuts: list[float], points: list[dict]) -> list[float]:
    # Endpoint cuts are valid metadata, but must not manufacture t=duration.
    bounds = [0, *[cut for cut in cuts if 0 < cut < duration], duration]
    last_frame = points[-1]["frame"]
    candidates = [point["time"] for point in points] + [(a + b) / 2 for a, b in zip(bounds, bounds[1:])]
    frames = {max(0, min(last_frame, round(time * fps))) for time in candidates}
    return [round(frame / fps, 9) for frame in sorted(frames)]


def resolve_cli(project: Path, explicit_version: str | None = None) -> dict:
    package_path = project / "package.json"
    package = json.loads(package_path.read_text()) if package_path.exists() else {}
    pins, check_args = set(), []
    use_evocut = False
    dependency_pin = False
    for kind in ("dependencies", "devDependencies"):
        declared = package.get(kind, {}).get("hyperframes")
        if declared is not None:
            if not isinstance(declared, str) or not VERSION.fullmatch(declared):
                raise ValueError("EvoCut's upstream hyperframes dependency must use an exact version")
            pins.add(declared)
            dependency_pin = True
    for name, script in package.get("scripts", {}).items():
        if name not in ("check", "render", "dev", "preview", "publish"):
            continue
        if not isinstance(script, str):
            raise ValueError(f"Package script {name!r} must be text")
        if "hyperframes" not in script and "evocut" not in script:
            continue
        if re.search(r"[;&|`$<>\n\r]", script):
            raise ValueError(f"Unsafe/complex package script {name!r}; provide a simple pinned CLI script")
        tokens = shlex.split(script)
        used_npx = bool(tokens and tokens[0] == "npx")
        if tokens and tokens[0] == "npx":
            tokens = tokens[1:]
            if tokens and tokens[0] in ("--yes", "-y"):
                tokens = tokens[1:]
        if not tokens:
            raise ValueError(f"Unsupported EvoCut wrapper in script {name!r}")
        command = tokens[0]
        command_at = 1
        if command == "evocut":
            if used_npx:
                raise ValueError("Do not use npx evocut: EvoCut is a local wrapper, not the upstream npm package")
            use_evocut = True
            if len(tokens) > 1 and tokens[1] == "--engine-version":
                if len(tokens) < 4 or not VERSION.fullmatch(tokens[2]):
                    raise ValueError("EvoCut --engine-version must use an exact version")
                pins.add(tokens[2])
                command_at = 3
        elif command.startswith("evocut@"):
            raise ValueError("Use evocut --engine-version X.Y.Z, not evocut@version")
        elif command.startswith("hyperframes@"):
            version = command.removeprefix("hyperframes@")
            if not VERSION.fullmatch(version):
                raise ValueError("EvoCut engine must use an exact version, not latest/range")
            pins.add(version)
        elif command != "hyperframes":
            raise ValueError(f"Unsupported EvoCut engine command {command!r}")
        if len(tokens) <= command_at or tokens[command_at] not in ("check", "render", "preview", "publish"):
            raise ValueError(f"Unsupported EvoCut wrapper in script {name!r}")
        if name == "check":
            check_args = tokens[command_at + 1:]
            if any(not value.startswith("-") for value in check_args) or any(
                value.startswith(("--project", "--output", "--engine-version", "--resolve-engine")) for value in check_args
            ):
                raise ValueError("Check script must not redirect the project or output")
    if len(pins) > 1:
        raise ValueError(f"Conflicting project CLI pins: {sorted(pins)}")
    if explicit_version and not VERSION.fullmatch(explicit_version):
        raise ValueError("--cli-version must be an exact semver")
    if pins and explicit_version and explicit_version not in pins:
        raise ValueError("Explicit CLI version conflicts with project pin")
    version = next(iter(pins), explicit_version)
    local_package = project / "node_modules/hyperframes/package.json"
    local_bin = project / "node_modules/.bin/hyperframes"
    local_version = None
    if local_package.is_file() and local_bin.is_file():
        local_version = json.loads(local_package.read_text()).get("version")
    if use_evocut:
        if version is None and local_version and VERSION.fullmatch(local_version):
            version = local_version
        if version is None:
            raise ValueError("EvoCut requires an exact project engine pin/local installation or --cli-version")
        return {"prefix": ["evocut", "--engine-version", version], "version": version,
                "source": "evocut_wrapper", "engine_package": "hyperframes", "check_args": check_args,
                "package_sha256": sha256(package_path) if package_path.exists() else None}
    if local_version and VERSION.fullmatch(local_version) and version in (None, local_version):
        return {"prefix": [str(local_bin.resolve())], "version": local_version,
                "source": "project_local_install", "check_args": check_args,
                "package_sha256": sha256(package_path) if package_path.exists() else None}
    if version:
        return {"prefix": ["npx", "--yes", f"hyperframes@{version}"], "version": version,
                "source": "project_dependency_pin" if dependency_pin else ("project_script_pin" if pins else "explicit_version"), "check_args": check_args,
                "package_sha256": sha256(package_path) if package_path.exists() else None}
    raise ValueError("No exact project CLI pin/local installation; provide --cli-version explicitly")


def run(command: list[str], cwd: Path, log: Path, env: dict) -> subprocess.CompletedProcess:
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
    log.write_text(result.stdout + "\n" + result.stderr, encoding="utf-8")
    return result


def scaled_size(width: int, height: int, max_side: int = 480) -> tuple[int, int]:
    ratio = min(1.0, max_side / max(width, height))
    return max(1, round(width * ratio)), max(1, round(height * ratio))


def motion_evidence(frames: list[Path], content_type: str, static_reason: str | None = None) -> dict:
    """Whole-frame pixel change proves neither speaking nor new information."""
    if content_type not in CONTENT_TYPES:
        raise ValueError("Unknown content type")
    pairs = []
    for before, after in zip(frames, frames[1:]):
        with Image.open(before) as source, Image.open(after) as target:
            if source.size != target.size:
                raise ValueError("Snapshot dimensions changed inside composition")
            size = scaled_size(*source.size)
            left = source.convert("RGB").resize(size)
            right = target.convert("RGB").resize(size)
            diff = ImageChops.difference(left, right)
            mean = sum(ImageStat.Stat(diff).mean) / 3
            changed = sum(diff.convert("L").histogram()[13:]) / (size[0] * size[1])
            pairs.append({"from": before.name, "to": after.name, "analysis_size": list(size),
                          "mean_abs_difference": round(mean, 4), "changed_pixel_ratio": round(changed, 4)})
    active = sum(p["changed_pixel_ratio"] >= 0.008 for p in pairs)
    if not pairs:
        status = "insufficient_samples"
    elif static_reason:
        status = "declared_static_intent_pending_review"
    elif content_type in ("drama", "documentary", "talking_head"):
        status = "observed_change" if active else "low_change_review_recommended"
    else:
        status = "observed_change" if active >= max(1, len(pairs) // 2) else "low_change_review_recommended"
    return {"content_type": content_type, "status": status, "pairs": pairs,
            "active_intervals": active, "intentional_static_reason": static_reason,
            "information_progression": "pending_human_review",
            "limits": "Whole-frame pixel differences can come only from background motion. They prove neither foreground movement nor new information."}


def validate_cues(path: Path, duration: float, fps: float) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    if abs(finite(result["fps"], "cue fps") - fps) > 1e-6:
        raise ValueError("Cue FPS differs from final metadata/--fps")
    if abs(finite(result["duration"], "cue duration") - duration) > 1 / fps:
        raise ValueError("Cue duration differs from final metadata")
    audio = Path(result["audio"]["path"])
    if not audio.is_absolute():
        audio = path.parent / audio
    if sha256(audio) != result["audio"]["sha256"]:
        raise ValueError("Cue binding is stale: final audio hash changed")
    transcript = Path(result["transcript"]["path"])
    if not transcript.is_absolute():
        transcript = path.parent / transcript
    if sha256(transcript) != result["transcript"]["sha256"]:
        raise ValueError("Cue binding is stale: transcript hash changed")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--metadata", default="assets/narration.json")
    parser.add_argument("--cues", type=Path)
    parser.add_argument("--fps", type=float, help="Defaults to metadata/cue FPS, otherwise documented CLI default 30")
    parser.add_argument("--cli-version")
    parser.add_argument("--content-type", choices=CONTENT_TYPES, default="talking_head")
    parser.add_argument("--intentional-static-reason")
    parser.add_argument("--output-dir", type=Path, help="Reports/snapshots; defaults to project snapshots/pre-render")
    parser.add_argument("--plan-only", action="store_true", help="Write sample plan without invoking CLI")
    args = parser.parse_args()
    try:
        project = args.project.resolve()
        metadata = json.loads((project / args.metadata).read_text(encoding="utf-8"))
        duration = finite(metadata["duration"], "duration")
        cli = resolve_cli(project, args.cli_version)
        cue_path = args.cues.resolve() if args.cues else None
        cue_header = json.loads(cue_path.read_text(encoding="utf-8")) if cue_path else {}
        fps = finite(args.fps if args.fps is not None else metadata.get("fps", cue_header.get("fps", 30)), "fps")
        if duration <= 0 or fps <= 0:
            raise ValueError("duration and fps must be positive")
        cues = validate_cues(cue_path, duration, fps) if cue_path else {}
        cuts = sorted({finite(value, "cut") for value in [*metadata.get("cuts", []), *cues.get("cuts", [])]})
        points = qa_sample_plan(duration, fps, cuts, cues.get("cues", []), cues.get("events", []))
        times = sample_times(duration, fps, cuts, points)
        output = args.output_dir.resolve() if args.output_dir else project / "snapshots/pre-render"
        output.mkdir(parents=True, exist_ok=True)
        report = {"project": str(project), "duration": duration, "fps": fps, "cli": cli,
                  "times": times, "qa_samples": points, "cue_path": str(cue_path) if cue_path else None,
                  "technical": {"status": "planned", "cli_check": "not_run", "snapshots": "not_run"},
                  "semantic_alignment": cues.get("technical", {"status": "not_supplied"}),
                  "human_semantic_review": {"status": "pending", "checks": [
                      "cue text present at the intended spoken phrase", "foreground/new information, not just background motion",
                      "normal-speed first 5/15 seconds", "natural voice and lip sync", "intentional still-frame rationale"]},
                  "status": "plan_only" if args.plan_only else "in_progress", "release_approved": False}
        report_path = output / "pre-render-audit.json"
        if not args.plan_only:
            run_id = f"pre-render-{uuid.uuid4().hex[:12]}"
            run_dir = output / run_id
            run_dir.mkdir()
            env = {**os.environ, "HYPERFRAMES_NO_TELEMETRY": "1", "HYPERFRAMES_RUN_ID": run_id}
            # Refuse a migration race rather than silently use a stale pin.
            package = project / "package.json"
            if cli["package_sha256"] and sha256(package) != cli["package_sha256"]:
                raise ValueError("Project package changed during planning; retry against its new pin")
            check = run([*cli["prefix"], "check", *cli["check_args"]], project, run_dir / "check.log", env)
            report["technical"]["cli_check"] = "pass" if check.returncode == 0 else "fail"
            report["check_log"] = str(run_dir / "check.log")
            if check.returncode == 0:
                def snapshot(at, folder):
                    return run([*cli["prefix"], "snapshot", ".", "--at", ",".join(f"{t:.9f}" for t in at),
                                "--output", str(run_dir / folder), "--describe", "false", "--no-end"],
                               project, run_dir / f"{folder}.log", env)
                hook_times = [t for t in (0, .5, 1, 2, 3, 5) if t < duration]
                hook = snapshot(hook_times, "hook")
                sampled = snapshot(times, "samples")
                hook_inventory = snapshot_inventory(run_dir / "hook", hook_times)
                sample_inventory = snapshot_inventory(run_dir / "samples", times)
                frames = [Path(item["path"]) for item in hook_inventory["frames"]]
                coverage = hook_inventory["status"] == sample_inventory["status"] == "pass"
                report["technical"]["snapshots"] = "pass" if hook.returncode == sampled.returncode == 0 and coverage else "fail"
                report["snapshot_coverage"] = {"hook_expected": len(hook_times), "hook_observed": hook_inventory["observed"],
                                               "samples_expected": len(times), "samples_observed": sample_inventory["observed"],
                                               "hook": hook_inventory, "samples": sample_inventory}
                report["hook_motion"] = motion_evidence(frames, args.content_type, args.intentional_static_reason)
                report["contact_sheets"] = [str(p) for p in sorted((run_dir / "samples").glob("contact-sheet*"), key=natural_key)
                                            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
                report["snapshot_logs"] = [str(run_dir / "hook.log"), str(run_dir / "samples.log")]
            passed = report["technical"]["cli_check"] == report["technical"]["snapshots"] == "pass"
            report["technical"]["status"] = "pass" if passed else "fail"
            report["status"] = "ready_for_visual_review" if passed else "technical_check_failed"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"report": str(report_path), "technical": report["technical"],
                          "semantic_alignment": report["semantic_alignment"], "human_semantic_review": "pending"}, ensure_ascii=False))
        return 3 if report["technical"]["status"] == "fail" else 0
    except (ValueError, OSError, TypeError, KeyError) as error:
        parser.exit(2, f"pre_render_video: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
