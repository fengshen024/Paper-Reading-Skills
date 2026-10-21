# 第三方组件与修改

## 离线阅读渲染器

`scripts/render-reading.cjs`、`scripts/test-render-reading.cjs` 与 `assets/reading.css` 改编自 [Xiaofeng Shi 的 paper-reading-skill](https://github.com/xiaofengShi/paper-reading-skill)。

原项目为 MIT 许可证，副本见 [third-party/paper-reading-visual-LICENSE](third-party/paper-reading-visual-LICENSE)。适配包括中文 Markdown 默认行为、代码字面量保护、JPEG/GIF/data 图片处理、输出目录创建、个人阅读标签及对应验证。

## HTML 静态校验器

`scripts/validate_paper_html.py` 来自 [成峰 / AI产品自由的 paper-reading-skills](https://github.com/Agentchengfeng/paper-reading-skills)。

原项目为 Apache-2.0 许可证，保留 [LICENSE 副本](third-party/paper-reading-LICENSE) 与 [NOTICE 署名](third-party/paper-reading-NOTICE.md)。该校验器用于静态质量检查，不证明论文事实正确。

## 其他工具与方法参考

PDF 提取、Notion 上传、清理脚本及其相应测试为本整合工作流编写；Node 依赖 `marked`、`katex` 与 Python 依赖分别遵循其上游授权。依赖由包管理器安装，仓库不携带 `node_modules`。

阅读方法综合了三遍读法、研究导向解释、证据核查与自检方法。本项目不以复用、改写或整合为由移除第三方署名，也不对第三方作品重新授权。
