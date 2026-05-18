import { log } from "@common/utils"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { ExcelData, GameConfig, PrefabRegistry } from "./config"
import { json_parse } from "@common/json"
import {
  EconomySystem,
  MapGenerator,
  AnimalSystem,
  AnimalWalletSystem,
  AnimalPanelSystem,
  MiningSystem,
  PlotSystem,
  PlotActionSystem,
  InventorySystem,
  INVENTORY_UI_EVENT,
  PlantingSystem,
  PlayerSaveSystem,
  DailySignInSystem,
} from "./systems"
import { PlotSaveData } from "./systems/PlayerSaveSystem"
import { PlayerManager, SceneUIManager, UICache } from "./managers"
import { GameEvents } from "./utils"
// roleId -> currently selected shop level (defaults to 1)
const shopSelectedLevelByRoleId: Map<RoleID, number> = new Map()
const mainTriggerScopeId = TriggerHub.createScope("mt-main")

function registerMainTrigger(
  event: ReadonlyArray<unknown>,
  callback: (...args: any[]) => void
): number {
  const regId = TriggerHub.register(event, callback, {
    scopeId: mainTriggerScopeId,
  })
  if (regId === null) {
    throw new Error("[MainTrigger] register returned null")
  }
  return regId
}

function findRolesForCustomEvent(actor: unknown, data: unknown): Role[] {
  const result: Role[] = []
  const roleIds = new Set<RoleID>()

  function addRole(role: Role | null | undefined): void {
    if (role === null || role === undefined) return
    let roleId: RoleID
    try {
      roleId = role.get_roleid()
    } catch {
      return
    }
    if (roleIds.has(roleId)) return
    roleIds.add(roleId)
    result.push(role)
  }

  if (type(data) === "table") {
    const payload = data as Record<string, unknown>
    const role = payload.role as Role | undefined
    addRole(role)

    const roleIdRaw = payload.role_id
    const roleId = typeof roleIdRaw === "number" ? (roleIdRaw as RoleID) : undefined
    if (roleId !== undefined) {
      const roles = GameAPI.get_all_roles()
      for (const roleItem of roles) {
        if (roleItem.get_roleid() === roleId) {
          addRole(roleItem)
          break
        }
      }
    }
  }

  addRole(actor as Role)

  if (result.length > 0) return result
  return GameAPI.get_all_roles()
}

function validateExcelPrefabContracts(): void {
  ExcelData.init()

  function requireNumberMapping(map: Record<number, unknown>, id: number, what: string): void {
    if (map[id] === undefined) {
      throw new Error(`[ExcelContract] missing ${what} mapping for id=${String(id)}`)
    }
  }

  // PrefabId consistency: Excel should match PrefabRegistry for eggs/animals.
  // Runtime always uses PrefabRegistry (eggitor_export) as the source of truth;
  // this check prevents Excel from drifting silently.
  {
    const eggRows = ExcelData.getAllEggRows()
    for (let i = 0; i < eggRows.length; i++) {
      const row = eggRows[i]!
      const eggId = row["蛋ID"]
      const excelPrefabId = row["蛋PrefabID"]
      const registryPrefabId = (PrefabRegistry.egg as Record<number, number>)[eggId]
      if (registryPrefabId === undefined) {
        throw new Error(`[ExcelContract] missing egg prefab mapping in PrefabRegistry: eggId=${String(eggId)}`)
      }
      if (excelPrefabId !== registryPrefabId) {
        throw new Error(
          `[ExcelContract] egg prefabId mismatch: eggId=${String(eggId)} excel=${String(excelPrefabId)} registry=${String(
            registryPrefabId
          )}`
        )
      }
    }

    const animalRows = ExcelData.getAllAnimalRows()
    for (let i = 0; i < animalRows.length; i++) {
      const row = animalRows[i]!
      const animalId = row["动物ID"]
      const excelPrefabId = row["动物PrefabID"]
      const registryPrefabId = (PrefabRegistry.animal as Record<number, number>)[animalId]
      if (registryPrefabId === undefined) {
        throw new Error(`[ExcelContract] missing animal prefab mapping in PrefabRegistry: animalId=${String(animalId)}`)
      }
      if (excelPrefabId !== registryPrefabId) {
        throw new Error(
          `[ExcelContract] animal prefabId mismatch: animalId=${String(animalId)} excel=${String(
            excelPrefabId
          )} registry=${String(registryPrefabId)}`
        )
      }
    }
  }

  const enabledEggIds = ExcelData.getEnabledEggIds()
  for (let i = 0; i < enabledEggIds.length; i++) {
    const eggId = enabledEggIds[i]!
    requireNumberMapping(PrefabRegistry.egg as unknown as Record<number, unknown>, eggId, "egg prefab")
    requireNumberMapping(PrefabRegistry.inventoryIcons.egg as unknown as Record<number, unknown>, eggId, "egg icon")

    const hatchPool = ExcelData.getHatchPoolByEggId(eggId)
    for (let j = 0; j < hatchPool.length; j++) {
      const animalId = hatchPool[j]!.id
      requireNumberMapping(PrefabRegistry.animal as unknown as Record<number, unknown>, animalId, "animal prefab")
    }
  }

  // Validate conveyor pools for all levels that exist.
  const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })
  for (let level = 1; level <= maxLevel; level++) {
    const conveyorPool = ExcelData.getConveyorEggPoolByLevel(level)
    if (conveyorPool.length === 0) continue
    for (let i = 0; i < conveyorPool.length; i++) {
      const eggId = conveyorPool[i]!.id
      // Even if the egg is currently disabled, its mapping should exist to avoid save/load surprises.
      requireNumberMapping(PrefabRegistry.egg as unknown as Record<number, unknown>, eggId, "egg prefab")
      requireNumberMapping(PrefabRegistry.inventoryIcons.egg as unknown as Record<number, unknown>, eggId, "egg icon")
    }
  }
}

function debugFixedRuntime(): void {
  // Verify what "Fixed" is in this runtime.
  try {
    const c = 333
    GlobalAPI.warning(`[FixedCheck] type(c=333)=${tostring(type(c))} tostring(c)=${tostring(c)}`)

    const a1 = 1
    const b1 = 2
    const c1 = (a1 as unknown as number) / (b1 as unknown as number)
    GlobalAPI.warning(
      `[FixedCheck] type(1/2)=${tostring(type(c1))} tostring(1/2)=${tostring(c1)}`
    )

    const a2 = 4
    const b2 = 2
    const c2 = (a2 as unknown as number) / (b2 as unknown as number)
    GlobalAPI.warning(
      `[FixedCheck] type(4/2)=${tostring(type(c2))} tostring(4/2)=${tostring(c2)}`
    )

    // Pass a *number* into Fixed-typed math APIs.
    // (In this runtime, integer literals are `number`, decimals often become `Fixed`.)
    const num = 333
    GlobalAPI.warning(`[FixedCheck] type(num=333)=${tostring(type(num))} tostring(num)=${tostring(num)}`)
    try {
      const r = math.toreal(num as unknown as Fixed)
      GlobalAPI.warning(`[FixedCheck] math.toreal(num) ok type=${tostring(type(r))} value=${tostring(r)}`)
    } catch (e) {
      GlobalAPI.warning(`[FixedCheck] math.toreal(num) err=${tostring(e)}`)
    }
    try {
      const i = math.tointeger(num as unknown as Fixed)
      GlobalAPI.warning(`[FixedCheck] math.tointeger(num) ok type=${tostring(type(i))} value=${tostring(i)}`)
    } catch (e) {
      GlobalAPI.warning(`[FixedCheck] math.tointeger(num) err=${tostring(e)}`)
    }
    try {
      const ok = math.isfinite(num as unknown as Fixed)
      GlobalAPI.warning(`[FixedCheck] math.isfinite(num) ok type=${tostring(type(ok))} value=${tostring(ok)}`)
    } catch (e) {
      GlobalAPI.warning(`[FixedCheck] math.isfinite(num) err=${tostring(e)}`)
    }

    // Test string -> Fixed conversion.
    const e = tostring(1.4 as unknown as number)
    let f: unknown = undefined
    try {
      f = math.tofixed(e as unknown as integer)
    } catch (err) {
      GlobalAPI.warning(`[FixedCheck] math.tofixed(e) threw err=${tostring(err)}`)
    }
    GlobalAPI.warning(`[FixedCheck] e='${e}' type(e)=${tostring(type(e))}`)
    GlobalAPI.warning(`[FixedCheck] f=${tostring(f)} type(f)=${tostring(type(f))}`)
    let eq: unknown = undefined
    try {
      eq = (f as unknown as Fixed) == (1.4 as unknown as Fixed)
    } catch (err) {
      GlobalAPI.warning(`[FixedCheck] f==1.4 threw err=${tostring(err)}`)
    }
    GlobalAPI.warning(`[FixedCheck] type(f==1.4)=${tostring(type(eq))} value=${tostring(eq)}`)

    // Deserialize a decimal string back to a numeric value, then compare.
    const s = "1.3999999999069"
    let parsed: unknown = undefined
    try {
      parsed = json_parse(s)
    } catch (err) {
      GlobalAPI.warning(`[FixedCheck] json_parse('${s}') threw err=${tostring(err)}`)
    }
    GlobalAPI.warning(`[FixedCheck] json_parse('${s}') type=${tostring(type(parsed))} tostring=${tostring(parsed)}`)
    let eqParsed: unknown = undefined
    try {
      eqParsed = (parsed as unknown as Fixed) == (1.4 as unknown as Fixed)
    } catch (err) {
      GlobalAPI.warning(`[FixedCheck] parsed==1.4 threw err=${tostring(err)}`)
    }
    GlobalAPI.warning(`[FixedCheck] type(parsed==1.4)=${tostring(type(eqParsed))} value=${tostring(eqParsed)}`)
    let parsedInt: unknown = undefined
    try {
      parsedInt = math.tointeger(parsed as unknown as Fixed)
    } catch (err) {
      GlobalAPI.warning(`[FixedCheck] tointeger(parsed) threw err=${tostring(err)}`)
    }
    GlobalAPI.warning(`[FixedCheck] type(tointeger(parsed))=${tostring(type(parsedInt))} value=${tostring(parsedInt)}`)
    let eqParsedInt: unknown = undefined
    try {
      eqParsedInt = (parsedInt as unknown as number) == (1.4 as unknown as Fixed)
    } catch (err) {
      GlobalAPI.warning(`[FixedCheck] tointeger(parsed)==1.4 threw err=${tostring(err)}`)
    }
    GlobalAPI.warning(
      `[FixedCheck] type(tointeger(parsed)==1.4)=${tostring(type(eqParsedInt))} value=${tostring(eqParsedInt)}`
    )

    // Controls: parse a short decimal vs an int.
    const p14 = json_parse("1.4")
    GlobalAPI.warning(`[FixedCheck] json_parse('1.4') type=${tostring(type(p14))} tostring=${tostring(p14)}`)
    GlobalAPI.warning(`[FixedCheck] type(json_parse('1.4')==1.4)=${tostring(type((p14 as unknown as Fixed) == (1.4 as unknown as Fixed)))} value=${tostring((p14 as unknown as Fixed) == (1.4 as unknown as Fixed))}`)
    const p333 = json_parse("333")
    GlobalAPI.warning(`[FixedCheck] json_parse('333') type=${tostring(type(p333))} tostring=${tostring(p333)}`)

    const a = 1.4
    GlobalAPI.warning(`[FixedCheck] type(a=1.4)=${tostring(type(a))} tostring(a)=${tostring(a)}`)
    let b: unknown = undefined
    try {
      b = tonumber(a as unknown as number)
    } catch (e) {
      GlobalAPI.warning(`[FixedCheck] tonumber(a) threw err=${tostring(e)}`)
    }
    GlobalAPI.warning(`[FixedCheck] type(b=tonumber(a))=${tostring(type(b))} tostring(b)=${tostring(b)}`)

    const n = 1.5
    const fixedFromNumber = math.tofixed(1)
    const ts = GameAPI.get_timestamp()

    GlobalAPI.warning(
      `[FixedCheck] type(1.5)=${tostring(type(n))} type(math.tofixed(1))=${tostring(type(fixedFromNumber))}`
    )
    GlobalAPI.warning(
      `[FixedCheck] type(get_timestamp)=${tostring(type(ts))} tostring(get_timestamp)=${tostring(ts)}`
    )

    const tsInt = math.tointeger(ts as unknown as Fixed)
    GlobalAPI.warning(`[FixedCheck] type(tointeger(ts))=${tostring(type(tsInt))} value=${tostring(tsInt)}`)

    const tsReal = math.toreal(ts as unknown as Fixed)
    GlobalAPI.warning(`[FixedCheck] type(toreal(ts))=${tostring(type(tsReal))} value=${tostring(tsReal)}`)

    const mix1 = (ts as unknown as Fixed) + (n as unknown as Fixed)
    GlobalAPI.warning(`[FixedCheck] type(ts + 1.5)=${tostring(type(mix1))} value=${tostring(mix1)}`)
    const mix2 = (ts as unknown as Fixed) - (ts as unknown as Fixed)
    GlobalAPI.warning(`[FixedCheck] type(ts - ts)=${tostring(type(mix2))} value=${tostring(mix2)}`)
  } catch (e) {
    GlobalAPI.warning(`[FixedCheck] failed err=${tostring(e)}`)
  }
}

function initGame(): void {
  log("[ZooTycoon] Initializing game...")

  if (GameConfig.DEBUG_FIXED_RUNTIME) {
    debugFixedRuntime()
  }

  validateExcelPrefabContracts()

  MapGenerator.setObstacleInteractionHandler(handleObstacleInteraction)
  MapGenerator.generateAllBatched(() => {
    log("[ZooTycoon] Map generated")

    UICache.init()
    log("[ZooTycoon] UICache initialized")

    PlantingSystem.init()

    PlotActionSystem.init()

    // Persist inventory changes into per-role island save.
    EventBus.on(GameEvents.INVENTORY_CHANGED, (role: unknown) => {
      const r = role as Role
      if (PlayerManager.isLoading(r)) return
      const island = PlayerSaveSystem.getIsland(r)
      const inv = InventorySystem.exportToSave(r)
      island.inventorySlots = inv.eggTypeIds
      island.inventoryRarityIds = inv.rarityIds
      PlayerSaveSystem.setIsland(r, island)
    })

    EventBus.on(GameEvents.WALLET_COINS_COLLECTED, (role: unknown, amount: unknown, plotId: unknown) => {
      const r = role as Role
      if (PlayerManager.isLoading(r)) return
      UICache.pulseCoins(r)
    })

    // Per-player animal billboards (distance culled).
    AnimalPanelSystem.init()

    // Inventory slot clicks (expected to use event_name = INVENTORY_UI_EVENT).
    const inventoryUiEventRegId = registerMainTrigger(
      [EVENT.UI_CUSTOM_EVENT, INVENTORY_UI_EVENT],
      function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
        InventorySystem.handleSlotClicked(data.role, data.eui_node_id)
      }
    )
    log(`[EventReg] UI_CUSTOM_EVENT '${INVENTORY_UI_EVENT}' id=${tostring(inventoryUiEventRegId)}`)

    // Plant button click (UI -> Lua). Must match the button's configured UI custom event name.
    const plantUiEventRegId = registerMainTrigger(
      [EVENT.UI_CUSTOM_EVENT, "点击种植事件"],
      function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
        // Extra safety: only accept clicks from the expected node.
        if (data.eui_node_id !== (PrefabRegistry.inventoryUI.plantButton as unknown as ENode)) {
          return
        }
        PlantingSystem.handlePlantClicked(data.role)
      }
    )
    log(`[EventReg] UI_CUSTOM_EVENT '点击种植事件' id=${tostring(plantUiEventRegId)}`)

    // Plot buy button click (SceneUI -> Lua).
    // Some editor configs use '-' vs '_' in event names; listen to both but route to one handler.
    const registerPlotBuyUiEvent = (eventName: string): void => {
      const id = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, eventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          log(
            `[PlotBuy] UI_CUSTOM_EVENT fired name=${eventName} role=${tostring(data.role.get_roleid())} nodeId=${tostring(data.eui_node_id)} actor=${tostring(_actor)}`
          )
          SceneUIManager.handlePlotPurchaseClicked(data.role, _actor, data.eui_node_id)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
    }

    registerPlotBuyUiEvent("地板购买价格面板-点击购买事件")
    registerPlotBuyUiEvent("地板购买价格面板_点击购买事件")

    // Egg buy button click (SceneUI '蛋价格' -> Lua).
    // Similar to plot buy: listen to both '-' and '_' variants.
    const registerEggBuyUiEvent = (eventName: string): void => {
      const id = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, eventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          log(
            `[EggBuy] UI_CUSTOM_EVENT fired name=${eventName} role=${tostring(data.role.get_roleid())} nodeId=${tostring(data.eui_node_id)} actor=${tostring(_actor)} actorType=${type(_actor)}`
          )
          MapGenerator.handleEggPricePurchaseClicked(data.role, _actor, data.eui_node_id)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
    }

    try {
      registerEggBuyUiEvent("蛋价格-购买按钮-点击事件")
      registerEggBuyUiEvent("蛋价格_购买按钮_点击事件")
    } catch (e) {
      GlobalAPI.warning(`[EventReg] egg buy event failed: ${tostring(e)}`)
    }

    // Clear save button click (UI -> Lua).
    try {
      const clearSaveId = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, "清空存档按钮事件"],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          const r = data.role
          PlayerSaveSystem.clearArchive(r)
          r.show_tips("存档已清空 (1010)", 1.2 as Fixed)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '清空存档按钮事件' id=${tostring(clearSaveId)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] clear save event failed: ${tostring(e)}`)
    }

    try {
      const addCoinsEventName = "加钱按钮点击事件"
      const addCoinsId = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, addCoinsEventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          const r = data.role
          EconomySystem.addCoins(r, 200)
          PlayerSaveSystem.save(r)
          UICache.setText(r, "金币", tostring(EconomySystem.getCoins(r)))
          r.show_tips("+$200", 1.2 as Fixed)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${addCoinsEventName}' id=${tostring(addCoinsId)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] add coins event failed: ${tostring(e)}`)
    }

    // Offline income collect button.
    try {
      const eventName = "离线收益-收下按钮-点击事件"
      const id = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, eventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          const role = data.role
          const expected = PrefabRegistry.offlineIncomeUI.collectButton as unknown as ENode
          if (data.eui_node_id !== expected) {
            return
          }

          const pending = PlayerSaveSystem.getPendingOfflineCoins(role)
          if (pending <= 0) {
            try {
              role.set_node_visible(PrefabRegistry.offlineIncomeUI.root as unknown as ENode, false)
            } catch {
              // ignore
            }
            return
          }

          EconomySystem.addCoins(role, pending)
          PlayerSaveSystem.setPendingOfflineCoins(role, 0)
          PlayerSaveSystem.save(role)
          try {
            role.set_node_visible(PrefabRegistry.offlineIncomeUI.root as unknown as ENode, false)
          } catch {
            // ignore
          }
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] offline income event failed: ${tostring(e)}`)
    }

    // Daily sign-in panel: close (no claim).
    try {
      const eventName = "每日奖励面板-关闭按钮-点击事件"
      const id = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, eventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          const expected = PrefabRegistry.dailyRewardUI.closeButton as unknown as ENode
          if (data.eui_node_id !== expected) return
          DailySignInSystem.handleClose(data.role)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] daily sign-in close event failed: ${tostring(e)}`)
    }

    // Daily sign-in panel: confirm/claim.
    try {
      const eventName = "每日奖励面板-签到按钮-点击事件"
      const id = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, eventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          const expected = PrefabRegistry.dailyRewardUI.signInButton as unknown as ENode
          if (data.eui_node_id !== expected) return
          DailySignInSystem.handleSignIn(data.role)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] daily sign-in confirm event failed: ${tostring(e)}`)
    }

    const registerDailyRewardEvent = (eventName: string, amount: number): void => {
      try {
        const id = registerMainTrigger([EVENT.CUSTOM_EVENT, eventName], function (_event_name: unknown, actor: unknown, data: unknown) {
          const roles = findRolesForCustomEvent(actor, data)
          for (const role of roles) {
            DailySignInSystem.grantReward(role, amount, eventName)
          }
        })
        log(`[EventReg] CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
      } catch (e) {
        GlobalAPI.warning(`[EventReg] daily reward custom event failed: name=${eventName} err=${tostring(e)}`)
      }
    }

    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_1, 1000)
    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_2, 5000)
    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_3, 100000)
    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_4, 0)
    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_5, 0)
    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_6, 0)
    registerDailyRewardEvent(GameEvents.SIGN_IN_REWARD_DAY_7, 0)

    // Plot action panel + swap/recycle overlays.
    const registerPlotActionUiEvent = (eventName: string, expectedNode: ENode, cb: (role: Role) => void): void => {
      try {
        const id = registerMainTrigger(
          [EVENT.UI_CUSTOM_EVENT, eventName],
          function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
            if (data.eui_node_id !== expectedNode) return
            cb(data.role)
          }
        )
        log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
      } catch (e) {
        GlobalAPI.warning(`[EventReg] plot action ui event failed: name=${eventName} err=${tostring(e)}`)
      }
    }

    registerPlotActionUiEvent(
      "地块操作面板-回收-点击事件",
      PrefabRegistry.plotActionUI.recycleButton as unknown as ENode,
      (role) => PlotActionSystem.handleRecycleClicked(role)
    )
    registerPlotActionUiEvent(
      "地块操作面板-换位-点击事件",
      PrefabRegistry.plotActionUI.swapButton as unknown as ENode,
      (role) => PlotActionSystem.handleSwapClicked(role)
    )
    registerPlotActionUiEvent(
      "地块操作面板-变异-点击事件",
      PrefabRegistry.plotActionUI.mutateButton as unknown as ENode,
      (role) => PlotActionSystem.handleMutateClicked(role)
    )
    registerPlotActionUiEvent(
      "地块操作面板-升级-点击事件",
      PrefabRegistry.plotActionUI.upgradeButton as unknown as ENode,
      (role) => PlotActionSystem.handleUpgradeClicked(role)
    )
    registerPlotActionUiEvent(
      "换位-退出-点击事件",
      PrefabRegistry.swapOverlayUI.exitButton as unknown as ENode,
      (role) => PlotActionSystem.handleSwapExit(role)
    )
    registerPlotActionUiEvent(
      "换位-确认-点击事件",
      PrefabRegistry.swapOverlayUI.confirmButton as unknown as ENode,
      (role) => PlotActionSystem.handleSwapConfirm(role)
    )
    registerPlotActionUiEvent(
      "回收确认面板-确认-点击事件",
      PrefabRegistry.recycleConfirmUI.confirmButton as unknown as ENode,
      (role) => PlotActionSystem.handlePrimaryModalConfirm(role)
    )
    registerPlotActionUiEvent(
      "回收确认面板-取消-点击事件",
      PrefabRegistry.recycleConfirmUI.cancelButton as unknown as ENode,
      (role) => PlotActionSystem.handlePrimaryModalCancel(role)
    )

    try {
      const confirmId = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, "确认广告弹窗"],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          log(
            `[Event] UI_CUSTOM_EVENT '确认广告弹窗' role=${tostring(data.role.get_roleid())} nodeId=${tostring(data.eui_node_id)}`
          )
          PlotActionSystem.handleAdUnlockConfirm(data.role)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '确认广告弹窗' id=${tostring(confirmId)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] ad unlock confirm event failed: ${tostring(e)}`)
    }

    try {
      const cancelId = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, "关闭广告弹窗"],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          log(
            `[Event] UI_CUSTOM_EVENT '关闭广告弹窗' role=${tostring(data.role.get_roleid())} nodeId=${tostring(data.eui_node_id)}`
          )
          PlotActionSystem.handlePrimaryModalCancel(data.role)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '关闭广告弹窗' id=${tostring(cancelId)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] ad unlock cancel event failed: ${tostring(e)}`)
    }

    // Shop close button click (UI -> Lua).
    try {
      const shopCloseId = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, "商店界面-关闭按钮-点击事件"],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          log(
            `[Event] UI_CUSTOM_EVENT '商店界面-关闭按钮-点击事件' role=${tostring(data.role.get_roleid())} nodeId=${tostring(
              data.eui_node_id
            )}`
          )
          try {
            data.role.set_node_visible(PrefabRegistry.shopUI.root as unknown as ENode, false)
          } catch {
            // ignore
          }
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '商店界面-关闭按钮-点击事件' id=${tostring(shopCloseId)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] shop close event failed: ${tostring(e)}`)
    }

    // Shop level buttons: exclusive selection (1..5)
    const shopLevelButtons = [
      { level: 1, nodeName: "商店界面-一级按钮" },
      { level: 2, nodeName: "商店界面-二级按钮" },
      { level: 3, nodeName: "商店界面-三级按钮" },
      { level: 4, nodeName: "商店界面-四级按钮" },
      { level: 5, nodeName: "商店界面-五级按钮" },
    ] as const

    const shopLevelNormal: ImageKey = 10047 as ImageKey
    const shopLevelSelected: ImageKey = 10048 as ImageKey

    function shopLevelText(level: number): string {
      // Displayed at UI label node "商店界面-级别展示".
      // Requirement: show "N级"; when nothing selected default to "一级".
      // We use Chinese numerals for 1..5 to match existing UI naming.
      if (level === 1) return "一级"
      if (level === 2) return "二级"
      if (level === 3) return "三级"
      if (level === 4) return "四级"
      if (level === 5) return "五级"
      return `${tostring(level)}级`
    }

    function getShopMaxUnlockedLevel(role: Role): number {
      const island = PlayerSaveSystem.getIsland(role)
      const v = island.shopMaxUnlockedLevel
      const raw = typeof v === "number" ? v : 1
      const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })
      if (raw < 1) return 1
      if (maxLevel >= 1 && raw > maxLevel) return maxLevel
      return raw
    }

    function showShopLevelHint(role: Role, selectedLevel: number): void {
      const maxUnlocked = getShopMaxUnlockedLevel(role)
      const desc = ExcelData.getConveyorUnlockDesc(selectedLevel)
      const price = ExcelData.getConveyorUpgradePrice(selectedLevel)

      if (selectedLevel <= maxUnlocked) {
        if (desc.length > 0) {
          role.show_tips(desc, 1.5 as Fixed)
        }
        return
      }

      if (selectedLevel === maxUnlocked + 1) {
        const priceText = price === null ? "" : `$${tostring(price)}`
        if (desc.length > 0 && priceText.length > 0) {
          role.show_tips(`解锁费用${priceText}: ${desc}`, 2.01 as Fixed)
        } else if (priceText.length > 0) {
          role.show_tips(`解锁费用${priceText}`, 1.5 as Fixed)
        } else if (desc.length > 0) {
          role.show_tips(desc, 1.5 as Fixed)
        }
        return
      }

      // Locked beyond next: still show description to guide players.
      if (desc.length > 0) {
        role.show_tips(desc, 1.5 as Fixed)
      }
    }

    function setShopPurchaseButtonText(role: Role, selectedLevel: number): void {
      const maxUnlocked = getShopMaxUnlockedLevel(role)
      const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })

      // UX requirement:
      // - Already unlocked: show "已解锁"
      // - Next unlockable level (max+1): show "购买 $X" (from Excel)
      // - Skipping levels (> max+1): show "未解锁"
      let text: string
      if (maxLevel >= 1 && selectedLevel > maxLevel) {
        text = "未开放"
      } else if (selectedLevel <= maxUnlocked) {
        text = "已解锁"
      } else if (selectedLevel === maxUnlocked + 1) {
        const price = ExcelData.getConveyorUpgradePrice(selectedLevel)
        if (price !== null && price > 0) {
          text = `购买 $${tostring(price)}`
        } else {
          text = "购买"
        }
      } else {
        text = "未解锁"
      }
      try {
        role.set_button_text(PrefabRegistry.shopUI.purchaseButton, text)
      } catch (e) {
        GlobalAPI.warning(
          `[Shop] set purchase button text failed: role=${tostring(role.get_roleid())} text=${text} err=${tostring(e)}`
        )
      }
    }

    function applyShopLevelSelection(role: Role, selectedLevel: number): void {
      const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })
      // Hide buttons above the configured max level.
      for (let i = 1; i <= 5; i++) {
        const btn = PrefabRegistry.shopUI.levelButtons[i]
        const visible = maxLevel <= 0 ? true : i <= maxLevel
        try {
          role.set_node_visible(btn as unknown as ENode, visible)
        } catch {
          // ignore
        }
      }

      shopSelectedLevelByRoleId.set(role.get_roleid(), selectedLevel)
      for (const b of shopLevelButtons) {
        const img = b.level === selectedLevel ? shopLevelSelected : shopLevelNormal
        const btn = PrefabRegistry.shopUI.levelButtons[b.level]
        try {
          role.set_button_normal_image(btn, img)
          role.set_button_pressed_image(btn, img)
        } catch (e) {
          GlobalAPI.warning(`[Shop] apply level image failed: role=${tostring(role.get_roleid())} level=${tostring(b.level)} err=${tostring(e)}`)
        }
      }

      try {
        role.set_label_text(PrefabRegistry.shopUI.levelDisplay, shopLevelText(selectedLevel))
      } catch (e) {
        GlobalAPI.warning(
          `[Shop] set level display failed: role=${tostring(role.get_roleid())} level=${tostring(selectedLevel)} err=${tostring(e)}`
        )
      }

      setShopPurchaseButtonText(role, selectedLevel)
      showShopLevelHint(role, selectedLevel)
    }

    // Shop purchase button: unlock selected level (no skipping).
    try {
      const eventName = "商店界面-购买按钮-点击事件"
      const id = registerMainTrigger(
        [EVENT.UI_CUSTOM_EVENT, eventName],
        function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
          const role = data.role

          // Optional safety: ensure click is from expected button.
          const expected = PrefabRegistry.shopUI.purchaseButton as unknown as ENode
          if (data.eui_node_id !== expected) {
            return
          }

          const selectedCached = shopSelectedLevelByRoleId.get(role.get_roleid())
          const selected = selectedCached === undefined ? 1 : selectedCached
          const island = PlayerSaveSystem.getIsland(role)
          const maxUnlocked = getShopMaxUnlockedLevel(role)
          const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })

          if (maxLevel >= 1 && selected > maxLevel) {
            role.show_tips("该等级未开放", 1.5 as Fixed)
            setShopPurchaseButtonText(role, selected)
            return
          }

          if (selected <= maxUnlocked) {
            role.show_tips("已解锁", 1.2 as Fixed)
            setShopPurchaseButtonText(role, selected)
            return
          }

          const nextUnlock = maxUnlocked + 1
          if (selected !== nextUnlock) {
            role.show_tips(`不能跳级，请先解锁${shopLevelText(nextUnlock)}`, 1.5 as Fixed)
            setShopPurchaseButtonText(role, selected)
            return
          }

          const upgradePrice = ExcelData.getConveyorUpgradePrice(selected)
          if (upgradePrice === null) {
            role.show_tips("配置缺失：升级价格", 1.5 as Fixed)
            setShopPurchaseButtonText(role, selected)
            return
          }
          if (upgradePrice > 0 && !EconomySystem.spendCoins(role, upgradePrice)) {
            role.show_tips(`金币不足，需要$${tostring(upgradePrice)}`, 1.5 as Fixed)
            setShopPurchaseButtonText(role, selected)
            return
          }

          island.shopMaxUnlockedLevel = selected
          PlayerSaveSystem.setIsland(role, island)
          PlayerSaveSystem.save(role)
          role.show_tips(`${shopLevelText(selected)}已解锁`, 1.5 as Fixed)
          setShopPurchaseButtonText(role, selected)
        }
      )
      log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] shop purchase event failed: ${tostring(e)}`)
    }

    for (const b of shopLevelButtons) {
      const eventName = `${b.nodeName}-点击事件`
      try {
        const id = registerMainTrigger(
          [EVENT.UI_CUSTOM_EVENT, eventName],
          function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
            // Optional safety: ensure the clicked node matches the expected button.
            const expected = PrefabRegistry.shopUI.levelButtons[b.level] as unknown as ENode
            if (data.eui_node_id !== expected) {
              log(
                `[Shop] level click ignored: event=${eventName} role=${tostring(data.role.get_roleid())} nodeId=${tostring(
                  data.eui_node_id
                )} expected=${tostring(expected as unknown as string)}`
              )
              return
            }

            log(`[Shop] level selected: role=${tostring(data.role.get_roleid())} level=${tostring(b.level)}`)
            applyShopLevelSelection(data.role, b.level)
          }
        )
        log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
      } catch (e) {
        GlobalAPI.warning(`[EventReg] shop level event failed: name=${eventName} err=${tostring(e)}`)
      }
    }

    // Debug compatibility: some UI authoring uses "商店界面-级别按钮-点击事件{1..N}" naming.
    // Register them as well so we can confirm which scheme is firing.
    for (let level = 1; level <= 5; level++) {
      const eventName = `商店界面-级别按钮-点击事件${tostring(level)}`
      try {
        const id = registerMainTrigger(
          [EVENT.UI_CUSTOM_EVENT, eventName],
          function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
            log(
              `[Shop] level click event fired: name=${eventName} role=${tostring(data.role.get_roleid())} nodeId=${tostring(
                data.eui_node_id
              )}`
            )
            applyShopLevelSelection(data.role, level)
          }
        )
        log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
      } catch (e) {
        GlobalAPI.warning(`[EventReg] shop level event failed: name=${eventName} err=${tostring(e)}`)
      }
    }

    // Compatibility: some UI authoring uses a single shared event name for all level buttons.
    // In this case, discriminate by nodeId.
    {
      const eventName = "商店界面-级别按钮-点击事件"
      try {
        const id = registerMainTrigger(
          [EVENT.UI_CUSTOM_EVENT, eventName],
          function (_event_name: unknown, _actor: unknown, data: { role: Role; eui_node_id: ENode }) {
            let clickedLevel: number | null = null
            for (let level = 1; level <= 5; level++) {
              const expected = PrefabRegistry.shopUI.levelButtons[level] as unknown as ENode
              if (data.eui_node_id === expected) {
                clickedLevel = level
                break
              }
            }

            log(
              `[Shop] level click event fired: name=${eventName} role=${tostring(data.role.get_roleid())} nodeId=${tostring(
                data.eui_node_id
              )} level=${tostring(clickedLevel)}`
            )

            if (clickedLevel === null) {
              return
            }

            applyShopLevelSelection(data.role, clickedLevel)
          }
        )
        log(`[EventReg] UI_CUSTOM_EVENT '${eventName}' id=${tostring(id)}`)
      } catch (e) {
        GlobalAPI.warning(`[EventReg] shop level event failed: name=${eventName} err=${tostring(e)}`)
      }
    }

    // Player leave: destroy runtime island state.
    try {
      const exitId = registerMainTrigger(
        [EVENT.SPEC_ROLE_EXIT_GAME],
        function (_event_name: unknown, _actor: unknown, data: { role: Role }) {
          const r = data.role
          SceneUIManager.cleanupOwner(r.get_roleid())
          const pendingByPlot = AnimalWalletSystem.exportPendingCoinsByPlot(r.get_roleid())
          const island = PlayerSaveSystem.getIsland(r)
          const hadPlots = island.plots !== undefined
          let pendingTotal = 0
          const existingPending = PlayerSaveSystem.getPendingOfflineCoins(r)
          for (const plotId in pendingByPlot) {
            const pending = pendingByPlot[plotId]
            if (pending === undefined || pending <= 0) continue
            if (island.plots === undefined) island.plots = {}
            let st = island.plots[plotId]
            if (st === undefined) {
              st = new PlotSaveData()
              island.plots[plotId] = st
            }
            st.pendingCoins += pending
            pendingTotal += pending
          }
          log(
            `[OfflineIncome] exit role=${tostring(r.get_roleid())} pendingTotal=${tostring(pendingTotal)} ` +
              `existingPending=${tostring(existingPending)} hadPlots=${tostring(hadPlots)}`
          )
          PlayerSaveSystem.setLastExitTimestamp(r, GameAPI.get_timestamp())
          PlayerSaveSystem.save(r)
          PlayerManager.removePlayer(r)
        }
      )
      log(`[EventReg] SPEC_ROLE_EXIT_GAME id=${tostring(exitId)}`)
    } catch (e) {
      GlobalAPI.warning(`[EventReg] SPEC_ROLE_EXIT_GAME failed: ${tostring(e)}`)
    }

    initAllPlayers()
    log("[ZooTycoon] Players initialized")

    SceneUIManager.initAllUI()
    log("[ZooTycoon] Scene UI initialized")

    startUIUpdateTimer()

    startIncomeTimer()
    log("[ZooTycoon] Income timer started")

    startConveyorEggSpawner()

    startPlayerJoinPoll()

    log("[ZooTycoon] Sync verify marker: 20260226-03")
    log("[ZooTycoon] Game ready!")
  })
}

function startPlayerJoinPoll(): void {
  const tickInterval = math.toreal(0.5)

  function tick(): void {
    const roles = GameAPI.get_all_roles()
    for (const role of roles) {
      if (!PlayerManager.isInitialized(role)) {
        PlayerManager.initPlayer(role)
        PlayerManager.loadPlayerData(role)
        PlayerManager.giveStarterPack(role)

        // Plot buy UI is now focus-based (PLOT_SELECTED/UNSELECTED), no per-plot label creation.
      }
    }

    LuaAPI.call_delay_time(tickInterval, tick)
  }

  LuaAPI.call_delay_time(tickInterval, tick)
}

function initAllPlayers(): void {
  const roles = GameAPI.get_all_roles()
  log(`[ZooTycoon] Found ${roles.length} roles`)
  for (const role of roles) {
    log(`[ZooTycoon] Initializing player ${role.get_roleid()}`)
    PlayerManager.initPlayer(role)
    log(`[ZooTycoon] Player ${role.get_roleid()} initialized`)
    PlayerManager.loadPlayerData(role)
    log(`[ZooTycoon] Player ${role.get_roleid()} data loaded`)
    PlayerManager.giveStarterPack(role)
    log(`[ZooTycoon] Player ${role.get_roleid()} starter pack given`)
  }
}

function startIncomeTimer(): void {
  const interval = math.toreal(GameConfig.INCOME_INTERVAL)

  LuaAPI.call_delay_time(interval, function tick() {
    const roles = GameAPI.get_all_roles()
    for (const role of roles) {
      if (PlayerManager.isInitialized(role)) {
        AnimalWalletSystem.tick(role, interval)
      }
    }

    LuaAPI.call_delay_time(interval, tick)
  })
}

function startUIUpdateTimer(): void {
  const tickInterval = math.toreal(0.2)

  function tick(): void {
    const roles = GameAPI.get_all_roles()
    for (const role of roles) {
      if (PlayerManager.isInitialized(role)) {
        const stats = PlayerManager.getPlayerStats(role)
        UICache.updateAllStats(role, stats)
      }
    }
    LuaAPI.call_delay_time(tickInterval, tick)
  }

  LuaAPI.call_delay_time(tickInterval, tick)
}


function startConveyorEggSpawner(): void {
  const spawnInterval = math.toreal(3)

  ExcelData.init()
  const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })

  function findRoleById(roleId: RoleID): Role | null {
    const roles = GameAPI.get_all_roles()
    for (const r of roles) {
      if (r.get_roleid() === roleId) return r
    }
    return null
  }

  function tick(): void {
    const owners = PlayerManager.getAllInitializedPlayers()
    for (const ownerRoleId of owners) {
      // Use the player's unlocked shop level as current conveyor level.
      // This matches current gameplay progression (1..5) without introducing a separate conveyor-level system.
      const role = findRoleById(ownerRoleId)
      let level = 1
      if (role !== null) {
        const island = PlayerSaveSystem.getIsland(role)
        const v = island.shopMaxUnlockedLevel
        level = typeof v === "number" ? v : 1
      }

      if (level < 1) level = 1
      if (maxLevel >= 1 && level > maxLevel) level = maxLevel

      let eggTypeId = ExcelData.pickConveyorEggId(level, { enabledOnly: true })
      if (eggTypeId === null && level !== 1) {
        eggTypeId = ExcelData.pickConveyorEggId(1, { enabledOnly: true })
      }
      if (eggTypeId !== null) {
        MapGenerator.spawnEggAtConveyorStartForOwner(ownerRoleId, eggTypeId)
      }
    }

    LuaAPI.call_delay_time(spawnInterval, tick)
  }

  LuaAPI.call_delay_time(spawnInterval, tick)
}

function handleObstacleInteraction(data: {
  interact_lifeentity: LifeEntity
  interact_unit: Obstacle
  interact_id: InteractBtnID
}): void {
  const obstacle = data.interact_unit
  const interactor = data.interact_lifeentity

  const plotId = obstacle.get_kv_by_type(Enums.ValueType.Str, "plotId") as string | undefined
  if (plotId !== undefined) {
    let ownerRoleId: RoleID | undefined
    try {
      ownerRoleId = obstacle.get_kv_by_type(Enums.ValueType.Int, "ownerRoleId") as unknown as RoleID
    } catch {
      ownerRoleId = undefined
    }
    handlePlotInteraction(ownerRoleId, plotId, interactor)
    return
  }

  const npcType = obstacle.get_kv_by_type(Enums.ValueType.Str, "npcType") as string | undefined
  if (npcType === "shop") {
    handleShopNpcInteraction(interactor)
    return
  }

  if (npcType === "miner") {
    handleMinerNpcInteraction(interactor)
    return
  }
}

function handlePlotInteraction(ownerRoleId: RoleID | undefined, plotId: string, interactor: LifeEntity): void {
  const roles = GameAPI.get_all_roles()
  let ownerRole: Role | null = null

  for (const role of roles) {
    if (role.get_ctrl_unit() === interactor) {
      ownerRole = role
      break
    }
  }

  if (ownerRole === null) return

  if (ownerRoleId !== undefined && ownerRole.get_roleid() !== ownerRoleId) {
    ownerRole.show_tips("Only owner can operate", 1.2 as Fixed)
    return
  }

  const effectiveOwnerRoleId = ownerRoleId === undefined ? ownerRole.get_roleid() : ownerRoleId

  const plot = MapGenerator.getPlotById(effectiveOwnerRoleId, plotId)
  if (plot === undefined) return

  if (!plot.isUnlocked) {
    if (plotId === "premium_1" || plotId === "premium_2") {
      PlotActionSystem.onPlotFocusChanged(ownerRole)
      ownerRole.show_tips("可通过广告解锁", 1.2 as Fixed)
      return
    }
    const success = PlotSystem.unlockPlot(ownerRole, plotId)
    if (success) {
      ownerRole.show_tips("Plot unlocked!", 1.5 as Fixed)
    } else {
      ownerRole.show_tips("Not enough coins", 1.5 as Fixed)
    }
    return
  }

  if (!plot.hasAnimal) {
    return

  }

  const animalData = AnimalSystem.getAnimalOnPlot(effectiveOwnerRoleId, plotId)
  if (animalData !== undefined) {
    log(`[ZooTycoon] Selected animal on plot ${plotId}`)
  }
}

function handleShopNpcInteraction(interactor: LifeEntity): void {
  const roles = GameAPI.get_all_roles()

  for (const role of roles) {
    if (role.get_ctrl_unit() === interactor) {
      role.show_tips("Shop not implemented", 1.5 as Fixed)

      break
    }
  }
}

function handleMinerNpcInteraction(interactor: LifeEntity): void {
  const roles = GameAPI.get_all_roles()

  for (const role of roles) {
    if (role.get_ctrl_unit() === interactor) {
      const gold = MiningSystem.sellAllOre(role)
      if (gold > 0) {
        role.show_tips(`Sold ore for $${gold}!`, 1.5 as Fixed)
      } else {
        role.show_tips("No ore to sell", 1.5 as Fixed)
      }
      break
    }
  }
}

LuaAPI.call_delay_time(0.1 as Fixed, () => {
  log("[ZooTycoon] Delayed init trigger")
  initGame()
})

log("[ZooTycoon] Script loaded, scheduled init")

// Sync-channel verification: change this line, run worker /pipeline/sync-start,
// and verify the new string shows up in worker console game logs.
log("[ZooTycoon] SYNC_TEST: bridge-v2 https-proxy path OK (2026-02-10)")
