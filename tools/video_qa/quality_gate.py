#!/usr/bin/env python3
"""Offline typed final-video gate. No generation, ASR execution or approval writes.

Default --check reads existing evidence only. --run performs local FFmpeg checks.
Technical success is deliberately independent of existing human attestations.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from qa_evidence import (audio_pcm_sha256, coverage_value, now, probe, record,
                         review_status, validate_manifest)
from video_checks import detect_black_and_decode
from audit_render_audio import audit as audit_audio, meter
from audit_asset_plan import audit_plan
from semantic_timeline import build_timeline

SCHEMA = "evocut.quality-gate/v1"
BINDINGS_SCHEMA = "evocut.qa-report-bindings/v1"
DETECTOR_VERSION = 2
INVALIDATION_SCHEMA = "evocut.qa-invalidation/v1"
RENDER_RECEIPT_SCHEMA = "evocut.render-receipt/v1"
TYPES = ("narrated", "dialogue", "music", "silent")
SPOKEN = ("narrated", "dialogue")
ERRORS = (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError)


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def object_json(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("JSON document must be an object")
    return value


def same_record(expected, observed, label):
    if not isinstance(expected, dict):
        raise ValueError(f"{label}: missing file record")
    path = expected.get("path")
    if not isinstance(path, str) or not Path(path).is_absolute():
        raise ValueError(f"{label}: record path must be absolute")
    if Path(path).resolve() != Path(observed["path"]).resolve() or expected.get("sha256") != observed["sha256"]:
        raise ValueError(f"{label}: stale or wrong-file evidence")
    if "size_bytes" in expected and expected["size_bytes"] != observed["size_bytes"]:
        raise ValueError(f"{label}: size mismatch")


def finite(value, label, low=None, high=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: finite number required")
    if low is not None and value < low or high is not None and value > high:
        raise ValueError(f"{label}: outside allowed range")
    return value


def timestamp(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}: timezone-qualified ISO timestamp required")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label}: invalid ISO timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{label}: timezone-qualified ISO timestamp required")
    return parsed.astimezone(timezone.utc)


class Gate:
    def __init__(self, args):
        self.args = args
        self.inputs = {}
        self.issues = []
        self.checks = {}
        self.observations = {}
        self.human = {"visual": "pending"}
        if args.type != "silent":
            self.human["listening"] = "pending"
        self.manifest = None
        self.bindings = None
        self.review_record = None
        self.source_binding = {"status": "not_bound", "reason": "Video-only QA; --project not supplied"}
        self.project_paths = {}

    def watch_project_file(self, name, path):
        # Keep the lexical path too: a changed symlink or a newly created marker
        # must not evade the final check by leaving its old resolved target intact.
        path = Path(path).absolute()
        present = path.exists() or path.is_symlink()
        current = self.take(name, path) if present else None
        self.project_paths[name] = (path, current)
        return current

    def collect_project(self):
        if not self.args.project:
            if self.args.render_receipt:
                raise ValueError("--render-receipt requires --project; it cannot bind video-only QA")
            return
        self.source_binding = {"status": "pending", "reason": "Project render binding not validated"}
        project = self.args.project.resolve(strict=True)
        if not project.is_dir():
            raise ValueError("--project must be an existing directory")
        self.source_binding["project"] = str(project)
        index = self.watch_project_file("project_index", project / "index.html")
        state = project / ".hyperframes" / "evocut"
        marker_path = state / "qa-invalidated.json"
        marker_record = self.watch_project_file("project_invalidation", marker_path)
        receipt_path = self.args.render_receipt or state / "render-receipt.json"
        receipt_record = self.watch_project_file("render_receipt", receipt_path)
        if index is None:
            raise ValueError("Project index.html is missing; source binding requires the current entry source")
        marker = None
        if marker_record:
            marker = object_json(marker_path)
            if (marker.get("schema") != INVALIDATION_SCHEMA or marker.get("status") != "invalidated"
                    or not isinstance(marker.get("indexSha256"), str)
                    or re.fullmatch(r"[a-fA-F0-9]{64}", marker["indexSha256"]) is None
                    or not isinstance(marker.get("transaction"), str) or not marker["transaction"].strip()):
                raise ValueError("Malformed project QA invalidation marker")
            marker_at = timestamp(marker.get("at"), "Invalidation at")
        if receipt_record is None:
            self.source_binding["reason"] = "A matching successful render receipt is required for --project"
            raise ValueError("Project source binding pending: no render receipt; rerender explicitly and supply its receipt")
        receipt = object_json(receipt_path)
        if receipt.get("schema") != RENDER_RECEIPT_SCHEMA or receipt.get("sourceUnchanged") is not True:
            raise ValueError("Render receipt must use the supported schema and assert sourceUnchanged:true")
        claimed_project = receipt.get("project")
        if (not isinstance(claimed_project, str) or not Path(claimed_project).is_absolute()
                or Path(claimed_project).resolve() != project):
            raise ValueError("Render receipt belongs to another project")
        same_record(receipt.get("index"), index, "render receipt current index")
        same_record(receipt.get("video"), self.inputs["video"], "render receipt final video")
        if not isinstance(receipt.get("engineVersion"), str) or not receipt["engineVersion"].strip():
            raise ValueError("Render receipt must record its engineVersion")
        rendered_at = timestamp(receipt.get("renderedAt"), "Receipt renderedAt")
        if marker and rendered_at < marker_at:
            raise ValueError("Render receipt predates the latest project QA invalidation; rerender required")
        self.source_binding.update(status="bound", reason="Current index and final video match the render receipt",
                                   rendered_at=receipt["renderedAt"], engine_version=receipt["engineVersion"],
                                   invalidation_present=bool(marker),
                                   invalidation_transaction=marker.get("transaction") if marker else None,
                                   invalidation_satisfied_by_render=bool(marker),
                                   scope="index.html only; unlisted external dependencies are not bound")
        self.checks["project_source_bound"] = True

    def verify_project_paths(self):
        for name, (path, original) in self.project_paths.items():
            if original is None:
                if path.exists() or path.is_symlink():
                    raise ValueError(f"{name}: appeared during checking; rerun QA")
            else:
                same_record(original, record(path), name)

    def issue(self, code, message, severity="error", start=None, end=None):
        self.issues.append({"code": code, "severity": severity, "message": str(message),
                            "start_seconds": start, "end_seconds": end})

    def take(self, name, path):
        value = record(Path(path))
        if name in self.inputs and self.inputs[name] != value:
            raise ValueError(f"{name}: input changed during checking")
        self.inputs[name] = value
        return value

    def bound_file(self, name, value):
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            raise ValueError(f"{name}: missing file record")
        observed = self.take(name, value["path"])
        same_record(value, observed, name)
        return Path(observed["path"])

    def attempt(self, name, operation):
        try:
            operation()
        except ERRORS as error:
            # Avoid dumping external tool argv/logs, which may contain private paths.
            message = (f"Local detector failed (exit {error.returncode})" if
                       isinstance(error, subprocess.CalledProcessError) else str(error))
            self.issue(name, message)

    def collect(self):
        self.take("video", self.args.video)
        if self.args.script:
            self.take("script", self.args.script)
        elif self.args.type in SPOKEN:
            self.issue("script_missing", "Spoken video requires --script", "pending")
        for key in ("reference_audio", "audio_plan", "asset_manifest", "semantic_spec", "edl"):
            path = getattr(self.args, key)
            if path:
                self.take(key, path)
        if bool(self.args.reference_audio) != bool(self.args.audio_plan):
            self.issue("reference_inputs_missing", "Use --reference-audio and --audio-plan together")
        if self.args.semantic_spec and not self.args.semantic_report:
            self.issue("semantic_report_missing", "--semantic-spec requires --semantic-report")
        if self.args.edl and not (self.args.audio_plan or self.args.audio_report):
            self.issue("edl_plan_missing", "--edl requires --audio-plan or a bound --audio-report")
        if self.args.asset_manifest:
            self.collect_assets(self.args.asset_manifest)

    def collect_assets(self, manifest_path):
        source = object_json(manifest_path)
        for index, item in enumerate(source.get("assets", [])):
            current = self.take(f"asset_{index}", manifest_path.parent / item["path"])
            if current["sha256"] != item.get("sha256"):
                raise ValueError("Asset source changed since manifest")
        for index, item in enumerate(source.get("charts", [])):
            path = item.get("source", {}).get("path")
            if path:
                self.take(f"chart_source_{index}", manifest_path.parent / path)

    def evidence(self):
        if not self.args.evidence_manifest:
            if self.args.type in SPOKEN:
                self.issue("asr_missing", "Spoken video requires a qa_evidence.py manifest with bound ASR", "pending")
            return
        self.take("evidence_manifest", self.args.evidence_manifest)
        manifest = object_json(self.args.evidence_manifest)
        validate_manifest(manifest, Path(self.inputs["video"]["path"]), verify_pcm=False)
        if "script" in self.inputs:
            same_record(manifest["script"], self.inputs["script"], "script")
        elif self.args.type in SPOKEN:
            raise ValueError("Spoken video requires an explicit current --script")
        for key in ("audio", "script"):
            self.bound_file("evidence_" + key, manifest[key])
        artifacts = manifest["artifacts"]
        self.bound_file("first_screen", artifacts["first_screen"])
        for index, item in enumerate(artifacts["contact_sheets"]):
            self.bound_file(f"contact_sheet_{index}", item)
        if artifacts.get("last_frame"):
            self.bound_file("last_frame", artifacts["last_frame"])
        asr = manifest.get("asr")
        if self.args.type in SPOKEN:
            if not asr:
                self.issue("asr_missing", "No executed, hash-bound final-audio ASR report", "pending")
            else:
                path = self.bound_file("asr_report", asr["report"])
                value = coverage_value(object_json(path), self.args.min_asr_coverage)
                self.observations["asr_coverage"] = value
                self.checks["asr_coverage"] = True
        elif asr:
            self.bound_file("asr_report", asr["report"])
        self.manifest = manifest
        for aspect in self.human:
            status = review_status(manifest, aspect)
            # Legacy attestations bind the video, not this source revision. Keep
            # failures, but require a current qa_input_digest for project passes.
            self.human[aspect] = "pending" if self.args.project and status == "pass" else status

    def external_reports(self):
        requested = {name: getattr(self.args, name + "_report") for name in ("audio", "asset", "semantic")
                     if getattr(self.args, name + "_report")}
        if not requested:
            return
        if not self.args.report_manifest:
            raise ValueError("External reports require --report-manifest to bind their SHA256 to this final video")
        self.take("report_manifest", self.args.report_manifest)
        binding = object_json(self.args.report_manifest)
        if binding.get("schema") != BINDINGS_SCHEMA:
            raise ValueError(f"Report manifest must use {BINDINGS_SCHEMA}")
        same_record(binding.get("video"), self.inputs["video"], "report-manifest video")
        if "script" in self.inputs:
            same_record(binding.get("script"), self.inputs["script"], "report-manifest script")
        self.bindings = binding
        for name, path in requested.items():
            def validate(name=name, path=path):
                current = self.take(name + "_report", path)
                same_record(binding.get("reports", {}).get(name), current, name + " report")
                getattr(self, name + "_report")(object_json(path))
            self.attempt(name + "_report_invalid", validate)

    def audio_report(self, report):
        if report.get("schema") != "evocut.audio-audit/v1":
            raise ValueError("Unsupported audio report schema")
        expected = report.get("inputs", {})
        same_record(expected.get("video"), self.inputs["video"], "audio report video")
        for key, name in (("reference", "reference_audio"), ("plan", "audio_plan")):
            path = self.bound_file(name, expected[key])
            supplied = getattr(self.args, name)
            if supplied and path.resolve() != supplied.resolve():
                raise ValueError(f"Audio report uses a different {name}")
        checks = report.get("checks")
        required = {"full_decode", "whole_audio_aligned", "tail_retained", "loudness_close_to_reference",
                    "true_peak_below_ceiling", "audio_duration_matches_plan", "video_duration_matches_plan"}
        if (not isinstance(checks, dict) or not required.issubset(checks) or
                any(value is not True for value in checks.values())):
            raise ValueError("Audio report has missing/nonpassing concrete checks")
        levels = report.get("final_levels", {})
        finite(levels.get("integrated_lufs"), "audio report LUFS")
        finite(levels.get("true_peak_dbtp"), "audio report true peak", high=self.args.max_true_peak)
        self.checks["audio_report_bound"] = True

    def asset_report(self, report):
        path = self.bound_file("asset_manifest", report.get("manifest"))
        if self.args.asset_manifest and path.resolve() != self.args.asset_manifest.resolve():
            raise ValueError("Asset report uses a different manifest")
        source = object_json(path)
        self.collect_assets(path)
        declared = source.get("assets", [])
        results = report.get("assets", [])
        if report.get("mode") != "local_media_probe" or report.get("technical_status") != "pass" or report.get("errors") != []:
            raise ValueError("Asset report is not a completed local-media technical pass")
        if len(declared) != len(results) or len(source.get("charts", [])) != len(report.get("charts", [])):
            raise ValueError("Asset report omits manifest entries")
        by_id = {entry.get("id"): entry for entry in results}
        for index, item in enumerate(declared):
            current = self.take(f"asset_{index}", path.parent / item["path"])
            if current["sha256"] != item.get("sha256"):
                raise ValueError("Asset source changed since manifest")
            result = by_id.get(item.get("id"), {})
            if (result.get("observed_sha256") != current["sha256"] or result.get("media_verification") != "pass"
                    or result.get("errors") != [] or not result.get("ffprobe")):
                raise ValueError("Asset report lacks matching source probe evidence")
        schema_check = audit_plan(source, path.parent, schema_only=True)
        if schema_check["errors"]:
            raise ValueError("Current asset manifest fails schema/geometry checks")
        self.checks["asset_report_bound"] = True
        if report.get("human_review", {}).get("failed"):
            self.human["assets"] = "fail"
        else:
            self.human["assets"] = "pending"  # Per-source checks are not final-frame review.

    def semantic_report(self, report):
        if report.get("schema_version") != 1:
            raise ValueError("Unsupported semantic timeline schema")
        audio = self.bound_file("semantic_audio", report.get("audio"))
        transcript = self.bound_file("semantic_transcript", report.get("transcript"))
        if not self.args.semantic_spec:
            raise ValueError("Semantic report requires --semantic-spec for deterministic recomputation")
        expected = build_timeline(transcript, audio, object_json(self.args.semantic_spec),
                                  report["duration"], report["fps"])
        for key in ("cues", "events", "cuts", "qa_samples", "technical"):
            if report.get(key) != expected[key]:
                raise ValueError(f"Semantic report differs from current inputs: {key}")
        if expected["technical"]["status"] != "pass":
            for cue in expected["cues"]:
                if cue["status"] != "aligned":
                    self.issue("semantic_cue_pending", cue["id"], "pending", cue.get("start"), cue.get("end"))
        if not self.manifest or report["audio"]["sha256"] != self.manifest["audio"]["sha256"]:
            raise ValueError("Semantic audio must be the hash-bound final-audio artifact in --evidence-manifest")
        if not self.manifest.get("asr") or report["transcript"]["sha256"] != self.manifest["asr"]["report"]["sha256"]:
            raise ValueError("Semantic transcript must be the bound executed-ASR report, not an unattested pairing")
        self.checks["semantic_report_bound"] = True
        self.observations["semantic_duration_seconds"] = report["duration"]
        self.observations["semantic_fps"] = report["fps"]
        self.human["semantics"] = "pending"

    def run_local(self):
        video = Path(self.inputs["video"]["path"])
        info = probe(video)
        videos = [stream for stream in info.get("streams", []) if stream.get("codec_type") == "video"]
        audios = [stream for stream in info.get("streams", []) if stream.get("codec_type") == "audio"]
        duration = float(info.get("format", {}).get("duration", 0))
        finite(duration, "duration", low=0.000001)
        if len(videos) != 1:
            raise ValueError("Expected exactly one video stream")
        expected_audio = 0 if self.args.type == "silent" else 1
        if len(audios) != expected_audio:
            raise ValueError(f"{self.args.type} requires {expected_audio} audio stream(s); found {len(audios)}")
        self.observations.update(duration_seconds=duration, video_streams=len(videos), audio_streams=len(audios),
                                 width=videos[0].get("width"), height=videos[0].get("height"))
        if "semantic_duration_seconds" in self.observations:
            numerator, denominator = videos[0]["avg_frame_rate"].split("/")
            fps = float(numerator) / float(denominator)
            if abs(self.observations["semantic_duration_seconds"] - duration) > .1 or abs(self.observations["semantic_fps"] - fps) > .001:
                raise ValueError("Semantic timeline duration/fps does not match final video")
        self.checks["stream_contract"] = True
        black = detect_black_and_decode(video)
        self.checks["full_decode"] = True
        self.checks["black_frame_candidates_absent"] = not black
        for event in black:
            start = re.search(r"black_start:([\d.]+)", event)
            end = re.search(r"black_end:([\d.]+)", event)
            self.issue("black_frame_candidate", "Near-black interval needs inspection; not automatically excused",
                       "error", float(start[1]) if start else None, float(end[1]) if end else None)
        if audios:
            levels = meter(video)
            self.observations["levels"] = levels
            self.checks["true_peak_below_ceiling"] = levels["true_peak_dbtp"] <= self.args.max_true_peak
            if not self.checks["true_peak_below_ceiling"]:
                self.issue("true_peak_exceeded", f"True peak {levels['true_peak_dbtp']} dBTP exceeds {self.args.max_true_peak}")
            if self.manifest:
                validate_manifest(self.manifest, video, verify_pcm=True)
                self.checks["final_audio_pcm_matches_evidence"] = True
                self.observations["final_audio_pcm_sha256"] = self.manifest["audio"]["decoded_pcm_sha256"]
        if "reference_audio" in self.inputs and "audio_plan" in self.inputs:
            args = SimpleNamespace(video=video, reference=Path(self.inputs["reference_audio"]["path"]),
                                   plan=Path(self.inputs["audio_plan"]["path"]), edl=self.args.edl,
                                   fps=None, width=None, height=None, sample_rate=48000, tail_seconds=1,
                                   min_correlation=.99, sentence_correlation=.985, tail_correlation=.98,
                                   max_lag_ms=2, max_gain_db=.25, max_lufs_delta=.2,
                                   max_true_peak=self.args.max_true_peak)
            result = audit_audio(args)
            self.observations["reference_audio_checks"] = result["checks"]
            self.checks["reference_audio_integrity"] = all(value is True for value in result["checks"].values())
            if not self.checks["reference_audio_integrity"]:
                self.issue("reference_audio_failed", "Local reference-integrity audit failed")
        if "asset_manifest" in self.inputs:
            path = Path(self.inputs["asset_manifest"]["path"])
            result = audit_plan(object_json(path), path.parent)
            self.checks["asset_local_audit"] = result["technical_status"] == "pass"
            for issue in result["errors"]:
                self.issue("asset_local_audit", issue["message"])
        self.checks["local_detectors_completed"] = True

    def use_cached(self):
        if not self.args.technical_report:
            self.issue("local_checks_missing", "--check needs --technical-report from an earlier --run", "pending")
            return
        cached_record = record(self.args.technical_report)
        old = object_json(self.args.technical_report)
        if old.get("schema") != SCHEMA or old.get("detector_version") != DETECTOR_VERSION or old.get("mode") != "run":
            raise ValueError("Technical report must be an original --run result from this detector version")
        if old.get("type") != self.args.type or old.get("policy") != self.policy():
            raise ValueError("Cached report uses another type or threshold policy")
        if old.get("inputs") != self.inputs or old.get("input_digest") != canonical_sha(self.inputs):
            raise ValueError("Technical report is stale or belongs to different inputs")
        concrete = old.get("checks", {})
        required = {"local_detectors_completed", "stream_contract", "full_decode", "black_frame_candidates_absent"}
        if self.args.type != "silent":
            required.add("true_peak_below_ceiling")
        if self.manifest and self.args.type != "silent":
            required.add("final_audio_pcm_matches_evidence")
        if self.args.project:
            required.add("project_source_bound")
        if not required.issubset(concrete) or any(value is not True for value in concrete.values()):
            raise ValueError("Cached report has missing or failed concrete detector checks")
        if old.get("technical_status") != "pass":
            raise ValueError("Cached technical report did not pass")
        self.checks.update(concrete)
        self.observations.update(old.get("observations", {}))
        self.observations["cached_technical_report"] = cached_record
        same_record(cached_record, record(self.args.technical_report), "cached technical report")

    def existing_reviews(self):
        if not self.args.review_manifest:
            return
        current = record(self.args.review_manifest)
        source = object_json(self.args.review_manifest)
        if source.get("schema") != "evocut.qa-human-review/v1":
            raise ValueError("Human review manifest must use evocut.qa-human-review/v1")
        same_record(source.get("video"), self.inputs["video"], "human-reviewed video")
        if "script" in self.inputs:
            same_record(source.get("script"), self.inputs["script"], "human-reviewed script")
        if source.get("qa_input_digest") != canonical_sha(self.inputs):
            raise ValueError("Human review is stale: qa_input_digest differs")
        reviews = source.get("reviews", {})
        for aspect in self.human:
            review = reviews.get(aspect, {})
            status = review.get("status", "pending")
            if status not in ("pass", "fail", "pending"):
                raise ValueError(f"Invalid {aspect} review status")
            if status != "pending" and (review.get("attested_performed") is not True or
                    not all(isinstance(review.get(key), str) and review[key].strip()
                            for key in ("reviewer", "notes", "reviewed_at"))):
                raise ValueError(f"{aspect} review lacks explicit operator attestation")
            if self.human[aspect] != "fail":
                self.human[aspect] = status
        same_record(current, record(self.args.review_manifest), "human review manifest")
        self.review_record = current

    def policy(self):
        return {"min_asr_coverage": self.args.min_asr_coverage, "max_true_peak_dbtp": self.args.max_true_peak,
                "blackdetect": "d=0.08:pix_th=0.1:pic_th=0.99", "silent_requires_no_audio_stream": True}

    def assess(self):
        self.attempt("input_invalid", self.collect)
        if "video" in self.inputs:
            self.attempt("source_binding_invalid", self.collect_project)
            self.attempt("evidence_invalid", self.evidence)
            self.attempt("external_report_invalid", self.external_reports)
            self.attempt("local_detector_failed" if self.args.run else "cached_report_invalid",
                         self.run_local if self.args.run else self.use_cached)
            try:
                self.existing_reviews()
            except ERRORS as error:
                self.issue("human_review_invalid", str(error), "warning")
                self.human = {aspect: "fail" if status == "fail" else "pending" for aspect, status in self.human.items()}
        for name, item in list(self.inputs.items()):
            self.attempt("input_changed", lambda name=name, item=item: same_record(item, record(Path(item["path"])), name))
        self.attempt("project_input_changed", self.verify_project_paths)
        if self.args.project and any(i["code"] in ("source_binding_invalid", "project_input_changed", "input_changed")
                                     and i["severity"] == "error" for i in self.issues):
            self.source_binding["status"] = "pending" if "render_receipt" not in self.inputs else "invalid"
            self.checks["project_source_bound"] = False
        technical = ("fail" if any(i["severity"] == "error" for i in self.issues) else
                     "pending" if any(i["severity"] == "pending" for i in self.issues) else "pass")
        human = "fail" if "fail" in self.human.values() else "pending" if "pending" in self.human.values() else "pass"
        eligible = technical == "pass" and human == "pass"
        return {"schema": SCHEMA, "detector_version": DETECTOR_VERSION, "checked_at": now(),
                "mode": "run" if self.args.run else "check", "type": self.args.type, "policy": self.policy(),
                "inputs": self.inputs, "input_digest": canonical_sha(self.inputs), "checks": self.checks,
                "observations": self.observations, "issues": self.issues, "technical_status": technical,
                "human_reviews": self.human, "human_review_status": human, "release_eligible": eligible,
                "human_review_record": self.review_record,
                "approved": False, "approval_written": False, "media_modified": False, "asr_executed": False,
                "source_binding": self.source_binding,
                "project_edit_invalidation": ("integrated; marker preserved, fresh render receipt required"
                                               if self.args.project else "not_bound; --project not supplied"),
                "limits": "First-version technical gate, not perceptual review AI. Reads existing operator attestations only. "
                          "No voice-identity, pronunciation, acting, lip-sync, semantic truth, licensing or visual-quality certification. "
                          "Local JSON records establish freshness/provenance claims, not a cryptographic signer identity. "
                          "Black intervals are conservative candidates; silent means no audio stream. No approval or publish action."}


def html_report(report):
    rows = "".join("<tr>" + "".join("<td>" + html.escape(str(issue.get(key, ""))) + "</td>"
                                     for key in ("severity", "code", "start_seconds", "end_seconds", "message")) + "</tr>"
                   for issue in report["issues"])
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><title>EvoCut QA</title>"
            "<style>body{font:16px system-ui;margin:2rem;max-width:1100px}td,th{padding:.5rem;border:1px solid #ccc}"
            "table{border-collapse:collapse}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>"
            "<h1>EvoCut QA — no approval written</h1><p>Technical: " + html.escape(report["technical_status"]) +
            " · Human review: " + html.escape(report["human_review_status"]) + "</p>"
            "<table><tr><th>Severity</th><th>Issue</th><th>Start (s)</th><th>End (s)</th><th>Detail</th></tr>" + rows +
            "</table><h2>Bound evidence and limits</h2><pre>" + html.escape(json.dumps(report, ensure_ascii=False, indent=2)) +
            "</pre></html>")


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--video", type=Path, required=True)
    result.add_argument("--type", choices=TYPES, required=True)
    result.add_argument("--project", type=Path, help="Require current index.html + final video binding to a successful render receipt")
    result.add_argument("--render-receipt", type=Path, help="Override <project>/.hyperframes/evocut/render-receipt.json; requires --project")
    mode = result.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Default: read hashes and existing evidence only")
    mode.add_argument("--run", action="store_true", help="Run local FFmpeg/FFprobe detectors; never ASR or generation")
    for key in ("script", "evidence-manifest", "technical-report", "report-manifest", "review-manifest", "reference-audio", "audio-plan",
                "audio-report", "asset-report", "asset-manifest", "semantic-report", "semantic-spec", "edl",
                "json-output", "html-output"):
        result.add_argument("--" + key, type=Path)
    result.add_argument("--min-asr-coverage", type=float, default=.90)
    result.add_argument("--max-true-peak", type=float, default=-1)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        finite(args.min_asr_coverage, "min-asr-coverage", 0, 1)
        finite(args.max_true_peak, "max-true-peak", -60, 0)
        if args.run and args.technical_report:
            raise ValueError("--technical-report is only for --check")
        if args.check and (args.json_output or args.html_output):
            raise ValueError("Explicit --check is read-only; omit --check to request an exported inspection report")
        report = Gate(args).assess()
        outputs = [path.resolve() for path in (args.json_output, args.html_output) if path]
        protected = {Path(item["path"]).resolve() for item in report["inputs"].values()}
        protected.update(path.resolve() for path in vars(args).values() if isinstance(path, Path) and path not in (args.json_output, args.html_output))
        if args.project:
            protected.update(path.resolve() for path in (args.project / "index.html",
                             args.project / ".hyperframes" / "evocut" / "qa-invalidated.json",
                             args.project / ".hyperframes" / "evocut" / "render-receipt.json"))
        if len(outputs) != len(set(outputs)) or any(path in protected or path.exists() for path in outputs):
            raise ValueError("Reports need distinct new output paths; never overwrite inputs or existing files")
        for path, content in ((args.json_output, json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"),
                              (args.html_output, html_report(report))):
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("x", encoding="utf-8") as stream:
                    stream.write(content)
        print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
        return 0 if report["release_eligible"] else 3 if report["technical_status"] == "pass" and report["human_review_status"] == "pending" else 2
    except ERRORS as error:
        print(json.dumps({"schema": SCHEMA, "technical_status": "fail", "approved": False,
                          "release_eligible": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
