#!/usr/bin/env python3
"""Audit a local asset/chart manifest; never generate, alter media or publish.

FFprobe verifies media structure, not faces, voices, acting, anatomy, story or
eyelines. Review fields are explicit human declarations, not automated verdicts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

REVIEW_FIELDS = ("identity", "voice_consistency", "performance", "anatomy",
                 "action_continuity", "eyeline", "lip_sync", "story_logic")
CHART_REVIEWS = ("source_verified", "meaning_matches_narration", "label_visible_in_render")
SHA256 = re.compile(r"[a-fA-F0-9]{64}\Z")


def chart_sha256(chart):
    """Bind reviews to semantic/chart inputs, never to the review object itself."""
    payload = {key: chart.get(key) for key in (
        "id", "illustrative", "data", "unit", "as_of", "source", "display_label")}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def number(value, name, minimum=None, positive=False):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError(f"{name}: finite numeric value required")
    if positive and value <= 0 or minimum is not None and value < minimum:
        raise ValueError(f"{name}: invalid range")
    return float(value)


def dimensions(obj, name):
    return (number(obj["width"], name + ".width", positive=True),
            number(obj["height"], name + ".height", positive=True))


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path):
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,duration,sample_aspect_ratio,avg_frame_rate:stream_side_data=rotation:format=duration",
        "-of", "json", str(path)], capture_output=True, text=True, check=True, timeout=30)
    data = json.loads(result.stdout)
    if not data.get("streams"):
        raise ValueError("No video stream")
    video = data["streams"][0]
    duration = float(video.get("duration") or data.get("format", {}).get("duration") or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Missing/invalid video duration")
    sar = video.get("sample_aspect_ratio", "1:1")
    if sar in (None, "N/A", "0:1"):
        sar = "1:1"
    a, b = (float(n) for n in sar.split(":"))
    if not a > 0 or not b > 0:
        raise ValueError("Invalid sample aspect ratio")
    rotations = [s["rotation"] for s in video.get("side_data_list", []) if "rotation" in s]
    return {"width": video["width"], "height": video["height"], "duration": duration,
            "sample_aspect_ratio": a / b, "rotation_degrees": rotations[0] if rotations else 0,
            "fps": video.get("avg_frame_rate")}


def human_reviews(value, fields, binding=None):
    value = value or {}
    if not isinstance(value, dict):
        raise ValueError("human_review must be an object")
    result = {}
    for field in fields:
        item = value.get(field, {"status": "pending"})
        if not isinstance(item, dict):
            raise ValueError(f"human_review.{field}: object required")
        status = item.get("status", "pending")
        if status not in ("pending", "pass", "fail", "not_applicable"):
            raise ValueError(f"human_review.{field}: unsupported status")
        if status != "pending":
            if not item.get("reviewed_by") or not item.get("evidence"):
                raise ValueError(f"human_review.{field}: reviewer and evidence required")
            if binding and (not isinstance(item.get("reviewed_sha256"), str) or
                            item["reviewed_sha256"].lower() != binding.lower()):
                raise ValueError(f"human_review.{field}: stale/missing reviewed_sha256")
            if status == "not_applicable" and not item.get("reason"):
                raise ValueError(f"human_review.{field}: not_applicable requires a reason")
        result[field] = {**item, "status": status, "verification": "human_declared_not_automated"}
    return result


def asset_audit(asset, base, thresholds, schema_only=False):
    result = {"id": asset.get("id"), "errors": [], "warnings": [], "media_verification": "not_run"}
    try:
        if not isinstance(asset.get("path"), str) or not asset["path"] or "://" in asset["path"]:
            raise ValueError("path must name local media, not a URL")
        declared_hash = asset["sha256"]
        if not isinstance(declared_hash, str) or not SHA256.fullmatch(declared_hash):
            raise ValueError("sha256 must be a 64-character hex digest")
        width, height = dimensions(asset["source"], "source")
        target_w, target_h = dimensions(asset["target"], "target")
        crop = asset["crop"]
        x, y = number(crop["x"], "crop.x", minimum=0), number(crop["y"], "crop.y", minimum=0)
        crop_w, crop_h = dimensions(crop, "crop")
        if x + crop_w > width + 1e-6 or y + crop_h > height + 1e-6:
            raise ValueError("crop_out_of_bounds: crop exceeds declared source dimensions")
        start, end = number(asset["in"], "in", minimum=0), number(asset["out"], "out", positive=True)
        if end <= start:
            raise ValueError("out must be after in")
        fit = asset.get("fit")
        if fit not in ("cover", "contain", "stretch"):
            raise ValueError("fit must explicitly be cover, contain or stretch")
        path = Path(asset["path"])
        path = path.resolve() if path.is_absolute() else (base / path).resolve()
        result.update(path=str(path), declared_sha256=declared_hash.lower(),
                      source={"width": width, "height": height}, crop=crop, target=asset["target"],
                      source_range={"in": start, "out": end, "duration": end - start}, fit=fit)
        result["human_review"] = human_reviews(asset.get("human_review"), REVIEW_FIELDS, declared_hash)
        if not schema_only:
            if not path.is_file():
                raise ValueError("media file not found")
            observed_hash = file_sha256(path)
            result["observed_sha256"] = observed_hash
            if observed_hash != declared_hash.lower():
                raise ValueError("source_hash_mismatch: media differs from manifest")
            actual = probe(path)
            result["ffprobe"] = actual
            if (width, height) != (actual["width"], actual["height"]):
                raise ValueError("source_dimensions_mismatch: coded pixels differ from manifest")
            if end > actual["duration"] + .001:
                raise ValueError("trim_out_of_bounds: out exceeds source video duration")
            if abs(actual["sample_aspect_ratio"] - 1) > .001:
                result["warnings"].append("non_square_pixels: normalize or explicitly review display geometry")
            if actual["rotation_degrees"] % 360:
                result["warnings"].append("rotation_metadata: crop uses coded-pixel coordinates; verify autorotation behavior")
            result["media_verification"] = "pass"
        sx, sy = target_w / crop_w, target_h / crop_h
        aspect_error = abs((crop_w / crop_h) / (target_w / target_h) - 1)
        if fit == "stretch" and aspect_error > thresholds["aspect_tolerance"]:
            result["errors"].append("aspect_stretch_risk: nonuniform scaling changes subject proportions")
        scale = max(sx, sy) if fit in ("cover", "stretch") else min(sx, sy)
        visible_w, visible_h = ((target_w / scale, target_h / scale) if fit == "cover" else (crop_w, crop_h))
        result["geometry"] = {
            "crop_effective_pixels": crop_w * crop_h,
            "retained_source_width": round(visible_w, 3), "retained_source_height": round(visible_h, 3),
            "retained_source_pixels": round(visible_w * visible_h),
            "scale_x": round(sx if fit == "stretch" else scale, 6),
            "scale_y": round(sy if fit == "stretch" else scale, 6),
            "max_upscale": round(scale, 6), "aspect_error_ratio": round(aspect_error, 6),
            "basis": "coded square-pixel geometry; SAR/rotation warnings require review"}
        if scale > thresholds["max_upscale"]:
            result["warnings"].append(f"upscale_warning: {scale:.3f}x exceeds {thresholds['max_upscale']:.3f}x")
    except (KeyError, ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
        result["errors"].append(str(error))
    result["technical_status"] = "fail" if result["errors"] else "schema_pass" if schema_only else "pass"
    return result


def chart_audit(chart):
    result = {"id": chart.get("id"), "errors": [], "warnings": []}
    try:
        if not isinstance(chart.get("illustrative"), bool):
            raise ValueError("illustrative must explicitly be true or false")
        if not isinstance(chart.get("unit"), str) or not chart["unit"].strip():
            raise ValueError("chart unit is required, including explicit illustrative scale")
        if not isinstance(chart.get("as_of"), str):
            raise ValueError("as_of must be an ISO date YYYY-MM-DD")
        dt.date.fromisoformat(chart["as_of"])
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", chart["as_of"]):
            raise ValueError("as_of must be an ISO date YYYY-MM-DD")
        source = chart["source"]
        if not isinstance(source, dict) or not isinstance(source.get("title"), str) or not source["title"].strip():
            raise ValueError("source.title is required")
        if source.get("url") is not None and (not isinstance(source["url"], str) or
                                              not re.match(r"https?://[^/\s]+", source["url"])):
            raise ValueError("source.url must be an HTTP(S) source location")
        if source.get("path") is not None and (not isinstance(source["path"], str) or not source["path"].strip()):
            raise ValueError("source.path must name a source artifact")
        if chart["illustrative"]:
            label = chart.get("display_label", {})
            if not isinstance(label, dict) or not isinstance(label.get("text"), str) or not label["text"].strip():
                raise ValueError("illustrative chart requires a displayed explanatory label")
            if label.get("visible") is not True or not label.get("selector"):
                raise ValueError("illustrative display_label needs visible:true and a render selector")
            if not re.search(r"示意|非真实|非真實|非实际|非實際|illustrat|not actual|not real|schematic|not to scale", label["text"], re.I):
                raise ValueError("display_label must explicitly say illustrative/not actual/示意")
            if source.get("kind") != "editorial" and not source.get("url") and not source.get("path"):
                raise ValueError("illustrative source must identify editorial origin or source location")
            result["display_label"] = label
        elif not source.get("url") and not source.get("path"):
            raise ValueError("factual chart source requires url or path")
        data = chart.get("data")
        if not isinstance(data, list) or not data:
            raise ValueError("chart data must contain labeled numeric values")
        for row in data:
            if not isinstance(row, dict) or not row.get("label"):
                raise ValueError("each chart value requires a label")
            number(row.get("value"), "chart value")
        result.update(illustrative=chart["illustrative"], unit=chart["unit"], as_of=chart["as_of"], source=source, data=data)
        binding = chart_sha256(chart)
        result["canonical_sha256"] = binding
        result["canonical_hash_fields"] = ["id", "illustrative", "data", "unit", "as_of", "source", "display_label"]
        result["human_review"] = human_reviews(chart.get("human_review"), CHART_REVIEWS, binding)
        if chart["illustrative"] and result["human_review"]["label_visible_in_render"]["status"] != "pass":
            result["warnings"].append("illustrative_label_visibility_pending: declaration is not rendered-frame proof")
        result["source_verification"] = "not_fetched_or_fact_checked"
    except (KeyError, ValueError, TypeError) as error:
        result["errors"].append(str(error))
    result["technical_status"] = "fail" if result["errors"] else "pass"
    return result


def audit_plan(manifest, base, schema_only=False):
    if not isinstance(manifest, dict):
        raise ValueError("Manifest must be an object")
    if manifest.get("schema_version") != 1:
        raise ValueError("schema_version must be 1")
    if not isinstance(manifest.get("thresholds", {}), dict):
        raise ValueError("thresholds must be an object")
    thresholds = {"max_upscale": 1.25, "aspect_tolerance": .005, **manifest.get("thresholds", {})}
    number(thresholds["max_upscale"], "max_upscale", minimum=1)
    number(thresholds["aspect_tolerance"], "aspect_tolerance", minimum=0)
    if thresholds["aspect_tolerance"] > .1:
        raise ValueError("aspect_tolerance must be <= 0.1")
    assets, charts = manifest.get("assets", []), manifest.get("charts", [])
    if not isinstance(assets, list) or not isinstance(charts, list) or not (assets or charts):
        raise ValueError("Provide at least one asset or chart")
    if any(not isinstance(item, dict) for item in [*assets, *charts]):
        raise ValueError("Every asset/chart entry must be an object")
    ids = [item.get("id") for item in [*assets, *charts]]
    if any(not isinstance(i, str) or not i.strip() for i in ids) or len(ids) != len(set(ids)):
        raise ValueError("All asset/chart IDs must be nonempty and unique")
    asset_results = [asset_audit(a, base, thresholds, schema_only) for a in assets]
    chart_results = [chart_audit(c) for c in charts]
    results = [*asset_results, *chart_results]
    errors = [{"id": r["id"], "message": e} for r in results for e in r["errors"]]
    warnings = [{"id": r["id"], "message": e} for r in results for e in r["warnings"]]
    pending = [{"id": r["id"], "field": field} for r in results for field, review in r.get("human_review", {}).items()
               if review["status"] == "pending"]
    failed = [{"id": r["id"], "field": field} for r in results for field, review in r.get("human_review", {}).items()
              if review["status"] == "fail"]
    technical = "fail" if errors else "schema_pass" if schema_only else "pass"
    readiness = ("blocked" if errors or failed else "pending_media_verification" if schema_only else
                 "pending_human_review" if pending else "pending_warning_review" if warnings else "ready_for_edit")
    return {"schema_version": 1, "mode": "schema_only" if schema_only else "local_media_probe",
            "thresholds": thresholds, "assets": asset_results, "charts": chart_results,
            "technical_status": technical, "readiness": readiness,
            "human_review": {"pending": pending, "failed": failed, "verification": "declarations_only"},
            "errors": errors, "warnings": warnings, "release_approved": False,
            "limits": "No automated face, acting, anatomy, voice, lip-sync, plot or eyeline certification. Chart sources/visible labels require review. No media is modified or generated."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--schema-only", action="store_true", help="Validate declarations without accessing media or invoking ffprobe")
    args = parser.parse_args()
    try:
        manifest_path = args.manifest.resolve()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if args.output.resolve() == manifest_path:
            raise ValueError("Output must not overwrite the input manifest")
        # Protect original paths even when another malformed field prevents the
        # asset from reaching result.path during validation.
        if isinstance(manifest, dict):
            for collection in ("assets", "charts"):
                entries = manifest.get(collection, [])
                for item in entries if isinstance(entries, list) else []:
                    if not isinstance(item, dict):
                        continue
                    source = item if collection == "assets" else item.get("source", {})
                    path = source.get("path") if isinstance(source, dict) else None
                    if isinstance(path, str) and path and "://" not in path:
                        protected = (manifest_path.parent / path).resolve()
                        if protected == args.output.resolve():
                            raise ValueError("Output must not overwrite source media/data")
        result = audit_plan(manifest, manifest_path.parent, args.schema_only)
        result["manifest"] = {"path": str(manifest_path), "sha256": file_sha256(manifest_path)}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(args.output), "technical_status": result["technical_status"],
                          "readiness": result["readiness"], "errors": len(result["errors"]), "warnings": len(result["warnings"])}, ensure_ascii=False))
        return 2 if result["technical_status"] == "fail" else 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"audit_asset_plan: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
