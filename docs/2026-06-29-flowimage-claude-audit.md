# FlowImage Claude 审计报告

审计日期：2026-06-29
审计对象：`flow-image` monorepo（capability-link 实现，当前工作树）
审计类型：非破坏性代码审计、依赖核对、测试证据采集
审计基线：以代码事实为准，参考 `docs/2026-06-29-flowimage-implementation.md`
审计尺子：在“功能闭环已实现”前提下，按 MVP 最小化原则收敛
执行者：Claude（Opus 4.8）

## 测试基线

本次审计在分析前先跑通全套测试，确认“功能都实现”的前提成立：

- `pnpm -r test`：backend 9 passed、web 28 passed、mcp-bridge 11 passed。
- `node --test plugins/flow-image/test/*.test.mjs`：1 passed。
- 合计 49 个用例全绿。

## 执行摘要

当前实现是一个结构干净、分层清晰、纯函数高度可测的真 MVP，代码与落地文档一致性高，未见过度设计。核心闭环（发布截图 → iPad 绘制 → 同步展示 → 收取结果 → 人工确认）成立且有测试保护。

本报告共五类问题，按优先级：

1. **正确性与质量（建议修）** —— 一个会打到核心 iPad 路径的画布伸缩性问题、一个 Object URL 内存泄漏、一个初始加载未捕获异常。
2. **MVP 最小化删减** —— 死依赖、假按钮、重复校验、重复配置构造、兼容别名、本地遗留数据。这是本次审计在“最小化”尺子下最该清的部分。
3. **可移植性债** —— 多处写死本机绝对路径，且目录大小写不一致。
4. **安全（上线前唯一硬门槛）** —— 未鉴权的 session 创建叠加无限流与内存缓冲上传，构成资源耗尽面。
5. **一致性小问题** —— 中英文混排、retention 输入上限不随单位变、数据目录双层命名、清理逻辑覆盖不到遗留目录。

---

## 一、正确性与质量

### [Medium] 画布初始尺寸突破 `WORKSPACE_MAX_SIDE`，iPad 大截图可能整块白屏

- **Affected asset:** `apps/web/public/app.js` 画布初始化与渲染；核心使用场景（Mac 截图 → iPad 标注）。
- **Evidence:**
  - `apps/web/public/app.js:51` 定义 `WORKSPACE_MAX_SIDE = 4096`，意图是把单边尺寸钳在 iOS 画布安全范围内。
  - `apps/web/public/app.js:78-89` `createWorkspaceMetrics(image, scale = 3)` 把工作区初始化为 `workspaceWidth = imageWidth * scale`、`workspaceHeight = imageHeight * scale`（`:84-85`），**完全没有引用 `WORKSPACE_MAX_SIDE`**。
  - `apps/web/public/app.js:91-107` `workspaceExpansionForPoint` 里 `WORKSPACE_MAX_SIDE` 只用来计算“后续增长”的剩余空间（`:96-97`），即它只限制扩展，不限制初始分配。
  - `apps/web/public/app.js:385` `loadPage` 调用 `createWorkspaceMetrics(page)`，未做任何钳制。
- **Impact:** 任何宽度大于约 1365px 的截图，初始 canvas 单边就已经 ≥4096（1365 × 3 ≈ 4096）。Mac 全屏/窗口截图普遍 1440~2880，Retina 更大，对应工作区会去到 4320×2700、甚至 8640×5400 这种量级。iOS Safari 对 canvas 的面积与单边有硬上限，超限时画布会**整块渲染为空白**——也就是说核心场景里，越是“正常的 Mac 截图”，越容易在 iPad 上打开后看不到图。`WORKSPACE_MAX_SIDE = 4096` 这个常量本身证明作者已知 iOS 限制，但初始 3× 分配把它绕过了，使该防护对真实输入基本失效。
- **Reproduction or reasoning:** 静态推理即可确认：初始尺寸只由 `imageWidth * 3` 决定，代码路径中没有任何 `Math.min(maxSide, …)`。对一张 1440px 宽的截图，初始 `workspaceWidth = 4320 > 4096`。
- **Recommended fix:** 在 `createWorkspaceMetrics` 内对 `workspaceWidth/workspaceHeight` 套 `WORKSPACE_MAX_SIDE` 钳制，或当 `imageWidth * scale` 超限时按比例降低 `scale`（保证图本身完整显示、四周仍留可绘制余量）。同时让 `imageX/imageY` 随钳制后的尺寸重新居中。
- **Verification:** 增加前端单测：传入 3000×2000 的 image，断言 `workspaceWidth/Height` 不超过 `WORKSPACE_MAX_SIDE`，且图仍居中可见；在真实 iPad Safari 用一张 ≥2560px 宽截图手测，确认 Edit 页能正常显示底图并可绘制。
- **Confidence:** High（代码事实确凿；iOS 具体阈值依设备/系统版本略有差异，但“初始尺寸未受 4096 约束”这一缺陷是确定的）。

### [Low-Medium] Object URL 持续泄漏，长会话内存只增不减

- **Affected asset:** `apps/web/public/app.js` 所有图片加载路径（底图、远端 merged 结果图）。
- **Evidence:**
  - `apps/web/public/app.js:171-183` `fetchImageObjectUrl` 每次都 `URL.createObjectURL(await res.blob())`（`:182`）生成一个新的 blob URL。
  - `apps/web/public/app.js:322-327` `drawImageUrl` 用它给临时 `Image` 赋 `src`，绘制后**未 `revokeObjectURL`**。
  - `apps/web/public/app.js:383` `loadPage` 里 `baseImage.src = await fetchImageObjectUrl(...)`，每次翻页重新赋值，旧 blob URL 同样未释放。
  - 全仓 `apps/web/public` 内 `grep revokeObjectURL` 无任何命中。
- **Impact:** 每次翻页、每次轮询应用远端新结果（`pollSession` → `renderBase` → `drawImageUrl`）都会泄漏一个 blob URL，其底层 Blob 不会被 GC 回收。单次量很小，但在 iPad 上长时间、多页、多次同步的会话里会持续累积，最终表现为页面变卡或被系统回收。
- **Reproduction or reasoning:** blob object URL 的生命周期需显式 `revokeObjectURL` 管理；代码只创建不释放，泄漏随加载次数线性增长。
- **Recommended fix:** 让 `fetchImageObjectUrl` 的调用方在 `image.decode()` 完成后于 `finally` 中 `URL.revokeObjectURL(objectUrl)`；`baseImage` 这类复用元素，在赋新 `src` 前 revoke 上一个 URL。
- **Verification:** 增加单测断言 `drawImageUrl` 在解码后调用了注入的 `revoke`；浏览器内多次翻页/同步后用 DevTools 观察 blob URL 数量不再单调上升。
- **Confidence:** High。

### [Low] 初始加载 `start()` 未捕获异常

- **Affected asset:** `apps/web/public/app.js` 启动入口。
- **Evidence:** `apps/web/public/app.js:902-904` 顶层 `initViewer().start()` 没有 `.catch`；`start()`（`:848-875`）内部 `loadPage` → `fetchImageObjectUrl`/`image.decode()` 在网络或解码失败时会 reject。
- **Impact:** 首屏图片加载失败时变成 unhandled promise rejection，状态栏 `saveStatus` 不会给出明确反馈，用户只看到空白且无错误提示。属于健壮性问题，非功能阻断。
- **Reproduction or reasoning:** 断网或返回非图片内容时，`decode()` 抛错且无人接住。
- **Recommended fix:** 给 `initViewer().start()` 加 `.catch`，把错误写进状态栏；或在 `start()` 内对首屏加载做 try/catch 兜底。
- **Confidence:** High。

---

## 二、MVP 最小化删减

本节均为“在不影响功能的前提下可以删/可以简化”的项，是最小化原则下的直接收益。

### [Minimization] `form-data` 是死依赖

- **Evidence:** `apps/mcp-bridge/package.json` 声明 `"form-data": "^4.0.1"`，但 `apps/mcp-bridge/src` 全目录无任何 import；`apps/mcp-bridge/src/backend-client.mjs:28,31` 用的是原生 `FormData`/`Blob`/`fetch`（Node 18+ 全局）。
- **Impact:** 多余依赖，增加安装体积与潜在漏洞面，且误导读者以为用了第三方 multipart 库。
- **Recommended fix:** 从 `mcp-bridge/package.json` 删除 `form-data`，更新 lockfile。
- **Confidence:** High。

### [Minimization] “Show QR” 是名不副实的假按钮

- **Evidence:** `apps/web/public/index.html:46` 有 `<button id="showShareQr">Show QR</button>`；`apps/web/public/app.js:817-819` 的 handler 仅执行 `status.value = currentAbsoluteUrl()`，把当前 URL 文本塞进状态栏，**没有任何 QR 渲染**。落地文档也未提及 QR 功能。
- **Impact:** 按钮承诺的能力不存在，对用户是误导；属于无主 UI cruft。
- **Recommended fix:** MVP 下直接删除该按钮与对应 handler；若确有“扫码到 iPad”的诉求，再单独排期真正实现 QR 渲染。
- **Confidence:** High。

### [Minimization] `publish.mjs` 重复了 zod 已保证的校验

- **Evidence:** `apps/mcp-bridge/src/index.mjs:14-21` 已用 zod 约束 `session_title: z.string().min(1).max(120)`、`screenshot_paths: z.array(z.string()).min(1).max(10)`；`apps/mcp-bridge/src/tools/publish.mjs:24-27` 又手写 `if (!sessionTitle) throw` 与 `if (!Array.isArray(...) || !length) throw`。
- **Impact:** 经 MCP 调用时这段手写校验是死分支（zod 已拦截）。冗余逻辑增加阅读成本。
- **Recommended fix:** 二选一保留。若希望 `publish.mjs` 作为可独立测试单元保留最小自检，可只留一条；否则删除手写校验，由 schema 统一负责。
- **Confidence:** Medium（取舍取决于是否把 `publish.mjs` 当作独立入口测试）。

### [Minimization] `server.mjs` 主入口重复构造 config

- **Evidence:** `apps/backend/src/server.mjs:54-59`：先 `const config = makeConfig()`（`:55`），再 `createApp(config)`（`:56`），而 `createApp` 内部第一行又 `makeConfig(overrides)`（`:16`）。等于把已构造好的 config 当 overrides 再跑一遍。
- **Impact:** 无功能错误（键名恰好对齐、`publicBaseUrl` 去尾斜杠幂等），但属多余调用与轻微误导。
- **Recommended fix:** 主入口直接 `createApp()`，把 listen 所需的 `port/bindHost` 从 `app.locals.config` 取，或让 `createApp` 返回 `{ app, config }`。
- **Confidence:** High。

### [Minimization] `viewer_url` 兼容别名当前无外部消费者

- **Evidence:** `apps/backend/src/routes/sessions.mjs:102` 返回 `viewer_url: created.view_url`，与 `view_url` 同值；`apps/mcp-bridge/src/tools/publish.mjs:40,51,60,61` 用 `session.view_url ?? session.viewer_url` 两头兼容。
- **Impact:** 维护两份等价字段。文档（7.1）说明这是为兼容保留的别名，但当前没有任何外部系统依赖 `viewer_url`，在 MVP 阶段属可去除的历史包袱。
- **Recommended fix:** 若确认无外部消费者，统一为 `view_url`，删除 `viewer_url` 及 bridge 侧 `?? viewer_url` 兜底；否则在文档中标注计划移除时间点。
- **Confidence:** Medium（取决于是否已有第三方读取该字段）。

### [Minimization] 本地遗留 `pairs/` 数据且清理逻辑永远扫不到

- **Evidence:** 本地 `apps/backend/data/sessions/pairs/**` 残留 40+ 个旧 pair/device 文件（pair 模型已删除）。该目录已被 `.gitignore` 覆盖（未提交，仅本地脏数据）。`apps/backend/src/lib/store.mjs:185-201` `cleanupExpiredSessions` 只遍历 `sessionsDir()`（即 `data/sessions/sessions/`），与 `data/sessions/pairs/` 是兄弟目录，因此**永远不会清理 pairs**。
- **Impact:** 纯本地脏数据，无线上影响；但会长期堆积，且暴露出“数据根目录命名”引发的清理盲区（见第五节双层命名）。
- **Recommended fix:** 手动删除本地 `data/sessions/pairs/`；命名问题随第五节一并处理。
- **Confidence:** High。

---

## 三、可移植性债

### [Low-Medium] 多处写死本机绝对路径，且目录大小写不一致

- **Affected asset:** Codex 插件分发形态（`plugin.json` 已带 homepage / interface / marketplace 字段，定位为可分发插件）。
- **Evidence:**
  - `plugins/flow-image/.mcp.json:6` 写死 `/Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/apps/mcp-bridge/src/index.mjs`。
  - `plugins/flow-image/skills/flow-image/SKILL.md:13` 与 `:24` 同样写死该绝对路径。
  - `README.md:49` 的 `codex mcp add` 命令也写死同一路径。
  - 上述路径用 `LIKE-WATER`（大写），而实际目录是 `like-water`（小写）。macOS 默认大小写不敏感能跑，但在区分大小写的文件系统（Linux、部分 CI、区分大小写的 APFS 卷）上会直接断。
- **Impact:** 任何换机器、换用户名、或在区分大小写环境运行的人都无法直接使用；与 `plugin.json` 宣称的“可分发”定位冲突。纯个人自用可接受。
- **Reproduction or reasoning:** 路径常量硬编码，无 `${HOME}` 或相对/可配置解析。
- **Recommended fix:** 用相对插件根目录的路径或环境变量解析 MCP 入口；统一目录大小写为 `like-water`；README 命令改用占位符（如 `<flow-image-repo>`）并辅以一行说明。
- **Confidence:** High。

---

## 四、安全（上线前唯一硬门槛）

### [Medium] 未鉴权的 session 创建 + 无限流 + 内存缓冲上传，构成资源耗尽面

- **Affected asset:** `POST /api/sessions`、`POST /api/sessions/:id/screenshots`、`POST /api/sessions/:id/annotations/:screenshotId`。
- **Evidence:**
  - `apps/backend/src/routes/sessions.mjs:91-111` `POST /api/sessions` **无任何鉴权**，建完即在响应里返回可用的 owner token（`:106`）。
  - `apps/backend/src/routes/screenshots.mjs:7-13` 上传使用 multer `memoryStorage`，单文件上限 15MB（`MAX_PNG_BYTES`）、单请求最多 10 个文件（`MAX_SCREENSHOTS`）。
  - `apps/backend/src/server.mjs:25-46` 中间件链只有 CSP 与 `express.json()`，**无任何限流/配额**。
  - `apps/mcp-bridge/src/flowimage-config.mjs:5` 默认 server 指向公网 `https://flow-image.like-water.net`。
- **Impact:** 在公网部署下，攻击者可无限创建 session（每次落盘一个目录与 `session.json`），并凭返回的 owner token 反复上传接近上限（10 × 15MB = 150MB/请求，全部先进内存）的 PNG，造成磁盘、内存、文件句柄与 CPU 资源耗尽。Token 熵足够，不是凭据爆破问题，而是**无节流的写入面**问题。
- **Reproduction or reasoning:** 静态审计可见公开写入口无认证、无限流、无 per-IP/per-session 配额；上传走内存缓冲，瞬时内存随并发上涨。
- **Recommended fix:** 至少给 `POST /api/sessions` 与两个上传端点加应用层限流（按 IP / 按 session），并设最小配额（每 IP 每日 session 数、每 session 累计字节上限）。落地文档第 12.2 已将“限流”列为有意未做，方向认同；本条仅强调它是**公网发布前的硬门槛**，不是可选项。其余安全面（路径穿越、token 仅存 hash、CSP、PNG magic+IHDR 校验）已落实且有测试，无需改动。
- **Verification:** 增加 API 测试：超阈值请求返回 `429`；超配额返回稳定错误；正常低频流程仍 `pnpm test` 通过。
- **Confidence:** High（风险面确凿；是否阻断取决于是否真的公网暴露——本地/局域网自用不受影响）。

---

## 五、一致性小问题（nits）

### [Low] MCP 返回文案中英文混排

- **Evidence:** `apps/mcp-bridge/src/tools/collect.mjs:37` 在有 `review_url` 时返回中文提示；`apps/mcp-bridge/src/tools/publish.mjs:50-55` 返回英文。
- **Impact:** 同一工具集对 Codex 的回话语言不一致，观感与可读性略差。
- **Recommended fix:** 统一为一种语言（建议跟随产品主语言）。
- **Confidence:** High。

### [Low] retention 输入框 `max="720"` 不随单位变化

- **Evidence:** `apps/web/public/index.html:50` `retentionValue` 固定 `max="720"`；单位可选 hours/days。选 days 时，720 天的语义与后端 30 天上限不符。后端 `apps/backend/src/lib/store.mjs:236-238` `normalizeRetentionHours` 会钳到 `MAX_RETENTION_HOURS`（30 天），所以**无溢出 Bug**，仅前端可输入一个会被静默钳掉的值。
- **Impact:** 纯 UX 失配：用户在 days 模式下可填超大值，保存后被悄悄改小，没有即时反馈。
- **Recommended fix:** 让 `max` 随单位切换（hours → 720，days → 30），或在保存返回后回填实际生效值并提示“已调整为上限”。
- **Confidence:** High。

### [Low] 数据根目录双层命名 `data/sessions/sessions/`

- **Evidence:** `apps/backend/src/lib/config.mjs:8` `defaultDataDir = .../data/sessions`；`apps/backend/src/lib/store.mjs:23-25` `sessionsDir()` 又在其后 `path.join(dataDir, "sessions")`，最终真实路径是 `data/sessions/sessions/<sessionId>`。
- **Impact:** 非 Bug，但路径别扭、易误读，并间接造成第二节中“清理扫不到 `data/sessions/pairs/`”的盲区。
- **Recommended fix:** 把 `defaultDataDir` 收敛为 `.../data`，由 `sessionsDir()` 统一拼 `sessions`，得到 `data/sessions/<sessionId>`；迁移时注意已有本地数据目录结构。
- **Confidence:** High。

---

## 已验证、当前无需改动的区域

为避免误删“看起来多余但其实必要”的部分，记录本次确认健康的点：

- **路径穿越防护到位且充分。** `apps/backend/src/routes/files.mjs:7-15` 拦截 `/`、`\`、`..`、null byte；`:38-43` 用 `path.resolve` 并校验 root 前缀；`kind` 白名单 + `.png` 后缀双重约束。
- **token 仅以 hash 落盘。** `apps/backend/src/lib/auth.mjs` SHA-256；`apps/backend/src/lib/store.mjs:64-66` 只存 `*_token_hash`，原始 token 仅在创建响应返回一次。哈希比较用 `===` 在此场景安全（攻击者无法在不知 token 的情况下增量逼近 hash）。
- **CSP 最小且合理。** `apps/backend/src/server.mjs:25-31` 同源策略 + `img-src blob:`，与前端用法吻合。
- **PNG 校验。** `apps/backend/src/lib/png.mjs` 校验 magic 与 IHDR 后再读宽高；配合 multer 大小/数量限制。
- **前端不可信文本走 `textContent`。** `apps/web/public/app.js:167-169` `setSafeText`；全文件无 `innerHTML`。
- **View 权限正确收敛编辑控件。** `apps/web/public/app.js:762-773` 对非 edit 隐藏画笔/橡皮/Submit 与颜色/线宽/同步控件。
- **`/api/share/:mode/:id/:token` 与 `/api/sessions/:id`（header）两条读取路径均被使用**（前者用于浏览器首屏带 URL token 加载，后者用于 XHR 带 header），非冗余死代码。
- **`supertest`（backend devDependency）确在 `apps/backend/test/backend.test.mjs` 中使用**，非死依赖（与 `form-data` 不同）。

## 覆盖范围

- **已检查：** backend 全部 route/lib（server、config、store、auth、ids、png、sessions、share、screenshots、annotations、files）；mcp-bridge（index、publish、collect、backend-client、flowimage-config）；web 前端 `app.js`/`index.html`/`styles.css`；plugin（settings-server、SKILL.md、.mcp.json、plugin.json）；根 `package.json`、workspace、`.env.example`、`scripts/check-dev-server.sh`；落地文档与既有审计文档；全部测试文件。
- **已执行：** `pnpm -r test`（49 用例全绿）、`node --test` 插件测试；针对泄漏/钳制/别名/QR/retention/依赖的定向 `grep` 取证。
- **未检查：** 真实公网 `flow-image.like-water.net` 部署与 TLS/反代/WAF；真实 iPad Safari 的 Apple Pencil 压感与大画布渲染表现；Codex 端对 MCP image content 的实际渲染；负载/并发测试；依赖 CVE 扫描（`pnpm audit` 未在本轮执行）。

## 修复优先级建议

1. **先修第一节 1a（画布钳制）。** 这是唯一可能直接破坏核心 iPad 场景的问题，改动小、有测试可托底。
2. **顺带修 1b（Object URL 释放）与 1c（start 兜底）。** 同属前端、低风险。
3. **执行第二节全部最小化删减。** 删 `form-data`、删“Show QR”、去重 `publish.mjs` 校验与 `server.mjs` 双构造、评估 `viewer_url` 收敛、清本地 `pairs/`。每项独立、低风险、贴合最小化方向。
4. **第三节可移植性，按是否分发决定。** 若仅本机自用可暂缓；一旦要分发，硬编码路径与大小写是第一个会断的点。
5. **第四节限流，作为公网发布前的 gate。** 本地/局域网自用不阻塞；公网暴露前必须补。
6. **第五节 nits，随手清理即可。**

---

# 复审（Round 2）

复审日期：2026-06-29（同日，开发者按第一轮意见修正后）
复审范围：核验第一轮五类问题的处置，并审计本轮新增/改动的代码
测试基线：`pnpm -r test`（backend 14、web 34、mcp-bridge 11）+ `node --test` 插件（1），合计 **60 用例全绿**（较第一轮 49 增加 11，含新增测试）
方法：以 `git` 工作树现状为准，逐条对照第一轮 finding，并对新引入的 SQLite 存储层与限流层做正确性核验

## 复审结论

第一轮五类问题**基本全部修复，质量高**，并补充了测试。本轮最大的改动是把存储层从“文件系统 JSON”迁移到 **better-sqlite3**——落地规范（参数化查询、WAL、事务化清理、字节记账），且**实现文档已同步更新**（不再有“无 SQLite”的旧表述）。

代价是：SQLite 迁移按“最小化”尺子看比所需更重，并带出三个小尾巴（rate_limits 无清理、外键未启用、迁移残留死代码）。这些都不是阻断项；真正值得动手的只有一处（rate_limits 清理）。

## 一、第一轮五类问题处置核验

| 第一轮问题 | 状态 | 证据（现状） |
|---|---|---|
| 1a 画布初始尺寸突破 `WORKSPACE_MAX_SIDE` | ✅ 已修 | `apps/web/public/app.js:79-83` 对图本身 `imageScale` 与工作区均 `Math.min(WORKSPACE_MAX_SIDE, …)`，并按钳制后尺寸重新居中 |
| 1b Object URL 泄漏 | ✅ 已修 | 新增 `apps/web/public/app.js:194` `releaseObjectUrl`；底图换帧（`:381`）、`drawImageUrl`（`:376`）、QR（`:896/:913`）、退出（`:983-984`）各路径均释放 |
| 1c `start()` 未捕获异常 | ✅ 已修 | `apps/web/public/app.js:949` 整个 `start()` body 包入 try/catch |
| 2 `form-data` 死依赖 | ✅ 已删 | `apps/mcp-bridge/package.json` 不再声明 `form-data` |
| 2 “Show QR” 假按钮 | ✅ 已实现 | 新增 `apps/backend/src/routes/qr.mjs`（`qrcode` 生成 SVG）；前端经 `<img src=blob:>` 渲染（SVG 脚本不执行，XSS 安全）、限流、对象 URL 释放 |
| 2 `server.mjs` 双重 `makeConfig` | ✅ 已修 | `apps/backend/src/server.mjs:57-58` 改为 `createApp()` 后取 `app.locals.config` |
| 2 `viewer_url` 兼容别名 | ✅ 已删 | `apps/backend/src/routes/sessions.mjs:104-113` 仅返回 `view_url` |
| 3 硬编码绝对路径 + 大小写不一致 | ✅ 基本修 | `plugins/flow-image/.mcp.json` 改用相对 `scripts/mcp-server.mjs`；`plugins/flow-image/scripts/mcp-server.mjs` 从自身位置解析 repo 根（可移植）；SKILL.md / README 已清除写死路径 |
| 4 未鉴权建 session + 无限流 + 内存上传 | ✅ 已修 | `apps/backend/src/lib/rate-limit.mjs` 接入 create（`sessions.mjs:94`）、upload（`screenshots.mjs:21`）、annotation 提交（`annotations.mjs:44`）、qr；三层控制：per-IP 请求数、per-IP 字节数、per-session 存储上限（`screenshots.mjs:37-44`、`annotations.mjs:55-63`） |
| 5 数据目录双层命名 `data/sessions/sessions/` | ✅ 已修 | `apps/backend/src/lib/config.mjs:8` 收敛为 `data/`；PNG 落到 `apps/backend/src/lib/store.mjs:82` `data/files/sessions/` |
| 5 MCP 文案中英文混排 | ◐ 大部修 | `apps/mcp-bridge/src/tools/publish.mjs:50-55` 已统一中文；`apps/mcp-bridge/src/tools/collect.mjs` 仍残留英文兜底串（"No ready FlowImage results"、"Page N:"） |
| 5 retention `max="720"` 不随单位变 | ✗ 未动 | `apps/web/public/index.html:51` 仍写死 720（后端 `normalizeRetentionHours` 会钳到 30 天，纯 UX） |

## 二、复审新发现（均由 SQLite 迁移引入，非阻断项）

### [Low-Medium] `rate_limits` 表无清理，将随不同来源 IP 无界增长

- **Affected asset:** `apps/backend/src/lib/store.mjs` 限流持久化；SQLite 数据文件体积。
- **Evidence:** `apps/backend/src/lib/store.mjs:316-345` `consumeRateLimit` 只有 `SELECT` 与 `INSERT … ON CONFLICT DO UPDATE`；全文件无 `DELETE FROM rate_limits`。表结构见 `:72-77`。
- **Impact:** 每个 `bucket:ip`（以及 upload 的 `bucket:bytes:ip`）都会留下一行且永不回收。公网长跑、来源 IP 多样时，`rate_limits` 表单调增长。单行很小、非灾难性，但属无界资源占用，与本轮加固限流的初衷相悖。
- **Reproduction or reasoning:** 过期 bucket（`reset_at <= now`）只有在“同一 key 再次到来”时才被复用覆盖；从此不再出现的 key 永久驻留。
- **Recommended fix:** 在 `cleanupExpiredSessions`（`:276-290`）的事务里顺带 `DELETE FROM rate_limits WHERE reset_at <= @now`；该清理已在 createSession / setRetention 时触发，无需额外定时器。
- **Verification:** 增加 store 单测：写入若干已过期 bucket 后触发 cleanup，断言过期行被删、未过期行保留。
- **Confidence:** High。

### [Low] 外键声明 `ON DELETE CASCADE` 但未启用 `PRAGMA foreign_keys = ON`

- **Affected asset:** `apps/backend/src/lib/store.mjs` schema 完整性约束。
- **Evidence:** `apps/backend/src/lib/store.mjs:54/69` 在 `screenshots`/`results` 上声明了 `FOREIGN KEY … ON DELETE CASCADE`；构造器 `:25` 仅设置 `journal_mode = WAL`，未设 `foreign_keys = ON`。better-sqlite3 默认外键关闭。
- **Impact:** 声明的级联与引用完整性约束实际未生效。当前 `cleanupExpiredSessions:281-289` 用事务按 `results → screenshots → sessions` 顺序手动删除，兜住了孤儿行，因此**无实际数据残留 Bug**；但 schema 与运行行为不一致，属潜在隐患（未来若新增删除路径、忘了手动删子表，就会留孤儿）。
- **Recommended fix:** 二选一：① 构造器加 `this.db.pragma("foreign_keys = ON")`，依赖 CASCADE 自动级联，删除路径只删 sessions 行；② 或保留手动删除并在注释中说明外键为文档性约束。建议选 ①，更稳。
- **Verification:** 启用 pragma 后，删除 session 行断言子表行随之消失；全套 `pnpm test` 仍通过。
- **Confidence:** High。

### [Minimization] 迁移后残留死代码 `sessionJsonPath` / `sessionJsonPathFor`

- **Affected asset:** `apps/backend/src/lib/store.mjs`。
- **Evidence:** `apps/backend/src/lib/store.mjs:93-99` 仍定义这两个方法，但迁移到 SQLite 后 `session.json` 不再写入或读取（`getStandaloneSession:262-267` 走 db 查询），全 `src` 无其它调用方。
- **Impact:** 纯死代码，易误导读者以为仍有 JSON 落盘。
- **Recommended fix:** 删除这两个方法。
- **Confidence:** High。

### [关注点·非缺陷] SQLite 比“最小化修复”更重，建议有意识地认领

- **Evidence:** 限流状态表 `rate_limits`（`:72-77`）与 session 元数据均落 SQLite；后端新增原生依赖 `better-sqlite3`（`apps/backend/package.json:9`），`pnpm-workspace.yaml` 增加 `allowBuilds: better-sqlite3: true`。
- **Reasoning（最小化视角）:** 限流计数是易失状态（窗口默认 10 分钟，重启丢失无影响），一个内存 `Map<key,{count,bytes,resetAt}>` 即可满足，无需持久化；per-session 字节上限亦可由文件大小求和得到。也就是说，单为闭合“限流”这一项，并不需要引入数据库。
- **平衡评价:** SQLite 同时解决了 2026-06-27 旧审计提出的“凭据查询全量文件扫描”问题、让查询更干净，并且实现文档已同步更新为 SQLite 表述（`docs/2026-06-29-flowimage-implementation.md:553` 等），属**有依据、已记录**的工程取舍。代价是多一个原生依赖与构建链、部署可移植性略降。
- **Recommendation:** 不要求回退。仅建议明确认领该取舍；若后续要回到极简形态，可考虑把限流改为进程内 `Map`，把数据库收回到仅 session 索引，或反之坚持 SQLite 并补上 N1/N2。
- **Confidence:** Medium（属架构取舍，非客观缺陷）。

## 三、剩余小尾巴（可选）

- `plugins/flow-image/.mcp.json:9` 的 `FLOWIMAGE_CONFIG_PATH: /Users/ryu/.flowimage/config.json` 仍写死用户家目录，且与 bridge 默认值相同——**冗余且非可移植**，可整条 `env` 删除（bridge 会回落默认 `~/.flowimage/config.json`）。
- `apps/mcp-bridge/src/tools/publish.mjs:24-27` 仍在 zod 之外手写校验——可接受（作为独立单元自检），低优先级。
- `apps/mcp-bridge/src/tools/collect.mjs` 的英文兜底串与 retention `max` 未随单位变（见上表）——纯 polish。

## 复审优先级建议

1. **修 N1（`rate_limits` 清理）。** 唯一有实质价值的一处，一句 `DELETE` 即可，建议带单测。
2. **修 N2（启用 `foreign_keys` pragma）+ N3（删死代码）。** 顺手清理，低风险。
3. **认领 N4（SQLite 取舍）。** 决定坚持 SQLite 还是回到内存限流；坚持则务必先做 N1/N2。
4. **剩余小尾巴随手清。** `.mcp.json` 冗余 env、collect 文案、retention max。

## 复审覆盖

- **已执行：** `pnpm -r test`（backend 14 / web 34 / mcp-bridge 11 全绿）、`node --test` 插件（1 绿）；针对 workspace 钳制、`releaseObjectUrl`、限流接线、`rate_limits` 清理、外键 pragma、死代码、硬编码路径的定向 `grep` 取证；通读新增 `store.mjs`、`rate-limit.mjs`、`qr.mjs`、`scripts/mcp-server.mjs`。
- **未执行：** 真实公网部署与并发/负载压测；真实 iPad Safari 大图渲染与 Pencil 压感；`pnpm audit` 依赖 CVE 扫描；better-sqlite3 在目标部署环境的预编译/构建验证。
