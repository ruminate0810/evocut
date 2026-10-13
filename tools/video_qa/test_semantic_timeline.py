import json
import tempfile
import unittest
from pathlib import Path

from tools.video_qa.semantic_timeline import (
    align_cues, build_timeline, qa_sample_plan, resolve_events, transcript_units,
)
from tools.video_qa.pre_render_video import (
    motion_evidence, resolve_cli, scaled_size, validate_cues,
)
from PIL import Image


class SemanticTimelineTests(unittest.TestCase):
    def units(self, words):
        return transcript_units({"words": words}, 60)

    def test_exact_measured_word_boundaries_not_equal_character_timing(self):
        words = self.units([{"word": "9000", "start": 10, "end": 10.3},
                            {"word": "美元", "start": 10.31, "end": 11.2}])
        cue = align_cues(words, [{"id": "money", "phrase": "9000美元"}])[0]
        self.assertEqual((cue["start"], cue["end"]), (10, 11.2))
        self.assertEqual(cue["timing_precision"], "word_span")

    def test_partial_word_expands_to_supplied_token_not_fake_char_start(self):
        cue = align_cues(self.units([{"text": "foobar", "start": 3, "end": 5}]),
                         [{"id": "partial", "phrase": "bar"}])[0]
        self.assertEqual(cue["start"], 3)
        self.assertTrue(cue["expanded_to_token_boundaries"])

    def test_ambiguity_is_pending_unless_explicit_occurrence(self):
        units = self.units([{"text": "油价", "start": 1, "end": 2},
                            {"text": "油价", "start": 8, "end": 9}])
        self.assertEqual(align_cues(units, [{"id": "oil", "phrase": "油价"}])[0]["reason"], "ambiguous")
        selected = align_cues(units, [{"id": "oil", "phrase": "油价", "occurrence": 2}])[0]
        self.assertEqual(selected["start"], 8)

    def test_explicit_alias_and_window(self):
        units = self.units([{"text": "油價", "start": 1, "end": 2},
                            {"text": "油價", "start": 8, "end": 9}])
        cue = align_cues(units, [{"id": "oil", "phrase": "油价", "aliases": ["油價"], "within": [7, 10]}])[0]
        self.assertEqual(cue["start"], 8)

    def test_unmatched_and_unstated_alias_are_pending(self):
        units = self.units([{"text": "油價", "start": 1, "end": 2}])
        cue = align_cues(units, [{"id": "oil", "phrase": "油价"}])[0]
        self.assertEqual(cue["reason"], "not_found")
        self.assertNotIn("start", cue)

    def test_segment_only_never_claims_word_precision(self):
        units = transcript_units({"segments": [{"text": "one two", "start": 1, "end": 4}]}, 5)
        cue = align_cues(units, [{"id": "two", "phrase": "two"}])[0]
        self.assertEqual(cue["reason"], "only_segment_timing_available")
        coarse = align_cues(units, [{"id": "two", "phrase": "two", "allow_segment_span": True}])[0]
        self.assertEqual((coarse["start"], coarse["end"], coarse["timing_precision"]), (1, 4, "segment_span"))

    def test_invalid_timestamp_fails(self):
        with self.assertRaises(ValueError):
            self.units([{"text": "bad", "start": 5, "end": 4}])

    def test_duplicate_ids_fail(self):
        with self.assertRaises(ValueError):
            align_cues(self.units([{"text": "ok", "start": 1, "end": 2}]),
                       [{"id": "x", "phrase": "ok"}, {"id": "x", "phrase": "ok"}])

    def test_event_offset_and_unknown_cue(self):
        cue = {"id": "x", "status": "aligned", "start": 4.25, "end": 5.5}
        event = resolve_events([cue], [{"id": "show", "cue": "x", "edge": "end", "offset": .1, "duration": 2}], 10)[0]
        self.assertEqual((event["start"], event["end"]), (5.6, 7.6))
        with self.assertRaises(ValueError):
            resolve_events([cue], [{"id": "bad", "cue": "missing"}], 10)
        with self.assertRaises(ValueError):
            resolve_events([cue], [{"id": "bad", "cue": "x", "offset": 99}], 10)

    def test_pending_event_has_no_absolute_time(self):
        event = resolve_events([{"id": "x", "status": "pending"}], [{"id": "e", "cue": "x"}], 10)[0]
        self.assertEqual(event["status"], "pending")
        self.assertNotIn("start", event)

    def test_qa_samples_cut_neighbors_first15_cues_and_last_frame(self):
        points = qa_sample_plan(60, 24, [20], [{"id": "cue", "status": "aligned", "start": 40, "end": 42}])
        frames = {p["frame"] for p in points}
        self.assertTrue({479, 480, 481, 960, 984, 1008, 1439}.issubset(frames))
        self.assertTrue({round(t * 24 / 2) for t in range(31)}.issubset(frames))

    def test_bound_artifacts_change_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            transcript, audio, out = root / "transcript.json", root / "audio.wav", root / "cues.json"
            transcript.write_text(json.dumps({"words": [{"word": "yes", "start": 1, "end": 2}]}))
            audio.write_bytes(b"example audio bytes")
            result = build_timeline(transcript, audio, {"cues": [{"id": "yes", "phrase": "yes"}]}, 5, 24)
            out.write_text(json.dumps(result))
            self.assertEqual(validate_cues(out, 5, 24)["technical"]["status"], "pass")
            self.assertEqual(result["human_semantic_review"]["status"], "pending")
            audio.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                validate_cues(out, 5, 24)
            with self.assertRaises(ValueError):
                build_timeline(transcript, audio, {"cues": [], "expected_audio_sha256": "bad"}, 5, 24)


class PreRenderTests(unittest.TestCase):
    def test_pin_used_not_global(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text(json.dumps({"scripts": {"check": "npx --yes hyperframes@0.8.45 check --strict"}}))
            cli = resolve_cli(root)
            self.assertEqual(cli["prefix"], ["npx", "--yes", "hyperframes@0.8.45"])
            self.assertEqual(cli["check_args"], ["--strict"])
            with self.assertRaises(ValueError):
                resolve_cli(root, "0.8.62")

    def test_no_pin_never_uses_unversioned_npx(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                resolve_cli(Path(tmp))
            self.assertEqual(resolve_cli(Path(tmp), "0.8.62")["version"], "0.8.62")

    def test_unsafe_or_conflicting_scripts_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for scripts in ({"check": "npx hyperframes@0.8.45 check && touch pwned"},
                            {"check": "npx hyperframes@latest check"},
                            {"check": "npx hyperframes@0.8.45 check", "render": "npx hyperframes@0.8.62 render"}):
                (root / "package.json").write_text(json.dumps({"scripts": scripts}))
                with self.assertRaises(ValueError):
                    resolve_cli(root)

    def test_actual_local_cli_version_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "node_modules/.bin").mkdir(parents=True)
            (root / "node_modules/hyperframes").mkdir()
            (root / "node_modules/.bin/hyperframes").write_text("binary")
            (root / "node_modules/hyperframes/package.json").write_text('{"version":"0.8.62"}')
            self.assertEqual(resolve_cli(root)["source"], "project_local_install")

    def test_aspect_ratio_preserved(self):
        self.assertEqual(scaled_size(1920, 1080), (480, 270))
        self.assertEqual(scaled_size(1080, 1920), (270, 480))
        self.assertEqual(scaled_size(1080, 1260), (411, 480))

    def test_static_drama_and_background_motion_never_imply_semantic_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a, b = root / "a.png", root / "b.png"
            Image.new("RGB", (1920, 1080), "black").save(a)
            Image.new("RGB", (1920, 1080), "black").save(b)
            static = motion_evidence([a, b], "drama", "deliberate reaction hold")
            self.assertEqual(static["status"], "declared_static_intent_pending_review")
            self.assertEqual(static["pairs"][0]["analysis_size"], [480, 270])
            Image.new("RGB", (1920, 1080), "white").save(b)
            moving = motion_evidence([a, b], "motion_graphics")
            self.assertEqual(moving["status"], "observed_change")
            self.assertEqual(moving["information_progression"], "pending_human_review")


if __name__ == "__main__":
    unittest.main()
