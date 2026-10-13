import copy
import contextlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.video_qa.audit_asset_plan import (
    REVIEW_FIELDS, asset_audit, audit_plan, chart_audit, chart_sha256, file_sha256, main,
)

DEFAULT_THRESHOLDS = {"max_upscale": 1.25, "aspect_tolerance": .005}


def sample_asset():
    return {"id": "host", "path": "source.mp4", "sha256": "a" * 64,
            "source": {"width": 320, "height": 180},
            "crop": {"x": 0, "y": 0, "width": 320, "height": 180},
            "target": {"width": 320, "height": 180}, "fit": "contain", "in": 0, "out": 1}


def sample_chart():
    return {"id": "chart", "illustrative": False, "unit": "%", "as_of": "2026-09-23",
            "source": {"title": "Example data location, not fetched", "url": "https://example.org/data"},
            "data": [{"label": "A", "value": 5.2}]}


class SchemaTests(unittest.TestCase):
    def test_invalid_manifest_cannot_overwrite_its_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"do not overwrite")
            asset = sample_asset()
            del asset["crop"]
            manifest = root / "plan.json"
            manifest.write_text(json.dumps({"schema_version": 1, "assets": [asset]}))
            with patch("sys.argv", ["audit_asset_plan", str(manifest), "--schema-only", "--output", str(source)]), \
                 contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                main()
            self.assertEqual(caught.exception.code, 2)
            self.assertEqual(source.read_bytes(), b"do not overwrite")

    def test_schema_only_never_touches_media(self):
        with patch("tools.video_qa.audit_asset_plan.probe", side_effect=AssertionError("probe forbidden")), \
             patch("tools.video_qa.audit_asset_plan.file_sha256", side_effect=AssertionError("media read forbidden")):
            report = audit_plan({"schema_version": 1, "assets": [sample_asset()]}, Path("/missing"), True)
        self.assertEqual(report["technical_status"], "schema_pass")
        self.assertEqual(report["readiness"], "pending_media_verification")
        self.assertFalse(report["release_approved"])

    def test_cropped_effective_pixels_and_upscale_warning(self):
        asset = sample_asset()
        asset["crop"] = {"x": 80, "y": 45, "width": 160, "height": 90}
        report = asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)
        self.assertEqual(report["geometry"]["crop_effective_pixels"], 14400)
        self.assertEqual(report["geometry"]["max_upscale"], 2)
        self.assertTrue(any("upscale_warning" in w for w in report["warnings"]))
        custom = asset_audit(asset, Path("."), {**DEFAULT_THRESHOLDS, "max_upscale": 2}, True)
        self.assertFalse(custom["warnings"])

    def test_out_of_bounds_crop_and_invalid_trim_fail(self):
        for values in ({"crop": {"x": 200, "y": 0, "width": 160, "height": 90}}, {"in": 2, "out": 1}):
            asset = {**sample_asset(), **values}
            self.assertEqual(asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)["technical_status"], "fail")

    def test_stretch_is_error_but_cover_reports_retained_pixels(self):
        asset = sample_asset()
        asset.update(target={"width": 180, "height": 320}, fit="stretch")
        stretch = asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)
        self.assertTrue(any("aspect_stretch_risk" in e for e in stretch["errors"]))
        asset["fit"] = "cover"
        cover = asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)
        self.assertFalse(cover["errors"])
        self.assertLess(cover["geometry"]["retained_source_width"], 320)
        self.assertEqual(cover["geometry"]["scale_x"], cover["geometry"]["scale_y"])

    def test_all_human_fields_default_pending(self):
        report = asset_audit(sample_asset(), Path("."), DEFAULT_THRESHOLDS, True)
        self.assertEqual(set(report["human_review"]), set(REVIEW_FIELDS))
        self.assertTrue(all(v["status"] == "pending" for v in report["human_review"].values()))

    def test_human_pass_needs_evidence_and_matching_hash(self):
        asset = sample_asset()
        asset["human_review"] = {"identity": {"status": "pass"}}
        self.assertEqual(asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)["technical_status"], "fail")
        asset["human_review"]["identity"].update(reviewed_by="reviewer", evidence="sheet.png", reviewed_sha256="b" * 64)
        self.assertEqual(asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)["technical_status"], "fail")

    def test_chart_missing_or_invalid_required_values(self):
        for key, value in (("unit", ""), ("as_of", "2026-13-40"), ("source", {}), ("data", [{"label": "x", "value": "42"}]),
                           ("data", [{"label": "x", "value": True}]), ("data", [{"label": "x", "value": float("nan")}] )):
            chart = sample_chart()
            chart[key] = value
            self.assertEqual(chart_audit(chart)["technical_status"], "fail", key)

    def test_illustrative_label_must_explicitly_be_displayed(self):
        chart = sample_chart()
        chart["illustrative"] = True
        self.assertEqual(chart_audit(chart)["technical_status"], "fail")
        chart["display_label"] = {"text": "Illustrative only — not actual market data", "visible": False, "selector": "#label"}
        self.assertEqual(chart_audit(chart)["technical_status"], "fail")
        chart["display_label"]["visible"] = True
        valid = chart_audit(chart)
        self.assertEqual(valid["technical_status"], "pass")
        self.assertEqual(valid["human_review"]["label_visible_in_render"]["status"], "pending")
        chart["display_label"]["text"] = "Annual return"
        self.assertEqual(chart_audit(chart)["technical_status"], "fail")

    def test_chart_source_not_claimed_verified(self):
        report = audit_plan({"schema_version": 1, "charts": [sample_chart()]}, Path("."))
        self.assertEqual(report["technical_status"], "pass")
        self.assertEqual(report["readiness"], "pending_human_review")
        self.assertEqual(report["charts"][0]["source_verification"], "not_fetched_or_fact_checked")

    def test_chart_review_binds_all_chart_data_and_invalidates_changes(self):
        chart = sample_chart()
        binding = chart_sha256(chart)
        chart["human_review"] = {"source_verified": {"status": "pass", "reviewed_by": "reviewer",
                                 "evidence": "review-note.md", "reviewed_sha256": binding}}
        self.assertEqual(chart_audit(chart)["technical_status"], "pass")
        changes = ({"data": [{"label": "A", "value": 6.2}]}, {"unit": "USD"},
                   {"as_of": "2026-09-24"}, {"source": {"title": "Different source", "url": "https://example.org/new"}},
                   {"display_label": {"text": "Changed display label"}})
        for change in changes:
            altered = {**chart, **change}
            result = chart_audit(altered)
            self.assertEqual(result["technical_status"], "fail", change)
            self.assertTrue(any("reviewed_sha256" in error for error in result["errors"]))

    def test_chart_canonical_hash_ignores_object_key_order_but_not_label_visibility(self):
        chart = sample_chart()
        self.assertEqual(chart_sha256(chart), chart_sha256(dict(reversed(list(chart.items())))))
        chart["illustrative"] = True
        chart["display_label"] = {"text": "关系示意", "visible": True, "selector": "#label"}
        binding = chart_sha256(chart)
        chart["display_label"]["visible"] = False
        self.assertNotEqual(chart_sha256(chart), binding)

    def test_duplicate_ids_bad_threshold_and_remote_asset_rejected(self):
        with self.assertRaises(ValueError):
            audit_plan({"schema_version": 1, "assets": [sample_asset(), sample_asset()]}, Path("."), True)
        with self.assertRaises(ValueError):
            audit_plan({"schema_version": 1, "assets": [sample_asset()], "thresholds": {"max_upscale": .5}}, Path("."), True)
        asset = sample_asset()
        asset["path"] = "https://example.org/media.mp4"
        self.assertEqual(asset_audit(asset, Path("."), DEFAULT_THRESHOLDS, True)["technical_status"], "fail")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Local ffmpeg/ffprobe needed for temporary fixture")
class RealMediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.path = cls.root / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=1",
                        "-an", "-c:v", "mpeg4", "-q:v", "8", str(cls.path)], check=True, timeout=30)
        cls.asset = sample_asset()
        cls.asset["sha256"] = file_sha256(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_real_probe_passes_but_readiness_pending(self):
        before = file_sha256(self.path)
        report = audit_plan({"schema_version": 1, "assets": [self.asset]}, self.root)
        self.assertEqual(report["technical_status"], "pass")
        self.assertEqual(report["readiness"], "pending_human_review")
        self.assertEqual(report["assets"][0]["ffprobe"]["fps"], "24/1")
        self.assertEqual(file_sha256(self.path), before)

    def test_source_hash_dimensions_and_duration_mismatch(self):
        for overrides, keyword in (({"sha256": "a" * 64}, "source_hash_mismatch"),
                                   ({"source": {"width": 640, "height": 360}}, "source_dimensions_mismatch"),
                                   ({"out": 1.5}, "trim_out_of_bounds")):
            asset = {**self.asset, **overrides}
            result = asset_audit(asset, self.root, DEFAULT_THRESHOLDS)
            self.assertTrue(any(keyword in e for e in result["errors"]), result)

    def test_explicit_reviews_can_be_ready_for_edit_not_published(self):
        asset = copy.deepcopy(self.asset)
        asset["human_review"] = {field: {"status": "not_applicable", "reviewed_by": "fixture-test",
                                         "evidence": "synthetic test bars", "reason": "no characters in test pattern",
                                         "reviewed_sha256": asset["sha256"]} for field in REVIEW_FIELDS}
        report = audit_plan({"schema_version": 1, "assets": [asset]}, self.root)
        self.assertEqual(report["readiness"], "ready_for_edit")
        self.assertFalse(report["release_approved"])


if __name__ == "__main__":
    unittest.main()
