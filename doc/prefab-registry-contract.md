# PrefabRegistry 契约（必须遵守）

这是一份项目级规约，用来强制 PrefabRegistry 的需求侧/供给侧契约。

目标只有一个：

- 如果编辑器导出的资源缺失或命名不一致，必须在 TypeScript 编译期直接失败，而不是运行时将就。

## 适用范围

凡是动到下面任一内容，都按这份规约执行：

- Prefab（unit/character/group/trigger/scene ui 等）
- TriggerSpace / CustomTriggerSpace（编辑器里配置的触发区域）
- HUD/界面节点（例如 `role.set_node_visible`、`EVENT.UI_CUSTOM_EVENT` 依赖的节点名）

## 三条铁律

1) 游戏逻辑层禁止直接引用生成层

- 游戏代码禁止直接 import `ts_src/generated/*`
- 唯一允许接触生成层数据的地方：`ts_src/config/PrefabRegistry.ts`

2) 先更新数据源，再接业务

- 蛋/动物等核心 PrefabID 以 Excel 导出为准（`excel_data.ts`）
- 其余未入 Excel 的资源暂由 `PrefabRegistry` 快照常量承接，后续逐步迁移

3) 禁止运行时兜底

- 不要写“缺了就提示一下/跳过一下/用默认值”
- 这是资源契约问题，必须回到编辑器导出修复，不允许让线上带病运行

## 标准落地流程

1) 在需求侧登记资源名

编辑 `ts_src/config/PrefabRegistry.ts`：

- Prefab：优先从 Excel 行表构建映射
- UI 节点：集中维护在 `PrefabRegistry` 的快照常量

2) 在 PrefabRegistry 暴露结构化访问点

- 把资源挂到 `PrefabRegistry` 下，并按业务语义分组（示例：`PrefabRegistry.shopUI.root`）

3) 游戏逻辑只允许使用 PrefabRegistry

- 把所有直接写字符串或直接写数字 ID 的地方，替换为 `PrefabRegistry.*` 访问

4) 触发编译验证

```bash
npm run build
```

如果编译报缺少 key/字段等错误：

- 立刻停止继续写业务逻辑
- 修复 Excel / PrefabRegistry 数据并重新编译，直到通过
