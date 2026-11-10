# 加入对话用引用芯片承载上下文：输入框一张芯片，模型收到展开全文

## Status

accepted

## Considered Options

- **继续插入固定格式多行文本**（现状）：被否决——一次多选会在输入框里堆出十几行机器文本，用户读不到自己还想问什么。
- **只管消息侧折叠**（`ctx.uiConversation.userText` 注册匹配规则 + `conversation.user.text.node` 渲染器）：被否决——它作用于待发回显、队列行与已发送消息，管不到输入框里的编辑器正文，用户原始诉求（输入框要短）得不到满足。
- **草稿只写一行 key、详情靠模型调工具现查**：被否决——模型从"一次拿全"退化成"多轮工具调用"，问答质量与延迟都受损；显示层折叠不应以削弱模型上下文为代价。
- **把上下文写成工作区文件、用 file 引用芯片承载**：被否决——在用户仓库里留下文件、需要生命周期管理，且借用了别人的引用源 codec。
- **作为文件附件挂载**（`createDrafts` + `addAttachments`）：被否决——附件通道是"字节 + 回执"，没有文本载荷，附件的收录受 intake 策略限制。
- **接管 `conversation.composer.bar` 自绘输入栏**：被否决——`replaceRisk: shadows-shipped-ui`，等于重写整个输入栏，与仓库"只用官方公开接面"的纪律冲突。

## Decision

输入框里放一个 **Zotero Context Chip**：向 `ctx.inputTriggers.registerSource()` 注册一个 `@` 触发源（`appearance: 'file'`，v1 不提供菜单候选），源自带 `codec.serialize(ref)` 负责模型文本；点击"加入对话"通过公开服务 `ctx.conversation.input.for(sessionScope).insertReference(ref, span)` 插入芯片（span 取自 `captureInsertion()`）。芯片只显示短标签（如"3 个 Zotero 条目"），`clipboardText` 为完整展开文本，`codec.serialize` 在发送时返回同一份投影文本（外层包一层换行与相邻内容分隔）——因此模型收到的内容与旧版固定格式文本等价，视觉上却只剩一张芯片，且芯片是原子节点、一次退格整体删除。

`ref` 自包含（条目的 library/key/标题/作者/年份/主 PDF 附件 key、引文的 item/attachment/页码/引文正文，base64url 编码），使 codec 为纯函数：Zotero 未运行或页面重载后仍能发送（DSH 的既定语义是 codec 抛错即拦截发送并保留草稿）。单次插入的引文超过 8k 字符时拒绝并提示，不静默截断。

消息侧另注册 `ctx.uiConversation.userText` 规则与 `conversation.user.text.node` 渲染器，把同一份展开文本折叠成 **Zotero Context Card**（标题与作者年份在 hover 时按 key 现场查 Local API，最多列 5 条）。Ask 走同一路径：先写入问题文本，再插芯片，然后 `submit()`。

环境不支持（无 `inputTriggers` / `conversation` / `uiConversation`）时回退旧行为：直接 `insertText` 插入完整多行文本，并在设置页说明"输入框内折叠不可用"。

## Consequences

- 芯片外观由 DSH 内建渲染器固定（`appearance` 只有 `file|folder|session|undefined`，标签 240px 截断），插件无法自定义边框、图标或胶囊形态。
- `ref` 体积随选择增大（引文尤甚），草稿持久化会保存这份编码；"复制"与草稿文本投影都等于展开全文，这是有意的。
- 模型侧文本由插件自己的 codec 决定，DSH 上游改动展开协议（`serializeDraftPrompt`）会直接影响本功能；回退路径必须保持可用。
- 因码片来自 `@` 触发源，`@` 菜单里会出现该源的组标题；v1 用空候选让它不显示任何行，若将来提供候选需要补齐搜索与排序。
- DSH 在每枚芯片之后补一个空格，展开文本若直接拼接会与相邻内容粘连（两枚芯片、或用户已输入的文字）。因此 `codec.serialize` 返回的模型文本在投影外面包一层换行（`\n<投影>\n`）：每枚芯片成为独立段落，消息侧按行首锚定的折叠规则对每一段都成立；`clipboardText` 仍是未包裹的裸投影，复制得到的就是纯文本。
