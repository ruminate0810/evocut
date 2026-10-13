# Examples

Three small, reproducible workflows. These are technical examples, not customer productions or AI-generated footage. Complete [setup](PORTABLE-SETUP.md), then run commands from the repository root.

## 1. Export a title card

**Input:** the included [hello project](../examples/hello/index.html), a silent 640×360 composition lasting two seconds.

![Actual frame from the exported hello example](../assets/evocut/examples/hello.png)

```sh
node scripts/cli.mjs check examples/hello --json
node scripts/cli.mjs preview examples/hello
```

Review the preview, then stop with `Ctrl+C` and export:

```sh
node scripts/cli.mjs render examples/hello -o renders/hello.mp4
```

**Output:** `renders/hello.mp4`. This example has a recorded successful export and technical QA result. The image above is a static frame from that export, not a video player. It demonstrates the basic workflow, not complex production quality.

**Prompt for your agent:**

```text
Check and preview examples/hello.
Show me the preview result, then export an MP4 after I approve.
Give me the exported file's absolute path.
```

## 2. Cut a card and its caption together

**Input:** the [linked-edit project](../examples/linked-edit/index.html), a six-second composition with three text cards and explicitly linked captions. It contains no footage, voiceover, or music.

**Request:** remove seconds 2–4, deleting the middle card and caption together and moving the ending forward.

| Track | Before | After |
| --- | --- | --- |
| Cards | Opening 0–2s · Middle 2–4s · Ending 4–6s | Opening 0–2s · Ending 2–4s |
| Captions | Opening 0–2s · Middle 2–4s · Ending 4–6s | Opening 0–2s · Ending 2–4s |
| Duration | 6s | 4s |

Work on a copy. Choose an unused directory and plan filename for each run:

```sh
mkdir -p renders
cp -R examples/linked-edit renders/linked-edit-demo
node scripts/cli.mjs edit plan --project renders/linked-edit-demo \
  --operation cut --range 2:4 --out renders/linked-cut-plan.json

# Dry run: inspect the plan before changing content.
node scripts/cli.mjs edit apply renders/linked-cut-plan.json

# Apply only after reviewing the plan.
node scripts/cli.mjs edit apply renders/linked-cut-plan.json --apply
node scripts/cli.mjs timeline renders/linked-edit-demo --json
```

The apply result includes `receipt`. To undo, use that exact receipt path:

```sh
node scripts/cli.mjs edit undo /absolute/path/to/receipt.json --apply
```

**Verified:** on a temporary copy, planning and application succeeded, duration became four seconds, both ending clips moved forward, and undo restored the source byte-for-byte. This verifies editing operations, not a visually reviewed animation. With no audio, it makes no audio-sync claim. The adapter currently supports verified structures on engine 0.8.81.

**Prompt for your agent:**

```text
Copy examples/linked-edit to a new working directory and remove seconds 2–4.
Keep cards and their captions linked. Show me the plan before applying it.
Verify the duration changes from six seconds to four, and retain the undo receipt.
```

## 3. Check the actual MP4

**Input:** `renders/hello.mp4` exported in example 1 and its matching project source. Export it first; do not substitute an unrelated MP4.

```sh
node scripts/cli.mjs qa --project examples/hello --video renders/hello.mp4 \
  --type silent --run --json-output renders/hello-qa.json
```

**Output:** `renders/hello-qa.json`, including source binding, decoding, stream information, and black-frame candidate checks.

Selected fields from the recorded hello run—not a guaranteed result for every run:

```json
{
  "technical_status": "pass",
  "human_review_status": "pending",
  "approved": false
}
```

Exit `3` can indicate pending required review, not an encoding failure. Technical success does not approve visual quality, acting, pronunciation, or licensing. [Full QA contract →](../tools/video_qa/QUALITY_GATE.md)

**Prompt for your agent:**

```text
Check whether the exported hello.mp4 matches the current project,
decodes fully, and contains black-frame candidates.
Give me the report path. Separate technical results from items requiring
human review. Do not publish anything.
```
