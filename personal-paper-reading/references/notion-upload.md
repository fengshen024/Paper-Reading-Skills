# 将论文笔记上传到 Notion

适用于用户明确要求“保存/上传到 Notion”。上传可编辑正文、公式、表格、代码、图片和自检折叠块，保留本地 Markdown 主稿。脚本不依赖 Codex 的 Notion MCP 登录；只需 Node >=22.12 和 skill 已锁定的 `marked` 依赖。

## 保存位置：每篇论文一个独立页面

脚本为每篇笔记新建页面，各篇正文互相独立。父页面模式中的父页面只是目录；数据库模式中的每条记录也有自己的完整页面。

如果用户希望在工作区顶层直接出现「论文 A」「论文 B」等页面，使用下面的 **PAT + 工作区顶层** 模式。无需提供父页面链接；工作区由 token 创建时选择的工作区决定。顶层页面创建在授权用户的私人页面区域，不会自动共享给整个工作区，也不是 teamspace 页面。

## 用户授权：工作区顶层使用 PAT

1. 打开 [Personal access tokens](https://www.notion.so/developers/tokens)，选择 **New token**。
2. 选择目标工作区，启用 Notion API 能力及所需的读取/插入内容能力，设置有效期并保存 token。
3. 在私人 `notion.env` 中仅配置以下目标模式，删除或注释父页面和 data source 设置：

```dotenv
NOTION_TOKEN=你的个人访问令牌PAT
NOTION_WORKSPACE_ROOT=true
```

PAT 随创建者在所选工作区的权限工作，不需要再把父页面共享给内部集成。免费工作区一般只有所有者可创建带 Notion API 能力的 PAT，其他套餐还受管理员策略限制；以后台实际可用选项为准。token 过期后需在本机更新配置。

运行下文相同的 `--check-auth`、`--dry-run` 和上传命令即可；也可用 `--workspace` 临时选择工作区顶层。`--check-auth` 检查身份及是否有用户身份归属，不会创建页面，不能保证创建配额或全部写入权限。检查输出中的 `workspace_name` 可帮助确认 token 所属工作区。

内部集成令牌不支持顶层私人页面，脚本会在上传图片或创建页面之前停止并提示更换 PAT。用户授权的公共连接也支持此模式，但脚本没有实现公共 OAuth 注册/回调。

## 用户授权：父页面或数据库使用 internal connection

1. 在 [Notion 开发者后台](https://app.notion.com/developers/connections) 创建 **Internal connection / 内部集成**，选择自己的工作区。创建内部连接通常需要工作区所有者身份。
2. 在配置中开启 **Read content（读取内容）** 和 **Insert content（插入内容）**，复制 API token。当前脚本只新建页面，不需要开启用于覆盖内容的 Update content。
3. 在 Notion 新建或选定一个普通页面，例如“论文阅读”。右上角 `•••` → `Connections / Add connections（连接/添加连接）`，选择刚创建的连接，授予该页面访问权限。
4. 复制这个**父页面**的链接，配置为 `NOTION_PARENT_PAGE_ID`。脚本会在它下面创建论文子页面。

有 token 不等于有页面权限；忘记第 3 步时可能收到 404 或 403。`--check-auth` 只验证身份和目标读取权限，不创建测试页，也不能保证后续的插入权限或上传配额一定满足。

如果工作区提供并允许 [Personal access token](https://developers.notion.com/guides/get-started/personal-access-tokens)，也可将 PAT 填进同一个 `NOTION_TOKEN`。PAT 使用创建者在所选工作区的权限，授权规则不同于 internal connection，不需要再把页面共享给一个内部连接。多人分发的公共应用才需要单独实现 OAuth client/callback；本脚本没有内置公共 OAuth 注册和回调服务。

## 本地配置

环境变量优先；也可用 `--env-file` 显式读取私有配置文件，不会自动扫描工作区的 `.env`。

从 [配置样例](../assets/notion.env.example) 复制到用户目录等私有位置，填入 token 和父页面链接：

```dotenv
NOTION_TOKEN=替换为你自己的token
NOTION_PARENT_PAGE_ID=替换为Notion父页面链接或ID
```

建议位置：`~/.config/paper-reading/notion.env`。保留配置在 skill 文件夹之外，分享/打包 skill 时就不会把凭证一起带走。token 只在自己的机器上填写，无需发送到聊天。

也可以在 PowerShell 当前会话临时输入 token，输入时不显示字符：

```powershell
$notionSecret = Read-Host 'Notion token' -AsSecureString
$env:NOTION_TOKEN = [System.Net.NetworkCredential]::new('', $notionSecret).Password
$env:NOTION_PARENT_PAGE_ID = '粘贴父页面链接'
```

## 运行

以下命令从 skill 文件夹运行，替换实际笔记/配置文件路径。首次准备依赖：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
```

纯本地预览，无需 token，不联系 Notion：

```powershell
node scripts/upload-to-notion.cjs ../notes/kqa-pro-2022.md --dry-run
```

只读验证身份和目标访问权限：

```powershell
node scripts/upload-to-notion.cjs --check-auth --env-file "$env:USERPROFILE/.config/paper-reading/notion.env"
```

上传：

```powershell
node scripts/upload-to-notion.cjs ../notes/kqa-pro-2022.md --env-file "$env:USERPROFILE/.config/paper-reading/notion.env"
```

使用临时环境变量时可省略 `--env-file`。也可以用 `--parent '页面链接'` 覆盖配置中的目标。`--title '自定义标题'` 覆盖 Markdown 的首个一级标题；被用作页面标题的 H1 不在正文重复添加。

保存位置选项互斥：`--parent`、`--database`、`--data-source`、`--workspace`。显式命令行模式会覆盖配置文件的保存模式；配置文件本身不能同时启用多个目标。工作区顶层的本地预览示例：

```powershell
node scripts/upload-to-notion.cjs ../notes/kqa-pro-2022.md --workspace --dry-run
```

`--plan '新文件.json'` 可保存完整转换计划，文件里有正文和本地图片路径，没有 token；不会覆盖已有计划文件。配合 `--dry-run` 使用即可只导出计划。

## 保存到论文数据库

用户在 Notion 复制数据库链接后，可直接填到 `NOTION_DATABASE_ID`，无需手工寻找 data source ID。先在目标数据库的 `••• → 连接/添加连接` 中添加内部集成，确保它有读取和插入内容能力。若当前是链接视图，还需保证其源数据库对集成可见。

删除或注释 `NOTION_PARENT_PAGE_ID`、`NOTION_DATA_SOURCE_ID`、`NOTION_WORKSPACE_ROOT` 后，配置：

```dotenv
NOTION_TOKEN=你的内部集成令牌
NOTION_DATABASE_ID=粘贴完整数据库链接或数据库ID
```

也可以用 `--database '数据库链接'` 临时指定。URL 中路径部分的 ID 是数据库目标，`?v=` 后的视图 ID 不用于创建页面。`--dry-run` 只验证链接格式和本地笔记，不联系 Notion；`--check-auth` 或实际上传时会先读取数据库的 `data_sources`。

只有一个 data source 时，自动选择并读取其 schema，识别 title 属性，无需假设标题列一定叫 Name。数据库为空或有多个 data source 时，在任何远程写入前停止；多个候选会列出名称和 ID，明确选择后删除/注释 `NOTION_DATABASE_ID` 并设置 `NOTION_DATA_SOURCE_ID`，或用 `--data-source UUID` 覆盖目标。

`NOTION_DATA_SOURCE_ID` 必须是真实 data source ID，不能填数据库链接或 `?v=` 后的视图 ID。每篇论文作为一条新记录创建，完整正文、图片和自检答案写进该记录自己的页面，不写进数据库其他论文的页面。回执同时保存请求的数据库目标和解析出的 data source。

当前只填写标题属性；年份、标签、阅读状态等自定义字段暂不自动推断或写入。缺失目标时先询问保存位置，不在用户工作区随意选择数据库。

## 文件与格式行为

- 支持普通中文 Markdown 的标题、列表、加粗/斜体、代码、行内/独立公式、表格和 `<details><summary>` 自检答案。表格和折叠块以原生 Notion 内容块写入。
- `![说明](paper.assets/figure.png)` 会上传为原生 image block；重复引用同一文件只上传一次。本地图片必须位于笔记同目录或子目录，支持 PNG/JPEG/GIF/WebP/SVG，每张不超过 20 MiB，仍受工作区文件限制。
- HTTPS 图片使用外部 image block，不额外下载。依赖第三方地址可用性；本地原图则进入 Notion 文件存储。
- Markdown 图片说明保留为 image caption；图后的原文图注段落照常保留。不会自动把整篇 PDF 作为附件上传；相对 PDF/锚点链接保留为说明文字并在预览中提示。
- Mermaid 按代码块导入，显示效果依赖 Notion；HTML 阅读版的专用 `paper-*` JSON 块只作为普通代码保留，不声称能直接转换成同样的视觉组件。未支持的 HTML 和嵌套 details 会在上传前报错。
- 超长正文按最多 50 个顶层块和请求体预算分批追加；嵌套块使用父块 ID 继续写入，表格先创建带首行的表，再逐批追加行。

## 重复运行与失败恢复

成功后在笔记旁保存 `<note.md>.notion-upload.json`，包含页面 URL、正文与图片摘要和上传状态，没有 token。保留此文件以便识别重复运行。

- 内容、目标和标题均未变化时跳过重复上传，返回已有 URL。
- 不同论文分别新建页面；同一篇重复运行保留防重逻辑。确实需要同一篇再建一个独立页面时使用 `--new-page`。
- 内容变化或上次失败时默认停止并报告回执。当前版本不覆盖已有 Notion 页；明确需要另建一个版本时使用 `--new-page`，回执保留上一页链接。
- 网络中断或 5xx 后，不盲目重试写入，因为服务端可能已经创建页面或追加内容；检查回执和目标页面后再决定如何处理。限流 429 最多重试 3 次，单次等待超过 30 秒即停止。
- 若中途失败，回执中的页面可能只有部分正文。不要把它当成完整上传。脚本会返回可用的部分页面 URL；本版没有自动续传和回滚。
- 并行上传同一笔记会被 `.lock` 文件阻止。仅在确认没有其他上传进程、核对回执后处理异常退出留下的锁。

## 验证范围与来源

本地测试覆盖真实 KQA Pro 笔记转换、图片去重、原生公式/表格/toggle、multipart 上传请求、数据源标题识别、重复上传保护、部分失败和限流处理。没有用户 token 和目标授权时，只报告本地/模拟验证；不宣称完成了用户工作区的真实联调。

官方 API 版本：`2026-03-11`。

- [授权方式](https://developers.notion.com/guides/get-started/authorization)
- [个人访问令牌 PAT](https://developers.notion.com/guides/get-started/personal-access-tokens)
- [创建页面](https://developers.notion.com/reference/post-page)
- [读取数据库与 data sources](https://developers.notion.com/reference/retrieve-a-database)
- [文件上传](https://developers.notion.com/guides/data-apis/uploading-small-files)
- [追加内容块](https://developers.notion.com/reference/patch-block-children)
