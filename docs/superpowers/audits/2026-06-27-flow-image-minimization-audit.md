# FlowImage 最小化审计报告

审计日期：2026-06-27
审计对象：`flow-image` monorepo，分支 `feature/flow-image`
审计类型：最小化 / MVP 范围审计（确认除刚需功能外没有扩大代码面）
审计基准：当前锁定刚需 = 公网 Pair 模式闭环（publish → iPad 标注 → review-gated collect）、多截图/多页、merged-only 输出、accountless pair code
说明：下方 `[High/Medium/Low]` 表示**减法收益 / 优先级**，不是安全严重度。逐条结论已对照真实代码核对。

## 结论摘要

核心代码面是收紧的：配置仅 4 项、MCP 仅 2 个工具且 schema 最小、前端 UI 恰好是必需控件、文件路由单端点带防护、图片回传单一机制、CSS 无冗余。**但存在一处明显超出刚需的扩张（Legacy 本地模式，M1），以及若干小的预置/未接线代码（M2–M6）。** 不能判定为「完全没有扩大」。最大且唯一需要业务拍板的减法是 M1。

## Findings

### [High] M1 Legacy 本地模式与 Pair 模式并存，形成第二套认证/会话面

- **Affected asset:** `apps/backend/src/routes/sessions.mjs`、`apps/backend/src/lib/store.mjs`、`apps/backend/src/routes/annotations.mjs`、`apps/backend/src/lib/config.mjs`、`apps/backend/src/routes/files.mjs`、`apps/backend/src/routes/screenshots.mjs`、`apps/mcp-bridge/src/{backend-client,index}.mjs`、`apps/mcp-bridge/src/tools/{publish,collect}.mjs`、`apps/web/public/app.js`。
- **Evidence:** `sessions.mjs:28-43` `requireSessionSecret` 中间件；`sessions.mjs:47,79-81` `allowLegacySecret` 开关；`sessions.mjs:113-124` bridge token 创建分支；`sessions.mjs:127-133`、`files.mjs:22-26`、`screenshots.mjs:20` 路由上挂 `allowLegacySecret: true`；`store.mjs:75,79-82` `session_secret` 生成 + 双形态 `viewer_url`；`store.mjs:57-60,96-104` 第二套存储路径（`sessionDir`/`sessionDirFor`/`getSession` vs pair 路径）；`annotations.mjs:68-74` 仅 legacy 可用的 `GET .../ready`；`config.mjs:16` `bridgeToken`；`backend-client.mjs:52-56` `readyAnnotations`、`index.mjs:27` 工具入参 `session_secret`、`publish.mjs:38-42` 与 `collect.mjs:10-12` 的双分支文案/逻辑；`app.js:51-63,206-209,231-233` 前端 `?secret=`/`withSecret`/`X-Session-Secret` 分支。全仓 legacy 痕迹约 50 处。
- **Impact:** 两套并行的认证/会话模型，使受保护路由都要同时考虑 secret 与 pair 两条路径，理解面、测试面、出错面接近翻倍。
- **Reproduction or reasoning:** Pair 模式对 localhost 同样可用——本地起后端 → 网页 `Generate Pair Code` → 把 code 填入 `FLOWIMAGE_PAIR_CODE`、`FLOWIMAGE_SERVER_URL` 指向 localhost，即完整本地开发闭环。因此 legacy 的「本地开发」理由已被 pair 覆盖，属冗余面，而非独立刚需。
- **Recommended fix:** 删除 legacy secret 模式：session 创建只经 pair code；会话/文件/标注访问只经 pair code 或 device token。删 `requireSessionSecret`、`allowLegacySecret`、`?secret=`/`getSecret`、`session_secret`、`bridgeToken`、`GET .../ready`、bridge `readyAnnotations` 及工具入参 `session_secret`；`viewer_url`/`publicSession`/`app.js` 随之简化；存储只保留 `dataDir/pairs/...` 单路径。
- **Verification:** 删除后 `pnpm test` 仍通过（需同步删除/改写 legacy 测试用例）；本地以 pair 模式跑通 publish→annotate→collect；`grep -rE "session_secret|X-Session-Secret|BRIDGE_TOKEN|requireSessionSecret|allowLegacySecret|secret="` 痕迹清零。
- **Confidence:** High（冗余事实明确；是否删除属业务取舍，但 MVP 最小化口径下应删）。

### [Medium] M2 rotate-code 功能在产品中无入口

- **Affected asset:** `apps/backend/src/routes/pairs.mjs`、`apps/backend/src/lib/store.mjs`。
- **Evidence:** `pairs.mjs:66-81` `POST /rotate-code` 与 `store.mjs:297-316` `rotatePairCode`（含吊销其它设备的循环）只在后端及一个后端测试 `backend.test.mjs:122-130` 出现；`index.html` 无按钮、`app.js` 无调用、mcp-bridge 不调用。
- **Impact:** 约 35 行后端 + 设备吊销循环 + 测试，服务于一个产品里点不到的路径。
- **Reproduction or reasoning:** 全仓 `rotate` 静态搜索只命中后端路由/store/测试，无任何前端或 bridge 触发。
- **Recommended fix:** 二选一——(a) 若「轮换/泄露恢复」是刚需，补一个最小的 rotate 按钮把它接入产品（改动很小）；(b) 否则整体 defer：删端点、`rotatePairCode`、相关测试，需要时再加。
- **Verification:** 若删，`grep rotate` 无残留且测试更新后通过；若保留，前端手测可触发轮换并使旧 code 失效。
- **Confidence:** High。

### [Low] M3 pair.revoked_at 只读不写（预置未实现能力）

- **Affected asset:** `apps/backend/src/lib/store.mjs`。
- **Evidence:** pair 的 `revoked_at` 仅在 `store.mjs:193` 初始化为 `null`、在 `store.mjs:242,266` 被检查，从未被赋值；只有 device 的 `revoked_at` 在 `store.mjs:307-308`（rotate）被设。无任何「吊销 pair」端点。
- **Impact:** `!pair.revoked_at` 守护一个 MVP 内不可能出现的状态，是预置代码。
- **Recommended fix:** 移除 pair 上的 `revoked_at` 字段及其检查（可随 M2 一并处理）；确有吊销 pair 需求时再加完整能力。device 的 `revoked_at` 保留（被 rotate 真实使用）。
- **Verification:** 删除后认证路径行为不变，`pnpm test` 通过。
- **Confidence:** High。

### [Low] M4 collect 双路径，可收敛为仅 collect-latest

- **Affected asset:** `apps/backend/src/routes/annotations.mjs`、`apps/mcp-bridge/src/backend-client.mjs`、`apps/mcp-bridge/src/tools/collect.mjs`、`apps/mcp-bridge/src/index.mjs`。
- **Evidence:** `annotations.mjs:31-39`（按 id 的 `collect`）与 `annotations.mjs:95-112`（`collect-latest`）两个端点；`backend-client.mjs:52,58,66` 三个方法；`collect.mjs:7-12` 三分支（latest / by-id / legacy-ready）；`index.mjs:26-27` 工具入参 `session_id`/`session_secret`。
- **Impact:** 工具入参 `session_id`/`session_secret`、一个端点、一条 bridge 方法属可省面——`collect-latest` 已覆盖「标完回来收最近一个会话」的评审流。
- **Recommended fix:** 纯 pair 下只保留 `collect-latest`，删 by-id 端点、`collectAnnotations`、`readyAnnotations`（后者随 M1）、工具入参 `session_id`/`session_secret`。若确需按指定会话收取再保留 by-id。
- **Verification:** 收敛后 publish→annotate→collect 流仍通；bridge 测试更新后通过。
- **Confidence:** Medium（by-id 是否需要属取舍）。

### [Low] M5 GET /api/pairs/current 过度返回

- **Affected asset:** `apps/backend/src/routes/pairs.mjs`。
- **Evidence:** `pairs.mjs:3-20` `publicPair` 把每个会话的完整 `screenshots[]` 与 `annotations[]` 一并返回；首页列表（`app.js:276-285`）仅使用 `title`/`status`/`session_id`。
- **Impact:** 过度获取，并把 `merged_png_path` 一起下发（与《代码审计报告》F3 同源的泄露面之一）。
- **Recommended fix:** 列表只返回会话摘要（`session_id`/`title`/`status`/`updated_at`）；完整 `screenshots`/`annotations` 走 `GET /api/sessions/:sessionId` 详情。
- **Verification:** 首页仍正确渲染会话列表；后端测试断言列表项不含 `merged_png_path`/完整数组。
- **Confidence:** High。

### [Low] M6 display_name / last_seen_at 记录但无消费者

- **Affected asset:** `apps/backend/src/lib/store.mjs`、`apps/backend/src/routes/pairs.mjs`。
- **Evidence:** `store.mjs:192-194,201,287,291,303` 持续写入 `display_name`/`last_seen_at`，`pairs.mjs:6,8` 返回；但 `display_name` 在 spec 中自述为「purely local product polish」，`last_seen_at` 无任何失活/清理逻辑读取。
- **Impact:** 轻微的数据面/写入面，无功能消费者。
- **Recommended fix:** 极简口径可删；或在引入（部署级）失活清理时再保留 `last_seen_at`。两者价值都低，优先级最末。
- **Confidence:** Medium。

## No Expansion in Area（确认收紧）

- **配置最小。** `config.mjs:11-28` 仅 `port`/`bindHost`/`publicBaseUrl`/`bridgeToken`（`bridgeToken` 随 M1），无多余旋钮。
- **MCP 工具最小。** `mcp-bridge/src/index.mjs:13-30` 仅 `ui_publish_screenshots`、`ui_collect_annotations` 两个工具，zod schema 精简。
- **前端 UI 恰好是必需控件。** `index.html` 仅 pair 生成/绑定/列表 + prev/next/brush/eraser/color/width/submit/status；无营销文案、无多余面板；`styles.css:137` `#drawCanvas{touch-action:none}` 在位。
- **文件服务单端点 + 防护。** `files.mjs` 一个路由，含 `SAFE_KIND` 白名单 + `.png` 后缀 + 穿越拦截 + `DATA_DIR` 前缀校验，不多不少。
- **图片回传单一机制。** `collect.mjs` 读盘转 base64，没有铺开多套 fallback。

## Docs（文档侧）

- **交叉验证更正：** 当前 canonical 设计文档 `2026-06-27-flow-image-pairing-public-mvp-design.md` 已只列 `GET /api/pairs/current`，没有 `GET /api/pairs/current/sessions`；该冗余只存在于 reviewed 旧稿。
- **TTL 已对齐：** canonical 设计文档的 Session 示例已是 `2026-07-04T10:10:00.000Z`，并明确 public paired sessions expire 7 days after last activity；代码同样使用 7 天 + 标注/收取活动续期（`store.mjs:16,175-180`）。
- 因此当前文档侧不需要为这两点继续扩代码；后续只需保持 reviewed 旧稿不作为实现依据。

## Coverage

- **Inspected:** backend 全部 route/lib（store/config/auth/ids/png）、mcp-bridge（index/backend-client/publish/collect）、web（index.html/app.js/styles.css）、`.env.example`/README、现有测试。
- **Executed:** `pnpm test`（28 全过：backend 16 / mcp-bridge 6 / web 6）；针对 `rotate`、legacy 痕迹、`revoked_at`、`display_name`/`last_seen_at`、collect 方法的静态搜索。
- **Not inspected:** 运行时性能、真实部署形态、未来 SQLite/对象存储迁移后的范围。

## Residual Risk / 建议优先级

最小化口径下建议：**M1 删 legacy（最大收益，需你拍板）→ 顺手清 M3/M5 → M2 与 M4 二选一**（rotate 补按钮或 defer；collect 收敛成只 latest）→ M6 视心情。M1 完成后，认证/会话面将单一化为「pair code（Codex 侧）+ device token（iPad 侧）」，与刚需一一对应，没有第二条路径。

## Implementation Status

2026-06-27 本轮代码改动已执行：

- M1 已完成：删除 legacy `BRIDGE_TOKEN` / `session_secret` / secret URL / legacy ready 路径，后端、MCP bridge、前端都只走 Pair Mode。
- M5 已完成：`GET /api/pairs/current` 只返回 session summary，不再返回完整 screenshots/annotations。
- F3 关联项已完成：public collect 响应不再包含 `merged_png_path`，MCP bridge 改用 `merged_png_url` 认证拉图。
- M2 未执行：`rotate-code` 仍保留，但仍没有产品 UI 入口。
- M3/M6 未执行：pair-level `revoked_at`、`display_name`、`last_seen_at` 仍保留，属于后续小减法。
- M4 未执行：collect-by-id 仍保留，用于精确收取指定 session；是否收敛为 latest-only 仍需业务取舍。
