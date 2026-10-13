# 案例 / Examples

Three small, reproducible workflows. These are technical examples, not customer productions or AI-generated footage. Complete [setup](PORTABLE-SETUP.md), then run commands from the repository root.

三个可复现的小案例，不冒充客户作品或 AI 生成效果。先完成[安装](PORTABLE-SETUP.md)，下列命令均从仓库根目录执行。

## 1. 片头导出 / Export a title card

**Input / 输入：**仓库自带的 [hello 项目](../examples/hello/index.html)，640×360、2 秒、无声。

![Actual frame from the exported hello example / hello 导出视频的实际画面](../assets/evocut/examples/hello.png)

```sh
node scripts/cli.mjs check examples/hello --json
node scripts/cli.mjs preview examples/hello
```

Review the preview, then stop with `Ctrl+C` and export / 看过预览，按 `Ctrl+C` 停止后导出：

```sh
node scripts/cli.mjs render examples/hello -o renders/hello.mp4
```

**Result / 输出：**`renders/hello.mp4`。该示例已有实际导出与技术 QA 记录；图片是静态成片帧，不是动画播放器。可从这个最小项目了解预览和导出流程，不代表复杂视频的制作水平。

**Agent prompt / 给 Agent 的需求：**

```text
使用仓库的 examples/hello 跑通检查和预览。
先告诉我预览结果，确认后导出 MP4，并给我文件的绝对路径。
```

## 2. 画面与字幕一起剪 / Cut a card and its caption together

**Input / 输入：**[linked-edit 项目](../examples/linked-edit/index.html)，6 秒、三张图文卡片，每张有明确关联的字幕。纯文字示例，不含真人素材、配音或音乐。

**Request / 需求：**删掉第 2–4 秒，中段画面和字幕一起删除，后段一起前移。

| Track / 轨道 | Before / 修改前 | After / 修改后 |
| --- | --- | --- |
| Cards / 图文 | Opening 0–2s · Middle 2–4s · Ending 4–6s | Opening 0–2s · Ending 2–4s |
| Captions / 字幕 | Opening 0–2s · Middle 2–4s · Ending 4–6s | Opening 0–2s · Ending 2–4s |
| Duration / 总时长 | 6s | 4s |

Work on a copy. Use a new directory and plan filename for each run / 在副本上操作，每次选择未使用的目录和计划文件名：

```sh
mkdir -p renders
cp -R examples/linked-edit renders/linked-edit-demo
node scripts/cli.mjs edit plan --project renders/linked-edit-demo \
  --operation cut --range 2:4 --out renders/linked-cut-plan.json

# Dry run: inspect the plan before changing content / 先检查，不修改
node scripts/cli.mjs edit apply renders/linked-cut-plan.json

# After reviewing the plan / 确认计划后执行
node scripts/cli.mjs edit apply renders/linked-cut-plan.json --apply
node scripts/cli.mjs timeline renders/linked-edit-demo --json
```

The apply result includes `receipt`. To undo, replace the placeholder with that exact receipt path / 执行结果会返回 `receipt`，把下面的占位符替换为该回执的完整路径：

```sh
node scripts/cli.mjs edit undo /absolute/path/to/receipt.json --apply
```

**Verified / 已验证：**对该示例的临时副本，实际生成计划、执行剪辑、核对时长和字幕前移、撤销后逐字节还原源文件。此案例验证剪辑操作，不是已审片的动画成片；没有音频，因此不声称验证了音画同步。适配器目前只验证引擎 0.8.81 的受支持结构。

**Agent prompt / 给 Agent 的需求：**

```text
复制 examples/linked-edit 到新的工作目录，删除第 2–4 秒。
图文和关联字幕一起处理，先给我计划，确认后应用。
核对总时长从 6 秒变成 4 秒，并保留撤销回执。
```

## 3. 导出后检查 / Check the actual MP4

**Input / 输入：**案例 1 导出的 `renders/hello.mp4` 及其项目源文件。先导出，不要拿无关 MP4 替代。

```sh
node scripts/cli.mjs qa --project examples/hello --video renders/hello.mp4 \
  --type silent --run --json-output renders/hello-qa.json
```

**Result / 输出：**`renders/hello-qa.json`，包含源文件绑定、解码、流信息和黑帧候选等技术检查。

下面是 hello 历史验收记录的字段摘录，不是每次执行都保证得到的结果 / Selected fields from the recorded hello run, not a promised result for every run:

```json
{
  "technical_status": "pass",
  "human_review_status": "pending",
  "approved": false
}
```

Exit `3` can indicate pending required review, not an encoding failure. Technical success does not approve visual quality, acting, pronunciation or licensing.

退出码 `3` 可以表示仍需人工审核，不等于编码失败。技术通过不代表画面、表演、读音或素材授权均已通过。[完整 QA 规则 →](../tools/video_qa/QUALITY_GATE.md)

**Agent prompt / 给 Agent 的需求：**

```text
检查刚导出的 hello.mp4 是否与当前项目匹配，能否完整解码，有没有黑帧候选。
给我报告路径，区分技术检查结果和仍需人工确认的项目，不要自动发布。
```
