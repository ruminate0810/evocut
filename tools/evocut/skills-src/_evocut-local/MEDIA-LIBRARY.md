# EvoCut 离线素材与固定声音配置

这两模块是本地 EvoCut 扩展，不修改 HyperFrames 安装或原素材 manifest，不调用供应商，不下载模型或媒体，不生成声音。可由启动器分发，也可直接运行：

```sh
node tools/evocut/media-library.mjs help
node tools/evocut/voice-profile.mjs help
```

两模块导出 `async main(argv)`：打印 JSON，返回整数 `0`/`1`，不调用 `process.exit()`。`run(argv)` 返回对象或抛出错误，供程序调用和测试。启动器应设置 `process.exitCode = await main(args)`。

## 配置根与只读输入

- 配置根：`--home DIR` > `EVOCUT_HOME` > `~/.config/evocut`。
- 素材输入：默认 `~/.media/manifest.jsonl`；可用 `--media-home DIR` 指向另一个素材根。
- 加 `--project DIR` 可读取该项目 `.media/manifest.jsonl`。不扫描整个工作区。
- 内置音效：已发布模块优先读取同一稳定快照内的 `skills/media-use/audio/assets/sfx`；源码开发模式只读取仓库的空白素材清单。可指定 `--bundled-dir DIR`，或 `--bundled-dir none` 禁用。开源仓库不分发第三方音效原文件；历史目录保存在 docs/optional-sfx-catalog.json，仅作描述参考，不作为可用素材。
- 标签及导入记录：`<home>/media/library.json`；备份在 `media/backups/`，事务日志在 `media/ledger.jsonl`。
- 声音：`<home>/voices/<id>.json`；备份在 `voices/backups/`，事务日志在 `voices/ledger.jsonl`。

只读命令不会创建配置目录。所有测试都使用临时 fixture，不向真实配置、原索引或真实视频写入。

## 素材检索、标签、显式导入

```sh
evocut assets search 转场 --type sfx
evocut assets search 收银机 --type sfx --project /absolute/project
evocut assets search 硬币
evocut assets search 欢快 --type bgm
evocut assets list --scope bundled
```

支持中英文概念同义词（转场/whoosh、收银机/cash register、硬币/coin、欢快/upbeat 等），也搜索原描述、ID、文件名和中文标签。它是可审计关键词检索，不是声学理解或向量语义模型；查不到就返回空，不生成、不下载、不擅自选用。

结果包含已验证绝对路径、实际 SHA-256、类型、来源索引与行号、许可声明、重复别名和检索分数。按 SHA 合并重复内容；原始记录缺文件、hash 失效、越界/逃逸符号链接、非允许媒体类型会进入 `issues`，不进入可用候选。`verified` 只表示文件路径/普通文件/内容 hash 检查，不代表已成功解码或通过观感听感验收。

许可为 `unknown` 或 `declared-unverified`。缓存命中、bundle 的 CREDITS、manifest 的 license 声明都不是工具作出的授权保证。尤其不要把未知许可当作可商用。

从检索结果显式选择完整 SHA，并使用结果中的 `revision`（初次为 `missing`）：

```sh
evocut assets tag --sha SELECTED_SHA --tags '转场,短促,国风' --expect REVISION
evocut assets untag --sha SELECTED_SHA --expect REVISION
evocut assets import --sha SELECTED_SHA --project /absolute/project --expect REVISION
```

SHA 前缀至少 12 位且必须唯一；`--id` 也可选择唯一原始 ID，歧义时必须用 SHA，或用 `global:ID` / `project:ID` / `bundled:ID`。不会自动选择检索第一项。

导入默认复制到 `assets/evocut/<type>/<sha-prefix>-<basename>`。可用 `--to assets/...` 指定项目内位置，不能越出 `assets`，不能跟随输出符号链接，也不能改变媒体扩展名。首次写入目标期望不存在；覆盖已有目标必须显式传 `--expect-dest OLD_FILE_SHA`，且旧文件会备份。若已存在相同内容，返回 `alreadyPresent: true`，不重复复制。

原全局/项目 manifest 不修改；导入只写自己的状态和指定素材目标。日志记录 prepare/commit、前后 hash 和备份位置。配置写入持排他锁并采用 CAS 与原子替换；跨“素材文件 + sidecar”不是文件系统级原子事务，中断时应查看 ledger/backup，不能把 `incomplete` 当成功。不自动删除陈旧锁或覆盖外部并发改动。

## 静态本地试听目录

```sh
evocut assets catalog --type sfx --output /absolute/new-catalog.html
```

生成无脚本、无远程依赖的静态 HTML，使用 HTML audio/video 控件和安全图片预览。只引用本轮通过验证的白名单媒体路径；不启动文件服务器，不提供任意路径路由。标题/标签/路径均 HTML 转义，设置限制性 CSP，SVG 不内嵌。浏览器可能限制 `file:` 媒体，页面保留文件绝对路径供本机打开。生成快照后源文件若改变，应重新检索、生成目录。

默认拒绝覆盖目录文件；确需替换自己生成的目录时传 `--expect-output OLD_HTML_SHA`。目录可用 query、type、scope、limit 筛选；未包含媒体文件副本，不应拿去公开发布。

## 固定声音档案

没有默认声线，不读取凭证，不推断历史 clone ID。旧克隆声必须由用户明确填写 ID 后注册。示例配置（替换占位值，非可直接合成配置）：

```json
{
  "id": "my-explicit-voice",
  "provider": "explicit-provider",
  "voice_id": "EXPLICIT_VOICE_ID",
  "lang": "zh-CN",
  "speed": 1.0,
  "reference": {"path": "/absolute/user-approved-reference.wav"},
  "pronunciation": [{"from": "AI", "to": "诶艾"}]
}
```

```sh
evocut voice register --file /absolute/profile.json --expect missing
evocut voice list
evocut voice show --id my-explicit-voice
evocut voice validate --id my-explicit-voice
evocut voice update --file /absolute/profile.json --expect PROFILE_REVISION
evocut voice prepare-neutral-request --id my-explicit-voice --text-file /absolute/script.txt --expect PROFILE_REVISION
evocut voice delete --id my-explicit-voice --expect PROFILE_REVISION
```

注册时记录参考文件真实路径/SHA；`reference: null` 用于明确无参考文件的已选 stock voice。validate/prepare 会检查参考文件是否仍匹配。`show/list` 可查看失效档案，list 会标出 `changed-or-missing`。

update 允许在 CAS 下显式修改速度、语言、参考和发音规则，但不能悄悄改变 provider/voice ID；换身份必须注册另一个 ID。prepare 若尝试用 `--provider`、`--voice-id`、`--lang`、`--speed` 改成与档案不同的值，会拒绝，而不是静默替换。

请求带原稿、原稿 SHA、发音替换后的文本、替换清单、档案 revision 和禁换声/禁供应商兜底/禁追加对白约束。发音替换是最长优先、非递归的字面替换，不执行正则、代码或网络，不添加对白段落；规则不能包含句末符号/换行。新增词句是否属于合理发音表达仍需用户审阅替换清单。

这只是中性请求准备，不是付费合成入口，也不承诺外部模型必然遵循文本、发音和声线；供应商认证、可用性、额度、听感和最终 ASR 验收仍是后续单独步骤。配置拒绝任意扩展字段（包括 API 密钥），永远不要把凭证填入这些 JSON。

## 离线测试

```sh
node --test tools/evocut/media-library.test.mjs tools/evocut/voice-profile.test.mjs
```

覆盖中文 4 类同义词、类型过滤、无结果、SHA stale/duplicate、路径和符号链接逃逸、CAS/备份/日志、原 manifest 字节不变、显式导入/幂等、目录注入与覆盖保护、无默认声线、换声拒绝、reference changed、文字转换、CRUD 和零供应商执行。
