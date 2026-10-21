# 随 skill 携带的工具

以下命令均在 skill 文件夹运行；实际使用时替换论文、笔记和输出路径。工具只支持阅读过程，不代替来源核实。

## PDF 文本、页面与裁剪

Python 依赖见 `requirements-pdf.txt`。当前环境已有可用库时直接使用；只在首次确实缺依赖时安装，不为每次裁剪重复探测或安装。

```powershell
# 仅缺依赖时运行：python -m pip install -r requirements-pdf.txt
# 首轮提取一次全文，并批量渲染需要定位插图的页。
python scripts/extract-paper.py paper.pdf work/paper --pages 1,3-5
# 后续追加单张裁剪，不再次抽全文。
python scripts/extract-paper.py paper.pdf work/paper --append --no-text --pages 3 --clip 50 80 560 400
```

默认输出 `paper-text.txt`、带 PDF 页码和提取范围的 `source.json`，以及所选页的 PNG。首次文本抽取覆盖整个 PDF；`--pages` 控制渲染页，`--no-text` 完全跳过文本抽取及其 pypdf 依赖。页码从 1 开始，裁剪坐标是从页左上角计的 PDF 点，默认每点 2 像素，scale 合法范围为大于 0 且不超过 4。

### 先整页定位，再批量裁剪

一次查看每个目标整页，记录该页所有目标图的范围，包含图例、坐标和必要图注。`source.json` 的 `page_sizes_points` 给出实际页宽高；原始 PNG 像素坐标除以 scale 才是 PDF 点，阅读器缩放后的显示坐标不能直接使用。

把范围写入 UTF-8 JSON（例如 `work/clips.json`）：

```json
[
  {"page": 3, "box": [50, 80, 560, 400], "name": "fig2"},
  {"page": 3, "box": [50, 420, 560, 700], "name": "fig3"}
]
```

```powershell
python scripts/extract-paper.py paper.pdf work/paper --append --no-text --clips work/clips.json
```

上述坐标仅作格式示例，须按实际页替换。一条命令可跨页批量裁剪，同页多个 bbox 只渲染一次。输出为 `page-003-clip-fig2.png` 等；`name` 可省略，默认按条目序号命名，显式名称限 1–64 位英文字母、数字、下划线和连字符，同页不能重名。所有 bbox、页码和输出冲突在写文件前检查。之后同一轮检查这批图，仅重裁有问题的图，不逐图试坐标。

`--append` 合并 `rendered_pages` 和逐图 `renders`（文件、页码、bbox、scale），已有全文文本保持不变；没有旧文本且未指定 `--no-text` 时才抽取。已有图片仍拒绝覆盖，需要重裁同名图时显式加 `--force`；同时使用 `--append --force` 且不加 `--no-text` 会重建全文。追加时核对 PDF 路径及已记录的文件大小／修改时间，避免混入另一份或修改后的论文。旧版来源记录可追加，但没有历史逐图 bbox 的文件不会被臆造记录。

只需图片时可直接 `--no-text --pages ...` 或 `--no-text --clips ...` 开始，之后同样使用 `--append`。每篇论文复用一个提取目录和来源记录，最终选中的图复制到笔记 `.assets/`。

工具不自动识别图表、不执行 OCR，也不能保证文字顺序或公式准确；扫描 PDF 需另行 OCR。全文过长时在本地按 `=== PDF page N ===` 定位、分段读取，避免将整篇文本反复送入截断的工具输出。

### Windows 环境

PowerShell／终端的默认编码随版本和配置变化，不能统一视为 GBK。遇到 Python 中文输出乱码或编码错误时，在当前会话设置标准输入输出为 UTF-8：

```powershell
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
```

这不会改变 PowerShell 自身的文件编码；写 JSON 时明确使用 UTF-8（脚本也接受 UTF-8 BOM）。不要为验图尺寸临时尝试 `System.Drawing`；已有 Pillow 时直接：

```powershell
python -c "from PIL import Image; im=Image.open('work/paper/page-003.png'); print(im.size); im.close()"
```

尺寸检查不能替代对裁图内容的视觉核对。

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

`scripts/cleanup-reading.cjs` 不访问 Notion，无需先执行 `npm ci`。已安装时懒加载 `marked` 检查 Markdown 引用；未安装时保守扫描链接和文件名，可能多保留文件。明确指定工作区 `--root`，默认只预览；加 `--apply` 才删除。只有本次阅读已完成、输出已核对后才应用清理。

```powershell
# 从 skill 目录运行，--extracted 路径相对于 --root；可重复指定。
node scripts/cleanup-reading.cjs --root .. --extracted work/paper
node scripts/cleanup-reading.cjs --root .. --extracted work/paper --apply
```

可清理的范围：

- 本 skill 的 `scripts/__pycache__` 中 `.pyc` 字节码缓存。
- 明确指定且具有有效 `source.json` 的 PDF 提取目录：`paper-text.txt`、目录直属的 `page-NNN.png`、`page-NNN-clip.png` 和 `page-NNN-clip-NAME.png`，页码须在 PDF 范围内。即使旧来源记录遗漏页图也可清理；自定义其他文件名不匹配。裁剪子目录需要分别指定；仍被 Markdown/HTML/CSS 引用的文件会保留。
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
