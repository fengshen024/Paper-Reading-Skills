# 随 skill 携带的工具

以下命令均在 skill 文件夹运行；实际使用时替换论文、笔记和输出路径。工具只支持阅读过程，不代替来源核实。

## PDF 文本、页面与裁剪

Python 依赖见 `requirements-pdf.txt`。当前环境已有可用库时直接使用，不为普通笔记安装无关重型模型。

```powershell
python -m pip install -r requirements-pdf.txt
python scripts/extract-paper.py paper.pdf work/paper --pages 1,3-5
python scripts/extract-paper.py paper.pdf work/crop --pages 3 --clip 50 80 560 400
```

输出 `paper-text.txt`、带 PDF 页码和提取范围的 `source.json`，以及所选页的 PNG。文本始终提取整个 PDF；`--pages` 只控制哪些页渲染。页码从 1 开始，裁剪坐标是从页左上角计的 PDF 点，默认每点 2 像素。

只在已查看页面并确定范围后使用 `--clip`，然后实际查看输出，确认图例与图注完整。工具不自动识别图表、不执行 OCR，也不能保证文字顺序或公式准确；扫描 PDF 需另行 OCR。默认拒绝覆盖已有输出，明确需要重建时加 `--force`。

## 可选离线 HTML

复用 05 的渲染器、样式、公式和结构化视觉块。Markdown 仍是主稿，HTML 只在用户需要时生成。Node 至少 22.12；依赖按锁文件安装到 skill 本地，禁用安装脚本。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node scripts/render-reading.cjs notes/paper.md notes/paper.html
```

没有语言标记时默认中文。需要英文时在首行加 `<!-- paper-reading-lang: en -->`；可在语言标记之后或无语言标记的首行用 `<!-- paper-reading-theme: cobalt -->` 选择主题，支持 `forest`、`cobalt`、`plum`、`saffron`。

支持普通 Markdown、表格、`$...$`／`$$...$$` 公式、相对路径原图、代码以及 `<details>` 自检答案。图片、CSS、数学和字体嵌入单个 HTML，阅读文件不需要联网。**代码里的美元符号保持原样。** `[原文 §3.2, Eq.1]` 等引用可通过页面“显示原文定位”开关查看，正文表格中的来源文字始终保留。

图片放在 Markdown 所在目录或子目录中，支持 PNG／JPEG／WebP／GIF／SVG／已有 base64。远程图片和源文件目录之外的路径不自动下载或嵌入，先将获准使用的图放入配套 assets 目录。渲染器会重建目标 HTML，请使用专门的生成文件路径。

结构化图使用带 JSON 内容的代码块：

| 块类型 | 内容与必要字段 |
|---|---|
| `paper-map` | 全局图：`items`，每项 `number,label,text,source`；可附 `thesis` |
| `paper-path` | 流程：`title,stages`，每阶段 `title,role,action,why,output,source` |
| `paper-contrast` | 双机制对比：`title,intro,branches`，两个分支各有 `name,lead,scope,judge,signal,why,source` |
| `paper-experiments` | 实验问题表：`title,rows`，每行 `question,setup,observation,source`；把指标、数值和条件写进对应字段 |
| `paper-chart` | 分段或配对百分数图；只适用于百分数，不把 0–1 的 MRR 原值直接当百分数 |

完整写法见 [可运行示例](../examples/reading-demo.md)。结构化块只在需要时使用，普通笔记不必全部添加。每项论文事实必须给真实来源；教学数据明确标注。Mermaid 代码目前不会由该渲染器自动转成图，HTML 中需要图时改用结构化流程或经核查的 SVG／原图。

## Notion 上传

`scripts/upload-to-notion.cjs` 将 Markdown 转成原生 Notion 内容块，并上传本地图片。授权、私有配置文件、只读验证、去重和失败处理见 [Notion 上传与授权](notion-upload.md)。普通阅读不自动执行上传。

```powershell
node scripts/upload-to-notion.cjs ../notes/paper.md --dry-run
node scripts/upload-to-notion.cjs --check-auth --env-file PATH/TO/notion.env
node scripts/upload-to-notion.cjs ../notes/paper.md --env-file PATH/TO/notion.env
```

目标是数据库时可用 `--database '复制的数据库链接'` 或配置 `NOTION_DATABASE_ID`，自动识别其唯一 data source。数据库记录各自是独立页面；多个 data source 时明确选择 `--data-source ID`，详见授权说明。

## 完成后的清理

`scripts/cleanup-reading.cjs` 不访问 Notion。明确指定工作区 `--root`，默认只预览；加 `--apply` 才删除。只有本次阅读已完成、输出已核对后才应用清理。

```powershell
# 从 skill 目录运行，--extracted 路径相对于 --root；可重复指定。
node scripts/cleanup-reading.cjs --root .. --extracted work/paper
node scripts/cleanup-reading.cjs --root .. --extracted work/paper --apply
```

可清理的范围：

- 本 skill 的 `scripts/__pycache__` 中 `.pyc` 字节码缓存。
- 明确指定且具有有效 `source.json` 的 PDF 提取目录：`paper-text.txt`、来源记录列出的 `page-NNN.png`/`page-NNN-clip.png`。裁剪子目录需要分别指定；仍被 Markdown/HTML/CSS 引用的文件会保留。
- 上传成功后遗留、超过 24 小时、对应进程已退出且没有上传锁的回执 `.tmp`。失败记录、活跃锁和正式回执保留。

保留 `source.json` 供追溯；笔记、离线 HTML、PDF、配套 `.assets`、`assets/notion.env`、测试报告、预览计划、依赖及脚本均不清理。额外文件、预览后修改的文件或新增引用的文件不会因后缀相同被批量删除。来源文件及指定目录全部验证后才开始清理；符号链接/junction 和越界路径不删除，也不递归删除目录。脚本输出路径、数量和回收字节数，不读取或输出 token。

后续提取优先放到独立的 `work/<paper-slug>/`，最终使用的图复制到笔记配套 `.assets/` 后再清理提取目录。重复运行清理应返回零个待清理文件。

## 校验与测试

```powershell
python scripts/validate_paper_html.py notes/paper.html --json
node --test scripts/test-render-reading.cjs
node --test scripts/test-upload-to-notion.cjs
node --test scripts/test-cleanup-reading.cjs
python -m unittest discover -s scripts -p "test_pdf_tools.py"
```

HTML 校验器复用 04 的实现，检查公式卡、SVG 与 Mermaid 语法风险。默认不加 `--contract`，它属于上游批注协作页面，并不适用于这里的渲染版式。KaTeX 直接渲染与上游公式卡是两条路径；自绘 SVG 检查也可能对公式库的内部 SVG 给出不适用的建议，应核对具体警告。

这些检查不验证论文事实、阅读覆盖或图片视觉完整性。HTML 交付仍需实际查看公式、图像、长表格和自检答案；静态检查通过不代表阅读质量已获证明。

复用来源、改动与许可证见 [THIRD_PARTY.md](../THIRD_PARTY.md)。
