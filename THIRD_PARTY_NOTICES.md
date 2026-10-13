# Third-party notices and asset boundaries

| Item | License/source | Distribution |
| --- | --- | --- |
| HyperFrames code/guidance | HeyGen, Inc.; Apache-2.0; https://github.com/heygen-com/hyperframes | Adapted guidance and guarded patch tools; engine installed separately at exact 0.8.81 |
| Acorn parser | MIT; tools/evocut/vendor/acorn/LICENSE | Vendored with original notice |
| Generated SVG sanitizer bundle | Upstream sanitizeSvg plus LinkeDOM dependency family; see licenses/svg-sanitizer | Unmodified upstream generated implementation; dependency notices supplied separately |
| Hershey SVG stroke fonts | Attribution/restricted-format license embedded in each SVG metadata block | Textual font sources retained with their complete original notices |
| talking-head-recut / vtake-skills | MIT; skill-local NOTICE.md | Adapted source guidance and HTML recipes |
| EvoCut original code, brand SVGs, and hello example screenshot | Apache-2.0 | Included; the screenshot shows the included original title-card composition; no trademark-clearance claim |
| Stock SFX, music and footage | Provider-specific, including Pixabay Content License | Binary media deliberately not redistributed |
| Third-party font files and example screenshots | Individual rights not fully documented in local source | Binary assets deliberately not redistributed |
| GSAP | Separate GSAP license, https://gsap.com/standard-license/ | Vendor binary omitted; examples may reference external/user-installed GSAP |

Apache-2.0 does not relicense third-party assets or grant trademarks. Preserve
the notices above when redistributing. User imports and generated media are
not covered automatically by this source-code license. The dependency lock
does not imply that all engine dependencies use Apache-2.0.

The exported optional-asset omission inventory is in `docs/source-inventory.json`.
Asset manifest entries referring to absent media are not a bundled asset grant.
Supply licensed media explicitly, substitute system fonts where appropriate,
and run missing-file checks before rendering a recipe. No automatic stock-media
download is included. The old SFX catalog descriptions/credits describe source
provenance, not permission to redistribute their original recordings.

No commercial fonts, private footage, voice references, or provider keys are
required to run the included smoke example or core tests.
