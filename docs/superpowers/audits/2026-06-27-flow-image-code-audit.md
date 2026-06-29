# FlowImage 代码审计报告

审计日期：2026-06-27
审计对象：`flow-image` monorepo，分支 `feature/flow-image`
审计类型：非破坏性代码审计、依赖审计、测试证据采集
审计重点：公网 Pair Mode MVP 的安全性、多租户隔离、文件处理、MCP 回传链路、部署就绪度

## MVP 最小化复核更新

复核输入：`docs/superpowers/audits/2026-06-27-flow-image-minimization-audit.md`。

最小化审计的方向成立：当前最值得优先处理的不是继续扩展公网运营能力，而是先把实现收回到单一 Pair Mode。特别是 legacy `BRIDGE_TOKEN` / `session_secret` 本地模式仍与 public pair 模式并存，形成第二套认证、会话、文件访问和 MCP 分支。若当前目标已经锁定为 FlowImage public pair MVP，应把删除 legacy 模式作为下一轮最大减法收益。

交叉验证结论：

- **接受 M1：** legacy secret 模式确实是最大扩张面。`BRIDGE_TOKEN`、`X-Session-Secret`、`session_secret`、`requireSessionSecret`、`allowLegacySecret`、`?secret=`、`readyAnnotations` 在 backend、MCP bridge、web 和测试中均有残留。
- **接受 M5，并与本报告 F3 合并处理：** `GET /api/pairs/current` 返回完整 `screenshots[]` / `annotations[]`，会把 `merged_png_path` 这类只应内部使用的字段一起带到列表响应。修复 public collect 的本地路径依赖时，应同步把 pair current 缩成 session summary。
- **接受 M3/M6 为低优先级减法：** `pair.revoked_at`、`display_name`、`last_seen_at` 目前更多是预置能力或轻量 polish；可随 legacy/rotate 清理一并处理，不应优先于闭环可用性。
- **M2/M4 需要业务取舍：** `rotate-code` 若作为泄露恢复能力保留，至少应有最小 UI 入口；否则应 defer。`collect-latest` 可以覆盖常见“标完回来收最近一个会话”，但按 `session_id` collect 对多会话并发和跨线程恢复更精确，是否删除取决于是否接受“只收最近返回会话”的 UX。
- **纠正一条文档侧意见：** 当前 canonical 设计文档 `2026-06-27-flow-image-pairing-public-mvp-design.md` 已只列 `GET /api/pairs/current`，没有 `GET /api/pairs/current/sessions`；该冗余只存在于 reviewed 旧稿。TTL 也已在 canonical 文档中对齐为 public session 7 天活动续期。
- **原安全审计中的生产化项降为 MVP 后置：** 应用级限流、Pair/Device 索引、结构化安全日志属于公网长期运营 gate，不应压过 M1 和 public collect 路径修正。依赖漏洞、示例 Pair Code、CSP 加固仍然有效，但可作为小修或发布前检查处理。

本轮实现状态：

- 已完成：删除 legacy `BRIDGE_TOKEN` / `session_secret` 模式；MCP bridge 只使用 `FLOWIMAGE_PAIR_CODE`。
- 已完成：public collect 不再返回或读取 `merged_png_path`，MCP bridge 改为通过 authenticated `merged_png_url` 拉取 PNG bytes。
- 已完成：`GET /api/pairs/current` 收窄为 session summary，不再返回完整 screenshots/annotations。
- 已完成：README、`.env.example` 和 canonical design spec 改为单一 Pair Mode，并把完整 Pair Code 示例替换为占位符。
- 保留待定：`rotate-code` 与 collect-by-id 仍保留；这两项需要按产品取舍决定补 UI 入口还是 defer。
- 仍未处理：应用级限流/配额、Pair/Device 索引、结构化安全日志、Vitest/Vite/esbuild 升级、CSP 进一步加固。

## Findings

### [Medium] 公网 Pair 入口缺少应用级限流和配额

- **Affected asset:** `POST /api/pairs`、`POST /api/pairs/bind-device`、pair-code/device-token 认证的 session、upload、collect API。
- **Evidence:** `apps/backend/src/routes/pairs.mjs:25-49` 中 `POST /api/pairs` 与 `POST /api/pairs/bind-device` 直接创建 Pair 或绑定设备；`apps/backend/src/routes/screenshots.mjs:7-22` 只有单文件大小和数量限制；`docs/superpowers/specs/2026-06-27-flow-image-pairing-public-mvp-design.md:413` 已要求托管部署必须做 rate limit；仓库部署扫描只发现 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，没有反向代理、CI 或托管层限流配置。
- **Impact:** 公网部署时，攻击者可以高频创建 Pair、绑定设备、尝试 Pair Code、创建 session 或上传接近上限的 PNG，造成磁盘、CPU、文件句柄和请求处理资源消耗。Pair Code 熵足够高，暴力破解成功概率低，但在线尝试仍然没有服务端节流。
- **Reproduction or reasoning:** 静态审计可见公开写入口没有认证、限流中间件或 IP/Pair 配额；`POST /api/pairs` 每次成功都会落盘 `pair.json` 与 device 文件。
- **Recommended fix:** 在应用层加入最小限流，至少覆盖 `POST /api/pairs`、`/api/pairs/bind-device`、`POST /api/sessions`、截图上传、标注上传和 collect；同时增加按 IP、Pair、session 的配额，例如每日 Pair 创建数、每 Pair 活跃 session 数、每 session 最大总字节数。托管层仍可再加反向代理限流，但不应作为唯一控制。
- **Verification:** 增加 API 测试：连续超过阈值请求返回 `429`；超过 Pair/session 配额返回稳定错误；正常低频流程仍通过 `pnpm test`。
- **Confidence:** High。

### [Medium] Pair Code 和 Device Token 查询是全量文件系统线性扫描

- **Affected asset:** Pair 认证、设备认证、Pair 会话列表、所有依赖 `getPairForCode` / `getPairForDeviceToken` 的接口。
- **Evidence:** `apps/backend/src/lib/store.mjs:227-245` 每次 Pair Code 查询都会遍历 `dataDir/pairs` 下的所有 Pair；`apps/backend/src/lib/store.mjs:247-274` 每次 Device Token 查询会遍历所有 Pair 及其 devices；`apps/backend/src/routes/sessions.mjs:50-75` 在请求鉴权路径中调用这些查询。
- **Impact:** Pair 数量增长后，任何带 Pair Code 或 Device Token 的请求都会变慢；如果与未限流的 Pair 创建叠加，攻击者可以先制造大量 Pair 目录，再让正常用户的认证路径退化为高成本文件系统扫描。
- **Reproduction or reasoning:** 代码路径中没有索引、缓存或数据库查询键，凭据哈希比较发生在循环内部；请求复杂度随 Pair 和 Device 数量线性增长。
- **Recommended fix:** 为公网模式引入常量时间查找索引。MVP 可用文件索引，例如 `pair-code-index/<hash>.json`、`device-token-index/<hash>.json`；更稳的下一步是 SQLite，按 `pair_code_hash` 和 `device_token_hash` 建唯一索引。Pair Code 轮换和 device revoke 必须同步更新索引。
- **Verification:** 增加 store 单元测试覆盖 create/bind/rotate/revoke 后索引一致性；增加性能 smoke test，构造上千 Pair 后认证请求仍保持稳定延迟。
- **Confidence:** High。

### [Medium] Public collect 响应泄露服务端本地路径，并让远端 MCP 桥接依赖同机文件读取

- **Affected asset:** `POST /api/sessions/:sessionId/annotations/collect`、`POST /api/annotations/collect-latest`、`ui_collect_annotations` MCP 工具。
- **Evidence:** `apps/backend/src/lib/store.mjs:147-153` 将 `merged_png_path` 存入 annotation；`apps/backend/src/routes/annotations.mjs:23-28` 与 `apps/backend/src/routes/annotations.mjs:87-92` 直接返回 `session.annotations`；`apps/mcp-bridge/src/tools/collect.mjs:35-42` 使用 `readFile(item.merged_png_path)` 读取图片。
- **Impact:** 对公网官方服务来说，Codex MCP bridge 通常运行在用户本机，而不是服务端同机，因此无法读取服务端绝对路径，收图链路会失败或只在本地同机开发模式成立。同时，任何持有 Pair Code 的客户端都能看到服务端文件系统布局，属于不必要的信息泄露。
- **Reproduction or reasoning:** 代码明确从 API payload 读取 `merged_png_path` 并本地读文件；如果 backend 在 `flow-image.like-water.net` 上，用户本机没有这个路径。
- **Recommended fix:** Public Pair Mode 的 collect payload 不返回 `merged_png_path`；MCP bridge 改为使用 `merged_png_url` 携带 `X-FlowImage-Pair-Code` 获取图片 bytes，再转成 MCP image content。Legacy local mode 可以保留内部本地路径，但不要暴露在公网 pair API。
- **Verification:** 增加后端测试断言 public collect 响应不含 `merged_png_path`；增加 mcp-bridge 测试，用 mock fetch 验证它通过 authenticated URL 拉取 PNG 并返回 base64 image content；端到端验证官方远端 URL 下可以收图。
- **Confidence:** High。

### [Medium] Dev/Test 依赖存在已知高危漏洞

- **Affected asset:** 开发机、CI、测试运行环境。
- **Evidence:** `package.json:10-12` 使用 `vitest ^2.1.9`；`pnpm-lock.yaml` 锁定 `vitest@2.1.9`、`vite@5.4.21`、`esbuild@0.21.5`；执行 `rtk pnpm audit --audit-level low` 返回 5 个漏洞：`vitest <3.2.6` critical、`vite <=6.4.2` high、`esbuild <=0.24.2` moderate 等。
- **Impact:** 这些依赖目前是 devDependency，生产 Express 服务不直接加载它们；但如果开发机或 CI 运行 Vitest UI/Vite dev server，可能出现任意文件读取、请求读取或路径绕过风险。影响面是开发/测试环境，不是当前生产 API 直接暴露。
- **Reproduction or reasoning:** 依赖审计命令已复现漏洞报告；项目测试脚本使用 `vitest run`，未发现 Vitest UI 脚本，但 vulnerable package 仍在 lockfile 中。
- **Recommended fix:** 升级 Vitest 到 `>=3.2.6` 或当前兼容稳定版，并更新 lockfile；确认 transitive `vite` 和 `esbuild` 进入修复版本。CI 中禁止暴露 Vitest UI/Vite dev server 到公网。
- **Verification:** 执行 `pnpm install` 后重新跑 `pnpm audit --audit-level low`，确认上述 advisories 消失；执行 `pnpm test` 确认 28 个测试仍通过。
- **Confidence:** High。

### [Medium] Pair 生命周期缺少安全事件日志

- **Affected asset:** Pair 创建、设备绑定、Pair Code 轮换、session 创建、图片上传、标注回传、collect。
- **Evidence:** `apps/backend/src/routes/pairs.mjs:25-80`、`apps/backend/src/routes/sessions.mjs:90-124`、`apps/backend/src/routes/annotations.mjs:31-64` 中没有结构化事件记录；`apps/backend/src/server.mjs:47-49` 仅有启动日志；设计文档 `docs/superpowers/specs/2026-06-27-flow-image-pairing-public-mvp-design.md:420` 也说明 MVP 没有超出 created/updated timestamp 的 audit log。
- **Impact:** 如果 Pair Code 泄露、异常绑定设备、异常上传或误 collect，服务端缺少可用于排查的时间线。对 accountless MVP 来说这不是阻断上线的问题，但公网服务会较难定位滥用来源和用户反馈。
- **Reproduction or reasoning:** 静态搜索 `log|logger|pino|winston|morgan|audit` 只发现启动日志和文档说明，没有业务事件日志。
- **Recommended fix:** 增加最小结构化事件日志，不记录原始 Pair Code、Device Token 或图片内容，只记录事件类型、pair_id、session_id、device_id、结果、状态码、IP hash、user-agent 摘要和时间。先落文件或 stdout 即可，后续再接托管日志。
- **Verification:** API 测试或集成测试触发 create/bind/rotate/upload/collect 后，断言日志 sink 收到脱敏事件；人工检查日志中没有原始凭据。
- **Confidence:** Medium。

### [Low] CSP 已存在但缺少基础加固指令

- **Affected asset:** Web 前端和所有 Express 响应。
- **Evidence:** `apps/backend/src/server.mjs:22-26` 设置了 `default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'`；`apps/backend/test/backend.test.mjs:244-251` 只验证了最小 CSP。
- **Impact:** 当前前端没有第三方脚本，且主代码使用 `textContent` 渲染，直接风险较低；但缺少 `object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'none'` 等常见防御指令，削弱了 XSS 或点击劫持场景下的纵深防御。
- **Reproduction or reasoning:** 静态检查响应头字符串即可确认缺少这些指令。
- **Recommended fix:** 将 CSP 扩展为包含 `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`。若未来引入外链资源，必须显式加入最小白名单。
- **Verification:** 更新 header 测试，断言新增 CSP 指令存在；浏览器手测首页和 `/s/:sessionId` 仍正常。
- **Confidence:** High。

### [Low] 示例配置使用了看起来像真实凭据的 Pair Code

- **Affected asset:** `.env.example`、README 配置说明。
- **Evidence:** `.env.example:5-6` 和 `README.md:35-36`、`README.md:48-50` 使用 `FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2CZ-V6DZ-J3WY` 作为示例；`README.md:54` 已说明 Pair Code 是私有凭据。
- **Impact:** 该示例码不一定能在服务端解析到真实 Pair，因此不是直接密钥泄露；但它容易被用户复制进真实配置、日志或截图，也会让审计工具和读者误以为仓库含有真实凭据。
- **Reproduction or reasoning:** 文档和示例环境文件中存在格式完整、看似可用的 Pair Code。
- **Recommended fix:** 将示例改为不可误用的占位符，例如 `FLOWIMAGE_PAIR_CODE=<your-generated-pair-code>`；README 的命令同样使用占位符。若需要展示格式，用单独文本说明，不放进可复制命令。
- **Verification:** 静态搜索确认示例中没有格式完整的 Pair Code；README 仍清楚说明用户需要从 iPad/Web 生成自己的 Pair Code。
- **Confidence:** High。

## No Findings in Area

- **Pair 隔离基本路径通过测试。** `apps/backend/test/backend.test.mjs:181-191` 验证另一个 Pair 的 device token 不能读取当前 Pair 的文件，返回 `404`。
- **文件读取路径 traversal 有防护并有测试。** `apps/backend/src/routes/files.mjs:7-14` 拦截 `/`、`\`、`..`、null byte；`apps/backend/src/routes/files.mjs:38-45` 使用 `path.resolve` 并校验 root 前缀；`apps/backend/test/backend.test.mjs:298-320` 覆盖未授权、路径穿越和正常读取。
- **PNG 上传有类型解析和大小/数量限制。** `apps/backend/src/lib/config.mjs:4-6` 定义 `MAX_SCREENSHOTS=10`、`MAX_PNG_BYTES=15MB`；`apps/backend/src/routes/screenshots.mjs:7-12` 使用 Multer limit；`apps/backend/src/routes/screenshots.mjs:35-42` 调用 `parsePngMeta`；`apps/backend/test/backend.test.mjs:284-296` 覆盖非 PNG 拒绝。
- **前端主要用户可控文本使用安全文本渲染。** `apps/web/public/app.js:34-36` 提供 `setSafeText`；`apps/web/public/app.js:274-280` 用它渲染 Pair 与 session 文本；静态搜索未在 `apps/web/public/app.js` 中发现 `innerHTML`。
- **Pair Code 和 Device Token 服务端落盘为哈希。** `apps/backend/src/lib/auth.mjs:14-15` 使用 SHA-256 哈希；`apps/backend/src/lib/store.mjs:188-200` 只保存 `pair_code_hash` 和 `device_token_hash`；`apps/backend/test/backend.test.mjs:79-94` 验证 Pair Code 不以明文进入 `pair.json`。

## Coverage

- **Inspected:** backend route/store/config/auth/file handling；MCP bridge client 与 collect tool；Web 前端 Pair/annotation 逻辑；README、`.env.example`、spec/plan 文档；package manifests 与 lockfile；现有测试。
- **Executed:** `rtk pnpm test`，结果为 backend 16 tests、mcp-bridge 6 tests、web 6 tests 全部通过；`rtk pnpm audit --audit-level low`，结果为 5 vulnerabilities；`rtk rg ...` 静态搜索危险 API、headers、路径字段和日志；`rtk proxy find ...` 检查顶层部署/CI 配置。
- **Not inspected:** 真实公网 `flow-image.like-water.net` 部署、TLS/反向代理配置、WAF/CDN、实际 iPad Safari 手写体验、Codex Desktop MCP 对 image content 的真实渲染、备份/恢复、数据清理任务、生产日志系统、负载测试。

## Residual Risk

本次审计确认 MVP 的核心隔离和文件处理路径有基本测试保护，但公网服务仍缺少运营层控制：限流、配额、索引、日志、依赖升级、部署/CI 策略都还没有形成闭环。由于当前实现使用本地文件系统作为数据层，随着用户数增加，性能和清理策略会比功能正确性更早成为主要风险。

## Recommended Next Actions

1. **先拍板并执行 M1 legacy 删除：** 若 FlowImage 当前只保留 public pair MVP，删除 `BRIDGE_TOKEN` / `session_secret` / legacy ready / secret URL / legacy tests，使认证面单一化为 Codex 侧 Pair Code + iPad 侧 Device Token。
2. **修 public collect 的单一机制：** 不增加多套 fallback，而是把 pair 模式收图机制替换为 authenticated `merged_png_url` fetch；公网 API 不再返回 `merged_png_path`。这同时解决远端 MCP bridge 无法读服务端本地路径的问题。
3. **收窄 pair current 列表：** `GET /api/pairs/current` 只返回 session summary；完整截图和标注只在 `GET /api/sessions/:sessionId` 详情里返回，避免列表响应泄露内部路径。
4. **决定 rotate 与 collect-by-id：** `rotate-code` 要么补最小 UI 入口成为真实泄露恢复能力，要么 defer/delete；`collect-by-id` 要么保留支持精确收图，要么收敛为 latest-only。
5. **顺手做小减法和小安全修：** 清理 `pair.revoked_at` 等未接线字段、替换 README/`.env.example` 的完整 Pair Code 示例、补 CSP 指令、升级 Vitest/Vite/esbuild。
6. **把公网运营项排到 MVP 后：** 限流/配额、Pair/Device 索引或 SQLite、结构化安全事件日志在官方公网服务发布前必须补，但不应阻塞当前最小闭环收敛。
