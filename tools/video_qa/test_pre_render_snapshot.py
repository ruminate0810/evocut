import tempfile
import unittest
from pathlib import Path

from tools.video_qa.pre_render_video import natural_key, sample_times, snapshot_inventory
from tools.video_qa.semantic_timeline import qa_sample_plan


class SnapshotContractTest(unittest.TestCase):
    def test_endpoint_cuts_do_not_add_end_of_timeline(self):
        points = qa_sample_plan(3, 24, [0, 3])
        times = sample_times(3, 24, [0, 3], points)
        self.assertEqual(times[-1], round(71 / 24, 9))
        self.assertNotIn(3, times)

    def test_midpoints_are_frame_aligned_and_deduplicated(self):
        points = qa_sample_plan(3, 24, [1.01])
        times = sample_times(3, 24, [1.01], points)
        self.assertEqual(len(times), len(set(times)))
        self.assertTrue(all(abs(time * 24 - round(time * 24)) < 1e-6 for time in times))

    def test_shorter_than_one_frame_has_only_frame_zero(self):
        points = qa_sample_plan(.01, 24)
        self.assertEqual(sample_times(.01, 24, [], points), [0])

    def test_numeric_order_is_stable_beyond_99_snapshots(self):
        paths = [Path(f"frame-{number:02d}-at-{number}s.png") for number in (100, 11, 2, 99)]
        self.assertEqual([path.name for path in sorted(paths, key=natural_key)],
                         [f"frame-{number:02d}-at-{number}s.png" for number in (2, 11, 99, 100)])
        sheets = [Path("contact-sheet-10.jpg"), Path("contact-sheet-2.jpg")]
        self.assertEqual(sorted(sheets, key=natural_key)[0].name, "contact-sheet-2.jpg")

    def test_inventory_accepts_cli_millisecond_rounding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("frame-00-at-0s.png", "frame-01-at-0.042s.png"):
                (root / name).write_bytes(b"filename fixture only")
            self.assertEqual(snapshot_inventory(root, [0, 1 / 24])["status"], "pass")

    def test_equal_count_wrong_timestamp_or_missing_index_does_not_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "frame-00-at-0s.png").write_bytes(b"filename fixture only")
            (root / "frame-02-at-1s.png").write_bytes(b"filename fixture only")
            self.assertEqual(snapshot_inventory(root, [0, .5])["status"], "fail")

    def test_contact_sheets_never_count_as_frames(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "frame-00-at-0s.png").write_bytes(b"filename fixture only")
            (root / "contact-sheet.jpg").write_bytes(b"sheet fixture")
            (root / "contact-sheet-1.jpg").write_bytes(b"sheet fixture")
            self.assertEqual(snapshot_inventory(root, [0])["observed"], 1)

    def test_unrecognized_frame_filename_blocks_coverage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "frame-00-new-format.png").write_bytes(b"filename fixture only")
            self.assertEqual(snapshot_inventory(root, [0])["status"], "fail")


if __name__ == "__main__":
    unittest.main()
