import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_render_audio as audit


class AudioAuditTest(unittest.TestCase):
    def setUp(self):
        import numpy as np
        self.np = np
        self.sound = np.random.default_rng(10).normal(0, .05, (4800, 2))

    def test_identical_audio_passes(self):
        result = audit.compare(self.sound, self.sound.copy(), 48000)
        self.assertTrue(audit.aligned(result, .99, 2, .25))

    def test_delay_is_measured_and_rejected(self):
        delayed = self.np.concatenate([self.np.zeros((240, 2)), self.sound])[:len(self.sound)]
        result = audit.compare(self.sound, delayed, 48000)
        self.assertAlmostEqual(result["lag_ms"], 5)
        self.assertFalse(audit.aligned(result, .99, 2, .25))

    def test_gain_change_is_rejected(self):
        result = audit.compare(self.sound, self.sound * 2, 48000)
        self.assertAlmostEqual(result["gain_db"], 6.0206, places=3)
        self.assertFalse(audit.aligned(result, .99, 2, .25))

    def test_silence_does_not_certify_retained_speech(self):
        silent = self.np.zeros((4800, 2))
        self.assertFalse(audit.aligned(audit.compare(silent, silent, 48000), .99, 2, .25))

    def test_empty_tail_fails(self):
        result = audit.compare(self.sound, self.sound[:0], 48000)
        self.assertEqual(result["status"], "too_short")

    def test_generic_and_legacy_plan_windows(self):
        shots, cues = audit.bounds({"shots": [{"id": "one", "start": 2, "duration": 3}], "cues": [{"start": 2.2, "end": 4}]}, 7)
        self.assertEqual(shots[0]["end"], 5)
        self.assertEqual(len(cues), 1)
        shots, _ = audit.bounds({"shots": [{"global_start": 1, "duration": 2}]}, 5)
        self.assertEqual(shots[0]["start"], 1)

    def test_out_of_range_or_nan_cues_rejected(self):
        for cue in ({"start": -1, "end": 2}, {"start": 1, "end": 11}, {"start": float("nan"), "end": 2}):
            with self.subTest(cue=cue), self.assertRaises(ValueError):
                audit.bounds({"cues": [cue]}, 10)


if __name__ == "__main__":
    unittest.main()
