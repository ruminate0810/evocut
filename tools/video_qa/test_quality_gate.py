"""Temporary-fixture tests; never touch campaigns, models, providers or approvals."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import quality_gate as gate
from qa_evidence import PCM_FORMAT, SCHEMA, audio_pcm_sha256, evidence_digest, record


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg fixtures required")
class QualityGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(prefix="quality-gate-fixtures-")
        cls.media = Path(cls.shared.name)
        for name, audio, color in (("music", True, "blue"), ("silent", False, "green"), ("black", False, "black")):
            command = ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                       f"color=c={color}:s=160x90:r=10:d=2"]
            if audio:
                command += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"]
            command += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
            command += ["-c:a", "aac", "-shortest"] if audio else ["-an"]
            subprocess.run(command + [str(cls.media / f"{name}.mp4")], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="quality-gate-test-")
        self.root = Path(self.temporary.name)
        self.video = self.root / "final.mp4"
        shutil.copyfile(self.media / "music.mp4", self.video)
        self.script = self.root / "script.txt"
        self.script.write_text("Test phrase.\n", encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def save(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def assess(self, kind="music", *extra):
        args = gate.parser().parse_args(["--video", str(self.video), "--type", kind, *map(str, extra)])
        return gate.Gate(args).assess()

    def evidence(self):
        audio = self.root / "audio.wav"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(self.video), "-map", "0:a:0",
                        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(audio)], check=True, capture_output=True)
        image = self.root / "evidence-image.png"
        image.write_bytes(b"Synthetic fixture evidence; not a real human-reviewed image")
        asr = self.save("asr.json", {"coverage": 1.0, "segments": [{"start": .2, "end": 1.2, "text": "Test phrase."}]})
        pcm = audio_pcm_sha256(self.video)
        video_record, audio_record, script_record = record(self.video), record(audio), record(self.script)
        manifest = {"schema": SCHEMA, "video": video_record, "script": script_record,
                    "audio": {**audio_record, "decoded_pcm_sha256": pcm, "pcm_format": PCM_FORMAT},
                    "capture": {"method": "ffmpeg_from_final", "video_sha256": video_record["sha256"]},
                    "artifacts": {"first_screen": record(image), "contact_sheets": [record(image)]},
                    "asr": {"method": "executed_command_with_bound_inputs", "report": record(asr),
                            "source": {"video_sha256": video_record["sha256"], "audio_sha256": audio_record["sha256"],
                                       "audio_pcm_sha256": pcm, "script_sha256": script_record["sha256"]}},
                    "reviews": {"visual": {"status": "pending"}, "listening": {"status": "pending"}}}
        return self.save("evidence.json", manifest), manifest

    def test_music_needs_no_asr_and_pending_never_release_pass(self):
        result = self.assess("music", "--run")
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertEqual(result["human_review_status"], "pending")
        self.assertFalse(result["release_eligible"])
        self.assertFalse(result["approved"])
        self.assertFalse(result["asr_executed"])
        self.assertNotIn("asr_missing", [i["code"] for i in result["issues"]])

    def test_spoken_needs_asr(self):
        for kind in ("narrated", "dialogue"):
            result = self.assess(kind, "--run", "--script", self.script)
            self.assertEqual(result["technical_status"], "pending")
            self.assertIn("asr_missing", [i["code"] for i in result["issues"]])

    def test_spoken_requires_actual_audio(self):
        shutil.copyfile(self.media / "silent.mp4", self.video)
        result = self.assess("narrated", "--run", "--script", self.script)
        self.assertEqual(result["technical_status"], "fail")
        self.assertTrue(any("audio stream" in i["message"] for i in result["issues"]))

    def test_silent_passes_without_audio_or_asr(self):
        shutil.copyfile(self.media / "silent.mp4", self.video)
        result = self.assess("silent", "--run")
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertEqual(result["human_reviews"], {"visual": "pending"})

    def test_missing_file_is_blocking(self):
        self.video.unlink()
        result = self.assess("music")
        self.assertEqual(result["technical_status"], "fail")
        self.assertFalse(result["release_eligible"])

    def test_check_has_no_subprocesses_and_reads_cache(self):
        saved = self.save("technical.json", self.assess("music", "--run"))
        before = sorted(p.name for p in self.root.iterdir())
        with patch("subprocess.run", side_effect=AssertionError("check may not launch a detector")):
            result = self.assess("music", "--check", "--technical-report", saved)
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertEqual(before, sorted(p.name for p in self.root.iterdir()))

    def test_check_without_previous_run_stays_pending(self):
        with patch("subprocess.run", side_effect=AssertionError("unexpected subprocess")):
            result = self.assess()
        self.assertEqual(result["technical_status"], "pending")

    def test_stale_cached_video_is_rejected(self):
        saved = self.save("technical.json", self.assess("music", "--run"))
        with self.video.open("ab") as handle:
            handle.write(b"changed")
        result = self.assess("music", "--technical-report", saved)
        self.assertEqual(result["technical_status"], "fail")
        self.assertIn("cached_report_invalid", [i["code"] for i in result["issues"]])

    def test_report_for_another_video_is_rejected(self):
        report = self.assess("music", "--run")
        other = self.root / "another.mp4"
        shutil.copyfile(self.video, other)
        report["inputs"]["video"] = record(other)
        report["input_digest"] = gate.canonical_sha(report["inputs"])
        result = self.assess("music", "--technical-report", self.save("wrong.json", report))
        self.assertEqual(result["technical_status"], "fail")

    def test_bound_asr_pass_and_changed_script_fail(self):
        path, _ = self.evidence()
        result = self.assess("narrated", "--run", "--script", self.script, "--evidence-manifest", path)
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertTrue(result["checks"]["final_audio_pcm_matches_evidence"])
        self.script.write_text("New dialogue", encoding="utf-8")
        stale = self.assess("narrated", "--run", "--script", self.script, "--evidence-manifest", path)
        self.assertEqual(stale["technical_status"], "fail")

    def test_project_requires_current_digest_attestation_not_legacy_video_review(self):
        evidence, manifest = self.evidence()
        reviews = {aspect: {"status": "pass", "reviewer": "fixture operator", "notes": "fixture only",
                            "reviewed_at": "2026-09-29T00:00:03Z", "attested_performed": True,
                            "evidence_sha256": evidence_digest(manifest)} for aspect in ("visual", "listening")}
        manifest["reviews"] = reviews
        self.save("evidence.json", manifest)
        index = self.root / "index.html"
        index.write_text("<html>fixture source</html>", encoding="utf-8")
        state = self.root / ".hyperframes" / "evocut"
        state.mkdir(parents=True)
        self.save(".hyperframes/evocut/render-receipt.json", {
            "schema": gate.RENDER_RECEIPT_SCHEMA, "project": str(self.root.resolve()),
            "index": record(index), "video": record(self.video), "sourceUnchanged": True,
            "engineVersion": "fixture-1", "renderedAt": "2026-09-29T00:00:02Z"})
        shared = ("--project", self.root, "--script", self.script, "--evidence-manifest", evidence)
        report = self.assess("narrated", "--run", *shared)
        self.assertEqual(report["technical_status"], "pass", report["issues"])
        self.assertEqual(report["human_review_status"], "pending")
        cache = self.save("technical.json", report)
        bound_review = self.save("project-reviews.json", {"schema": "evocut.qa-human-review/v1",
                               "video": record(self.video), "script": record(self.script),
                               "qa_input_digest": report["input_digest"], "reviews": reviews})
        result = self.assess("narrated", *shared, "--technical-report", cache, "--review-manifest", bound_review)
        self.assertTrue(result["release_eligible"], result["issues"])
        self.assertFalse(result["approved"])

    def test_changed_asr_report_is_not_accepted(self):
        path, _ = self.evidence()
        self.save("asr.json", {"coverage": 1.0, "changed": True})
        result = self.assess("dialogue", "--run", "--script", self.script, "--evidence-manifest", path)
        self.assertEqual(result["technical_status"], "fail")

    def test_loose_ok_external_report_cannot_pass(self):
        fake = self.save("fake-audio.json", {"ok": True})
        result = self.assess("music", "--run", "--audio-report", fake)
        self.assertEqual(result["technical_status"], "fail")
        binding = self.save("bindings.json", {"schema": gate.BINDINGS_SCHEMA,
                            "video": record(self.video), "reports": {"audio": record(fake)}})
        result = self.assess("music", "--run", "--audio-report", fake, "--report-manifest", binding)
        self.assertEqual(result["technical_status"], "fail")

    def test_external_report_changed_since_receipt_is_rejected(self):
        fake = self.save("asset.json", {"technical_status": "pass"})
        binding = self.save("bindings.json", {"schema": gate.BINDINGS_SCHEMA,
                            "video": record(self.video), "reports": {"asset": record(fake)}})
        self.save("asset.json", {"technical_status": "pass", "changed": True})
        result = self.assess("music", "--run", "--asset-report", fake, "--report-manifest", binding)
        self.assertEqual(result["technical_status"], "fail")
        self.assertTrue(any("stale" in i["message"] for i in result["issues"]))

    def test_black_interval_has_timed_issue(self):
        shutil.copyfile(self.media / "black.mp4", self.video)
        result = self.assess("silent", "--run")
        self.assertEqual(result["technical_status"], "fail")
        issue = next(i for i in result["issues"] if i["code"] == "black_frame_candidate")
        self.assertEqual(issue["start_seconds"], 0)
        self.assertGreater(issue["end_seconds"], 0)

    def test_only_existing_bound_human_attestation_can_make_eligible(self):
        report = self.assess("music", "--run")
        saved = self.save("technical.json", report)
        reviews = {aspect: {"status": "pass", "reviewer": "fixture operator", "notes": "fixture only",
                            "reviewed_at": "2026-09-29T00:00:00Z", "attested_performed": True}
                   for aspect in ("visual", "listening")}
        path = self.save("reviews.json", {"schema": "evocut.qa-human-review/v1", "video": record(self.video),
                         "qa_input_digest": report["input_digest"], "reviews": reviews})
        before = path.read_bytes()
        result = self.assess("music", "--technical-report", saved, "--review-manifest", path)
        self.assertTrue(result["release_eligible"], result["issues"])
        self.assertFalse(result["approved"])
        self.assertEqual(before, path.read_bytes())
        reviews["listening"]["status"] = "fail"
        self.save("reviews.json", {"schema": "evocut.qa-human-review/v1", "video": record(self.video),
                  "qa_input_digest": report["input_digest"], "reviews": reviews})
        failed = self.assess("music", "--technical-report", saved, "--review-manifest", path)
        self.assertEqual(failed["human_review_status"], "fail")
        self.assertEqual(failed["technical_status"], "pass")
        self.assertFalse(failed["release_eligible"])

    def test_json_html_are_new_files_and_exit_pending(self):
        output, html = self.root / "result.json", self.root / "result.html"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = gate.main(["--video", str(self.video), "--type", "music", "--run",
                              "--json-output", str(output), "--html-output", str(html)])
            blocked = gate.main(["--video", str(self.video), "--type", "music", "--check", "--json-output", str(self.video)])
        self.assertEqual(code, 3)
        self.assertEqual(blocked, 2)
        self.assertTrue(output.is_file() and html.is_file())
        self.assertIn("no approval written", html.read_text())

    def test_stale_human_review_does_not_turn_technical_pass_into_fail(self):
        report = self.assess("music", "--run")
        saved = self.save("technical.json", report)
        reviews = self.save("reviews.json", {"schema": "evocut.qa-human-review/v1", "video": record(self.video),
                            "qa_input_digest": "0" * 64, "reviews": {"visual": {"status": "pass"}}})
        result = self.assess("music", "--technical-report", saved, "--review-manifest", reviews)
        self.assertEqual(result["technical_status"], "pass")
        self.assertEqual(result["human_review_status"], "pending")
        self.assertFalse(result["release_eligible"])

    def test_direct_asset_sources_are_hash_bound_in_cached_report(self):
        asset = self.root / "asset.mp4"
        shutil.copyfile(self.video, asset)
        plan = self.save("assets.json", {"schema_version": 1, "assets": [{"id": "one", "path": str(asset),
                         "sha256": record(asset)["sha256"], "source": {"width": 160, "height": 90},
                         "target": {"width": 160, "height": 90}, "crop": {"x": 0, "y": 0, "width": 160, "height": 90},
                         "in": 0, "out": 2, "fit": "cover"}]})
        report = self.assess("music", "--run", "--asset-manifest", plan)
        self.assertEqual(report["technical_status"], "pass", report["issues"])
        saved = self.save("technical.json", report)
        with asset.open("ab") as handle:
            handle.write(b"modified asset")
        changed = self.assess("music", "--asset-manifest", plan, "--technical-report", saved)
        self.assertEqual(changed["technical_status"], "fail")

    def test_html_escapes_untrusted_report_strings(self):
        result = self.assess("music", "--run")
        result["issues"] = [{"code": "<script>evil()</script>", "message": "<img src=x onerror=evil()>", "severity": "error"}]
        rendered = gate.html_report(result)
        self.assertNotIn("<script>", rendered)
        self.assertNotIn("<img ", rendered)
        self.assertIn("&lt;script&gt;", rendered)

    def test_semantic_report_is_recomputed_and_bound_to_final_asr(self):
        evidence, manifest = self.evidence()
        spec = self.save("semantic-spec.json", {"cues": [{"id": "phrase", "phrase": "Test phrase.",
                                                        "allow_segment_span": True}], "events": []})
        semantic = gate.build_timeline(Path(manifest["asr"]["report"]["path"]), Path(manifest["audio"]["path"]),
                                       json.loads(spec.read_text()), 2, 10)
        report_path = self.save("semantic.json", semantic)
        bindings = self.save("bindings.json", {"schema": gate.BINDINGS_SCHEMA, "video": record(self.video),
                              "script": record(self.script), "reports": {"semantic": record(report_path)}})
        args = ("--run", "--script", self.script, "--evidence-manifest", evidence,
                "--semantic-spec", spec, "--semantic-report", report_path, "--report-manifest", bindings)
        result = self.assess("narrated", *args)
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertEqual(result["human_reviews"]["semantics"], "pending")
        semantic["cues"][0]["start"] += .25
        self.save("semantic.json", semantic)
        self.save("bindings.json", {"schema": gate.BINDINGS_SCHEMA, "video": record(self.video),
                  "script": record(self.script), "reports": {"semantic": record(report_path)}})
        changed = self.assess("narrated", *args)
        self.assertEqual(changed["technical_status"], "fail")
        self.assertTrue(any("differs from current inputs" in i["message"] for i in changed["issues"]))


class ProjectBindingTests(unittest.TestCase):
    """Pure filesystem binding tests; detector results are explicit test stubs."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="quality-project-binding-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "project"
        self.state = self.project / ".hyperframes" / "evocut"
        self.state.mkdir(parents=True)
        self.index = self.project / "index.html"
        self.index.write_text("<html>revision one</html>", encoding="utf-8")
        self.video = self.project / "final.mp4"
        self.video.write_bytes(b"Binding fixture, not claimed playable media")
        self.marker = self.state / "qa-invalidated.json"
        self.receipt = self.state / "render-receipt.json"

    def write(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def invalidation(self, **updates):
        return self.write(self.marker, {"schema": gate.INVALIDATION_SCHEMA, "status": "invalidated",
                          "indexSha256": record(self.index)["sha256"], "at": "2026-09-29T00:00:01Z",
                          "transaction": "test-edit-1", **updates})

    def rendered(self, **updates):
        return self.write(self.receipt, {"schema": gate.RENDER_RECEIPT_SCHEMA, "project": str(self.project.resolve()),
                          "index": record(self.index), "video": record(self.video), "engineVersion": "fixture-1",
                          "renderedAt": "2026-09-29T00:00:02Z", "sourceUnchanged": True, **updates})

    @staticmethod
    def detector_stub(instance):
        instance.checks.update(local_detectors_completed=True, stream_contract=True, full_decode=True,
                               black_frame_candidates_absent=True, true_peak_below_ceiling=True)

    def assess(self, *extra, project=True, run=True, detector=None):
        arguments = ["--video", str(self.video), "--type", "music"]
        if project:
            arguments += ["--project", str(self.project)]
        if run:
            arguments += ["--run"]
        args = gate.parser().parse_args(arguments + list(map(str, extra)))
        with patch.object(gate.Gate, "run_local", detector or self.detector_stub):
            return gate.Gate(args).assess()

    def assert_binding_fail(self, result):
        self.assertEqual(result["technical_status"], "fail", result["issues"])
        self.assertFalse(result["release_eligible"])
        self.assertTrue(any(i["code"] == "source_binding_invalid" for i in result["issues"]))

    def test_video_only_is_explicitly_unbound_and_unchanged(self):
        result = self.assess(project=False)
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertEqual(result["source_binding"]["status"], "not_bound")
        self.assertNotIn("project_index", result["inputs"])

    def test_project_without_receipt_is_pending_binding_but_technical_fail(self):
        result = self.assess()
        self.assert_binding_fail(result)
        self.assertEqual(result["source_binding"]["status"], "pending")
        self.invalidation()
        self.assert_binding_fail(self.assess())

    def test_fresh_receipt_satisfies_marker_without_removing_it_or_human_pass(self):
        self.invalidation()
        self.rendered()
        before = self.marker.read_bytes(), self.receipt.read_bytes(), self.index.read_bytes()
        result = self.assess()
        self.assertEqual(result["technical_status"], "pass", result["issues"])
        self.assertEqual(result["source_binding"]["status"], "bound")
        self.assertTrue(result["source_binding"]["invalidation_satisfied_by_render"])
        self.assertEqual(result["human_review_status"], "pending")
        self.assertFalse(result["release_eligible"])
        self.assertEqual(before, (self.marker.read_bytes(), self.receipt.read_bytes(), self.index.read_bytes()))
        self.assertTrue({"project_index", "render_receipt", "project_invalidation"}.issubset(result["inputs"]))

    def test_older_receipt_fails_even_when_content_hashes_match(self):
        self.invalidation()
        self.rendered(renderedAt="2026-09-29T00:00:00Z")
        self.assert_binding_fail(self.assess())
        self.rendered(renderedAt="2026-09-29T08:00:01+08:00")
        self.assertEqual(self.assess()["technical_status"], "pass")

    def test_current_index_change_rejects_prior_render(self):
        self.rendered()
        self.index.write_text("<html>revision two</html>", encoding="utf-8")
        self.assert_binding_fail(self.assess())

    def test_other_video_path_rejected_even_with_identical_bytes(self):
        other = self.project / "other.mp4"
        shutil.copyfile(self.video, other)
        self.rendered(video=record(other))
        self.assert_binding_fail(self.assess())

    def test_other_video_hash_and_other_project_are_rejected(self):
        self.rendered(video={**record(self.video), "sha256": "f" * 64})
        self.assert_binding_fail(self.assess())
        self.rendered(project=str(self.root))
        self.assert_binding_fail(self.assess())

    def test_receipt_requires_unchanged_source_and_timestamp_with_zone(self):
        for updates in ({"sourceUnchanged": False}, {"sourceUnchanged": "true"},
                        {"renderedAt": "2026-09-29T00:00:02"}, {"schema": "unknown"}):
            with self.subTest(updates=updates):
                self.rendered(**updates)
                self.assert_binding_fail(self.assess())

    def test_invalid_marker_cannot_be_ignored(self):
        self.rendered()
        for updates in ({"at": "not a date"}, {"status": "cleared"},
                        {"indexSha256": "bad"}, {"transaction": ""}):
            with self.subTest(updates=updates):
                self.invalidation(**updates)
                self.assert_binding_fail(self.assess())

    def test_explicit_receipt_override_and_no_project_rejected(self):
        override = self.root / "explicit.json"
        self.rendered().rename(override)
        self.assertEqual(self.assess("--render-receipt", override)["technical_status"], "pass")
        self.assert_binding_fail(self.assess("--render-receipt", override, project=False))

    def test_cached_run_binds_index_receipt_marker_and_remains_readonly(self):
        self.invalidation()
        self.rendered()
        original = self.assess()
        cache = self.write(self.root / "technical.json", original)
        with patch("subprocess.run", side_effect=AssertionError("check is read-only")):
            cached = self.assess("--check", "--technical-report", cache, run=False)
        self.assertEqual(cached["technical_status"], "pass", cached["issues"])
        self.assertEqual(original["input_digest"], cached["input_digest"])
        self.invalidation(transaction="test-edit-2")
        changed = self.assess("--technical-report", cache, run=False)
        self.assertEqual(changed["technical_status"], "fail")
        self.assertNotEqual(changed["input_digest"], original["input_digest"])

    def test_new_render_receipt_invalidates_old_cached_report(self):
        self.rendered()
        original = self.assess()
        cache = self.write(self.root / "technical.json", original)
        self.rendered(renderedAt="2026-09-29T00:00:03Z")
        changed = self.assess("--technical-report", cache, run=False)
        self.assertEqual(changed["technical_status"], "fail")
        self.assertNotEqual(changed["input_digest"], original["input_digest"])
        self.assertEqual(self.assess()["technical_status"], "pass")

    def test_marker_appearance_during_checks_invalidates_result(self):
        self.rendered()

        def detector(instance):
            self.detector_stub(instance)
            self.invalidation()

        result = self.assess(detector=detector)
        self.assertEqual(result["technical_status"], "fail")
        self.assertFalse(result["checks"]["project_source_bound"])
        self.assertIn("project_input_changed", [i["code"] for i in result["issues"]])

    def test_source_replacement_during_checks_invalidates_result(self):
        self.rendered()

        def detector(instance):
            self.detector_stub(instance)
            self.index.write_text("changed while checking", encoding="utf-8")

        result = self.assess(detector=detector)
        self.assertEqual(result["technical_status"], "fail")
        self.assertFalse(result["checks"]["project_source_bound"])

    def test_reports_cannot_create_missing_project_control_files(self):
        for destination in (self.marker, self.receipt):
            with self.subTest(destination=destination), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = gate.main(["--video", str(self.video), "--type", "music", "--project", str(self.project),
                                  "--json-output", str(destination)])
                self.assertEqual(code, 2)
                self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
