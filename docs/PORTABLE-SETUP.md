# 跨电脑与桌面 Agent 接入 / Portable setup

已经装好，只想让 Agent 调用？直接看 [Agent 快速接入 / Agent quick start](AGENT-QUICKSTART.md)。

EvoCut v0.1.1 增加独立的安装管理入口。它不要求 Codex，也不会自动修改所有
Agent 的技能目录。桌面 Agent 必须能够访问持久项目文件、执行本地命令、加载
技能及其引用，并将图片、视频和音频交给用户检查。仅有聊天或 MCP 客户端而
没有命令执行能力的应用，仍需要额外适配；本版本不提供 MCP Server。

这里的命令从 EvoCut 仓库目录运行；已克隆私有仓库并取得访问权限是前提。

## 1. 先检查，不安装

```sh
npm run evocut -- env doctor --feature render --json
npm run evocut -- env doctor --feature qa --json
npm run evocut -- env doctor --feature asr --json
```

`env doctor` 离线、只读，不调用付费 API，不下载模型、不自动修复、不输出
凭据值。JSON 中列出每项检查和修复建议。退出码 `0` 表示所选前置检查通过，
`2` 表示缺失条件，`1` 表示配置或命令错误。它与引擎已有的 `doctor` 不同：
后者可能检查线上版本，而这里是跨电脑安装的只读检查。

“ready”只表示版本/文件/可执行性或模块可发现性，不证明实际渲染、推理、
完整模板或最终作品质量通过。浏览器自动检查只覆盖已配置或已知缓存位置。
`asr` 要求显式指定本地模型，不自动选用机器上另一个模型。

## 2. 选择需要的功能

| Feature | 准备内容 | 仍需用户提供 |
| --- | --- | --- |
| `core` | 锁定引擎、版本验证和本仓库运行环境 | Node.js 22+、Python 3.11+ |
| `render` | core + 渲染浏览器 | FFmpeg、ffprobe、系统浏览器运行库 |
| `qa` | NumPy、SciPy、Pillow | FFmpeg、ffprobe |
| `asr` | QA 的 faster-whisper 路径：CTranslate2、NumPy、OpenCC | 完整本地模型和 FFmpeg |
| `beats` | music-to-video 的 Python 分析器：librosa、NumPy、soundfile | FFmpeg、ffprobe |

这两项不是所有同类工具的通用安装包：媒体转写技能默认使用的 Parakeet /
whisper.cpp 需另行准备；Studio 的 `evocut beats` 使用 Chrome，不使用上述 Python 分析器。

先看计划，再执行：

```sh
npm run evocut -- env prepare --feature render
npm run evocut -- env prepare --feature render --apply --allow-downloads

npm run evocut -- env prepare --feature qa
npm run evocut -- env prepare --feature qa --apply --allow-downloads
```

没有 `--apply` 时不写文件。执行准备还需 `--allow-downloads` 明确允许软件包/
浏览器下载；这些计划不下载模型权重、不调用付费生成、不自动运行 sudo 或安装
系统 FFmpeg。请用自己系统的包管理器安装主机工具，并让桌面 Agent 的进程
能访问它们，而不只是交互式终端能找到。

默认在仓库 `.venv` 创建 Python 环境，pip 强制要求虚拟环境，拒绝向系统
Python 安装。若显式选择了 Python，安装会使用它；它也必须是虚拟环境。
Python 最低版本改为 3.11，是因为现有 QA 使用 `hashlib.file_digest`，不再
错误地把 3.10 报为支持。

准备输出实时日志到 stderr，最终 JSON 到 stdout。失败会保留已下载的进度，
不会自动降级或切换供应商。`prepared: true` 不等于所有前置条件 ready；例如
ASR 包装好但没配置模型时，仍返回 `2`。Python 依赖当前使用有界版本范围，
还不是跨平台的完整哈希锁；请勿声称安装结果逐字节可复现。

## 3. 统一指定 Python、浏览器和模型

```sh
# 先预览，确认路径后再加 --apply。
npm run evocut -- env init --python /absolute/venv/bin/python
npm run evocut -- env init --python /absolute/venv/bin/python --apply
npm run evocut -- env init --asr-model /absolute/models/faster-whisper-small --apply
```

支持 `--python`、`--browser`、`--asr-model`。配置保存在选定 `EVOCUT_HOME`
下的 `host.json`，默认是当前仓库 `.evocut-home/host.json`，不上传 Git。
不要把它直接复制到路径不同的新电脑，应该在新电脑重新生成。

此配置不接受 API key。优先级是显式环境变量 → 本机配置 → 仓库虚拟环境/
默认检测。包装器把选定的 Python 同时传给 QA 和旧音频适配器，并将解释器
目录放入子进程 PATH。只有通过 `scripts/cli.mjs` 启动的调用获得这些设置；
直接运行旧脚本不保证自动继承。模型需要 `model.bin`、`config.json`、
`tokenizer.json`、`vocabulary.txt`，检查文件存在不代表模型兼容性已验证。

## 4. 接入你自己的桌面 Agent

先获取当前电脑准确的入口：

```sh
npm run evocut -- agent instructions
```

它返回绝对 CLI 路径、技能入口和需要交给 Agent 的说明。把 `launcher` 配置
成该 Agent 的命令执行方式，并让它从视频项目目录运行。这样无需 `npm link`
或占用全局 `evocut` 命令。安装目录要持久保留，不要装到临时聊天沙箱。

core 准备会在本机运行目录的 `bin` 中建立专用命令链接；包装器只为自己的
子进程优先使用它们，避免辅助脚本误用机器上旧的全局安装。不会修改 shell
启动文件或系统 PATH，遇到未知同名命令文件会拒绝覆盖。

若 Agent 支持 SKILL.md 目录，明确给出它的技能目录：

```sh
npm run evocut -- agent install --skills-dir /absolute/agent/skills
npm run evocut -- agent install --skills-dir /absolute/agent/skills --apply
```

只操作该目录，不自动猜测 Agent 品牌。同名内容默认阻止替换；明确需要替换
时，在审查计划后加 `--replace`，先备份再绑定。输出恢复回执路径：

```sh
npm run evocut -- agent restore --receipt /absolute/receipt.json --apply
```

此方式使用符号链接到已验证的 release 技能，并保留相对引用与兼容别名。
不支持符号链接或不支持 SKILL.md 的 Agent 可先使用 `agent instructions`
指向完整技能树；若应用无法读取外部文件，仍需该应用专门的打包/导入适配。
**本版本不等于已认证兼容所有桌面 Agent。** Windows 只提供诊断/计划，自动
prepare/install 明确拒绝，避免误报已适配。不要用旧 `release bind-skills`
替代本节命令：旧命令仍是多目录兼容入口。

## 5. 验收与能力边界

按 README 的示例执行 check、render 和 QA，再实际检查导出视频。需注意：

- 基础剪辑不需要 Codex；显式调用 Codex 的可选生图适配器仍然需要它，或另接替代服务。
- 商业 API、克隆声音、字体、音效和已有视频素材需要另行配置/迁移。
- 高级字幕、动画等旧 helper 的所有依赖尚未统一覆盖；基础 render ready 不代表 29 组技能全部可用。
- 本阶段未实现后台 Worker、生成服务凭据管理、MCP Server、npm 公开发布或安装包分发。
- macOS 是当前实测平台；Linux 及 Windows 不因出现安装说明而被视为已验证。

These setup commands are checkout-level administration, separate from immutable
production snapshots. Updating the Git checkout updates this bootstrap layer;
it does not replace the active engine, global installation or existing projects.
