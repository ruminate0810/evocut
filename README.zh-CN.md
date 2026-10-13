<div align="center">

<img src="assets/evocut/readme-hero.svg" alt="EvoCut：面向 AI Agent 的视频剪辑工具。创意 → 剪辑 → 检查 → 导出。" width="100%">

### 你掌握创意，让 AI 有工具把剪辑做好。

联动剪辑 · 素材与声音管理 · 可复现的版本 · 有证据的质量检查

**[开始使用](#开始使用)** &nbsp; / &nbsp; **[功能清单](docs/FEATURES.md)** &nbsp; / &nbsp; **[English](README.md)**

`v0.1.1 · 早期版本` &nbsp; `Node.js 22+` &nbsp; `面向 macOS / Linux` &nbsp; `Apache-2.0¹`

</div>

---

## 给 AI 一套剪辑工具，而不只是一条导出命令

EvoCut 将剪辑、素材管理、预览、渲染与质量检查串成一套 AI Agent 可以操作的流程。让画面、字幕和声音保持关联，让每次修改可检查，也让交付的视频能追溯到对应的项目源文件。

**适合与编程 Agent 协作的创作者、开发视频工作流的工程师，以及需要可检查、可复现修改的团队。** EvoCut 提供工具与技能指南；你提供 Agent、创意方向和有使用权的素材。

<table>
<tr>
<td width="50%" valign="top">

### 01 / 剪辑一起动

在支持的片段结构下，剪切或移动镜头时联动字幕、配音、音效和图形。通过冲突检查与撤销，保护已有编辑。

[联动剪辑 →](tools/evocut/SEMANTIC-EDIT.md)

</td>
<td width="50%" valign="top">

### 02 / 素材有章可循

中英文关键词检索、哈希去重、来源信息记录；保留已确认的声音档案和发音规则。

[素材与声音 →](tools/evocut/MEDIA-LIBRARY.md)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 03 / 检查真正交付的文件

导出记录绑定源文件，检查解码、黑帧、音频和提供的转写证据。技术通过与人工确认分别记录。

[质量检查 →](tools/video_qa/QUALITY_GATE.md)

</td>
<td width="50%" valign="top">

### 04 / 更新有退路

在隔离版本中验证引擎、工具和技能，通过后再切换。保留项目版本锁定、完整性校验和回滚路径。

[版本管理 →](tools/evocut/LOCAL-WORKFLOW.md)

</td>
</tr>
</table>

## 从创意到可检查的交付

| 你的方向 | Agent 使用 EvoCut 完成 | 可以检查的结果 |
| :--- | :--- | :--- |
| **确定视频内容** | 按任务使用 29 组视频技能中的相关指南 | 可编辑项目与明确的素材选择 |
| **调整节奏和镜头** | 预览、剪切、移动、撤销支持的关联元素 | 项目内容、修改结果与重做计划 |
| **检查交付质量** | 导出 MP4，执行绑定源文件的技术 QA | 成片、导出记录与检查报告 |
| **保留稳定版本** | 验证候选版本，再有意识地切换 | 版本快照与完整性记录 |

*顶部视觉是工作流示意，不是 Studio 界面截图。技能模板可能需要另行准备有授权的素材和工具。*

## 开始使用

需要 Node.js 22+、npm、Python 3.11+、FFmpeg/ffprobe。渲染还需要受支持的 Chromium 浏览器及平台依赖；尚未验证 Windows。

**要换电脑或接入另一个桌面 Agent？** 先看[跨电脑与 Agent 接入指南](docs/PORTABLE-SETUP.md)：只读环境检测、按功能准备依赖、指定技能目录安装。基础剪辑不要求安装 Codex。

### 1. 安装到独立目录

```sh
git clone https://github.com/ruminate0810/evocut.git
cd evocut
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
export EVOCUT_PYTHON="$PWD/.venv/bin/python"
npm run setup -- --install-engine
```

安装会明确下载锁定的渲染引擎，并在当前目录验证、激活版本。**不会覆盖全局命令、已安装技能或以前的视频。** 仓库保持私有期间，克隆需要访问权限。

### 2. 预览与导出示例

```sh
npm run evocut -- check examples/hello --json
npm run evocut -- preview examples/hello
# 若继续使用同一终端，先停止预览服务。
npm run evocut -- render examples/hello -o renders/hello.mp4
```

### 3. 检查导出结果

```sh
npm run evocut -- qa --project examples/hello --video renders/hello.mp4 \
  --type silent --run --json-output renders/qa.json
```

示例是 **2 秒无声冒烟测试**，不是生成视频效果展示。QA 退出码 `3` 表示技术检查通过、仍需人工审核，不是编码失败。交付前应检查实际 MP4。

<details>
<summary><strong>安装注意事项</strong></summary>

- 引擎位于 `.runtime`，版本快照位于 `.evocut-home`；可通过 `EVOCUT_HOME` 明确指定其他位置。
- 常规剪辑命令不会静默下载或升级引擎。
- 编译器可能联网下载默认字体；新机器首次渲染不保证离线可用。
- 浏览器安装是独立步骤，不包含在 `npm test` 中。
- 尚未发布 npm 包，不要使用 `npx evocut`。如需用 `npm link` 注册全局命令，请先检查原有安装。

</details>

## 能做什么，也说清楚不能做什么

EvoCut 是**剪辑工具包**，不是视频生成模型，也不是自动发布服务。

- 联动剪辑目前面向锁定引擎上受支持的扁平标记片段；复杂结构不会假装处理成功。
- 镜头重做功能生成请求计划，不自动生成或替换素材。
- 技术检查不能证明表演自然、人物一致、口型完美或风格复刻成功；导出记录绑定项目入口，不覆盖所有外部依赖。
- 不附带商业素材包、私人声音、模型密钥或付费合成。素材检索基于关键词，不是对声音内容的理解。
- 不包含财经分析、社交平台发布或账号登录等业务流程。

[完整能力与限制 →](docs/FEATURES.md)

## 已验证的部分

| 2026-10-13 本地验证 | 结果 |
| :--- | :--- |
| Node 回归测试 | **120 项通过** |
| Python 回归测试 | **115 项通过** |
| 技能入口元数据 | **29 组通过校验** |
| 内置示例 | **已导出 MP4，技术 QA 通过** |

这是已记录的 macOS 测试结果，不是实时 CI 状态，也不表示所有模板都已渲染验证。[验证说明 →](docs/VALIDATION.md)

## 继续探索

| 创作与剪辑 | 维护与贡献 |
| :--- | :--- |
| [Agent 技能入口](tools/evocut/skills-src/evocut/SKILL.md) | [版本管理](tools/evocut/LOCAL-WORKFLOW.md) |
| [联动剪辑与撤销](tools/evocut/SEMANTIC-EDIT.md) | [开发与更新](docs/DEVELOPMENT.md) |
| [素材与声音档案](tools/evocut/MEDIA-LIBRARY.md) | [贡献指南](CONTRIBUTING.md) |
| [视频 QA](tools/video_qa/QUALITY_GATE.md) | [安全说明](SECURITY.md) |

```sh
npm test
npm run audit:source
npm run evocut -- --help
```

**CI 尚未启用：** 已保留 [GitHub Actions 模板](docs/ci/github-actions.yml)，首次上传凭据缺少工作流写入权限。Linux CI 尚未执行验证；启用方法见[开发文档](docs/DEVELOPMENT.md)。

---

<div align="center">

**EvoCut · 面向 AI Agent 的视频剪辑工具**

[English](README.md) · [简体中文](README.zh-CN.md) · [参与贡献](CONTRIBUTING.md) · [安全说明](SECURITY.md)

</div>

¹ 使用 Apache-2.0，第三方组件例外见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和[第三方声明](THIRD_PARTY_NOTICES.md)。许可证不改变仓库可见性；package.json 的 `private: true` 用于防止误发布 npm。
