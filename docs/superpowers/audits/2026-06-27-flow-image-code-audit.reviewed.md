# FlowImage 代码审计报告

审计日期：2026-06-27
审计对象：`flow-image` monorepo，分支 `feature/flow-image`
审计类型：非破坏性代码审计、依赖审计、测试证据采集
审计重点：公网 Pair Mode MVP 的安全性、多租户隔离、文件处理、MCP 回传链路、部署就绪度

---

## 交叉验证结论 (Cross-Verification)

> 本文件是审计副本,由 Claude 于 2026-06-27 对照真实代码逐条交叉验证后生成。原始审计 `2026-06-27-flow-image-code-audit.md` 未改动。下方在每条 Finding 末尾以 `> [交叉验证]` 引用块给出复核结论;正文未删改。
>
> **总体:这份审计质量高、可信。** 抽查的全部 `file:line` 证据均属实,可执行证据也已复现:
> - `pnpm test` → backend 16 / mcp-bridge 6 / web 6 = **28 全过**(与审计一致)。
> - `pnpm audit --audit-level low` → **5 漏洞(3 moderate / 1 high / 1 critical)**,全在 `vitest > vite > esbuild` 这条 devDependency 链(与审计一致)。
> - "No Findings" 的隔离 / 路径穿越 / PNG 解析 / textContent / 哈希存储等断言逐条复核成立。
>
> **七条 Finding 复核:** F1 ✅ · F2 ✅(附校准)· F3 ✅(**泄露面需扩大**)· F4 ✅ · F5 ✅(附校准)· F6 ✅ · F7 ✅。
>
> **交叉验证新增/修正(详见各条内联):**
> 1. **F3 泄露面被低估(重要):** `merged_png_path` 不只在两个 collect 端点泄露,还经 `publicSession`(`store.mjs:344-353` → `GET /api/sessions/:id`)、`publicPair`(`pairs.mjs:9-18` → `GET /api/pairs/current`)、`GET .../annotations/ready`(`annotations.mjs:68-74`)一并下发给浏览器/设备。**修复要落在序列化层(从 session JSON 输出剥离该字段,或不持久化绝对路径),不能只改 collect。** bridge 端改动很小:`backend-client.mjs:6-14` 已持有 `baseUrl`+`pairCode`,加一个带 `X-FlowImage-Pair-Code` 拉 `merged_png_url` 的方法即可。
> 2. **代码已优于设计文档,勿重复"修复":** `rotatePairCode` **会连带吊销其它设备**(`store.mjs:305-314`,强于 spec 的"device token 仍有效");collect 是 **POST**(`annotations.mjs:31/95`,非有副作用的 GET);存在 **`collect-latest`**(无需 session_id);pair 会话 TTL 是 **7 天 + 每次标注续期**(`store.mjs:16,175-180`,非 24h)。这几点此前在 spec 审校里被点过,代码均已解决。
> 3. **新发现——字母表内部不一致(低):** pair code 生成器用 31 字符表(`ids.mjs:3`,排除 I/L/O/0/1,符合 spec),但校验正则是 32 字符(`auth.mjs:4` 的 `[A-HJ-NP-Z2-9]`,**含 L**)。无安全影响(正则是超集,接受全部生成码),但应统一。顺带确认:生成码 24 字符 × log2(31) ≈ **119 bit**,熵达标,F1"熵足够高"成立。
> 4. **严重度校准:** F2 单独看(本地 FS、Pair 量不大)影响很低,其"牙齿"来自与 F1 叠加 → **先修 F1 限流/配额,F2 的索引/SQLite 可作随后的性能项**。F4 已确认是 dev-only 链(生产 Express 不加载),运行时暴露面低,属低成本卫生升级。F5 对 accountless MVP 而言 spec 本就接受无 audit log,可视为 Low-Medium。
> 5. **一条低价值信息项(无需处理):** 凭据为非常量时间比较(`sessions.mjs:36` `!==`、`store.mjs:242/268` `===`),但比较对象是高熵密钥的 SHA-256 哈希,时序侧信道不具可利用性,列出仅为完整性。

---

## Findings

### [Medium] 公网 Pair 入口缺少应用级限流和配额

- **Affected asset:** `POST /api/pairs`、`POST /api/pairs/bind-device`、pair-code/device-token 认证的 session、upload、collect API。
- **Evidence:** `apps/backend/src/routes/pairs.mjs:25-49` 中 `POST /api/pairs` 与 `POST /api/pairs/bind-device` 直接创建 Pair 或绑定设备；`apps/backend/src/routes/screenshots.mjs:7-22` 只有单文件大小和数量限制；`docs/superpowers/specs/2026-06-27-flow-image-pairing-public-mvp-design.md:413` 已要求托管部署必须做 rate limit；仓库部署扫描只发现 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，没有反向代理、CI 或托管层限流配置。
- **Impact:** 公网部署时，攻击者可以高频创建 Pair、绑定设备、尝试 Pair Code、创建 session 或上传接近上限的 PNG，造成磁盘、CPU、文件句柄和请求处理资源消耗。Pair Code 熵足够高，暴力破解成功概率低，但在线尝试仍然没有服务端节流。
- **Reproduction or reasoning:** 静态审计可见公开写入口没有认证、限流中间件或 IP/Pair 配额；`POST /api/pairs` 每次成功都会落盘 `pair.json` 与 device 文件。
- **Recommended fix:** 在应用层加入最小限流，至少覆盖 `POST /api/pairs`、`/api/pairs/bind-device`、`POST /api/sessions`、截图上传、标注上传和 collect；同时增加按 IP、Pair、session 的配额，例如每日 Pair 创建数、每 Pair 活跃 session 数、每 session 最大总字节数。托管层仍可再加反向代理限流，但不应作为唯一控制。
- **Verification:** 增加 API 测试：连续超过阈值请求返回 `429`；超过 Pair/session 配额返回稳定错误；正常低频流程仍通过 `pnpm test`。
- **Confidence:** High。

> **[交叉验证 ✅ F1 成立]** 已核:`pairs.mjs:25-49` 的 `POST /`(createPair)与 `POST /bind-device` 无任何认证/限流;session 创建(`sessions.mjs:90-125`)、截图上传(`screenshots.mjs:18-22`)、collect(`annotations.mjs:31-39/95-112`)有 pair-code/token 认证但无节流;全仓无 rate-limit 中间件。`POST /api/pairs` 每次成功落盘 `pair.json`+device 文件,确为无鉴权写入口。**与 F2 叠加风险最大,应作为最高优先的运营加固。**

### [Medium] Pair Code 和 Device Token 查询是全量文件系统线性扫描

- **Affected asset:** Pair 认证、设备认证、Pair 会话列表、所有依赖 `getPairForCode` / `getPairForDeviceToken` 的接口。
- **Evidence:** `apps/backend/src/lib/store.mjs:227-245` 每次 Pair Code 查询都会遍历 `dataDir/pairs` 下的所有 Pair；`apps/backend/src/lib/store.mjs:247-274` 每次 Device Token 查询会遍历所有 Pair 及其 devices；`apps/backend/src/routes/sessions.mjs:50-75` 在请求鉴权路径中调用这些查询。
- **Impact:** Pair 数量增长后，任何带 Pair Code 或 Device Token 的请求都会变慢；如果与未限流的 Pair 创建叠加，攻击者可以先制造大量 Pair 目录，再让正常用户的认证路径退化为高成本文件系统扫描。
- **Reproduction or reasoning:** 代码路径中没有索引、缓存或数据库查询键，凭据哈希比较发生在循环内部；请求复杂度随 Pair 和 Device 数量线性增长。
- **Recommended fix:** 为公网模式引入常量时间查找索引。MVP 可用文件索引，例如 `pair-code-index/<hash>.json`、`device-token-index/<hash>.json`；更稳的下一步是 SQLite，按 `pair_code_hash` 和 `device_token_hash` 建唯一索引。Pair Code 轮换和 device revoke 必须同步更新索引。
- **Verification:** 增加 store 单元测试覆盖 create/bind/rotate/revoke 后索引一致性；增加性能 smoke test，构造上千 Pair 后认证请求仍保持稳定延迟。
- **Confidence:** High。

> **[交叉验证 ✅ F2 成立,附严重度校准]** 已核:`getPairForCode`(`store.mjs:236-245`)遍历全部 pair 读 `pair.json`、在循环内比对哈希;`getPairForDeviceToken`(`store.mjs:262-274`)遍历全部 pair × 全部 device;无索引/缓存。**但单独影响有限**——本地 FS、Pair 量不大时延迟可接受;真正的放大器是 F1(无限建 Pair → 认证路径线性退化)。**建议:先做 F1 限流/配额,F2 的索引或 SQLite 作为随后的性能项,不必与 F1 同等紧急。**

### [Medium] Public collect 响应泄露服务端本地路径，并让远端 MCP 桥接依赖同机文件读取

- **Affected asset:** `POST /api/sessions/:sessionId/annotations/collect`、`POST /api/annotations/collect-latest`、`ui_collect_annotations` MCP 工具。
- **Evidence:** `apps/backend/src/lib/store.mjs:147-153` 将 `merged_png_path` 存入 annotation；`apps/backend/src/routes/annotations.mjs:23-28` 与 `apps/backend/src/routes/annotations.mjs:87-92` 直接返回 `session.annotations`；`apps/mcp-bridge/src/tools/collect.mjs:35-42` 使用 `readFile(item.merged_png_path)` 读取图片。
- **Impact:** 对公网官方服务来说，Codex MCP bridge 通常运行在用户本机，而不是服务端同机，因此无法读取服务端绝对路径，收图链路会失败或只在本地同机开发模式成立。同时，任何持有 Pair Code 的客户端都能看到服务端文件系统布局，属于不必要的信息泄露。
- **Reproduction or reasoning:** 代码明确从 API payload 读取 `merged_png_path` 并本地读文件；如果 backend 在 `flow-image.like-water.net` 上，用户本机没有这个路径。
- **Recommended fix:** Public Pair Mode 的 collect payload 不返回 `merged_png_path`；MCP bridge 改为使用 `merged_png_url` 携带 `X-FlowImage-Pair-Code` 获取图片 bytes，再转成 MCP image content。Legacy local mode 可以保留内部本地路径，但不要暴露在公网 pair API。
- **Verification:** 增加后端测试断言 public collect 响应不含 `merged_png_path`；增加 mcp-bridge 测试，用 mock fetch 验证它通过 authenticated URL 拉取 PNG 并返回 base64 image content；端到端验证官方远端 URL 下可以收图。
- **Confidence:** High。

> **[交叉验证 ✅ F3 成立,且泄露面比报告更广 —— 同意第一优先]** 已核:`store.mjs:152` 写入 `merged_png_path`(服务端绝对路径);`collect.mjs:37` 用 `read(item.merged_png_path)` 读本地文件——远端官方服务下用户本机无此路径,收图必失败。**补充:同一字段还经 `publicSession`(`store.mjs:344-353`,`GET /api/sessions/:id`)、`publicPair`(`pairs.mjs:9-18`,`GET /api/pairs/current`)、`GET .../annotations/ready`(`annotations.mjs:68-74`)返回**,因此修复要在序列化层剥离该字段(或不在 session JSON 持久化绝对路径),不能只改 collect payload。bridge 侧改动很小:`backend-client.mjs:6-14` 已有 `baseUrl`+`pairCode`,加一个"带 `X-FlowImage-Pair-Code` 拉 `merged_png_url`"的方法即可。

### [Medium] Dev/Test 依赖存在已知高危漏洞

- **Affected asset:** 开发机、CI、测试运行环境。
- **Evidence:** `package.json:10-12` 使用 `vitest ^2.1.9`；`pnpm-lock.yaml` 锁定 `vitest@2.1.9`、`vite@5.4.21`、`esbuild@0.21.5`；执行 `rtk pnpm audit --audit-level low` 返回 5 个漏洞：`vitest <3.2.6` critical、`vite <=6.4.2` high、`esbuild <=0.24.2` moderate 等。
- **Impact:** 这些依赖目前是 devDependency，生产 Express 服务不直接加载它们；但如果开发机或 CI 运行 Vitest UI/Vite dev server，可能出现任意文件读取、请求读取或路径绕过风险。影响面是开发/测试环境，不是当前生产 API 直接暴露。
- **Reproduction or reasoning:** 依赖审计命令已复现漏洞报告；项目测试脚本使用 `vitest run`，未发现 Vitest UI 脚本，但 vulnerable package 仍在 lockfile 中。
- **Recommended fix:** 升级 Vitest 到 `>=3.2.6` 或当前兼容稳定版，并更新 lockfile；确认 transitive `vite` 和 `esbuild` 进入修复版本。CI 中禁止暴露 Vitest UI/Vite dev server 到公网。
- **Verification:** 执行 `pnpm install` 后重新跑 `pnpm audit --audit-level low`，确认上述 advisories 消失；执行 `pnpm test` 确认 28 个测试仍通过。
- **Confidence:** High。

> **[交叉验证 ✅ F4 成立]** 已复跑 `pnpm audit --audit-level low`:**5 漏洞(3 moderate / 1 high / 1 critical)**,路径均为 `.>vitest>vite>esbuild`,确为 devDependency 传递依赖,生产服务不加载;`package.json:11` 为 `vitest ^2.1.9`,lockfile 锁 `vitest@2.1.9 / vite@5.4.21 / esbuild@0.21.5`。升级 vitest≥3.2.6 即可。**校准:对本服务运行时暴露面为低,属低成本供应链卫生项,可与功能修复解耦。**

### [Medium] Pair 生命周期缺少安全事件日志

- **Affected asset:** Pair 创建、设备绑定、Pair Code 轮换、session 创建、图片上传、标注回传、collect。
- **Evidence:** `apps/backend/src/routes/pairs.mjs:25-80`、`apps/backend/src/routes/sessions.mjs:90-124`、`apps/backend/src/routes/annotations.mjs:31-64` 中没有结构化事件记录；`apps/backend/src/server.mjs:47-49` 仅有启动日志；设计文档 `docs/superpowers/specs/2026-06-27-flow-image-pairing-public-mvp-design.md:420` 也说明 MVP 没有超出 created/updated timestamp 的 audit log。
- **Impact:** 如果 Pair Code 泄露、异常绑定设备、异常上传或误 collect，服务端缺少可用于排查的时间线。对 accountless MVP 来说这不是阻断上线的问题，但公网服务会较难定位滥用来源和用户反馈。
- **Reproduction or reasoning:** 静态搜索 `log|logger|pino|winston|morgan|audit` 只发现启动日志和文档说明，没有业务事件日志。
- **Recommended fix:** 增加最小结构化事件日志，不记录原始 Pair Code、Device Token 或图片内容，只记录事件类型、pair_id、session_id、device_id、结果、状态码、IP hash、user-agent 摘要和时间。先落文件或 stdout 即可，后续再接托管日志。
- **Verification:** API 测试或集成测试触发 create/bind/rotate/upload/collect 后，断言日志 sink 收到脱敏事件；人工检查日志中没有原始凭据。
- **Confidence:** Medium。

> **[交叉验证 ✅ F5 成立]** 已核:`server.mjs:47-49` 仅启动日志,各路由(`pairs.mjs`/`sessions.mjs`/`annotations.mjs`)无业务事件日志。**校准:** spec 已显式接受 accountless MVP 无 audit log,对上线非阻断;建议的"最小脱敏结构化日志(事件类型 + pair_id/session_id/device_id + 结果 + IP hash,且不记原始凭据/图像)"合理且便宜,可作增量。

### [Low] CSP 已存在但缺少基础加固指令

- **Affected asset:** Web 前端和所有 Express 响应。
- **Evidence:** `apps/backend/src/server.mjs:22-26` 设置了 `default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'`；`apps/backend/test/backend.test.mjs:244-251` 只验证了最小 CSP。
- **Impact:** 当前前端没有第三方脚本，且主代码使用 `textContent` 渲染，直接风险较低；但缺少 `object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'none'` 等常见防御指令，削弱了 XSS 或点击劫持场景下的纵深防御。
- **Reproduction or reasoning:** 静态检查响应头字符串即可确认缺少这些指令。
- **Recommended fix:** 将 CSP 扩展为包含 `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`。若未来引入外链资源，必须显式加入最小白名单。
- **Verification:** 更新 header 测试，断言新增 CSP 指令存在；浏览器手测首页和 `/s/:sessionId` 仍正常。
- **Confidence:** High。

> **[交叉验证 ✅ F6 成立]** 已核:`server.mjs:22-28` 的 CSP 为 `default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'`,缺 `object-src`/`base-uri`/`form-action`/`frame-ancestors`。前端确无第三方脚本、统一 `textContent` 渲染(已核 `app.js` 无 `innerHTML`),故为纵深防御加固,Low 合理。补这几条指令是一行改动,值得做。

### [Low] 示例配置使用了看起来像真实凭据的 Pair Code

- **Affected asset:** `.env.example`、README 配置说明。
- **Evidence:** `.env.example:5-6` 和 `README.md:35-36`、`README.md:48-50` 使用 `FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2CZ-V6DZ-J3WY` 作为示例；`README.md:54` 已说明 Pair Code 是私有凭据。
- **Impact:** 该示例码不一定能在服务端解析到真实 Pair，因此不是直接密钥泄露；但它容易被用户复制进真实配置、日志或截图，也会让审计工具和读者误以为仓库含有真实凭据。
- **Reproduction or reasoning:** 文档和示例环境文件中存在格式完整、看似可用的 Pair Code。
- **Recommended fix:** 将示例改为不可误用的占位符，例如 `FLOWIMAGE_PAIR_CODE=<your-generated-pair-code>`；README 的命令同样使用占位符。若需要展示格式，用单独文本说明，不放进可复制命令。
- **Verification:** 静态搜索确认示例中没有格式完整的 Pair Code；README 仍清楚说明用户需要从 iPad/Web 生成自己的 Pair Code。
- **Confidence:** High。

> **[交叉验证 ✅ F7 成立]** 已核:`.env.example:6` 与 `README.md:36,50` 的 `FIMG-K7Q9-M4TN-X8PA-R2CZ-V6DZ-J3WY` 是格式合法的 24 字符码(匹配 `auth.mjs:4` 正则),且出现在可直接复制的 `codex mcp add` 命令里。改为占位符即可;`BRIDGE_TOKEN=change-me`(`.env.example:4`)已是占位符,可对齐处理。

## No Findings in Area

- **Pair 隔离基本路径通过测试。** `apps/backend/test/backend.test.mjs:181-191` 验证另一个 Pair 的 device token 不能读取当前 Pair 的文件，返回 `404`。
- **文件读取路径 traversal 有防护并有测试。** `apps/backend/src/routes/files.mjs:7-14` 拦截 `/`、`\`、`..`、null byte；`apps/backend/src/routes/files.mjs:38-45` 使用 `path.resolve` 并校验 root 前缀；`apps/backend/test/backend.test.mjs:298-320` 覆盖未授权、路径穿越和正常读取。
- **PNG 上传有类型解析和大小/数量限制。** `apps/backend/src/lib/config.mjs:4-6` 定义 `MAX_SCREENSHOTS=10`、`MAX_PNG_BYTES=15MB`；`apps/backend/src/routes/screenshots.mjs:7-12` 使用 Multer limit；`apps/backend/src/routes/screenshots.mjs:35-42` 调用 `parsePngMeta`；`apps/backend/test/backend.test.mjs:284-296` 覆盖非 PNG 拒绝。
- **前端主要用户可控文本使用安全文本渲染。** `apps/web/public/app.js:34-36` 提供 `setSafeText`；`apps/web/public/app.js:274-280` 用它渲染 Pair 与 session 文本；静态搜索未在 `apps/web/public/app.js` 中发现 `innerHTML`。
- **Pair Code 和 Device Token 服务端落盘为哈希。** `apps/backend/src/lib/auth.mjs:14-15` 使用 SHA-256 哈希；`apps/backend/src/lib/store.mjs:188-200` 只保存 `pair_code_hash` 和 `device_token_hash`；`apps/backend/test/backend.test.mjs:79-94` 验证 Pair Code 不以明文进入 `pair.json`。

> **[交叉验证 ✅ No-Findings 全部复核通过]** 逐条对照:**隔离** —— `requireSessionAccess` 经 `getPairSession(pair_id, sessionId)` 按已认证 pair 限定目录,跨 pair 取 session 返回 404(`sessions.mjs:45-85`);**路径穿越** —— `files.mjs:5-43` 有 `SAFE_KIND` 白名单 + `.png` 后缀 + `..`/`/`/`\`/null 拦截 + `path.resolve` 前缀校验(比 spec 还严);**PNG** —— `png.mjs:3-24` 校验魔数 + IHDR 取宽高;**前端** —— `app.js:34-35` `setSafeText` 走 `textContent`,全文件无 `innerHTML`;**哈希存储** —— `auth.mjs:14-15` SHA-256,`store.mjs` 只存 `*_hash`。断言均属实。**补充一条隐性优点:** iPad/Web 用 `X-Pair-Device-Token` 请求头(非 cookie)鉴权,天然规避 CSRF。

## Coverage

- **Inspected:** backend route/store/config/auth/file handling；MCP bridge client 与 collect tool；Web 前端 Pair/annotation 逻辑；README、`.env.example`、spec/plan 文档；package manifests 与 lockfile；现有测试。
- **Executed:** `rtk pnpm test`，结果为 backend 16 tests、mcp-bridge 6 tests、web 6 tests 全部通过；`rtk pnpm audit --audit-level low`，结果为 5 vulnerabilities；`rtk rg ...` 静态搜索危险 API、headers、路径字段和日志；`rtk proxy find ...` 检查顶层部署/CI 配置。
- **Not inspected:** 真实公网 `flow-image.like-water.net` 部署、TLS/反向代理配置、WAF/CDN、实际 iPad Safari 手写体验、Codex Desktop MCP 对 image content 的真实渲染、备份/恢复、数据清理任务、生产日志系统、负载测试。

## Residual Risk

本次审计确认 MVP 的核心隔离和文件处理路径有基本测试保护，但公网服务仍缺少运营层控制：限流、配额、索引、日志、依赖升级、部署/CI 策略都还没有形成闭环。由于当前实现使用本地文件系统作为数据层，随着用户数增加，性能和清理策略会比功能正确性更早成为主要风险。

## Recommended Next Actions

1. **先修 public collect 链路：** 移除公网 payload 的 `merged_png_path`，让 MCP bridge 通过 authenticated `merged_png_url` 拉图。这直接关系到官方远端服务能否工作。
2. **补应用级限流和 Pair/session 配额：** 优先覆盖所有公开写入口和 Pair Code 验证入口。
3. **把 Pair/Device 查找改为索引或 SQLite：** 避免 Pair 数增长后认证路径线性退化。
4. **升级 Vitest/Vite/esbuild 链：** 修复开发与 CI 供应链漏洞，并让 `pnpm audit --audit-level low` 通过。
5. **加最小安全事件日志和 CSP 加固：** 记录脱敏业务事件，扩展 CSP 防御指令。
6. **清理示例 Pair Code：** 将 `.env.example` 和 README 命令里的完整示例码替换为占位符。
