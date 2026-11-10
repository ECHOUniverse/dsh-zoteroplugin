# `@hanxu131/dsh-zotero` 实施规格

版本：0.2.0-m7（M0 骨架、M1 数据层、宿主服务/安全路由/Agent 工具/写审批、
**M2/M3 右栏标签 UI、M8 会话集成、M4 PDF 阅读/全文/定位/会话高亮/保存高亮、
M7 DOI/arXiv 元数据导入、attach_pdf URL 下载、安装探测/启动与 `zotero://`
deep link、`export_bib` 工作区写入与 `attach_pdf` 本地路径模式**（M8 旧
`insertText` 形态与 Zotero Context Chip/Card 形态的自动化层均已落地；芯片/
卡片的真机形态仍待 V-13 验收，见 ADR 0004）已落地）。
上游语境见 [CONTEXT.md](../CONTEXT.md)；架构决策见
[ADR 0001](adr/0001-local-api-only-zotero-10.md)、[ADR 0002](adr/0002-dsh-two-halves-webserver-single-right-tab.md)、
[ADR 0003](adr/0003-differentiated-write-approval.md)、
[ADR 0004](adr/0004-reference-chip-for-zotero-context.md)（会话上下文以 Zotero
Context Chip/Card 承载，自动化层已完成、真机 V-13 待验收）。

> **真机只读验收状态（DSH Desktop 0.2.1-rc.5，macOS，全程只读，未写真实
> Zotero）**：插件经 desktop profile `link:` 安装载入（装载前 profile 已备份至
> `/Users/hanxu/.dsh/profiles/desktop/backup-20261101-141702/`）；真实 health
> 200，无认证直连 `/status` 401（预期认证栅栏）。宿主 Cordis 晚绑定修复后：
> 右栏真实显示个人文库 803 条；元数据检索「Double-shock」返回 1 条；全文短语
> 「elusive BC8 carbon」metadata 模式 0 条、everything 模式 2 条；条目详情与
> PDF 注释打开正常；PDF（FHPRDEEL）右栏真实渲染 22 页，页码/缩放控件可见；
> Add to chat 按正确 item key（CR6G7I2U）与 PDF key 插入可编辑草稿且未发送
> （旧 `insertText` 形态）。
> **未真机验收**（仅自动化覆盖）：Ask 真实发送（避免向外部模型发测试消息）、
> Zotero Context Chip/Card 真机形态（V-13——自动化层已完成、`npm run verify` 全绿，
> 但 `ctx.inject`/`insertReference`/UserText 卡片均无真机证据）、
> 真实 Zotero 写入/授权/highlights 保存、DOI/arXiv 外网导入（V-11）、Open
> Zotero/`zotero://` deep link 与真实工作区 `export_bib` 落盘（V-12）；
> Windows/Linux 未实机。逐验证点状态见 §5.1，逐里程碑见 §9。

> **宿主阶段实现状态（M2/M5/M6 自动化层）**：在 M1 数据层（`domain/`、`zotero/`，
> fake Zotero 回放测试）之上，本阶段落地：
>
> - **`host/`**：`services.ts`（DSH 服务面本地结构化类型 + 防御式查找，官方
>   `dsh-host-open-in-app` 同款模式；0.2.1-rc.2 官方包未发布 npm，运行时无法从
>   插件目录 import，注册点本身仍是官方 `ctx.webServer.register` /
>   `ctx.connection.requestRejection` / `ctx.credentials.*` / `ctx.tools.register`
>   / `ctx.approval.request`）；`keystore.ts`（官方 credentials durable
>   per-plugin grant record 持久 KeyStore，`zotero/server-<sha256 指纹>`，payload
>   核验 serverId；无 credentials 服务退化为内存 KeyStore，不猜测落盘路径）；
>   `session.ts`（`ZoteroSession` 门面 + 配置热更新安全重建 + 事件 hub）；
>   `events.ts`（viewSeq 单调、有界历史、订阅清理）；`respond.ts`/`routes.ts`
>   （官方 fence 门 + method/content-type/body 校验 + 统一错误 envelope +
>   SSE `/events`）。`index.ts` 组装 `createRuntime`/`apply`。
> - **`tools/`**：`define-tool.ts`（官方 defineTool 的本地镜像，产出与官方一致的
>   注册形状；含官方校验器的关键语义——type 数组不支持、可空用 oneOf）；`approval.ts`
>   （fail-closed 审批包装）；`index.ts`（14 个工具：8 只读/视图 + 6 写工具，
>   写工具 `isConcurrencySafe: false`，先 DSH 审批再走同一 Zotero 授权门面）。
> - **路由表**：health（最小公开）、status（真实 probe）、libraries、collections、
>   items（q/mode/tag/sort/direction/start/limit/collection/search/keys）、
>   items/<key>（详情）、children、annotations、export（BibTeX/RIS + 本机路径
>   剥离）、events（SSE）、writes/*（authorize/items/note/collection/attachment）；
>   `pdf/` 子树 501 `not_implemented` 边界；无 `connection` 服务时受保护路由 503，
>   不注册无保护接口。
> - 测试 195 用例全绿（`npm run verify`：typecheck + vitest + build + smoke）；
>   smoke 断言 status 真实探测（closed port → `not_running`）、401/403/503/501
>   行为、客户端 bundle 无 `Zotero-API-Key`/`Zotero-Server-ID`。
>
> M1 原始状态注记：连接状态机含 `unsupported` 态与 `unsupported_version` 错误码
> （Zotero 主版本 <10）；读取路径不做写探测。V-2…V-5 仍待真机验证；新增 V-9
> （Local API 导出格式形状，见 §5.1）。真机验收（状态卡片/库树只读渲染、SSE
> 导航联动、审批卡）待 UI 里程碑执行。
>
> **UI 阶段实现状态（M2/M3/M8）**：在宿主路由层之上，右栏标签不再是骨架：
>
> - **`client/store.ts`**（纯 reducer + 可订阅包装）：单标签导航栈（library /
>   items / item / reader / settings 路由；同页就地替换、栈上限 30）、`viewSeq`
>   去重、查询 draft/commit（300ms 防抖的提交逻辑为纯 action）、按 viewKey 的
>   视图加载/空/错误状态（token 防陈旧覆盖）。
> - **`client/api.ts`**：仅 shared `ROUTES` 相对 fetch；统一错误 envelope →
>   `ApiError`；AbortSignal 贯穿；SSE `connectViewEvents`（Last-Event-ID 重连 +
>   seq 严格递增去重 + close 清理）；items/collections/export 路径构建（纯函数）。
> - **`client/chat-draft.ts`**（V-6 已消解）：官方接面 = `sidebar.right.pane.tab`
>   槽的 session-scope standardProps `inputActions`（`setDraft` 写草稿不发送；
>   `submit()` 以 queue 模式提交）+ `sessionId`（证据：本机安装包
>   `dsh-cordis-client-runner` CLIENT_SLOT_API 目录、`dsh-client-ui-session`、
>   `dsh-client-ui-conversation` `ctx.uiSession.provide({ props: ["inputActions"] })`
>   与 `SessionInputShell.actions`；只读查阅未复制代码）。条目文本投影与参考
>   实现格式兼容并含 library/key/PDF key 结构化标记；无会话面时按钮禁用，
>   不降级为剪贴板、不静默发送。
> - **`client/views.tsx`**：Library（个人+群组、分类树、保存搜索、元数据/全文、
>   5 排序 × 方向、50/页 Load more 至 500、多选 + Shift 范围 + 底栏 加入对话/
>   提问/清除、加载/空/错误+重试）、Item Detail（字段表/摘要展开/分类/标签/
>   附件/笔记 DOMPurify 清洗/注释列表/导出下载/Show in Zotero 禁用标注后续）、
>   Reader 显式 M4 边界、连接状态页（ready/not_running/api_disabled/unsupported/
>   error 分状态 zh/en 指引 + 重新检查）。
> - **`client.tsx` 入口**：tab 两段注册 + session-scope props 防御式读取 +
>   SSE 驱动导航（open_item→详情/Reader 边界；show_items→Agent Items）+ 标签
>   卸载清理（关 SSE 流、中止在途请求）。
> - 样式读取 DSW `--dsw-*` 主题变量（跟随宿主主题/字体/圆角），窄栏与
>   fullscreen 可用；控件 aria/键盘可达。DOMPurify 已入发行物并在
>   THIRD_PARTY_NOTICES 登记（Apache-2.0/OR MPL-2.0）。
> - 测试 255 用例全绿（该阶段新增 reducer/api/chat-draft/组件渲染四组 seam；当前累计
>   509 用例 / 28 文件，见 §9 M8 行）；
>   smoke 断言产物不再含「初始化骨架」、含检索/详情/聊天接面标识（ROUTES、
>   inputActions、DOMPurify）、相对路由、且无任何 key/server-id。
>
> **M4 阶段实现状态（PDF 阅读与高亮，自动化层完成）**：
>
> - **`domain/text.ts`**（移植自参考实现，Apache-2.0 归属）：`buildPage` 文本
>   拼装与 span 几何、NFKC/引号连字符归一（记录原文偏移）、行尾断词合并、
>   空白折叠 + 忽略空白回退、"start … end" 跨段、跨页引文、按 Helvetica 字宽
>   比例的矩形插值（基线下 0.25/上 0.75 字号，与 Zotero 一致）、`sortIndex`
>   页序|偏移|距页顶、页范围解析、`searchPages` 关键词定位；`pageIndexFor`
>   自上游 session 移入纯函数层。22 个直测（跨页、扫描无文本、找不到、中文
>   与页坐标、容差 ≤0.5pt）。
> - **`pdf/extract.ts`**：pdfjs-dist **6.4.299**（官方稳定版，精确锁定）legacy
>   构建，**按需动态 import**——打包副本 `lib/pdfjs/legacy/pdf.mjs` +
>   `pdf.worker.mjs` 由 `scripts/copy-pdfjs.mjs` 复制并随 npm `files` 分发，
>   `node_modules` 仅为开发/测试回退（构建产物不依赖开发机 node_modules 路径）；
>   worker 主线程内联；页标签；PdfStore 按 path+mtime+size LRU=4；`%PDF-`
>   magic、256 MiB 上限、`not_pdf`/`file_missing` 映射、扫描版提示。
> - **`host/pdf.ts`（路径安全边界）**：文件路径只来自
>   `ZoteroLibrary.resolveAttachmentPath`（唯一路径接缝），路由只接受已校验
>   library+attachmentKey；附件须为存储 PDF（contentType/linkMode 校验）；
>   **双重 Zotero 解析 + realpath 比对**缓解符号链接替换竞态（12 轮交换竞态
>   测试：成功读到的永远是真实文件，竞态窗口报 `file_missing`）；`%PDF-` 与
>   大小校验；字节按 2 MiB 范围读（`fs.open+read`），info 的 sha256 按
>   mtime:size 缓存；pdf.js 资产按 kind（cmaps/standard_fonts/wasm）+ 文件名
>   双白名单服务（`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`、resolve 后仍限资产根
>   内、单文件 ≤2 MiB），遍历与非法 kind 一律 404。
> - **路由（取消 501）**：`GET /pdf/info`（bytes/parts/sha256/pageCount）、
>   `GET /pdf/part`（octet-stream 分块）、`GET /pdfjs/<kind>/<file>`（认证 +
>   白名单 + private 缓存头）；`POST /writes/highlights/save|clear` UI 写路由
>   ——显式 UI 动作不经 DSH 审批（ADR 0003 范围是 Agent 写），但走同一
>   `ZoteroWrites` 授权门面；clear 仅删会话高亮，无任何删除 Zotero 注释的路由。
>   annotations 响应新增 `highlights`（会话高亮）字段。SSE 新增状态型意图
>   `highlights`（不导航，驱动阅读器刷新）。
> - **会话高亮与工具**：`host/highlights.ts`（id 序、ids/key 增删查、savedAs
>   标记）+ session 门面 `createHighlight/findHighlights/clearHighlights/
>   saveHighlights`（保存为 Zotero 注释：annotationText=引文实际写法、
>   annotationSortIndex、annotationPosition={pageIndex,rects}，与 Zotero 原生
>   字段一致）。工具注册从 14 → 19：`read_fulltext`（页标记/印刷页码/30k 预算
>   与续读提示/扫描版提示）、`find_in_pdf`、`highlight`（quote→rects；save:true
>   先 DSH 审批）、`clear_highlights`（仅会话态）、`save_highlights`（审批三
>   路径测试保持全绿）；`open_item` 支持 page/quote 定位（quote 失败报
>   `quote_not_found`，物理页越界报 `invalid_input`）。
> - **Reader UI（懒加载 chunk）**：`client.pdf.js`（入口 `src/client-pdf.tsx`）
>   按官方 `dsh-client-modules` chunk 契约注册（`ClientBundleRegistration.chunk`
>   + `ClientBundleRequire.async`；chunk 文件名匹配 `client.<name>.js`），主
>   bundle 的 reader 路由经 `require.async('./client.pdf.js')` 加载——普通文库
>   首屏不下载 pdf.js（主 bundle 180 KB vs chunk 3.1 MB）。阅读器：canvas +
>   TextLayer 文本层（worker 内联主线程；CMap/标准字体/wasm 走认证静态路由的
>   `BinaryDataFactory`，与参考实现在同一 DSH 面板环境的验证一致）；页码输入/
>   总页/印刷页标签；缩放（0.5–4）/适宽，缩放保持当前页；翻页/高亮跳转就地
>   替换路由不压栈；用户注释与 Agent 高亮（紫 #a28ae5）同层叠加、点击弹窗
>   （保存到 Zotero / 移除会话高亮）；注释侧栏点击跳页；划选文本浮出「引用到
>   对话 / 提问」（引文 + 标题 + 物理页/页标签 + item/PDF key 结构化标记；
>   ADR 0004 起改走 Zotero Context Chip，自动化层已完成，真机形态待 V-13）；
>   加载进度/错误/扫描版提示；导航返回。
> - **分发与许可**：`lib/pdfjs/`（legacy 构建 + cmaps + standard_fonts + wasm +
>   LICENSE + wasm 组件许可）随 npm files 分发；pdfjs-dist 6.4.299（Apache-2.0）
>   与全部移植归属已登记 THIRD_PARTY_NOTICES。
> - **测试**：313 用例全绿（新增 domain/text 22、pdf extract 14、host pdf 路由
>   11、M4 工具 7 组，扩展 store/views/工具注册断言）；smoke 断言：主 bundle
>   无 pdfjs 标记且含 `require.async('./client.pdf.js')`、chunk 以
>   `{id, chunk}` 注册并含 Reader、`lib/pdfjs` 资产齐备、PDF 路由真实验证
>   （无 501）、19 工具注册、客户端无 key。
>
> **M7 阶段实现状态（元数据导入、PDF URL 下载、安装探测/启动、deep link、
> 工作区写入与本地路径附件，自动化层完成）**：
>
> - **`metadata/net.ts`（SSRF 守卫，插件唯一出站网络面）**：仅 http(s)、拒绝
>   携带凭据 URL；DNS `lookup(all)` 全地址逐个分类——IPv4 0/8、10/8、100.64/10、
>   127/8、169.254/16、172.16/12、192.0.0/24、192.0.2/24、192.168/16、
>   198.18/15、198.51.100/24、203.0.113/24、224/4、240/4，IPv6 `::`/`::1`、
>   fc00::/7、fe80::/10、ff00::/8、2001:db8::/32、`::/8` 保留段，IPv4-mapped
>   IPv6 先解包再按 IPv4 判定，字面量 IP 直接判定不触 DNS；任一地址非公开即
>   拒绝（fail-closed：解析失败/空答案/未知族均拒绝）。重定向手动跟随
>   （`redirect: 'manual'`），逐跳重过同一校验（公网→私网/loopback/换 scheme
>   的跳转在连接前失败），跳数上限 `LIMITS.downloadRedirects`（5）。loopback
>   无豁免——Zotero Local API 只经 `zotero/client.ts` 访问。
> - **`metadata/metadata.ts`（移植自参考实现并按上表修改）**：`parseIdentifier`
>   （DOI/`doi:`/doi.org/dx 链接/尾部标点；arXiv 新旧式 id/版本/abs·pdf·html
>   链接/`10.48550/arXiv.*`）；`cslToZotero`（类型映射表、JATS 抽象清洗、literal
>   日期与机构作者、按类型的容器/事件/机构字段）；`arxivToZotero`（preprint、
>   分类→tags、comment/journal_ref/已发表 DOI→extra、错误 entry→
>   `metadata_not_found`、PDF 链接带 entry 版本）；`resolveIdentifier`（doi.org
>   内容协商 `application/vnd.citationstyles.csl+json`、arXiv `id_list` 查询、
>   `LIMITS.metadataTimeoutMs` 20s、404/非 2xx/非 JSON→`metadata_not_found`）；
>   `downloadPdf`（content-length 与流式双 100 MiB 上限、60s 超时、`%PDF-`
>   magic 于首 KiB、content-disposition/URL 路径文件名清洗）。
> - **`session.addItem`**：identifier 解析失败 `invalid_input` 且零网络；CSL/
>   Atom → `cleanItem`（经 `itemTypeFields` 过滤非法字段、无 DOI 字段的类型把
>   DOI 移入 extra、必须有 title）；**DOI 去重**（Local API `q=<doi>&qmode=
>   everything` 只读查询 + raw 比对 DOI/extra，命中即返回既有 key，不创建）；
>   collections 经 `resolveCollection`（键或名）；tags 合并；arXiv PDF 自动
>   附加（下载失败→warning，条目照常创建；三步上传；成功发布 open_item 意图）。
> - **工具层**：`add_item`（identifier / 结构化 fields+itemType / 合并覆盖；
>   collections/tags/pdfUrl/attachPdf 参数；**DSH 审批在一切外部网络与 Zotero
>   写入之前**，拒绝→零请求；schema/render 完整；`isConcurrencySafe: false`）；
>   `attach_pdf` 三来源单选（url/path/bytesBase64），URL 走 SSRF 守卫下载，
>   path/bytes 在审批后读取，统一 100 MiB/`%PDF-`/裸文件名校验。19 工具面
>   不变。
> - **许可**：`metadata/metadata.ts` 移植归属登记 THIRD_PARTY_NOTICES（标识符
>   文法、CSL/Atom 映射、文件名清洗与下载形状自上游；SSRF 守卫/超时/错误映射
>   为本插件修改）。
> - **安装探测与启动（`zotero/install.ts`）**：候选布局跨平台（macOS
>   `/Applications` 与 `~/Applications` 的 `.app`、Windows ProgramFiles/
>   ProgramFiles(x86)/LOCALAPPDATA、Linux /opt 与 /usr/lib 与 /usr/local/lib
>   与用户目录 + flatpak + `PATH`）；版本只从 bundle 读取（macOS `Info.plist`
>   → `Contents/Resources/application.ini` 回退，其余 `application.ini`），读
>   不到就不给版本，绝不从路径猜；未安装返回 `missing` + `searched` 列表
>   （home 缩写为 `~`）。启动仅生成平台白名单命令（macOS `/usr/bin/open -a
>   <app>`、flatpak `flatpak run org.zotero.Zotero`、其余直接执行解析出的可
>   执行文件），argv 数组、无 shell、错误包装为 `zotero_not_installed`/
>   `zotero_error`。
> - **`zotero://` deep link（`zotero/desktop.ts` + `host/routes.ts`）**：
>   `select`/`open-pdf`（可带 `?page=`）URL 全部服务端构造，library/key/page
>   在构造处再校验一次（纵深防御）；打开经平台白名单（macOS `/usr/bin/open`、
>   Windows `rundll32 url.dll,FileProtocolHandler`、Linux `xdg-open`）+ argv
>   数组、无 shell；`POST /desktop/launch` 与 `POST /desktop/open` 为显式 UI
>   动作、走认证 fence，客户端传入的 `url`/`command` 字段一律忽略（响应 URL
>   是服务端构造值）；status 路由在 Zotero 不应答时附 `install` wire（state/
>   version/searched），**永不携带绝对安装路径**；Setup「Open Zotero」、详情
>   与 Reader「Show in Zotero」完整接线（i18n zh/en 齐全），ready 时零探测。
> - **`export_bib` 工作区写入（`session.writeWorkspaceFile`）**：可选 `path`
>   必须是工作区相对且以 `.bib` 结尾；经官方 `ctx.fs.resolve(path,{cwd})` +
>   `ctx.fs.writeText(target, content, expected)` +
>   `ctx.workingDirectory.ensure(agent)`（cwd 来自会话，绝不 `process.cwd`）；
>   绝对路径/盘符/`..` 段
>   /realpath 解析后越界（符号链接逃逸，`isInside(root, displayPath)`）一律
>   `path_outside_workspace`；默认 `expected={kind:'createIfAbsent'}`（后端
>   保证不覆盖，`FS_NOT_OBSERVED` 映射为「先读再 `overwrite: true`」提示），
>   `overwrite: true` 才放开为原子替换；无官方服务/无会话目录 fail closed
>   只返回文本。工具层：无 `path` 为纯读（并发安全、不触发审批）；带 `path`
>   先 DSH 审批（拒绝→零写入）再写，`isConcurrencySafe` 按参数区分。
> - **`attach_pdf` 本地路径模式**：与 URL/内联字节同一审批序（拒绝→不读文件
>   不落库），批准后 `stat`+`readFile`，统一 100 MiB/`%PDF-`/裸文件名（路径
>   分隔符与 `..` 拒绝）校验后走同一 `writes.attachFile`。
> - **测试**：413 用例全绿（新增 metadata 20、metadata-net 20、session 导入 6、
>   工具 M7 网络/审批 5、安装/deep-link 21、桌面路由与 install wire 11、
>   工作区写入与 path 附件 17；覆盖：审批前零网络（identifier 拒绝→零外部
>   请求零写入）、重复 DOI、CSL/Atom fixtures、SSRF 地址分类与重定向逐跳
>   复检、abort 传播、大小上限（声明与流式）、magic、文件名清洗、arXiv PDF
>   自动附加与失败降级、跨平台候选布局与 missing 列表、spawn 白名单 argv、
>   deep link 构造/拒绝/走私字段、install wire 不泄路径、路径安全（绝对/
>   `..`/符号链接逃逸/默认不覆盖/后端守卫映射）、attach path 审批先行）。
>   外部网络全部为注入 fake + fake DNS；文件系统与 spawn 全部为注入 fake
>   seam；Zotero 侧为本地 fake 服务器，不触真实外网、真实 Zotero 写入、真实
>   进程启动与真实 deep link。
>
> **最终代码审查修复（自动化层完成）**：
>
> - **DOI 去重遍历全部候选**：`session.addItem` 的去重查询（`q=<doi>&qmode=
>   everything`，只读）改为对返回的全部非 attachment/note 候选逐一 `raw`
>   读取并比对 DOI/`extra`（大小写不敏感，语义不变），任一命中即返回既有
>   key 不创建——搜索可能把"仅提及 DOI 的条目"排在真正命中之前；无命中仍走
>   创建路径。新增"重复 DOI 在第 2/后续候选"测试（decoy 条目标题含 DOI 且
>   按 dateModified 排前），断言不多余创建。
> - **畸形 `%` 输入不再 500**：`parseIdentifier` 与 `downloadPdf` 文件名
>   解码处的 `decodeURIComponent` 均捕获 `URIError`——前者按非标识符处理
>   （上游映射 `invalid_input`，零网络零写入），后者映射 `download_failed`；
>   合法 `%xx` 转义解码行为不变。
> - **IPv6 `::/8` 保留段真 /8**：`metadata/net.ts` 的保留段检查由误用的
>   前 16 位改为真正的前 8 位全零（`::/8`），`0:400::`（组 1 全零、组 2
>   非零）与 `1::`/`80::`/`ff::` 一律拒绝；其余 CIDR（fc00::/7、fe80::/10、
>   ff00::/8、2001:db8::/32、公网单播等）回归测试保持不变。
> - **Setup 显示本地 API 地址**：`StatusResponse` 新增必填 `baseUrl`（宿主
>   当前 `localApiBaseUrl`，host 侧已校验 loopback 且无凭据，纯展示）；
>   Setup 视图全状态展示该地址，并明确引导"修改请前往 DSH 插件设置的
>   `localApiBaseUrl` 表单"——面板不提供任何 URL 写路由。zh/en i18n、
>   协议/路由/组件测试与本节同步更新。
> - **低风险重复治理（不改公开行为）**：最佳 PDF 附件解析提取为
>   `domain/items.ts` 的 `bestPdfKeyOf` 供 session/routes/tools 复用；
>   Zotero 托管字段集合 `ZOTERO_MANAGED_FIELDS` 收敛到 `domain/model.ts`
>   （routes 与 tools 共享）；路由 key 段与 item 投影复用 `KEY_PATTERN`/
>   `isItemKey`；client store 的 `push` 分支复用 `pushRoute`；client api 的
>   JSON envelope 解析合并为单一 helper。`host/session.ts` 不做大规模拆分。

> **会话集成形态更新（自动化层已完成，真机 V-13 待验收，ADR 0004）**：Add to chat /
> Ask 不再向草稿插入固定格式多行文本，改为插入 **Zotero Context Chip**；消息、队列
> 与待发回显把同一份展开文本折叠为 **Zotero Context Card**。接面、降级与验收口径
> 见 §1 平台要求、§5.1 V-13、§6、§8、§9；旧 `insertText` 形态保留为降级路径。实现
> 落在三个新文件上：`client/context-chip.ts`（ref base64url 编解码 + 模型文本投影 +
> 短标签 + 8k 上限）、`client/context-card.tsx`（UserText 规则匹配 + 卡片渲染 +
> hover portal）、`client/context-chip-source.ts`（`@` source 注册 + codec +
> `insertReference` 插入 + 旧路径降级 + `installChipRuntime`/`currentChipRuntime`）；
> 入口在 `client.tsx` 以可选 `ctx.inject(['inputTriggers','conversation','sessions',
> 'uiConversation'])` 接入，`ChatInfo` 增加 `sessionId` 与 live getter `chip`。
> 自动化验收：`npm run verify` 全绿——`tsc --noEmit` 无错、`vitest run` **28 文件 /
> 509 用例全过**（新增 26+24+19 = 69 例）、`npm run build` 成功（`lib/client.js`
> 216270 字节）、`npm run smoke` 四条断言通过（客户端 bundle 契约、宿主路由表/19
> 工具、pdf.js 资产、无凭据头）。
>
> **实现期修正（属设计事实，已并入实现）**：① `ref` 必须带**主 PDF 附件 key**，
> 否则模型文本会丢 `· PDF <key>` 标记——那是 `read_fulltext`/`find_in_pdf`/`cite`
> 的唯一凭据；② `ChatInfo.chip` 是**按调用时读取的 getter**（`currentChipRuntime()`），
> 因为 `ctx.inject` 的服务可能晚于首次渲染到达，捕获 `null` 会把降级路径永久钉死；
> ③ `createChipRuntime` 接受 `options.available`，避免为探测可用性而二次注册同一个
> `@` source（宿主对重复 trigger/name 抛错，会导致芯片永远不可用）。
>
> 芯片与卡片需 DSH ≥ 0.2.2-rc.1（`engines.dsh` 不抬高）；**真机行为一律仍标注
> 「V-13 待真机验证」**，未证实行为不得按已验证书写。

本规格是后续 coder 的执行依据。所有 DSH 侧 API 引用均标注其官方来源
（本机 0.2.1-rc.2 包的 `.d.ts` / README）；未在本机类型或参考实现中得到证实的
行为一律列为 **验证点（V-n）**，实现到对应里程碑时必须先验证再编码，不得凭
猜测填充。Zotero Local API 侧行为以参考实现（zai-org/zcode-plugins
`ui-plugins/zotero` 0.2.1，Apache-2.0，只读参考未复制代码）的公开契约文档
`src/CONTRACT.md` 及其客户端实现为依据，并标注验证点。

---

## 1. 目标与范围

**Reference Parity**（CONTEXT.md）：首版用户可见功能对齐 ZCode 官方 Zotero 插件：

| 域 | 功能 |
| --- | --- |
| 文库 | 个人库 + 群组库列表；分类（collections）树；标签；保存搜索（saved searches） |
| 检索 | Metadata Search（`q` + titleCreatorYear）与 Full-text Search（`everything` 模式）两种模式；排序（dateModified/dateAdded/title/creator/date）；分页；标签/集合/保存搜索过滤 |
| 条目 | 详情视图（creators、字段、摘要、附件、笔记、所属集合）；DOI/arXiv 元数据添加；附件三步上传；笔记；条目更新（按版本 PATCH） |
| PDF | 内嵌阅读（pdf.js）；逐页文本；页码标签；注释（annotations）列表；会话内高亮与保存为 Zotero 注释 |
| Agent | 只读工具（检索/详情/全文/PDF 定位/引文/注释搜索）与写工具（经 DSH 审批 + Zotero 授权）；会话内高亮；面板视图联动（open_item / show_items / highlight） |
| 会话 | Add to chat（条目/引用以 **Zotero Context Chip** 加入可编辑 Chat Draft，模型收到完整展开文本）；Ask（问题文本 + 芯片一起发送）；消息/队列/待发回显折叠为 **Zotero Context Card**；deep link（从对话打开具体条目/页）；导出 `.bib` |
| 连接 | 连接状态探测；Zotero 未安装/未运行/未开启 Local API 的分状态引导 |

**非目标（明确不做）**：

- 直连 `zotero.sqlite` 或任何绕过 Local API 的数据通道（ADR 0001）。
- Zotero Web API（api.zotero.org）作为数据源；公开群组免登录访问。
- Zotero < 10 的兼容或降级（探测到即明确报告不支持）。
- 首版对 Windows / Linux 的实机验证承诺（代码跨平台可移植，实机测试仅 macOS）。
- 插件删除条目、清空文库等破坏性操作（参考实现同样不提供）。
- 实现非 Zotero 的文献管理器（JabRef、Mendeley 等）。

**平台要求**：DSH 桌面版 0.2.1-rc.1 … <0.3.0-0（`engines.dsh`）；macOS 实测基线；
Zotero 桌面 10+ 且开启 Local API（写入需用户在 Zotero 中授权）。Zotero Context
Chip / Card 需 **DSH ≥ 0.2.2-rc.1**（`engines.dsh` 不抬高；检测不到
`inputTriggers`/`conversation`/`uiConversation` 时回退 `insertText`，见 ADR 0004）。

---

## 2. 架构（已定，见 ADR 0002）

```
┌─ DSH 桌面版（profile desktop） ──────────────────────────────┐
│ Host half（lib/index.js，Node）                               │
│  ├ Config schema（schemastery，volatile）                     │
│  ├ webServer 路由 /dsh-zotero/*（prefix 注册）                 │
│  │   ├ 读路由：文库/检索/条目/注释/PDF 分块/导出                │
│  │   └ 写路由：仅转发到 ZoteroLocalClient（带授权状态机）        │
│  ├ ZoteroLocalClient：Local API 唯一出口（连接/授权/key 落盘）   │
│  └ Agent 工具（ctx.tools.register，defineTool）                │
│        写工具执行前 ctx.approval.request（ADR 0003）            │
│                                                               │
│ Client half（lib/client.js，__ModuleLoader__ 工厂）            │
│  ├ sidebarRightTabs.register（page 型 tab，kind=zotero）       │
│  ├ slots: sidebar.right.pane.tab（keyed，key=包名）            │
│  ├ 标签内 store（自建，不用宿主 session store）                  │
│  └ 相对路径 fetch 同源调用 /dsh-zotero/*；不持有任何 key          │
└───────────────────────────────────────────────────────────────┘
          │ HTTP (loopback)                    │ HTTP (loopback)
          ▼                                    ▼
   Zotero Local API  http://127.0.0.1:23119/api/
```

固定约束（评审红线）：

1. 客户端半不出现 `Zotero-API-Key`、`Zotero-Server-ID` 或任何 key 持久化。
2. 宿主半只连接配置的 `localApiBaseUrl`（默认 loopback:23119）；上传地址必须
   校验为该 base 下的 `/api/local/uploads/<token>` 路径（见 §4.5）。
3. 写路径唯一：任何写 Zotero 的代码都必须经 `ZoteroWrites` 门面，便于审计与测试。

---

## 3. 代码布局（里程碑推进时逐步填充）

```
src/
  index.ts               宿主半入口：name/inject/Config/createRuntime/apply（已实现：组装 session+routes+tools）
  client.tsx             客户端半入口：tab 类型 + keyed 槽注册 + session-scope props（sessionId/inputActions）+ SSE 接入（M2/M3/M8 已填充）
  client/
    store.ts             M2 已完成：导航栈纯 reducer（viewSeq 去重/防抖提交/视图数据状态）+ 可订阅包装
    api.ts               M2 已完成：相对 fetch、错误 envelope、AbortSignal、SSE 重连去重、路径构建、导出下载
    chat-draft.ts        M8 已完成（旧形态）：Chat Draft / Ask 投影 + 官方 inputActions 面防御式接入（V-6 消解）；芯片形态下仅作降级路径的文本投影
    context-chip.ts      M8 已完成（自动化层，已验证）：ref base64url 编解码 + 模型文本投影（保留 `· PDF <key>`）+ 短标签 + 8k 上限，纯函数
    context-card.tsx     M8 已完成（自动化层，已验证）：`uiConversation.userText` 规则匹配 + `conversation.user.text.node` 卡片渲染 + hover portal（按 key 查 Local API）
    context-chip-source.ts M8 已完成（自动化层，已验证）：`@` source 注册 + codec + `insertReference` 插入 + 旧 `insertText` 降级 + `installChipRuntime`/`currentChipRuntime`
    views.tsx            M2/M3 已完成：Library / Agent Items / Item Detail / Reader 边界 / 连接状态视图
    i18n.ts              已完成：zh/en 词典（跟随宿主 locale）
    styles.ts            已完成：DSW 主题变量样式（注入一次）
    icons.tsx / ui.tsx   已完成：内联 SVG 图标与共享 atoms/hooks
  shared/protocol.ts     两半共享常量、wire 类型、传输上限、事件形状（已扩展至当前路由面）
  zotero/
    client.ts            M1 已完成：ZoteroLocalClient（探测/读取/授权/写入/上传；fetch/clock/sleep 可注入）
    auth.ts              M1 已完成：KeyStore 接口 + 内存实现（持久化见 host/keystore.ts）
    library.ts           M1 已完成：只读访问层（集合/条目/注释/导出 → contract 结构，版本缓存）
    writes.ts            M1 已完成：写门面本体（批量 ≤50、PATCH 版本冲突重试、附件三步上传并测试）
    install.ts           M7 已完成：跨平台安装探测（macOS .app / Windows / Linux+flatpak+PATH）、bundle 版本读取、白名单启动
    desktop.ts           M7 已完成：zotero://select|open-pdf URL 构造与校验、平台白名单打开（/usr/bin/open、rundll32、xdg-open）
  domain/
    model.ts             M1 已完成：contract 类型（LibraryId/ItemSummary/ItemDetail/Annotation…）
    text.ts              M4：引文匹配与矩形计算（纯函数，NFKC/断词/跨页）
    items.ts             M1 已完成：条目摘要与模型文本投影（纯函数）
  host/
    services.ts          已完成：DSH 服务面本地结构化类型 + 防御式查找（官方 open-in-app 模式）
    keystore.ts          已完成：官方 credentials grant record 持久 KeyStore
    session.ts           已完成：ZoteroSession 门面（组合 + 配置热更新安全重建 + 会话能力晚绑定 attach/detach：credentials→持久 KeyStore、fs/workingDirectory→工作区写入，解绑回退 fail-closed）
    events.ts            已完成：视图事件 hub（viewSeq/有界历史/订阅清理）
    respond.ts           已完成：fence 门、JSON 应答、错误 envelope、受限 body 读取
    routes.ts            已完成：认证安全路由表 + SSE /events + 写路由 + pdf 501 边界
  tools/
    define-tool.ts       已完成：官方 defineTool 本地镜像（compile/validate/render 包装）
    approval.ts          已完成：写工具 DSH 审批包装（ADR 0003，fail-closed）
    index.ts             已完成：ctx.tools.register 19 个工具（只读/视图/写；approval 以执行期引用接入）
  pdf/
    extract.ts           M4：pdfjs-dist legacy 构建封装 + PdfStore（路径+mtime+size LRU）
  metadata/
    net.ts               M7：SSRF 守卫 fetch（DNS 全地址分类、手动重定向逐跳复检、公网 http(s) 强制）
    metadata.ts          M7：标识符文法、CSL-JSON/Atom→Zotero、resolveIdentifier、downloadPdf、文件名清洗
tests/                   vitest 单测（fixtures 见 §8；509 用例 / 28 文件）
scripts/
  build-client.mjs       客户端半打包（M0 已完成）
  smoke.mjs              构建产物冒烟（已扩展：真实 tab 渲染断言、检索/详情/聊天接面标识、status 真实 probe、key 审计）
docs/                    本规格 + ADR
```

---

## 4. Zotero Local API 契约

依据：参考实现 `src/zotero/client.ts` / `library.ts` / `writes.ts`（经真机验证的行为
文档），并对照 Zotero 官方 local API 文档语义。**每条标注来源**；标 V 的条目在实现
该里程碑时用真实 Zotero 10 复核一次。

### 4.1 连接与探测（M1）

| 行为 | 依据 |
| --- | --- |
| 基地址 `http://127.0.0.1:23119`（可配置 `localApiBaseUrl`），请求头恒带 `Zotero-API-Version: 3` | 参考实现 `client.ts`；V-2 复核 Zotero 10 是否要求更新版本头 |
| 连接拒绝（ECONNREFUSED/ECONNRESET/EPIPE）→ `zotero_not_running`；`GET /api/` 404 → 无 Local API（Zotero ≤6）；403 且响应体含 “local api is not enabled” → `local_api_disabled` | 参考实现 |
| 响应头 `X-Zotero-Version`（应用版本）、`Zotero-Server-ID`（实例标识） | 参考实现；V-2 |
| 写能力探测：不带 key 与 Server-ID 的空 `POST /api/users/0/items`（body `[]`）；回 428/401/412 → 支持授权写入；其余 4xx → 只读。写能力按官方文档统一描述为 **Zotero 10+**（"Write requests (Zotero 10+) require a local API key"）；本插件支持下限即 10，探测到只读响应一律报 `writes_unsupported`。该探测无副作用（未携带 key，Zotero 以 428 拒绝，不落库） | 官方 local API 文档；参考实现；V-3 在 Zotero 10 上确认探测响应码 |
| 库版本轮询：`GET {prefix}/items/top?limit=1&format=keys` + `If-Modified-Since-Version`，304 表示未变；`Last-Modified-Version` 响应头记库版本 | 参考实现 |
| 库列表：`GET /api/users/0/groups` → 群组；个人库固定 `user`。群组 id `g<id>`，`editable` 取 `data.libraryEditing !== 'admins'` | 参考实现 |

状态机：`unknown → ready / not_running / api_disabled / error`；`writes: unknown|available|unsupported`；
`auth: none|remembered|pending|denied`。`Zotero-Server-ID` 变化即作废已存 key
（另一实例接管端口）。

### 4.2 读取（M1–M3）

统一前缀：`user → /api/users/0`，`g<id> → /api/groups/<id>`。条目 key 字符集
`23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`（8 位）。

| 端点 | 用途 |
| --- | --- |
| `GET {p}/collections`、`GET {p}/searches` | 分类树（`data.parentCollection` 建树，`meta.numItems` 计数）与保存搜索 |
| `GET {p}/items/top?q=<q>&qmode=<m>&tag=<tag>&sort=<f>&direction=<d>&start=<n>&limit=<n>` | 全库 Metadata Search（顶层条目；`Total-Results` 头给总数，分页用 start/limit） |
| 同上 + `qmode=everything` | Full-text Search 模式 |
| `GET {p}/collections/<key>/items/top?<查询>` | 分类内顶层条目——官方 Web API v3 端点；**不用** `collection=` 查询参数（Web API 无此参数） |
| `GET {p}/searches/<key>/items?<查询>` | 保存搜索执行——Local API 本地扩展端点（Web API 不提供） |
| `GET {p}/items?qmode=everything` | 全文检索（含笔记与附件文本命中；保存搜索可能返回子条目，读取层过滤） |
| `GET {p}/items/<key>` | 条目详情（`data` 字段 + creators + collections + 子件） |
| `GET {p}/items/<key>/children` | 附件与笔记 |
| `GET {p}/items/<key>/annotations`（附件条目） | 注释列表（type/text/comment/color/pageIndex/position/sortIndex） |
| 附件文件路径 | **路径解析保持抽象**（`resolveAttachmentPath`）：默认实现经 `{p}/items/<key>/file/view/url` 取 `file://` URL（官方 local API 端点）后转本机路径；children JSON 是否含绝对路径未经证实（V-4），读取层不得断言其形状，PDF 字节始终经解析出的路径读取，不经 API |

排序键约定：`dateModified | dateAdded | title | creator | date`（映射 Zotero
`sort` 参数）；分页默认 `limit=50`（`pageSize`），检索默认返回 25、上限 100。
导出 BibTeX 时删除 `file` 字段、RIS 删除 `L1` 行（本机路径泄漏）。

### 4.3 引文与全文（M4）

- PDF 文本：pdfjs-dist legacy 构建，worker 禁用（主线程解析），逐页 `getTextContent`
  保留文本项坐标；`PdfStore` 以 `(path, mtime, size)` 为键 LRU 缓存 4 份。
- 引文匹配（`domain/text.ts` 纯函数）：NFKC → 引号/连字符统一 → 行尾断词合并 →
  空白折叠；失败再忽略全部空白；支持「开头 … 结尾」省略式与跨页匹配。
- 高亮矩形：文本项内按字宽比例插值；竖直范围取基线下 0.25 / 上 0.75 字号（与
  Zotero 自身高亮一致）；页坐标为 PDF 用户空间（左下原点，pt）。
- 排序键 `页序|偏移|距页顶`。

### 4.4 写入与授权（M6，ADR 0003）

| 行为 | 依据 |
| --- | --- |
| `POST /api/local/authorize`（body `{appName}`，头带 `Zotero-Server-ID`）弹出 Zotero「允许/始终允许/拒绝」；200 回 `{key, remember}`；403 → `write_denied`；429 → 限速（`Retry-After`）；404/405 → 版本不支持写入 | 参考实现；V-5 |
| 「始终允许」key 按 Server-ID 存 `~/.dsh` 下插件数据目录（0600）；一次性 key 校验一次即作废；401 → 重授权一次；并发授权共享同一对话框 | 参考实现 |
| 写请求头：`Zotero-API-Key` + `Zotero-Server-ID`；创建走 `POST {p}/items|collections`，批 ≤50，带 `Zotero-Write-Token` 随机 token；更新走 `PATCH {p}/items/<key>` + `If-Unmodified-Since-Version: <itemVersion>`，412 时重读版本重试一次 | 参考实现 |
| 附件三步上传：创建附件条目 → `POST /api/local/uploads/<token>` 传字节（该地址必须校验为 `localApiBaseUrl` 同源同路径，防 SSRF）→ 登记文件名/md5/mtime；失败时删除刚建的条目 | 参考实现；V-5 |
| 错误码表 | `zotero_not_running / zotero_not_installed / local_api_disabled / zotero_error / not_found / invalid_input / not_pdf / file_missing / quote_not_found / writes_unsupported / write_denied / authorize_rate_limited / version_conflict / write_failed / metadata_not_found / download_failed` |

### 4.5 元数据导入（M7）

- DOI → CSL-JSON：`https://doi.org` 内容协商（`Accept: application/vnd.csl+json`），
  20s 超时。
- arXiv → Atom：`http://export.arxiv.org/api/query`。
- PDF 下载限 http(s)、100 MB、校验 `%PDF-` 魔数、60s 超时；只访问 doi.org、
  export.arxiv.org 与调用方给定的 PDF 链接。

---

## 5. DSH 侧契约（引用官方 0.2.1-rc.2 类型）

| 契约 | 官方依据 | 本项目用法 |
| --- | --- | --- |
| 插件清单 `dsh.bundle.patch` / `dsh.client{platform,inject,immediately,external}` | `@deepseek-ai/dsh-package-manifest` `lib/types/types.d.ts`（`DshBundleManifest`、`DshClientManifest`；注意 `dsh.client.inject` 是**信息性包依赖**，非 Cordis 服务注入） | M0 `package.json` 已按此声明；`inject: ["@deepseek-ai/dsh-client-ui-sidebar-right"]` 保证右栏服务工厂先于本包物化 |
| 客户端模块系统：`window.__ModuleLoader__.load({id, factory})` 懒 CJS 工厂；平台模块表 external；bundle 路径约定 `<pkg>/client` | `@deepseek-ai/dsh-client-modules` `lib/types/client/manifest.d.ts`（`ClientBundleRegistration`、`ClientBundleRequire`、`BootManifest`）；两个本机可用模板同构 | `scripts/build-client.mjs` 生成 `lib/client.js`；`exports["./client"]` 指向它 |
| webServer 路由：`ctx.webServer.register({kind:'prefix', path, handler})`；handler 拥有完整响应生命周期；重名 (kind,path) 抛错 | `@deepseek-ai/dsh-host-webserver` `lib/types/index.d.ts`（`WebServer`、`WebRoute`）；`inject` 注入名 `webServer` | 宿主半 M0 防御式注册 `/dsh-zotero` prefix；后续读/写路由都在此命名空间下再加 `exact` 注册（prefix 命名空间占位 + exact 路由可以共存，具体匹配顺序为 exact 优先、prefix 最长前缀——官方类型注释「Longest-prefix-wins over the prefix table after an exact-table miss」） |
| 右栏 tab 两段注册：`sidebarRightTabs.register(definition)`（id 唯一、kind 判别、page 型无 patterns、guide 入口）+ keyed 槽 `sidebar.right.pane.tab`（key = definition.id） | `@deepseek-ai/dsh-client-ui-sidebar-right` `lib/types/client/tab-registry.d.ts`、`contract/slots.d.ts` | M0 已按两段式注册占位 tab；page 型每 pane 去重 → 单标签 |
| 右栏导航面：`ctx.sidebarRight.openTab(kind)` / `openResource(address)`；标签体 `tab.actions.openTab/openResource/close/bindCommands` | 同上 `service.d.ts`、`contract/slots.d.ts` | 标签内导航动作（deep link 打开条目页）用 `tabInfo().tab.actions` |
| Agent 工具：`ctx.tools.register(defineTool({name, description, parameters, output{schema,render}, execute, isConcurrencySafe}))` | `@deepseek-ai/dsh-tools` `lib/types/index.d.ts` + `schema.d.ts` | M5 注册全部工具；写工具 `isConcurrencySafe: () => false` |
| 审批：`ctx.approval.request({agent, toolName, reason, callId?, signal?}) → 'allowed-once'|…`；会话无 open turn 会拒绝 | `@deepseek-ai/dsh-user-approval` `lib/types/index.d.ts`（`ApprovalService.request`） | M6 写工具在 `execute` 内先 `await ctx.approval.request(...)`；宿主半把工具挂在 `ctx.inject(['tools'], …)`，approval 走独立的 `ctx.inject(['approval'], …)` effect 写入执行期引用——写工具每次执行时读取，晚到即被采用、缺失/解绑 fail-closed（approval 不参与工具注册，服务 cycle 不重复注册） |
| Cordis 客户端服务：`ctx.slots.inject/register`、`ctx.locale.bind/register`、`ctx.effect(cb, label)` | 本机模板（deepseekcredit-dsh）与 `@deepseek-ai/cordis` 类型 | M0 客户端半已用 |

### 5.1 验证点（实现对应里程碑前必须先验证）

| # | 验证点 | 验证方法 |
| --- | --- | --- |
| V-1 | `sidebar.right.pane.tab` 槽组件收到的 props 形状（`hooks.tabInfo` 是否按注入声明传入；`register` 选项除 `name/key/locale` 外是否需要 `inject`） | 真机装载 M0 骨架，在组件里打印 props；对照 `contract/slots.d.ts` 的 `SidebarRightTabInjected`。**已消解（0.2.1-rc.5 只读验收）**：tab 真机挂载、session-scope props 实际到达（Add to chat 的 `captureInsertion+insertText` 旧形态真实走通；芯片形态的 `inputTriggers`/`conversation` 面见 V-13） |
| V-2 | `Zotero-API-Version: 3` 与 `X-Zotero-Version`/`Zotero-Server-ID` 头在 Zotero 10 是否不变 | curl 实测 `GET /api/`。**部分证实**：真机库读取成功间接说明 `Zotero-API-Version: 3` 被接受；响应头形状未显式记录，仍待真机复核 |
| V-3 | Zotero 10 写能力探测仍回 428；`/api/local/authorize` 形状（`appName` 字段、`{key, remember}`） | 隔离 profile + 测试库实机走一遍授权对话框。**仍待真机**：真机验收只读，写探测与授权对话框均未触发 |
| V-4 | 附件条目返回的本地文件路径形状（`path` 字段 / `file://` URI） | 实机读 `children`。**链路已证实**：PDF 真机渲染 22 页说明 `resolveAttachmentPath` → `file/view/url` 真实可用；children 字段形状未单独记录 |
| V-5 | 上传端点 `/api/local/uploads/<token>` 的路径与同源校验规则 | 实机附加一个小 PDF。**仍待真机**（写路径，未触发） |
| V-6 | Chat Draft（可编辑未发送输入）与 Ask 的编程接口：客户端半如何向当前会话输入框写入草稿、如何以用户名义发送 | **已消解（静态证据）**：`sidebar.right.pane.tab` 槽 `scope: "session"`，standardProps 含 `inputActions`（官方 InputActions：`setDraft`/`submit()`（queue）/`insertText`/`captureInsertion`…）与 `sessionId`——见本机安装包 `dsh-cordis-client-runner` CLIENT_SLOT_API 目录与 `dsh-client-ui-conversation`/`dsh-client-ui-session` 源码（只读查阅，未复制代码）。真机复核（props 实际到达 + 端到端草稿可见可编辑）并入 M2/M8 真机验收。**Add to chat 半边已消解（0.2.1-rc.5 只读验收）**：按正确 item key（CR6G7I2U）与 PDF key 插入当前会话可编辑草稿且未发送（`captureInsertion+insertText` 真实走通）；**Ask 的 `setDraft+submit` 真实发送仍未验收**（避免向外部模型发送测试消息）。**芯片/卡片形态**（ADR 0004）的接面形状与 codec 语义单列 V-13；芯片形态的自动化层已实现，故本行的 `insertText` 证据仅覆盖降级路径 |
| V-7 | 宿主半 `ctx.inject(['tools'])` / `ctx.inject(['approval'])` 两个 per-capability effect 的可用性（晚到/解绑即采用/回退 fail-closed，真实 cordis cycle 行为已有 `tests/host-mount.test.ts` 固定）；工具结果 `output.render` 的 ContentBlock 形状 | 对照 `dsh-tools` 类型在真机注册一个 echo 工具。**部分消解**：晚绑定与服务 cycle 已由真实 cordis 测试固定并在 0.2.1-rc.5 真机生效（晚绑定修复后右栏恢复真实数据）；`output.render` 在真实会话中的 ContentBlock 形状仍待真机 |
| V-8 | webServer 在桌面 Electron 载体上的实际监听与页面同源性（客户端 fetch 相对路径是否命中宿主路由） | M1 真机：客户端 health 轮询能否拿到 200；若页面非同源，退路为宿主半注册 `webserver/index-inject` 行或改走 shell 载体（`ClientModuleRegistry.fetchBundle` 模式），此为 M1 首个开工项。**已消解（0.2.1-rc.5 只读验收）**：health 200；无认证直连 `/status` 401（预期 fence）；document-relative fetch/EventSource 全部命中宿主路由，右栏真实读取个人文库 803 条 |
| V-9 | Local API 对导出格式（`format=bibtex` / `format=ris`）的支持形状与错误响应（`exportText` 与 `export` 路由依赖它） | 真机只读 `GET {p}/items?format=bibtex` 复核；不支持时按 §4.4 错误码映射回 400/502，并回退为宿主半自建导出（后续里程碑决定）。**仍待真机**（导出未在真机触发） |
| V-10 | 宿主对包内 chunk 文件（`lib/client.pdf.js`）的静态解析，以及 `require.async('./client.pdf.js')` 的兄弟 chunk URL 派生在真机 boot graph 下可用（依据：`dsh-client-modules` 0.2.1-rc.2 已发布源码 `importChunk`/`chunkUrl` 契约；本插件已在 exports 登记 `./client.pdf.js` 并把实现写入 `scripts/build-client.mjs`，smoke 离线验证注册/加载/物化全链路） | 真机装载插件后打开一次 PDF（reader 路由），确认 chunk 加载成功、阅读器可渲染；失败时主 bundle 显示 `reader.chunkFailed` 引导文案。**已消解（0.2.1-rc.5 只读验收）**：chunk 真机装载成功，PDF（FHPRDEEL）右栏真实渲染 22 页，页码/缩放控件可见 |
| V-11 | M7 外部元数据服务的真实行为：doi.org 内容协商（`Accept: application/vnd.citationstyles.csl+json`）的响应形状与重定向链、arXiv Atom 的 `id_list` 查询与错误 entry、发布商 PDF 链接的 content-disposition/`%PDF-` 前置字节分布 | 真机隔离验收：对 1 个测试 DOI 与 1 个测试 arXiv id 走一次 `add_item`（fake Zotero 或测试库），比对解析结果；不使用真实用户文库。**仍待真机**：DOI/arXiv 外网导入未触发（真机验收未访问真实外网），当前仅自动化覆盖 |
| V-12 | M7 install/deep-link/工作区批次的真机行为：本机安装候选布局的真实命中（`zotero/install.ts`）、`/usr/bin/open -a` 启动与 `zotero://select\|open-pdf` 在真实 Zotero 中的表现（选中条目/阅读器指定页）、官方 `ctx.fs` 的 `createIfAbsent` 守卫与 display path 形状、`ctx.workingDirectory.ensure` 的精确签名（本机安装包集合中无该服务的 `.d.ts`，仅有 `dsh-tool-fs/session-cwd` 的概念声明；本插件以防御式 face + fail-closed 接入） | 真机隔离验收：Setup「Open Zotero」与「Show in Zotero」各点一次；`export_bib path` 写一个测试工作区并验证已存在文件被拒/`overwrite: true` 替换；shape 不符时仅降级为文本导出。**仍待真机**：Open Zotero/`zotero://` deep link 与真实工作区导出均未真机触发（当前仅自动化覆盖）；插件本体经 DSH desktop profile `link:` 的安装装载已真机通过（装载前 profile 备份 `/Users/hanxu/.dsh/profiles/desktop/backup-20261101-141702/`），但该验收不覆盖本行 Zotero 安装探测/deep-link/fs 守卫项 |
| V-13 | Zotero Context Chip/Card 在 DSH ≥0.2.2-rc.1 的接面形状：`ctx.inject` 是否真实存在及回调时序、`ctx.inputTriggers.registerSource` 的 source 字段与 `codec`（`serialize` 抛错即拦截发送）、`ctx.conversation.input.for(scope).insertReference(ref, span)` 与 `captureInsertion()` 的 span 形状（含按钮路径下的 span-CAS 是否稳定）、`ctx.sessions.scope(sessionId)` 返回值能否直接喂给 `ctx.conversation.input.for(actx)`、`ctx.uiConversation.userText.register` 的匹配规则与 `conversation.user.text.node` keyed 渲染器、`serializeDraftPrompt` 是否按契约调用非内建 source 的 `codec.serialize` | 真机（0.2.2-rc.1）装载后插一枚条目芯片与一枚引文芯片，核对短标签、展开文本与旧投影一致、页面重载后可发送、退格整体删除；`@` 菜单里空候选源是否只显示组标题；发送后消息内 UserText 卡片是否真的折叠；不 `submit()`。**自动化层已就绪的 fake 覆盖**：`tests/context-chip.test.ts`（26：编解码/展开/短标签/8k 上限）、`tests/context-card.test.tsx`（24：规则匹配/卡片渲染/5 条 + 「还有 N 篇」/hover 取数与 portal 桩）、`tests/context-chip-source.test.ts`（19：source 注册/插入/按钮路径/降级与 runtime 晚到 getter）；这些只证明实现按设计工作，不构成真机证据。**真机部分确认（2026-11-10）**：输入框内已真实出现引用芯片（单条选择一枚，短标签「1 个 Zotero 条目」），即 `ctx.inject` 链路、`registerSource`、按钮路径 `captureInsertion()`+`insertReference(ref, span)` 已走通；仍待验证 `codec.serialize` 展开（需一次真实发送）、消息侧 UserText 卡片折叠、`@` 菜单空候选组标题、退格整体删除、复制为全文、重载后可发送，本行仍为部分待验证 |

---

## 6. UI 信息架构（右栏单标签内导航）

标签内导航栈由 `data/client-store.ts` 持有（纯 reducer + 订阅，vitest 覆盖）：

```
route =
  | { view: 'libraries' }                                   库与群组 + 保存搜索 + 标签入口
  | { view: 'collection'; library; key }                    分类内条目列表
  | { view: 'search'; library; query; mode }                元数据/全文检索结果
  | { view: 'saved-search'; library; key }
  | { view: 'item'; library; key }                          详情（元数据/子件/注释分区）
  | { view: 'reader'; library; itemKey; attachmentKey; page? }  PDF 阅读器
  | { view: 'settings' }                                    连接状态/引导/本地 API 地址
```

- 每视图声明加载状态（idle/loading/ready/error(code)），错误码复用 §4.4 表。
- 列表统一分页控件（`pageSize=50`，滚动加载可后置）。
- Agent 视图联动：宿主工具 `open_item/show_items/highlight` 通过 webServer 事件
  （SSE，`/dsh-zotero/events`，M5）推 `viewSeq` 递增的导航意图；客户端半按 `viewSeq`
  去重执行导航（参考实现 state.json + viewSeq 模式）。
- **会话上下文（M8，ADR 0004；自动化层已完成、真机 V-13 待验收）**：条目/引文
  不再以固定格式多行文本写入草稿，而是插入一枚 **Zotero Context Chip**。验证点
  V-6（官方 `inputActions` 面完备）与 V-13（芯片/卡片接面形状）分别约束两条路径；
  V-6 的 `insertText` 证据现只覆盖降级路径。
  - **触发源**：`ctx.inputTriggers.registerSource({trigger:'@', name:'zotero',
    candidates:()=>[], onPick, codec})`，`appearance:'file'`；v1 不提供菜单候选
    （`@` 菜单只出现该源的组标题，无候选行）。
  - **插入通道**：`ctx.conversation.input.for(sessionScope).insertReference(ref,
    span)`，span 取自 `captureInsertion()`（非破坏插入，保留用户已输入内容）；
    sessionScope 经 `ctx.sessions.scope(sessionId)` 解析。
  - **显示与展开**：芯片只显示短标签（「3 个 Zotero 条目」「1 处引文 · 第 22
    页」）；`clipboardText` 为完整展开文本；模型文本由 source 的
    `codec.serialize(ref, signal)` 在发送时返回（外层包一层换行，避免 DSH 的芯片后置空格把相邻块粘到同一行），与旧版 `itemsDraftText`/
    `quoteDraftText` 等价。芯片是原子装饰节点，退格整体删除。
  - **`ref` 自包含**：base64url 编码（条目：library/key/标题/作者/年份/主 PDF 附件 key；引文：
    item/attachment/页码/引文正文）；codec 为纯函数、不抛错，保证 Zotero 未运行
    与页面重载后仍可发送。
  - **PDF 引文**：同样走芯片，不再使用官方 `insertQuote`；单次插入引文超过
    8k 字符时拒绝并提示，不静默截断。
  - **消息侧**：注册 `ctx.uiConversation.userText` 规则（`register`，返回
    disposer）与 keyed slot `conversation.user.text.node` 渲染器，把同一份展开
    文本折叠为 **Zotero Context Card**（消息、队列、待发回显）；卡片 hover 用
    key 现场查 Local API 取标题与作者年份（带缓存），最多列 5 条 + 「还有 N
    篇」，单条也折叠。
  - **Ask**：先 `setDraft(问题文本)` → 插入芯片 → `submit()`（queue，不 steer）。
  - **覆盖入口**：条目列表多选底栏、条目详情动作行、PDF 阅读器划选浮层、Ask。
  - **降级**：检测不到 `inputTriggers`/`conversation`/`uiConversation` 时回退
    旧行为（`insertText` 插入完整多行文本），并在设置页连接卡追加一行「输入框内
    折叠不可用」；`engines.dsh` 不抬高（芯片与卡片需 DSH ≥ 0.2.2-rc.1）。
  - **接入方式**：客户端半用 `ctx.inject([...])` 可选注入 + 特性检测，不写入
    `package.json` 的 `dsh.client.inject` 硬依赖（后者是信息性包依赖，见 §5）。
  - **实现落点（自动化层已完成）**：`client/context-chip.ts`（ref 编解码 + 模型文本
    投影 + 短标签 + 8k 上限）、`client/context-card.tsx`（规则匹配 + 卡片 + hover
    portal）、`client/context-chip-source.ts`（source 注册 + 插入 + 降级 + runtime
    安装/读取），入口在 `client.tsx` 的可选 `ctx.inject([...])` 回调；三条实现期
    修正（主 PDF key 必带、`chip` 为 live getter、`options.available` 不二次注册）
    见本节前的状态块。芯片外观、退格行为与卡片折叠仍归 V-13 真机验收。
  - 两条路径都不得静默发送。

---

## 7. Agent 工具面（M5/M6）

工具名与语义对齐参考实现（同名同参，便于文档与心智迁移）；全部经
`defineTool` 声明 `parameters`/`output.schema`/`output.render`：

| 工具 | 类别 | 说明 |
| --- | --- | --- |
| `list_collections` / `search_library` / `get_item` / `search_annotations` | 只读 | 文库结构、检索（两种模式）、详情、注释检索 |
| `read_fulltext` / `find_in_pdf` / `cite` | 只读 | 全文摘录（默认 30k 字符预算）、PDF 内定位（物理页码+页标签）、引文格式化 |
| `open_item` / `show_items` / `highlight` / `clear_highlights` | 视图+会话态 | 导航意图进右栏；高亮只存在会话内，`highlight` 可带 `save` |
| `save_highlights` / `add_item` / `attach_pdf` / `update_item` / `add_note` / `create_collection` / `authorize_writes` | 写（M6） | 一律先 `ctx.approval.request`（ADR 0003）再走 Zotero 授权；`authorize_writes` 仅触发授权对话框不写数据 |
| `export_bib` | 读 + 工作区写（可选） | 无 `path` 返回导出文本（不触发审批）；带工作区相对 `.bib` `path` 先 DSH 审批再经官方 `ctx.fs` 写入；绝对/`..`/realpath 逃逸拒绝，默认不覆盖（`overwrite: true` 才替换）；不触 Zotero 写入 |

安全约束（全部工具）：错误与结果中不出现 key；`add_item` 导入只访问 §4.5 白名单
域；写工具在 DSH 审批拒绝或 Zotero `write_denied` 时终止且不自动重试。

---

## 8. 公开测试 seams（后续 coder 按此写测试）

| Seam | 机制 | 固定产物 |
| --- | --- | --- |
| Local API 契约 | `tests/fixtures/zotero/*.json` 记录真实响应形状（collections/items/item/children/annotations/search/groups/authorize/upload）；宿主半对 `ZoteroLocalClient` 的测试用 node:http 起的 fake Zotero server 按 fixture 回放 | fixtures 目录 + `tests/zotero-client.test.ts`（探测状态机/错误码映射/授权重试/412 重试） |
| DSH 路由 | 路由处理器签名 `(req, res)` 纯 Node；smoke 与 vitest 直接以 stub res 调用（M0 `scripts/smoke.mjs` 已示范 health/status/404） | 每条路由一个 happy + 一个错误用例 |
| 工具审批 | `approval.ts` 以注入的 `{ approval: { request } }` fake 测三条路径：允许→执行、拒绝→不执行、Zotero 拒绝→终止不重试 | `tests/tools-approval.test.ts` |
| UI store/导航 | `client-store.ts` 纯 reducer：`tests/client-store.test.ts` 覆盖 route 栈推进/回退/viewSeq 去重 | reducer + action 类型导出 |
| 草稿/Ask（ADR 0004，自动化层已完成） | `context-chip.ts`：`ref` base64url 编解码与 `codec.serialize` 展开为纯函数（条目/引文两种 ref；非法 ref 不抛错；条目 ref 必带主 PDF 附件 key 以保留 `· PDF <key>`）；`context-card.tsx`：UserText 规则匹配纯函数、卡片渲染（单条也折叠、5 条上限 + 「还有 N 篇」、hover 取数走 fake Local API + `createPortal` 桩）；`context-chip-source.ts`：`@` source 注册、`insertReference` 插入、按钮路径（非 `@` 菜单）、`currentChipRuntime` 晚到 getter、`options.available` 不二次注册；降级路径（fake 缺 `inputTriggers`/`conversation`/`uiConversation` → 回退 `insertText` 完整文本），旧投影继续测到 | `tests/context-chip.test.ts`（26）、`tests/context-card.test.tsx`（24）、`tests/context-chip-source.test.ts`（19）、`tests/chat-draft.test.ts`（旧投影）；真机行为归 V-6/V-13 |
| PDF/引文/高亮 | `domain/text.ts`、`pdf/extract.ts` 纯函数 + 小型 PDF fixture（2 页，含跨页引文）；矩形计算断言容差 ≤0.5pt | `tests/text.test.ts`、`tests/pdf-extract.test.ts` |
| 写入 fixtures | 版本冲突（412→重读→成功）、拒绝（403 write denied）、限速（429）、批量 51 拆批、上传失败回滚 | `tests/zotero-writes.test.ts` |
| 元数据导入（M7） | `metadata/metadata.ts` 纯函数 + `resolveIdentifier`/`downloadPdf`/`guardedFetch` 以注入 fake fetch + fake DNS 回放；`tests/helpers/metadata-fixtures.ts` 自拟 CSL-JSON/Atom/PDF fixtures；session 导入走 fake Zotero + 注入 metadata fetch | `tests/metadata.test.ts`、`tests/metadata-net.test.ts`、`tests/host-session-metadata.test.ts`、`tests/tools.test.ts`（审批零网络/SSRF 工具级） |
| 安装/deep-link/工作区（M7 install/export 批次） | `zotero/install.ts`+`zotero/desktop.ts` 以注入 `exists`/`readText`/`isExecutable`/`spawn` seam 测试（绝不真实启动/打开）；路由以 `mountRoutes` + 注入 `findApp`/`launchApp`/`openLink` 测试（fence/校验/install wire 形状）；`session.writeWorkspaceFile` 以 fake `ctx.fs`/`ctx.workingDirectory` face 测试（绝对/`..`/符号链接逃逸/createIfAbsent/后端错误码映射）；`attach_pdf` path 模式以真实 tmp 文件 + fake 审批复测审批序 | `tests/zotero-install.test.ts`、`tests/host-desktop.test.ts`、`tests/workspace-export.test.ts`、`tests/tools.test.ts`（attach 审批序） |
| 真实 cordis 装配（宿主服务晚绑定） | `tests/host-mount.test.ts` 以真实 `@deepseek-ai/cordis` Context 装载 `src/index.ts`，服务经 `ctx.provide`（保留 disposer 可撤销，模拟宿主 fiber cycle）：路由/工具不重复、approval/credentials/fs/workingDirectory 晚到与解绑（写审批实际调用晚到服务、凭据晚绑定被 client 使用、workspace 能力恢复） | `mountedSession(fiber.ctx)` 诊断 seam（session 不持有 key，无泄露面） |
| 包清单/构建 | M0 已有：`tests/manifest.test.ts`（清单/补丁/许可）+ `scripts/smoke.mjs`（产物形状） | 保持随里程碑扩展 |

真机验收（Mac，隔离 DSH profile + 独立测试 Zotero profile）不属于 vitest：每个里程碑
的验收矩阵（§9）里单列，主库（个人库）只验证读取，写入一律在测试库/隔离 profile 进行。

---

## 9. 里程碑与验收矩阵

| 里程碑 | 内容 | 自动化验收 | 真机验收（Mac） |
| --- | --- | --- | --- |
| M0 骨架（已完成） | 双半可构建；右栏占位 tab；health/status 路由；许可/规格/ADR | `npm run verify` 全绿 | 插件装载进 desktop profile，右栏出现「Zotero」入口，标签体显示骨架声明。**已通过（0.2.1-rc.5 只读验收）**：desktop profile `link:` 安装载入（装载前 profile 备份 `/Users/hanxu/.dsh/profiles/desktop/backup-20261101-141702/`），右栏入口与标签体真实呈现 |
| M1 数据层（已完成） | `ZoteroLocalClient` + `library.ts` + `domain/model.ts` + `domain/items.ts` + `writes.ts`/`auth.ts` | fake server 测试全绿；探测状态机、授权流、412 重试、SSRF 拒绝覆盖 | 真实 Zotero 10：状态卡片 ready；库/群组/分类树正确渲染（只读）——待 UI 里程碑执行 |
| 宿主服务与安全路由（本阶段，自动化层完成） | `host/`（session/keystore/events/respond/routes/services）+ `index.ts` 组装；官方 fence 认证 + method/content-type/body 校验 + 错误 envelope + SSE `/events` + 写路由 + status 真实 probe + export 路由（V-9） | 路由测试全绿（fence 401/403、503 无 fence、405/413/415/400、SSE 重放/上限/清理、写路由 happy/error、pdf 501）；smoke：status 非恒 unknown、client bundle 无 key | 真机：health 轮询命中宿主路由（V-8）；status ready；SSE 由 open_item 驱动右栏导航（待 UI）。**health 200 已证实**（0.2.1-rc.5，无认证 `/status` 401 为预期 fence）；认证浏览器上下文库读取真实可用（803 条）；SSE open_item 驱动导航仍待真机 |
| M2 检索与列表（UI 半，自动化层完成） | `client/store.ts` 导航栈/reducer + `client/api.ts` + Library 视图（个人+群组、分类树、保存搜索、元数据/全文、5 排序×方向、50/页 Load more 至 500、多选底栏） | reducer/api/组件渲染测试 | 元数据与全文检索结果与 Zotero UI 一致；排序分页可用（真机验收待执行）。**部分完成（0.2.1-rc.5）**：文库 803 条真实显示；元数据「Double-shock」1 条；全文短语「elusive BC8 carbon」metadata 模式 0 条、everything 模式 2 条；排序/分页未单独记录 |
| M3 条目详情（UI 半，自动化层完成） | 详情视图（字段/子件/笔记/分类/标签/注释/导出下载）；笔记 HTML 清洗（DOMPurify，无 DOM 环境降级纯文本）；Reader 显式 M4 边界 | 组件渲染测试（含 script/javascript: 不入标记） | 详情字段与 Zotero 一致；笔记安全显示（真机验收待执行）。**部分完成（0.2.1-rc.5）**：条目详情与 PDF 注释打开正常已确认；笔记清洗显示与导出下载未单独记录 |
| M4 PDF 与高亮（自动化层完成） | pdfjs-dist 6.4.299（legacy 构建随 lib/pdfjs 分发，许可登记）；Reader 视图（501 边界转正，懒加载 chunk）；引文匹配与矩形；会话内高亮（工具 + UI 写路由 + SSE 通知）；`read_fulltext`/`find_in_pdf`/`highlight`/`clear_highlights`/`save_highlights` 注册；open_item page/quote 定位 | text/pdf/host-pdf/工具/store/views 测试全绿；smoke：chunk 契约、无 501、19 工具、无 key | PDF 渲染、页码标签、文本选择高亮正确；高亮矩形与 Zotero 原生一致（真机验收待执行；chunk 在真机 boot graph 的装载为 V-10）。**部分完成（0.2.1-rc.5）**：V-10 已消解——PDF（FHPRDEEL）右栏真实渲染 22 页、页码/缩放控件可见；文本选择高亮、高亮矩形一致性、保存高亮到 Zotero 未真机验收 |
| M5 Agent 只读工具 + 视图联动（自动化层完成） | 只读/视图工具已注册（`search_annotations` 范围 = 单条目 PDF 注释；`cite`/`export_bib` 为元数据投影/导出文本）；SSE 事件通道已实现 | 工具 schema/输出/审批外工具单测全绿；SSE 推送/重放/上限测试全绿 | 会话内调用工具返回真实数据；open_item 驱动右栏导航。**未真机验收**：真实会话中未调用工具（V-7 的 output.render 形状待复核），SSE 导航联动未单独触发 |
| M6 写路径（自动化层完成） | 写工具（DSH 审批 → 同一 Zotero 授权门面；`isConcurrencySafe: false`；拒绝不执行不重试）+ 写路由 + 官方 credentials 持久 KeyStore 已实现 | 审批三路径（允许→执行/拒绝→不执行/Zotero 拒绝→终止不重试）+ 写 fixtures 全绿 | 隔离 profile：Agent 写→DSH 审批卡出现；拒绝路径不落库；「始终允许」key 经 `.credentials.yaml` 持久重启后复用。**未真机验收**：真实 Zotero 写入/授权/高亮保存均未触发（真机验收只读），仅自动化覆盖 |
| M7 元数据导入 + install/deep-link/工作区（自动化层完成） | `metadata/net.ts` SSRF 守卫 + `metadata/metadata.ts` 解析/下载 + `session.addItem`（DOI 去重、collections/tags、arXiv PDF 自动附加）+ `add_item`（审批先于外部网络）/`attach_pdf` URL 模式已实现；跨平台安装探测（`not_installed` vs 未运行分状态）、白名单启动与 `zotero://select|open-pdf` deep link（Setup/详情/Reader 接线，UI 不泄安装路径）、`export_bib` 工作区写入（官方 fs/workingDirectory 面，默认不覆盖、防逃逸）、`attach_pdf` 本地路径模式（审批先行）均已实现并有测试 | 导入解析单测（CSL-JSON/Atom fixtures）+ SSRF/重定向/大小/magic/审批零网络/重复 DOI 测试全绿（V-11 待真机）；`tests/zotero-install.test.ts`（21）+ `tests/host-desktop.test.ts`（11）+ `tests/workspace-export.test.ts`（17）全绿（真实候选布局命中/deep link 真实行为/fs 守卫形状待真机） | DOI 与 arXiv 条目连同 PDF 进入测试库（V-11）；「Open Zotero」/「Show in Zotero」在真实 Zotero 中选中条目/打开阅读器指定页；`export_bib path` 在真实工作区落盘。**未真机验收**：外网导入、deep link 与工作区落盘均未触发（真机验收未访问外网、未写 Zotero、未操作 GUI），仅自动化覆盖 |
| M8 会话集成（自动化层完成；真机 V-13 待验收） | 新形态（ADR 0004）已实现：Add to chat/Ask 插入 **Zotero Context Chip**（`@` 触发源 + `insertReference(ref, span)`；`codec.serialize` 发送时展开为完整文本，与旧 `itemsDraftText`/`quoteDraftText` 等价）；PDF 引文同走芯片、>8k 拒绝；消息/队列/待发回显经 `ctx.uiConversation.userText` + `conversation.user.text.node` 折叠为 **Zotero Context Card**（hover 查 Local API）；Ask = `setDraft(问题)` → 插芯片 → `submit()`（queue，不 steer）；缺服务降级 `insertText`。入口 chip-first：条目多选底栏、详情动作行（加入/提问）、阅读器划选（引用到对话/提问）、`SetupView` 降级提示行。旧形态：非破坏 `captureInsertion+insertText`、await 真实 boolean、插入面缺失/失败不改动草稿；SSE open_item/show_items 导航（seq 双层去重）沿用 | 新增 `tests/context-chip.test.ts`（26）+ `tests/context-card.test.tsx`（24）+ `tests/context-chip-source.test.ts`（19）全绿；旧 `chat-draft` 投影/接面单测与 store viewEvent 去重测试保留；全量 `npm run verify` 全绿（28 文件 / 509 用例、build 成功 `lib/client.js` 216653 字节、smoke 四条断言含 react-dom 平台桩） | **待真机（DSH ≥0.2.2-rc.1，V-13）**：验收口径 **允许插入草稿并截图、绝不 `submit()`**；核对 `ctx.inject` 时序、`sessions.scope` 可否直喂 `conversation.input.for`、按钮路径 span-CAS、`serializeDraftPrompt` 是否调 `codec.serialize`、`@` 菜单组标题、芯片短标签与整体退格、发送后 UserText 卡片折叠与 hover 取数。旧形态已真机确认（0.2.1-rc.5，正确 item key CR6G7I2U 与 PDF key 的草稿插入且未发送）；Ask 真实发送仍主动跳过（避免向外部模型发测试消息），deep link 未触发 |
| M9 收尾 | 错误引导（未安装/未运行/未开启 API）、i18n 完整性、性能预算（列表 <300ms 首屏） | smoke 扩展至全路由 | 三种不可用状态的引导文案可操作 |

每里程碑通用验收：`npm run verify` 全绿；`lib/` 产物不含 key 字符串（grep 审计）；
`THIRD_PARTY_NOTICES.md` 与实际依赖一致；不产生任何对真实 Zotero 的非预期写入
（真机验收前先在隔离 profile 断言写路径只在显式触发后调用）。

---

## 10. 后续数据层接口建议（给下一位 coder 的落点）

1. **`ZoteroLocalClient` 保持无状态 HTTP 面 + 显式状态机**（status/auth 缓存在实例内），
   所有方法抛 `ZoteroError(code)`，错误码表即 §4.4——路由层与工具层都不自行解析 HTTP 状态。
2. **`library.ts` 只做投影与缓存**：`CollectionsDoc`/`ItemList`/`ItemDetail` 以库版本
   为缓存键；不要在读取层散落 `fetch`。
3. **路由层薄**：`routes/*.ts` 只做参数校验（复用 domain 类型）、调用数据层、序列化
   `shared/protocol.ts` 里的 wire 类型；wire 类型演进必须先改 protocol.ts（两半共享）。
4. **工具层不直接 import zotero/**：经 `ZoteroSession` 门面（组合 client/library/writes/
   viewNotifier），与参考实现 `app/session.ts` 同构，便于单测注入 fake。
5. **客户端 store 先行**（M2 前）：route reducer 与 viewSeq 去重是所有 UI 里程碑的
   地基，先落 `data/client-store.ts` 与其测试。
6. **每个里程碑只扩 protocol.ts 中已被真实端点证实的数据形状**，避免提前固化猜测的
   字段（V-2…V-6 全部消解后再冻结 wire v1）。
