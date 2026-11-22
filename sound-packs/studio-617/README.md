# Studio SFX: 617 offline sound effects

[Download the sound pack (ZIP, 163 MiB)](https://github.com/ruminate0810/evocut/releases/download/sfx-studio-617-v1/evocut-studio-sfx-617-v1.zip) · [Release and checksum](https://github.com/ruminate0810/evocut/releases/tag/sfx-studio-617-v1) · [Track catalog and credits](catalog.json)

Unzip the download and open **index.html**. Search by sound, category or creator, then press **Play**. All previews play from disk. No account, API key, network connection or EvoCut installation is needed. The FLAC files are also usable directly in an editor.

The 32 categories include typing, clicks, notifications, footsteps, room tone, page turns, impacts, risers and transitions. The archive contains 415 CC0 recordings and 202 original procedural cues; individual licenses and source links are in the catalog. See [the notices](NOTICES.md).

### Import into EvoCut

From an updated EvoCut checkout (Node.js 22+), point the command at the **extracted folder containing index.html and audio/**:

```sh
node scripts/cli.mjs sound-pack ./evocut-studio-sfx-617-v1
node scripts/cli.mjs sound-pack ./evocut-studio-sfx-617-v1 --apply
```

The first command verifies every file against the trusted checkout without writing. The second copies verified tracks into your shared EvoCut media library; repeats skip identical files. Allow about 163 MiB for the extracted folder and up to another 163 MiB for the library. Only import once per user, not once per project.
