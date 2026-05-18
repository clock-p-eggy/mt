# mt Feishu Notes

此前这里放过一次性的 workbook patch 脚本，用来补 Zoo Tycoon demo 早期表结构。
现在表结构已经稳定，对齐到通用 `导出目录 + 业务 sheet` 方案，这些项目私有 patch 脚本已删除。

当前建议流程：

- 结构初始化：在 `../feishu-operator/tools/feishu-doc` 使用 `npm run excel-init`
- Prefab/UI 镜像同步：使用 `npm run eggitor-export-sync`
- 导出代码生成：使用 `npm run excel-sync -- --game /home/zhangyuwen/eggy_space/mt`
- 业务字段调整：直接在飞书表内修改，必要时补充到通用工具，而不是再加 mt 私有 patch 脚本

通用说明见：

- `../feishu-operator/tools/feishu-doc/README.md`
- `../feishu-operator/docs/excel-v1/USAGE.md`
