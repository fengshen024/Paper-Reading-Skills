# Paper Reading Skills

面向具体论文的中文研究导向阅读 Skill。[personal-paper-reading](personal-paper-reading/SKILL.md) 将机制讲解、实验证据核查与研究启发结合起来，以中文 Markdown 作为可编辑主稿，按需生成离线 HTML，或连同图片保存到 Notion。

适合已经指定论文的精读、公式或模块讲解、阅读笔记核查，以及少量明确论文之间的对比。

## 核心能力

- **讲清机制**：沿输入、操作、输出解释模型，区分训练与推理，把公式和图表接到实际计算过程。
- **核对证据**：对齐实验设置、对照、指标和结果；区分作者主张、实验观察、解释推断与待核查事项。
- **整理研究用途**：保留阅读疑问，说明可迁移设计的适用前提和最小验证方法。
- **按需呈现**：支持原图、公式、表格、机制图和篇末少量自检题，参考答案折叠展示。
- **保存到 Notion**：上传正文与本地图片；每篇论文创建独立页面，支持父页面、数据库和符合授权条件的工作区顶层模式。
- **清理中间文件**：结束后预览并清理指定 PDF 提取目录和缓存，保留最终笔记、配图、配置、来源与上传回执。

## 快速使用

无需先安装，也可在支持文件访问的 Agent 中指定入口：

```text
使用本仓库 personal-paper-reading/SKILL.md 精读这篇论文：<PDF 路径或论文链接>。
重点解释核心机制和训练/推理流程，并核对主要实验的证据边界。
输出中文 Markdown，按需配图，末尾附少量自检题和折叠答案。
```

在 Codex 中可将 `personal-paper-reading` 文件夹复制到个人 skills 目录，再通过 `$personal-paper-reading` 显式调用。

### 工具依赖

阅读指令本身可直接使用。HTML 渲染和 Notion 上传需要 Node.js **22.12 或更高版本**，在 `personal-paper-reading` 目录运行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
```

需要 PDF 提取和裁剪时，再安装对应 Python 依赖：

```powershell
python -m pip install -r requirements-pdf.txt
```

### 生成离线 HTML

```powershell
node scripts/render-reading.cjs path/to/paper.md path/to/paper.html
```

图片放在 Markdown 同目录或其子目录。内置 [教学示例](personal-paper-reading/examples/reading-demo.md) 用于演示呈现方式，其中合成数据不代表真实论文结论。

### 保存到 Notion

复制 [配置样例](personal-paper-reading/assets/notion.env.example) 到本机私人位置，填写 token 和一个保存位置。数据库模式可直接填写复制的数据库链接：

```dotenv
NOTION_TOKEN=your_notion_token
NOTION_DATABASE_ID=your_database_url_or_id
```

内部集成需要开启读取/插入内容能力，并将目标页面或数据库共享给该集成。详细配置和工作区顶层模式的 PAT 要求见 [Notion 上传与授权](personal-paper-reading/references/notion-upload.md)。

```powershell
node scripts/upload-to-notion.cjs path/to/paper.md --dry-run
node scripts/upload-to-notion.cjs --check-auth --env-file path/to/private/notion.env
node scripts/upload-to-notion.cjs path/to/paper.md --env-file path/to/private/notion.env
```

每篇笔记创建独立页面。同一篇未变化的笔记重复运行会返回已有页面，显式另建版本可用 `--new-page`。上传凭证只在本机读取，不包含在示例配置中。

### 清理中间文件

完成输出核对后，明确指定工作区及本次 PDF 提取目录。默认预览，`--apply` 才执行删除：

```powershell
node scripts/cleanup-reading.cjs --root path/to/workspace --extracted work/paper
node scripts/cleanup-reading.cjs --root path/to/workspace --extracted work/paper --apply
```

更多格式行为、边界和命令见 [工具说明](personal-paper-reading/references/tools.md)。

## 目录结构

| 目录 | 用途 |
|---|---|
| `personal-paper-reading/SKILL.md` | 阅读入口、任务范围与执行流程 |
| `personal-paper-reading/references/` | 机制讲解、证据核查、模板、知识图谱专项和工具说明 |
| `personal-paper-reading/scripts/` | PDF 提取、HTML 渲染、Notion 上传、清理及测试 |
| `personal-paper-reading/assets/` | 样式与不含真实凭证的配置样例 |
| `personal-paper-reading/examples/` | 教学 Markdown、离线 HTML 和示例配图 |
| `personal-paper-reading/third-party/` | 复用组件所需的许可证与署名副本 |

来源及复用说明见 [THIRD_PARTY.md](THIRD_PARTY.md)。运行本 skill 无需安装其他参考项目。

## 验证

在 `personal-paper-reading` 目录执行：

```powershell
npm test
python -m unittest discover -s scripts -p "test_pdf_tools.py"
```

Node 测试覆盖渲染、Notion 模拟接口和清理边界；PDF 测试使用自造文档检查提取与裁剪。模拟接口测试不需要真实 token，也不会写入 Notion。工具测试通过不代表论文事实或阅读质量已得到独立验证。

## 本地数据与授权

公开版本通过根目录白名单和凭证忽略规则排除私人笔记、表格、个人论文文件、真实配置、上传回执与本地测试报告。配置样例和教学示例可公开，真实凭证应保存在仓库之外；手动强制添加文件前仍需检查内容。

复用组件按原有许可证和署名声明使用，本仓库不对第三方材料重新授权；许可证及 NOTICE 副本位于 `personal-paper-reading/third-party/`。
