必须先读的通用文档: @../platform/AGENTS.md. 注意, 你每次被压缩后, 也需要读它

# 游戏 Workspace 入口

该 workspace 是游戏根目录。

- Workspace root: `本目录`
- Project root: `project/`
- Game TS sources: `ts_src/`
- Platform/common library sources: `../platform/ts-src/`
- Lua output: `project/ts_out/` (underscore only)

## 项目级规则文档

- PrefabRegistry 契约：`doc/prefab-registry-contract.md`

## 通用模块使用约定（mt 已接入）

本项目已接入 platform 通用实现。大模型改代码时，先用这些模块，不要在 `ts_src/` 里重复造轮子。

- 事件总线：`@common/event_bus`
  - 用法入口：`EventBus.on/once/off/emit/createScope/disposeScope`
  - 游戏事件名定义在：`ts_src/utils/GameEvents.ts`
- Trigger 注册/反注册：`@common/trigger_hub`
  - 用法入口：`TriggerHub.createScope/register/registerMany/unregister/disposeScope`
- 数值归一化：`@common/num`
  - 用法入口：`toNumber`、`toNumberOrThrow`、`toIntOrThrow`
- 加权随机：`@common/weighted`
  - 用法入口：`pickWeightedId`、`hasPositiveWeight`
- 引擎安全调用：`@common/engine_safe`
  - 用法入口：`safeCall/safeVoid` 及 `safeCreate*`、`safeDestroy*`、`safeSet*`

## 本项目新增同类功能时的规则

- 先查 `../platform/ts-src/` 是否已有能力；已有则直接复用。
- 如确实缺能力，优先补到 `platform`，再在 `mt` 使用。
- 除业务玩法逻辑外（如地块规则、经济规则），不要在 `mt` 新建重复的通用工具。
