import json
import tempfile
import unittest
from pathlib import Path

from tools.video_qa.pre_render_video import resolve_cli


class EvoCutCliTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def package(self, scripts, **extra):
        (self.root / "package.json").write_text(json.dumps({"scripts": scripts, **extra}))

    def test_explicit_wrapper_keeps_engine_and_check_flags(self):
        self.package({"check": "evocut --engine-version 0.8.62 check --strict"})
        result = resolve_cli(self.root)
        self.assertEqual(result["prefix"], ["evocut", "--engine-version", "0.8.62"])
        self.assertEqual(result["check_args"], ["--strict"])
        self.assertEqual(result["engine_package"], "hyperframes")

    def test_bare_wrapper_respects_other_legacy_project_pin(self):
        self.package({"check": "evocut check", "render": "npx hyperframes@0.8.45 render"})
        self.assertEqual(resolve_cli(self.root)["prefix"], ["evocut", "--engine-version", "0.8.45"])

    def test_bare_wrapper_respects_dependency_pin(self):
        self.package({"check": "evocut check"}, devDependencies={"hyperframes": "0.8.62"})
        self.assertEqual(resolve_cli(self.root)["version"], "0.8.62")

    def test_wrapper_without_pin_needs_explicit_helper_version(self):
        self.package({"check": "evocut check"})
        with self.assertRaises(ValueError):
            resolve_cli(self.root)
        self.assertEqual(resolve_cli(self.root, "0.8.62")["version"], "0.8.62")

    def test_wrapper_cannot_override_project_pin_in_qa(self):
        self.package({"check": "evocut --engine-version 0.8.62 check", "render": "npx hyperframes@0.8.45 render"})
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            resolve_cli(self.root)

    def test_explicit_helper_cannot_override_wrapper_pin(self):
        self.package({"check": "evocut --engine-version 0.8.45 check"})
        with self.assertRaisesRegex(ValueError, "conflicts"):
            resolve_cli(self.root, "0.8.62")

    def test_real_upstream_dependency_must_not_float(self):
        self.package({"check": "evocut check"}, dependencies={"hyperframes": "^0.8.62"})
        with self.assertRaisesRegex(ValueError, "exact version"):
            resolve_cli(self.root)

    def test_no_unrelated_npm_or_fake_versioned_wrapper(self):
        for script in ("npx evocut check", "evocut@0.8.62 check", "evocut --engine-version latest check"):
            with self.subTest(script=script):
                self.package({"check": script})
                with self.assertRaises(ValueError):
                    resolve_cli(self.root)

    def test_wrapper_shell_injection_and_misplaced_engine_flags_rejected(self):
        for script in ("evocut check; touch bad", "evocut check $(id)", "evocut check --engine-version=0.8.62", "evocut --resolve-engine check", "evocut --engine-version 0.8.62 check --resolve-engine"):
            with self.subTest(script=script):
                self.package({"check": script})
                with self.assertRaises(ValueError):
                    resolve_cli(self.root)

    def test_hf_only_scripts_keep_real_pinned_command(self):
        self.package({"check": "npx hyperframes@0.8.62 check"})
        self.assertEqual(resolve_cli(self.root)["prefix"], ["npx", "--yes", "hyperframes@0.8.62"])

    def test_conflicting_dependencies_and_scripts_rejected(self):
        self.package({"check": "npx hyperframes@0.8.45 check"}, dependencies={"hyperframes": "0.8.62"})
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            resolve_cli(self.root)


if __name__ == "__main__":
    unittest.main()
