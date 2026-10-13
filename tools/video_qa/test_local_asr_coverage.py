import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.video_qa.local_asr_coverage import (
    MODEL_FILES, compare, normalized, read_script, resolve_model,
)


class OfflineAsrAdapterTests(unittest.TestCase):
    def test_coverage_is_expected_character_coverage_not_symmetric_ratio(self):
        result = compare("ABCD", "ABC")
        self.assertEqual(result["coverage"], .75)
        self.assertEqual(result["recognized_precision"], 1)
        self.assertEqual(result["differences"][0]["expected"], "d")

    def test_extra_words_are_reported_even_if_expected_coverage_is_full(self):
        result = compare("hello", "hello extra words")
        self.assertEqual(result["coverage"], 1)
        self.assertLess(result["recognized_precision"], 1)
        self.assertTrue(result["differences"])

    def test_normalization_does_not_silently_correct_numbers(self):
        self.assertNotEqual(normalized("9000"), normalized("九千"))
        self.assertEqual(normalized("Ａ, B!"), "ab")
        self.assertEqual(compare("word", "")["coverage"], 0)
        with self.assertRaises(ValueError):
            compare("...", "hello")

    def test_explicit_model_missing_fails_without_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                resolve_model(Path(tmp))

    def test_only_complete_local_cached_model_is_selected(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {}, clear=True):
            root = Path(tmp)
            with self.assertRaises(ValueError):
                resolve_model(cache=root)
            model = root / "models--Systran--faster-whisper-small/snapshots/test-revision"
            model.mkdir(parents=True)
            for name in MODEL_FILES:
                (model / name).write_bytes(b"test fixture")
            self.assertEqual(resolve_model(cache=root), model.resolve())

    def test_plain_text_and_json_lines_supported_but_metadata_not_spoken(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plain, structured = root / "script.txt", root / "script.json"
            plain.write_text("Hello there.")
            self.assertEqual(read_script(plain), "Hello there.")
            structured.write_text(json.dumps(["one", "two"]))
            self.assertEqual(read_script(structured), "one\ntwo")
            structured.write_text(json.dumps({"duration": 3, "shots": []}))
            with self.assertRaises(ValueError):
                read_script(structured)


if __name__ == "__main__":
    unittest.main()
