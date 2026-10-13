# Upstream attribution

EvoCut is a presentation layer and agent-operable tooling extension around the HyperFrames video engine by HeyGen, Inc. It is not an official HeyGen product and does not imply HeyGen endorsement.

Upstream: https://github.com/heygen-com/hyperframes

The current installed candidate base is HyperFrames 0.8.81. Use `evocut release status` for the promoted stable snapshot; older exact engine versions remain available for pinned projects. The initial branding base was 0.8.62, upstream commit `d4485b5`; no commit is inferred for later npm packages. The Apache-2.0 license is reproduced in `upstream-LICENSE.txt` from the verified upstream repository. Package metadata, all original license/copyright notices, machine protocols, API hostnames, engine versions and authentication mechanisms remain unchanged. The vendored Acorn parser retains its original package and license files.

Modified JavaScript and HTML contain a prominent modification notice. Each modified installation also contains `EVOCUT-MODIFICATIONS.txt`, and each file has a hash-checked original backup. Original source maps and original hashed browser entry files are retained for attribution and recovery; the browser loads the new branded entry.
