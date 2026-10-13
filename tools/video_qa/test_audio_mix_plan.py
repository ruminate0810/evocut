import copy
import json
from pathlib import Path
import tempfile
import unittest

from audio_mix_plan import capture_mix, apply_mix, AudioTags


class MixTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "voice.wav").write_bytes(b"voice")
        (self.root / "music.wav").write_bytes(b"music")
        self.dry = ('<audio id="voice" src="voice.wav" data-duration="4" data-audio-group="dialogue"></audio>'
                    '<audio id="music" src="music.wav" data-duration="4" data-volume=".9"></audio>')
        self.wet = self.dry.replace('data-volume=".9"', 'data-volume=".8" '
            'data-fx-carve="{&quot;enabled&quot;:true,&quot;sources&quot;:[&quot;dialogue&quot;],&quot;strength&quot;:0.45}" '
            'data-fx-chain="{&quot;version&quot;:1,&quot;nodes&quot;:[]}" '
            'data-automation="{&quot;version&quot;:1,&quot;lanes&quot;:[]}"')
        self.plan = capture_mix(self.wet, self.root)

    def test_rebuild_restores_and_is_idempotent(self):
        rebuilt = apply_mix(self.dry, self.root, self.plan)
        self.assertEqual(capture_mix(rebuilt, self.root)["tracks"], self.plan["tracks"])
        self.assertEqual(rebuilt, apply_mix(rebuilt, self.root, self.plan))

    def test_changed_source_blocks(self):
        (self.root / "voice.wav").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "audio changed"):
            apply_mix(self.dry, self.root, self.plan)

    def test_changed_clock_blocks(self):
        with self.assertRaisesRegex(ValueError, "timing changed"):
            apply_mix(self.dry.replace('data-duration="4"', 'data-duration="5"'), self.root, self.plan)

    def test_changed_membership_blocks(self):
        with self.assertRaisesRegex(ValueError, "membership"):
            apply_mix(self.dry.split('</audio>')[0]+'</audio>', self.root, self.plan)

    def test_changed_group_blocks(self):
        with self.assertRaisesRegex(ValueError, "routing"):
            apply_mix(self.dry.replace('dialogue', 'music'), self.root, self.plan)

    def test_incomplete_carve_blocks(self):
        wet = self.dry.replace('data-volume=".9"', 'data-fx-carve="{}"')
        with self.assertRaisesRegex(ValueError, "not a finished mix"):
            capture_mix(wet, self.root)

    def test_nonlocal_source_blocks(self):
        with self.assertRaises(ValueError):
            capture_mix(self.dry.replace('voice.wav', 'https://example.com/voice.wav'), self.root)

    def test_no_certification_in_capture(self):
        self.assertEqual(self.plan['status'], 'captured_not_listening_approved')

    def test_bad_numeric_clock(self):
        with self.assertRaises(ValueError):
            capture_mix(self.dry.replace('data-duration="4"', 'data-duration="NaN"'), self.root)

    def test_bad_saved_clock_blocks(self):
        bad = copy.deepcopy(self.plan)
        bad["tracks"]["music"]["clock"]["data-duration"] = float("nan")
        with self.assertRaisesRegex(ValueError, "Invalid audio clock"):
            apply_mix(self.dry, self.root, bad)

    def test_bad_saved_settings_block(self):
        bad = copy.deepcopy(self.plan)
        bad["tracks"]["music"]["settings"]["data-fx-chain"] = '{"value": NaN}'
        with self.assertRaisesRegex(ValueError, "Non-finite"):
            apply_mix(self.dry, self.root, bad)

    def test_negative_volume_blocks(self):
        with self.assertRaisesRegex(ValueError, "Invalid mix volume"):
            capture_mix(self.dry.replace('data-volume=".9"', 'data-volume="-1"'), self.root)

    def test_bus_does_not_get_partial_capture(self):
        with self.assertRaisesRegex(ValueError, "Submix buses"):
            capture_mix('<hf-audio-group>'+self.wet+'</hf-audio-group>', self.root)


if __name__ == '__main__':
    unittest.main()
