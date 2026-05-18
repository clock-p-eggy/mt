# mt 代码评审（仅已实现功能）

> Scope：只评审 `mt/` 中 **已实现 / 可达（reachable）** 的功能。
> 参考设计文档：`doc/原型分析-最终版2.md`。
> 文档中提到但 **代码未实现** 的内容，会标记为 **Not Implemented**，并且不会被当作“缺失功能”来评审。

## Scope & 结论

- 只评审代码中已经实现/可达的功能。
- 当前 `mt` 已有可玩的 MVP gameplay loop：
  - conveyor spawn eggs -> player 购买 -> 存入 8-slot bag -> 种在自己已解锁的 plot -> shake hatch -> spawn animal -> animal wallet 周期性累积 coins -> proximity ENTER 触发收集。
- 主要问题集中在：
  - conveyor spawn 边界 / movement 依赖
  - trigger/timer 生命周期与 cleanup
  - debug 风格的 economy 默认值与 doc 偏离

## Implemented 与 Doc 对齐情况（仅已实现功能）

### Conveyor / Egg Spawn & Purchase（部分实现）

- 已实现：
  - 周期性 spawn eggs、interact-to-buy、花费 coins、加入 inventory、destroy egg。
  - eggs 的 end-zone destroy。
- 代码：`ts_src/main.ts`、`ts_src/systems/MapGenerator.ts`。

- 不一致 / 风险（限定在已实现范围内）：
- Spawn rate：代码是 **1 egg / 3 seconds**（`ts_src/main.ts:202-216`），doc anchor 暗示约 ~1/sec。
  - On-screen cap 8：**not implemented**（没有 counting/cap enforcement）。
  - Belt movement L->R：**not implemented in TS**；如果 prefab/physics 不能可靠移动 eggs，可能会堆积。
  - End-destroy triggers 重复注册（global + per-egg）=> 可能 double-destroy / leak。

### Inventory / Bag（核心存在；UX 不同）

- 已实现：
  - 8 个 slots。
  - click slot 会选中并把 egg model 绑定到 player head。
- 代码：`ts_src/systems/InventorySystem.ts`。

- 与 doc 的差异（不要当作缺失功能）：
  - “Bag full -> egg drops near player and can be picked up”：**not implemented**；当前行为是拒绝 purchase。
  - “Purchase success toast” / “auto-select purchased egg” / “slot highlight” / “drag out of bag”: **not implemented**.

### Plots / Land（核心状态机已实现）

- 已实现：
  - Locked -> Unlocked (spend coins).
  - Unlocked -> Occupied (hatch -> animal).
  - Owner-only operations.
- 代码：`ts_src/systems/PlotSystem.ts`、`ts_src/systems/MapGenerator.ts`、`ts_src/systems/PlantingSystem.ts`。

- 与 doc 对齐点：
- Prices：$350 / $2,000 / $40,000 与 config 一致（`ts_src/config/PlotConfig.ts`）。
  - Default unlocked plots：doc 说 4；代码 layout 默认是 **2**。

### Hatching / Animals / Coins（核心已实现）

- 已实现：
  - Plant button gating 基于 focus + selection。
  - egg shake animation 后 spawn animal。
  - wallet-style coin accrual（周期性 tick）。
  - proximity trigger ENTER 触发收集。
  - scene UI panel 显示 name / stored / $/sec。
- 代码：`ts_src/systems/PlantingSystem.ts`、`ts_src/systems/EggHatchingSystem.ts`、`ts_src/systems/AnimalWalletSystem.ts`、`ts_src/systems/AnimalPanelSystem.ts`。

- 与 doc 的对齐备注：
  - doc 里的 Visual effects（crack VFX、coin fly-in）在代码路径里不存在；presentation layer 可视为 **not implemented**。

## 高风险问题（优先修）

### 1) Hatch timer 无法取消（exit -> orphan spawns）

- 行为：
  - `EggHatchingSystem.startShake(... onComplete ...)` schedules delayed callbacks.
  - role exit 时，会通过 `PlayerManager.removePlayer()` 清理 runtime island/state。
  - 但 `EggHatchingSystem` 没有 cancel；cleanup 后 callbacks 仍可能触发。

- 影响：
  - owner 离开后 Hatch 仍可能完成，spawn 出不属于任何有效 plot 的 “orphan” animals/panels/wallets。

- 相关代码：
- `ts_src/systems/EggHatchingSystem.ts`
- `ts_src/systems/PlantingSystem.ts`
- `ts_src/managers/PlayerManager.ts`
- `ts_src/main.ts` (`EVENT.SPEC_ROLE_EXIT_GAME`)

### 2) Conveyor spawn 无上限；movement 依赖外部

- 行为：
  - spawner 从不检查当前 egg count。
  - TS 侧未实现 movement。
  - spawn 过程中发生 error 可能留下部分初始化的 eggs。

- 影响：
  - egg 堆积 / performance 问题。
  - exception 后可能出现 orphan eggs（不可交互 / 未销毁）。

- 相关代码：
- `ts_src/main.ts`
- `ts_src/systems/MapGenerator.ts`

### 3) end-zone destroy triggers 重复注册

- 行为：
  - Global end-zone destroy + per-egg end-zone destroy 同时被注册。

- 影响：
  - 可能 double-destroy，出现 engine-dependent errors。
  - unregistering 的职责不清晰。

- 相关代码：
- `ts_src/systems/MapGenerator.ts`

### 4) 多人并发购买同一个 world egg 的竞争

- 行为：
  - 没有显式的 “purchased/locked” guard；依赖事后 destroy egg。

- 影响：
  - 并发交互可能导致重复发放或扣费不一致（取决于 event ordering）。

- 相关代码：
- `ts_src/systems/MapGenerator.ts`

## 中风险 / 一致性问题

### Debug economy 掩盖真实进度

- `GameConfig.INITIAL_COINS` 与 `PlayerManager.loadPlayerData()` 会 top-up 到 1,000,000 coins
  - 让 “not enough coins” 路径很难验证。
  - 偏离 doc 预期的 early game pacing。

- 相关代码：
- `ts_src/config/GameConfig.ts`
- `ts_src/managers/PlayerManager.ts`
- `ts_src/systems/EconomySystem.ts`

### 默认解锁 plot 数量不一致

- doc 说默认解锁 4 个 plots；代码默认是 2。
- 相关代码：`ts_src/config/PlotConfig.ts`。

### Late-joiner 的 SceneUI 同步缺口

- egg price/name 的 SceneUI text 只会对 spawn 时在场的 roles 设置。
- 新加入的 players 可能在既有 eggs 上看不到正确的 SceneUI。

## Doc 提到但未实现的系统（仅记录）

- Conveyor upgrade tiers / level unlocks: **not implemented**.
- Rarity weights / discount weights / composed price formula: **not implemented**.
- Bag drag-out, bag-full drop-near-player pickup, purchase success toast: **not implemented**.
- Super plot：有 scaffolding，但在 gameplay 中被禁用。
- Shop：目前只显示 “Shop not implemented” tip。
- Mining/mutation：代码路径存在（`MiningSystem`、mutation stone economy fields），但实际可达性取决于 scene prefabs/zones。本评审 **不会**假设它已作为可交付 gameplay（除非场景已配置）。

## 最小验证 Checklist

- Hatch exit：start hatching 后立刻 exit role；观察是否会延迟 spawn orphan animal。
- Conveyor soak：不买 eggs 等待 10-15 分钟；确认 egg count 有上限、不会无界增长。
- Double-buy：两名玩家对同一个 egg 连续 spam interact；验证不会出现 duplication/charge glitches。
- Late join：player A spawn eggs，player B 加入；验证 B 能看到正确的 price/name UI 并能 purchase。
- Save/load：buy egg -> inventory、unlock plot、hatch animal -> rejoin；验证 inventory、unlocked plots、plot animals 能恢复。

## 建议修复优先级（若进入实现阶段）

1) 让 hatching 可取消 / 保证 owner cleanup 后不会再触发 onComplete。
2) 增加 conveyor egg cap，并移除冗余的 end-zone trigger registration；同时保证异常路径能清理已 spawn 的 eggs。
3) 将 1,000,000 coin top-up 做成 debug/config toggle，避免掩盖 progression 与 edge-case 校验。
