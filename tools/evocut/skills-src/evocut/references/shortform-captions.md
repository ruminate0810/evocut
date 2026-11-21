# Short-form caption rails

`evocut caption-style list --json` exposes seven original EvoCut treatments
and one versioned local collection. They are not copies of proprietary assets
or a live popularity feed. These are foreground rails, separate from the 35
embedded-caption identities. There are no changes to existing compositions unless
an author explicitly provides a slot and applies cues.

1. Add `<!-- evocut:captions -->` inside the standalone composition root and
   keep track 81 and the `ecs-` namespace free. Canvas and explicit duration
   must match the JSON. For consistent fonts set `--ecs-sans` and
   `--ecs-serif` on the root, with fonts supplied by the host project.
2. Supply a JSON file with canvas, duration in seconds and nonoverlapping cues.
   Word/phrase starts are **absolute source-aligned composition seconds**;
   include desired spaces and punctuation in the text. Do not invent word
   timings from character counts. First word starts at cue.start. Split long
   sentences into multiple readable cues. `lineAfter` is an optional token
   count for the multiline reading break. An optional per-cue `style` overrides
   the command-level default. Trending alternates highlight, frame, word by cue.

```json
{"width":1080,"height":1440,"duration":4,"cues":[
  {"start":0,"end":3.5,"lineAfter":1,"words":[
    {"at":0,"text":"估值指标里，"},{"at":1.4,"text":"有市盈率。"}]}
]}
```

3. Run `evocut caption-style apply --project ./my-video --input cues.json --style highlight`.
   Reapply with another ID to replace just the managed rail. Render/preview the
   project normally. The generated HTML and CSS travel with the composition.
   This is a shared CLI/agent command, not a Studio toolbar button.

### Progressive highlight

New highlights default to **red (#C62828) with white type**. Only the spoken
unit is marked; earlier units stay visible, future units stay hidden in reserved
space. Supply ASR-aligned per-character `words` or optional cue-level `glyphs`
with the same concatenated text. Numbers and initialisms such as `100` and
`PE` can be single timed units. When only phrase timings exist, reveal whole
phrases; do not invent individual onsets. Optional unit `end` clears the marker
during a pause without hiding the text.

For example, a cue can carry a whole phrase and its separately aligned units:

```json
{"start":0,"end":1.6,"words":[{"at":0,"text":"看100元"}],"glyphs":[{"at":0,"text":"看"},{"at":0.3,"text":"100"},{"at":0.8,"end":1.2,"text":"元"}]}
```

    evocut caption-style palette --output picker.html
    evocut caption-style apply --project . --input cues.json --highlight-color '#253D77'

Open the standalone picker to try seven presets or any RGB hex color; it gives
the corresponding apply command. Set `highlightColor` in the cue sheet for a
repeatable project preference. A CLI override wins. Render the edited project
normally; no picker is baked into the output. For the old full-sentence reveal,
use `--highlight-mode sentence`. Existing videos are not retroactively changed.
