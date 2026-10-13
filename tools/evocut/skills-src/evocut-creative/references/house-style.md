# House Style

Creative direction for compositions when no design spec (`frame.md` or `design.md`) is provided. These are starting points — override anything that doesn't serve the content. When a design spec exists, its brand values take precedence; house-style fills gaps.

## Before Writing HTML

1. **Interpret the prompt.** Generate real content. A recipe lists real ingredients. A HUD has real readouts.
2. **Pick a palette.** Light or dark? Declare bg, fg, accent before writing code.
3. **Pick typefaces.** Run the font discovery script in [typography.md](typography.md) — or pick a font you already know that fits the theme. The script broadens your options; it's not the only source.

## Lazy Defaults to Question

These patterns are AI design tells — the first thing every LLM reaches for. If you're about to use one, pause and ask: is this a deliberate choice for THIS content, or am I defaulting?

- Gradient text (`background-clip: text` + gradient)
- Left-edge accent stripes on cards/callouts
- Cyan-on-dark / purple-to-blue gradients / neon accents
- Pure `#000` or `#fff` (tint toward your accent hue instead)
- Identical card grids (same-size cards repeated)
- Everything centered with equal weight (lead the eye somewhere)
- Banned fonts (see [typography.md](typography.md) for full list)

If the content genuinely calls for one of these — centered layout for a solemn closing, cards for a real product UI mockup, a banned font because it's the perfect thematic match — use it. The goal is intentionality, not avoidance.

## Color

- Match light/dark to content: food, wellness, kids → light. Tech, cinema, finance → dark.
- One accent hue. Same background across all scenes.
- Tint neutrals toward your accent (even subtle warmth/coolness beats dead gray).
- **Contrast:** enforced by `hyperframes check` (WCAG AA). Text must be readable with decoratives removed.
- Declare palette up front. Don't invent colors per-element.

## Background Layer

Use background detail when it gives the content useful depth or context. A
deliberately simple background can support a hero object or a reading hold;
do not add decoration merely to meet an element count.

Ideas to choose from when the scene calls for them:

- Radial glows (accent-tinted, low opacity, breathing scale)
- Ghost text (theme words at 3-8% opacity, very large, slow drift)
- Accent lines (hairline rules, subtle pulse)
- Grain/noise overlay, geometric shapes, grid patterns
- Thematic decoratives (orbit rings for space, vinyl grooves for music, grid lines for data)

Ambient animation is optional supporting atmosphere. Keep stable backgrounds and
intentional reading holds when they improve hierarchy or match the reference.
Do not substitute drifting paper, glow pulses or camera motion for missing subject
action. If the brief specifies one ambient motion, respect that constraint without
inventing a minimum number of decorations. See
[reference-quality, 6–10](../../evocut/references/reference-quality.md).

## Motion

See [motion-principles.md](motion-principles.md) for full rules. Quick: 0.3–0.6s, vary eases, combine transforms on entrances, overlap entries.

## Typography

See [typography.md](typography.md) for full rules. Quick: 700-900 headlines / 300-400 body, serif + sans (not two sans), 60px+ headlines / 20px+ body.

## Palettes

Declare one background, one foreground, one accent before writing HTML.

| Category          | Use for                                       | File                                                          |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Bold / Energetic  | Product launches, social media, announcements | [palettes/bold-energetic.md](../palettes/bold-energetic.md)   |
| Warm / Editorial  | Storytelling, documentaries, case studies     | [palettes/warm-editorial.md](../palettes/warm-editorial.md)   |
| Dark / Premium    | Tech, finance, luxury, cinematic              | [palettes/dark-premium.md](../palettes/dark-premium.md)       |
| Clean / Corporate | Explainers, tutorials, presentations          | [palettes/clean-corporate.md](../palettes/clean-corporate.md) |
| Nature / Earth    | Sustainability, outdoor, organic              | [palettes/nature-earth.md](../palettes/nature-earth.md)       |
| Neon / Electric   | Gaming, tech, nightlife                       | [palettes/neon-electric.md](../palettes/neon-electric.md)     |
| Pastel / Soft     | Fashion, beauty, lifestyle, wellness          | [palettes/pastel-soft.md](../palettes/pastel-soft.md)         |
| Jewel / Rich      | Luxury, events, sophisticated                 | [palettes/jewel-rich.md](../palettes/jewel-rich.md)           |
| Monochrome        | Dramatic, typography-focused                  | [palettes/monochrome.md](../palettes/monochrome.md)           |

Or derive from OKLCH — pick a hue, build bg/fg/accent at different lightnesses, tint everything toward that hue.
