# FlowImage 变更后验证审计报告

审计日期：2026-06-27
审计对象：`flow-image` monorepo，分支 `feature/flow-image`
审计类型：变更后验证审计（核对最小化 M1/M5 + 代码审计 F3 的落地是否正确、是否引入回归、剩余项现状）
基线：`2026-06-27-flow-image-minimization-audit.md`（M1–M6）与 `2026-06-27-flow-image-code-audit.md`（F1–F7）

## 摘要

本轮代码改动已对照真实代码逐一核验：**M1（删 legacy 双模式）、M5（/current 只返回摘要）、F3（不再泄露/依赖服务端本地路径）三项均已正确、彻底落地，且自洽、无回归。** 全量测试 26 个通过。顺带还修掉了代码审计的 F7（示例码占位符化）并清理了一处死代码。剩余项（M2/M3/M4/M6、F1/F2）状态与开发者自述一致，属已知的后续/取舍项，非回归。结论：**这轮减法是干净的，可以接受。**

## 已验证修复

### M1 删除 Legacy 本地模式 —— 已彻底完成

后端、MCP bridge、前端、配置、测试全链路只剩 Pair 模式：

- `sessions.mjs`：`requireSessionSecret`、`allowLegacySecret`、`getSecret`、bridge-token 创建分支全部移除；`requireSessionAccess` 仅 `allowPairCode`/`allowDeviceToken`，无凭据则 401（`sessions.mjs:24-60`）；`POST /api/sessions` 必须带 pair code（`sessions.mjs:72-83`）。
- `store.mjs`：`createSession` 强制 `pairId`（`store.mjs:59-60`），单一 `viewer_url`（无 `?secret=`，`store.mjs:67`），单一存储路径（`sessionDirFor` 只走 pair 路径，`store.mjs:51-53`）；legacy `sessionDir`/`getSession` 已删。
- `config.mjs`：`bridgeToken`、`DEFAULT_TTL_HOURS` 移除，仅剩 port/bindHost/publicBaseUrl/dataDir/now（`config.mjs:10-24`）。
- `annotations.mjs`：移除 `requireSessionSecret` 引入与 legacy `GET .../ready` 端点。
- `files.mjs:22-25`、`screenshots.mjs:20`：调用处去掉 `allowLegacySecret`。
- bridge `backend-client.mjs`：删 `bridgeToken`、`readyAnnotations`、上传不再传 `session_secret`；`index.mjs:26` 工具入参去掉 `session_secret`；`publish.mjs` 不再返回 `session_secret`。
- `ids.mjs`：删除已无人引用的 `makeSessionSecret`（无残留死代码）。
- `app.js`：删 `withSecret` 与 `?secret=` 读取；取图/提交/读会话只用 `X-Pair-Device-Token`（`app.js:110,199,220`）；未配对即回 pair home（`app.js:209-217`）。
- 残留静态扫描：`session_secret`/`X-Session-Secret`/`BRIDGE_TOKEN`/`withSecret` 在**源码中已归零**，仅存在于测试的"断言不存在"中。

### M5 GET /api/pairs/current 只返回摘要 —— 已完成

`publicPair`（`pairs.mjs:3-13`）现仅返回 `session_id`/`title`/`status`/`updated_at`，不再下发完整 `screenshots[]`/`annotations[]`（也顺带去掉了 `display_name`/`last_seen_at`）。后端测试 `backend.test.mjs` 覆盖该响应。

### F3 服务端本地路径泄露 / 远端取图 —— 已完成（双重保险）

- 源头不再产生：`saveMergedAnnotation` 不再写 `merged_png_path`（`store.mjs:124-130`）。
- 序列化层兜底：新增 `publicAnnotation`（`store.mjs:331-339`）白名单字段；`publicSession`（`store.mjs:327`）与两个 `collectResponse`（`annotations.mjs:28,84`）都经它输出。
- bridge 改为认证拉图：新增 `fetchAnnotationImage(url)`（`backend-client.mjs:62-71`，相对 URL 对 `baseUrl` 解析 + `X-FlowImage-Pair-Code`）；`collect.mjs:33` 用 `fetchAnnotationImage(item.merged_png_url)` 取 bytes，不再 `read(merged_png_path)`。
- 这条链路现在对**远端官方服务**成立（之前必失败）。测试 `backend.test.mjs:201,209` 断言 collect 响应不含 `merged_png_path`。

### 附带改进

- 代码审计 **F7 已修**：`.env.example` 删除 `BRIDGE_TOKEN`，`FLOWIMAGE_PAIR_CODE=<your-generated-pair-code>` 占位符；README 已无 legacy/BRIDGE_TOKEN 残留。
- 无死代码遗留（`makeSessionSecret` 已随 legacy 一并删除）。

## 残留与新发现

### [Low] N1 pair code 生成器与校验正则字母表仍不一致（沿用自交叉验证）

- `ids.mjs:3` 生成器 `ABCDEFGHJKMNPQRSTUVWXYZ23456789` = 31 字符（排除 I/L/O/0/1）；`auth.mjs` 的校验正则 `[A-HJ-NP-Z2-9]` = 32 字符（**含 L**）。`auth.mjs` 本轮未改动。
- 无安全影响（正则是生成集的超集，生成码必过校验；熵仍 ≈119 bit）。建议把正则的 `J-N` 收紧为不含 L，与生成器统一。

### [Info] N2 路径前缀部署的取图解析（极小边界）

- `fetchAnnotationImage` 用根相对解析 `new URL("/files/...", baseUrl)`；若自托管把服务挂在子路径（`https://host/prefix`）下，会解析到 host 根而丢掉 `/prefix`。但后端路由本身也挂在 origin 根（`server.mjs` 的 `/files`、`/s/:id`），即整套应用都假设部署在 origin 根，并非此函数独有问题。结论：保持"部署在 origin 根/子域"即可，无需改代码。

### [Info] 按计划保留、未执行的项（非回归）

- **M2** `rotate-code` 仍在后端实现但产品无 UI 入口（`pairs.mjs:59`、`store.mjs:273-292`）——补按钮或 defer，待业务决定。
- **M3 / M6** pair 级 `revoked_at`（只读不写）、`display_name`、`last_seen_at` 仍保留——后续小减法。
- **M4** collect-by-id 与 collect-latest 并存（`annotations.mjs` + bridge 两路径）——是否收敛为 latest-only 属取舍。
- **F1 / F2**（来自代码审计）：公网写入口仍无应用级限流/配额；pair/device 认证仍是全量文件系统线性扫描。两者不在本轮变更范围，仍为公网上线前的运营加固项。

## 测试证据

- `pnpm test`：**全部通过** —— backend 13 / mcp-bridge 6 / web 7 = **26**（较改前 28：删 3 个 legacy 用例、加 1 个前端负向断言）。
- 关键不变量已被测试钉住：collect 响应无 `merged_png_path`（`backend.test.mjs:201,209`）、publish/collect 结构无 `session_secret`（`backend.test.mjs:134`、`bridge.test.mjs:87`）、前端无 `X-Session-Secret`/`withSecret`（`frontend.test.mjs:39,41`）。

## Coverage

- **Inspected:** 全部 backend route/lib、mcp-bridge（index/backend-client/publish/collect）、web（app.js/index.html/styles.css）、`.env.example`/README、git 改动清单、测试。
- **Executed:** `pnpm test`（26 通过）；针对 legacy 痕迹、`merged_png_path`、`rotate`/`revoked_at`/`display_name`/`last_seen_at`、字母表的静态搜索。
- **Not inspected:** 真实远端 `flow-image.like-water.net` 端到端收图、TLS/反代、Codex Desktop 对 image content 的真实渲染。

## 结论

M1/M5/F3 落地正确、彻底、自洽，未发现回归，测试全绿；并顺手清掉了 F7 与一处死代码。剩余项均为已知的取舍/后续加固（M2/M3/M4/M6、F1/F2）与一条无害的字母表不一致（N1）。**本轮减法可接受。** 公网上线前仍建议优先补 F1（限流/配额）。
