#!/usr/bin/env python3
"""Offline faster-whisper adapter for qa_evidence.py run-asr.

Extracts the established local-only inference pattern from the graincart v2/v3
audits and expected-character coverage from reddit-us-stocks-2026-09-21/verify.py.
No old project modules are imported: some have project-writing top-level code.
The script is comparison data only, never an ASR prompt. Exactly one ASR pass.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

MODEL_FILES = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def resolve_model(explicit=None, cache=None):
    override = explicit or os.environ.get("EVOCUT_ASR_MODEL_PATH")
    if override:
        model = Path(override).expanduser().resolve()
        if not all((model / name).is_file() for name in MODEL_FILES):
            raise ValueError("Explicit local ASR model directory is incomplete; downloading/fallback prohibited")
        return model
    if cache is None:
        cache = os.environ.get("HF_HUB_CACHE")
        if not cache:
            hf_home = Path(os.environ.get("HF_HOME", Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "huggingface"))
            cache = hf_home / "hub"
    cache = Path(cache).expanduser()
    # Same default family as optional offline ASR; medium is an installed-only
    # fallback, never a silent download or quality-reducing tiny fallback.
    for family in ("small", "medium"):
        root = cache / f"models--Systran--faster-whisper-{family}" / "snapshots"
        for candidate in sorted(root.glob("*")):
            if all((candidate / name).is_file() for name in MODEL_FILES):
                return candidate.resolve()
    raise ValueError("No complete cached faster-whisper small/medium model; install separately or specify --model-dir. No download attempted.")


def environment(model_dir=None, normalization="t2s"):
    dependencies = {name: importlib.util.find_spec(name) is not None for name in ("faster_whisper", "ctranslate2", "numpy")}
    if normalization == "t2s":
        dependencies["opencc"] = importlib.util.find_spec("opencc") is not None
    if not all(dependencies.values()) or not shutil.which("ffmpeg"):
        raise ValueError(f"Missing local dependencies: {dependencies}; ffmpeg={bool(shutil.which('ffmpeg'))}. No installation attempted.")
    model = resolve_model(model_dir)
    return {"dependencies": dependencies, "ffmpeg": shutil.which("ffmpeg"), "model_dir": str(model),
            "model_files": list(MODEL_FILES), "offline_only": True, "downloads": 0, "paid_api_calls": 0}


def read_script(path):
    raw = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() != ".json":
        return raw
    value = json.loads(raw)
    if isinstance(value, dict):
        candidates = [value[key] for key in ("text", "narration", "lines") if key in value]
        if len(candidates) != 1:
            raise ValueError("JSON script must have exactly one text, narration or lines field; alternatively use plain text")
        value = candidates[0]
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(isinstance(line, str) for line in value):
        return "\n".join(value)
    raise ValueError("JSON script must be a string or list of spoken strings, not arbitrary project metadata")


def normalized(text, converter=None):
    if converter:
        text = converter(text)
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def compare(expected, recognized, converter=None):
    left, right = normalized(expected, converter), normalized(recognized, converter)
    if not left:
        raise ValueError("Expected script contains no comparison text")
    matcher = difflib.SequenceMatcher(None, left, right, autojunk=False)
    matched = sum(size for _, _, size in matcher.get_matching_blocks())
    return {"coverage": matched / len(left), "recognized_precision": matched / len(right) if right else 0,
            "alignment_ratio": matcher.ratio(), "matched_characters": matched,
            "expected_characters": len(left), "recognized_characters": len(right),
            "expected_normalized": left, "recognized_normalized": right,
            "differences": [{"kind": kind, "expected": left[a:b], "recognized": right[c:d],
                             "expected_character_range": [a, b], "recognized_character_range": [c, d]}
                            for kind, a, b, c, d in matcher.get_opcodes() if kind != "equal"]}


def transcribe_once(audio, model_dir, language, threads):
    # Set these before importing model/hub libraries, and load a full local path.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import numpy as np
    from faster_whisper import WhisperModel
    decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(audio),
                              "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
                             check=True, capture_output=True)
    pcm = np.frombuffer(decoded.stdout, dtype=np.float32).copy()
    if not pcm.size:
        raise ValueError("Input audio is empty")
    model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=threads,
                         num_workers=1, local_files_only=True)
    segments, info = model.transcribe(pcm, language=None if language == "auto" else language,
        task="transcribe", temperature=0, beam_size=5, word_timestamps=True,
        vad_filter=False, condition_on_previous_text=False, initial_prompt=None)
    rows = [{"start": float(s.start), "end": float(s.end), "text": s.text,
             "avg_logprob": float(s.avg_logprob), "no_speech_prob": float(s.no_speech_prob),
             "words": [{"text": w.word, "start": float(w.start), "end": float(w.end),
                        "probability": float(w.probability)} for w in (s.words or [])]} for s in segments]
    return {"duration": len(pcm) / 16000, "language": info.language,
            "text": "".join(row["text"] for row in rows), "segments": rows,
            "decoded_asr_pcm_sha256": hashlib.sha256(decoded.stdout).hexdigest(),
            "decoded_asr_pcm_format": "f32le/16000Hz/mono"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--script", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--language", default="zh", help="Whisper language code, or auto")
    parser.add_argument("--normalization", choices=("t2s", "unicode"), default="t2s")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--check-env", action="store_true", help="Inspect local dependencies/model files only; no inference")
    args = parser.parse_args()
    try:
        env = environment(args.model_dir, args.normalization)
        if args.check_env:
            print(json.dumps(env, ensure_ascii=False, indent=2))
            return 0
        if not all((args.audio, args.script, args.report)) or not 1 <= args.threads <= 32:
            raise ValueError("--audio, --script and --report required; threads must be 1..32")
        audio, script, report = args.audio.resolve(), args.script.resolve(), args.report.resolve()
        if report.exists() or report in (audio, script):
            raise ValueError("Report must be a new path and must not overwrite input artifacts")
        before = {"audio_sha256": sha256(audio), "script_sha256": sha256(script)}
        expected = read_script(script)
        converter = None
        if args.normalization == "t2s":
            from opencc import OpenCC
            converter = OpenCC("t2s").convert
        compare(expected, "", converter)  # Validate expected text before expensive inference.
        started = datetime.now(timezone.utc).isoformat()
        print(json.dumps({"state": "one_offline_asr_pass", "model_dir": env["model_dir"]}), flush=True)
        raw = transcribe_once(audio, Path(env["model_dir"]), args.language, args.threads)
        comparison = compare(expected, raw["text"], converter)
        if before != {"audio_sha256": sha256(audio), "script_sha256": sha256(script)}:
            raise ValueError("Audio/script changed during recognition; report not written")
        result = {"schema": "evocut.local-asr-coverage/v1", "coverage": comparison["coverage"],
                  "source": {"audio": str(audio), "script": str(script), **before},
                  "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(),
                  "duration": raw["duration"], "language": raw["language"], "transcript": raw["text"],
                  "segments": raw["segments"], "comparison": comparison,
                  "strict_unicode_comparison": compare(expected, raw["text"]),
                  "normalization": args.normalization,
                  "normalization_limit": "No numeric rewriting, homophone repair, prompt hints or source-script conditioning",
                  "environment": env,
                  "settings": {"device": "cpu", "compute_type": "int8", "threads": args.threads,
                               "local_files_only": True, "initial_prompt": None, "temperature": 0,
                               "beam_size": 5, "vad_filter": False, "condition_on_previous_text": False,
                               "word_timestamps": True, "asr_passes": 1},
                  "decoded_asr_pcm_sha256": raw["decoded_asr_pcm_sha256"],
                  "decoded_asr_pcm_format": raw["decoded_asr_pcm_format"],
                  "human_listening_performed": False, "speaker_identity_verified": False,
                  "release_approved": False,
                  "limits": "Coverage is a text-match diagnostic, not absence-of-extra-voices, factual accuracy, naturalness, acting, speaker identity or lip-sync approval. Word times are model estimates."}
        report.parent.mkdir(parents=True, exist_ok=True)
        with report.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        print(json.dumps({"report": str(report), "coverage": result["coverage"], "human_review": "pending"}))
        # Coverage threshold belongs to qa_evidence/approve gate, not this adapter.
        return 0
    except (ValueError, OSError, ImportError, subprocess.SubprocessError, RuntimeError) as error:
        parser.exit(2, f"Local ASR failed: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
