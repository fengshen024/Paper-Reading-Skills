# 来源与复用说明

本仓库发布 `personal-paper-reading` 的阅读工作流与配套工具。整合过程中参考了三遍阅读、研究导向讲解、证据核查、理解自检与图文呈现等方法。

| 复用组件 | 上游来源 | 授权与保留文件 |
|---|---|---|
| 离线 HTML 渲染器、样式和通用渲染测试 | [Xiaofeng Shi / paper-reading-skill](https://github.com/xiaofengShi/paper-reading-skill) | MIT；保留作者及 LICENSE 副本 |
| HTML 静态校验器 | [成峰 / AI产品自由 / paper-reading-skills](https://github.com/Agentchengfeng/paper-reading-skills) | Apache-2.0；保留 LICENSE 与 NOTICE 副本 |

PDF 提取、Notion 上传、清理脚本及对应测试为本工作流编写。`marked`、`katex` 及 Python 依赖通过包管理器安装，分别遵循其上游授权。

具体修改和许可证链接见 [personal-paper-reading/THIRD_PARTY.md](personal-paper-reading/THIRD_PARTY.md)。本项目不以整合为由移除第三方作者署名，也不对第三方材料重新授权。
