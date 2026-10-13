# EvoCut offline ASR coverage adapter

`local_asr_coverage.py` adapts the workspace's established CPU int8/local-only
faster-whisper pattern from the graincart v2/v3 audits and the expected-character
coverage calculation in `reddit-us-stocks-2026-09-21/verify.py`. It does not import
old project modules because some have project-writing top-level code. Historical
ASR scripts that pass topic/number prompts are intentionally not reused.

Local prerequisites: ffmpeg, faster_whisper, ctranslate2, numpy, and opencc for
the default traditional-to-simplified comparison. The model is an existing full
local path: first cached Systran faster-whisper-small, then medium. No automatic
tiny fallback, model download, installation, cloud API, or paid request exists.
An explicit `--model-dir` or `EVOCUT_ASR_MODEL_PATH` must already be complete.

```bash
python3 tools/video_qa/local_asr_coverage.py --check-env

python3 tools/video_qa/local_asr_coverage.py \
  --audio /path/to/final-audio.wav \
  --script /path/to/NARRATION.txt \
  --report /path/to/new-asr-report.json --language zh

python3 tools/video_qa/qa_evidence.py run-asr \
  --manifest /path/to/final-qa/manifest.json -- \
  python3 /absolute/evocut/tools/video_qa/local_asr_coverage.py \
  --audio '{audio}' --script '{script}' --report '{report}' --language zh

python3 -m unittest tools.video_qa.test_local_asr_coverage -v
```

Use `--language en` for English, `auto` for model language detection; optionally
`--normalization unicode` to disable OpenCC. Scripts can be plain UTF-8 text,
JSON lists of spoken strings, or an object with exactly one `text`, `narration`
or `lines` field. Arbitrary project metadata is not concatenated into narration.

The adapter decodes the supplied final audio read-only, runs exactly one unprompted
ASR pass, and retains raw segments/word estimates. Script text is comparison-only,
never fed to the model. It records audio/script hashes before and after, refuses
to overwrite reports or sources, and returns top-level numeric `coverage` for the
QA evidence protocol. A threshold is enforced by the consuming approval gate,
not by retrying ASR until the words look favorable.

Coverage = matched expected characters / expected characters, the same definition
as the existing video verifier. It also reports recognized precision, symmetric
alignment, and differences so extra recognized speech is not hidden by 100%
coverage. Traditional-to-simplified normalization only affects comparison; raw
ASR is retained. Numbers and homophones are not silently rewritten. Word times
are the model's actual estimates, not uniformly interpolated character times.

Audio text matching does not certify voice identity, naturalness, nonverbal extra
voices, acting, lip sync or financial facts. Human review remains pending.
`--check-env` checks local files/dependencies, not recognition quality.

## Verified local smoke test

On 2026-09-23, `--check-env` found faster-whisper 1.2.1 dependencies and the
already-cached small snapshot `536b0662742c02347bc0e980a01041f333bce120`.
A single real inference ran on a 3.08-second excerpt of the existing final mix.
Its output is retained at
`outputs/hyperframes-upgrade-20260923/semantic-demo/asr-smoke/report.json`.
Coverage was **0.8461538462**, not promoted to a passing release verdict and not
retried to force a better transcript. This verifies the executable/protocol/offline
inference path; it does not certify the full video's dialogue. Use full final audio
with `qa_evidence run-asr` for actual delivery QA.
