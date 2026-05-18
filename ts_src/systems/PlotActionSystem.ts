import { EventBus } from "@common/event_bus"
import { log } from "@common/utils"
import { ExcelData, GameConfig, PrefabRegistry } from "../config"
import { GameEvents } from "../utils"
import { PlotFocusSystem } from "./PlotFocusSystem"
import { MapGenerator, type PlotData } from "./MapGenerator"
import { AnimalSystem } from "./AnimalSystem"
import { AnimalWalletSystem } from "./AnimalWalletSystem"
import { EconomySystem } from "./EconomySystem"
import { EntityFactory } from "./EntityFactory"
import { PlotSystem } from "./PlotSystem"
import { PlayerSaveSystem, PlotSaveData } from "./PlayerSaveSystem"

type Mode = "normal" | "swap"

type SwapState = {
  sourcePlotId: string
  targetPlotId: string | null
}

const modeByRoleId: Map<RoleID, Mode> = new Map()
const swapStateByRoleId: Map<RoleID, SwapState | null> = new Map()

// Recycle confirm modal state (per role)
const recyclePendingPlotIdByRoleId: Map<RoleID, string | null> = new Map()
const recyclePendingAmountByRoleId: Map<RoleID, number> = new Map()
const adUnlockPendingPlotIdByRoleId: Map<RoleID, string | null> = new Map()

const AD_UNLOCK_PLOT_IDS = new Set<string>(["premium_1", "premium_2"])

let initialized = false

function hideAll(role: Role): void {
  try {
    role.set_node_visible(PrefabRegistry.plotActionUI.root as unknown as ENode, false)
  } catch {
    // ignore
  }
  try {
    role.set_node_visible(PrefabRegistry.swapOverlayUI.root as unknown as ENode, false)
  } catch {
    // ignore
  }
  try {
    role.set_node_visible(PrefabRegistry.recycleConfirmUI.root as unknown as ENode, false)
  } catch {
    // ignore
  }
  try {
    role.set_node_visible(PrefabRegistry.adUnlockUI.root as unknown as ENode, false)
  } catch {
    // ignore
  }
}

function setVisible(role: Role, node: ENode, visible: boolean): void {
  try {
    role.set_node_visible(node, visible)
  } catch {
    // ignore
  }
}

function getFocusedPlot(role: Role): { plotId: string; plot: PlotData } | null {
  const roleId = role.get_roleid()
  const plotId = PlotFocusSystem.getCurrentPlotId(role)
  if (plotId === null) return null
  const plot = MapGenerator.getPlotById(roleId, plotId)
  if (plot === undefined) return null
  const plotData: PlotData = plot
  // Only owner can operate.
  if (plotData.ownerRoleId !== roleId) return null
  return { plotId, plot: plotData }
}

function computeRecyclePreviewAmount(role: Role, plotId: string): number {
  const roleId = role.get_roleid()
  const plot = MapGenerator.getPlotById(roleId, plotId)
  if (plot === undefined || !plot.isUnlocked || !plot.hasAnimal || plot.animalUnitId === null) return 0
  const data = AnimalSystem.getAnimal(plot.animalUnitId)
  if (data === undefined) return 0
  return EntityFactory.getAnimalRecyclePrice(data.creature, role)
}

function isAdUnlockPlot(plotId: string): boolean {
  return AD_UNLOCK_PLOT_IDS.has(plotId)
}

function clearAdUnlockState(role: Role): void {
  const roleId = role.get_roleid()
  adUnlockPendingPlotIdByRoleId.set(roleId, null)
}

function render(role: Role): void {
  const roleId = role.get_roleid()
  const mode = modeByRoleId.get(roleId)
  const storedRecyclePlotId = recyclePendingPlotIdByRoleId.get(roleId)
  let recyclePlotId: string | null = null
  if (storedRecyclePlotId !== undefined) {
    recyclePlotId = storedRecyclePlotId
  }
  const focused = getFocusedPlot(role)

  const storedAdUnlockPlotId = adUnlockPendingPlotIdByRoleId.get(roleId)
  let adUnlockPlotId: string | null = null
  if (storedAdUnlockPlotId !== undefined) {
    adUnlockPlotId = storedAdUnlockPlotId
  }

  if (adUnlockPlotId !== null) {
    setVisible(role, PrefabRegistry.plotActionUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.swapOverlayUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.recycleConfirmUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.adUnlockUI.root as unknown as ENode, true)
    return
  }

  if (recyclePlotId !== null) {
    // Modal: recycle confirm.
    setVisible(role, PrefabRegistry.plotActionUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.swapOverlayUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.recycleConfirmUI.root as unknown as ENode, true)
    setVisible(role, PrefabRegistry.adUnlockUI.root as unknown as ENode, false)

    const storedAmount = recyclePendingAmountByRoleId.get(roleId)
    let amount = 0
    if (storedAmount !== undefined) {
      amount = storedAmount
    }
    try {
      role.set_label_text(PrefabRegistry.recycleConfirmUI.amountLabel, `$${tostring(amount)}`)
    } catch {
      // ignore
    }
    return
  }

  if (mode === "swap") {
    setVisible(role, PrefabRegistry.plotActionUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.swapOverlayUI.root as unknown as ENode, true)
    setVisible(role, PrefabRegistry.recycleConfirmUI.root as unknown as ENode, false)
    setVisible(role, PrefabRegistry.adUnlockUI.root as unknown as ENode, false)

    const st = swapStateByRoleId.get(roleId)
    if (st === undefined || st === null) {
      setVisible(role, PrefabRegistry.swapOverlayUI.confirmButton as unknown as ENode, false)
      return
    }

    if (st.targetPlotId === null) {
      setVisible(role, PrefabRegistry.swapOverlayUI.confirmButton as unknown as ENode, false)
      return
    }

    setVisible(role, PrefabRegistry.swapOverlayUI.confirmButton as unknown as ENode, true)
    return
  }

  // Normal mode.
  setVisible(role, PrefabRegistry.swapOverlayUI.root as unknown as ENode, false)
  setVisible(role, PrefabRegistry.recycleConfirmUI.root as unknown as ENode, false)
  setVisible(role, PrefabRegistry.adUnlockUI.root as unknown as ENode, false)

  if (focused === null) {
    setVisible(role, PrefabRegistry.plotActionUI.root as unknown as ENode, false)
    return
  }

  const plot: PlotData = focused.plot
  if (!plot.isUnlocked) {
    setVisible(role, PrefabRegistry.plotActionUI.root as unknown as ENode, false)
    return
  }

  setVisible(role, PrefabRegistry.plotActionUI.root as unknown as ENode, true)

  const hasAnimal = plot.hasAnimal
  setVisible(role, PrefabRegistry.plotActionUI.recycleButton as unknown as ENode, hasAnimal)
  setVisible(role, PrefabRegistry.plotActionUI.swapButton as unknown as ENode, hasAnimal)
  // Mutate is placeholder.
  setVisible(role, PrefabRegistry.plotActionUI.mutateButton as unknown as ENode, hasAnimal)
  // Upgrade: only show on special plots.
  const isSpecialPlot = focused.plotId.indexOf("sp:") === 0
  setVisible(role, PrefabRegistry.plotActionUI.upgradeButton as unknown as ENode, isSpecialPlot)
}

export const PlotActionSystem = {
  init(): void {
    if (initialized) return
    initialized = true
    PlotFocusSystem.init()

    EventBus.on(GameEvents.PLOT_FOCUS_CHANGED, (role: unknown) => {
      const r = role as Role
      PlotActionSystem.onPlotFocusChanged(r)
    })
  },

  initPlayer(role: Role): void {
    const roleId = role.get_roleid()
    modeByRoleId.set(roleId, "normal")
    swapStateByRoleId.set(roleId, null)
    recyclePendingPlotIdByRoleId.set(roleId, null)
    recyclePendingAmountByRoleId.set(roleId, 0)
    adUnlockPendingPlotIdByRoleId.set(roleId, null)

    hideAll(role)
    render(role)
  },

  cleanupOwner(ownerRoleId: RoleID): void {
    modeByRoleId.delete(ownerRoleId)
    swapStateByRoleId.delete(ownerRoleId)
    recyclePendingPlotIdByRoleId.delete(ownerRoleId)
    recyclePendingAmountByRoleId.delete(ownerRoleId)
    adUnlockPendingPlotIdByRoleId.delete(ownerRoleId)
  },

  isSwapMode(role: Role): boolean {
    const roleId = role.get_roleid()
    return modeByRoleId.get(roleId) === "swap"
  },

  onPlotFocusChanged(role: Role): void {
    const roleId = role.get_roleid()
    if (modeByRoleId.get(roleId) === "swap") {
      const st = swapStateByRoleId.get(roleId)
      if (st === undefined || st === null) {
        render(role)
        return
      }

      const focused = getFocusedPlot(role)
      if (focused === null) {
        st.targetPlotId = null
        render(role)
        return
      }

      const plot: PlotData = focused.plot
      if (!plot.isUnlocked) {
        st.targetPlotId = null
        render(role)
        return
      }

      const targetId = focused.plotId
      st.targetPlotId = targetId === st.sourcePlotId ? null : targetId
      render(role)
      return
    }

    const focused = getFocusedPlot(role)
    if (focused !== null && !focused.plot.isUnlocked && isAdUnlockPlot(focused.plotId)) {
      adUnlockPendingPlotIdByRoleId.set(roleId, focused.plotId)
      log(`[AdUnlock] enter premium plot role=${tostring(roleId)} plotId=${focused.plotId}`)
      render(role)
      return
    }

    adUnlockPendingPlotIdByRoleId.set(roleId, null)
    render(role)
  },

  // --------------------------------------------------------------------------
  // UI events
  // --------------------------------------------------------------------------
  handleRecycleClicked(role: Role): void {
    const roleId = role.get_roleid()
    const mode = modeByRoleId.get(roleId)
    if (mode !== undefined && mode !== "normal") return

    const focused = getFocusedPlot(role)
    if (focused === null) return
    const plot: PlotData = focused.plot
    if (!plot.isUnlocked || !plot.hasAnimal) return

    const amount = computeRecyclePreviewAmount(role, focused.plotId)
    if (amount <= 0) {
      role.show_tips("回收价格异常", 1.2 as Fixed)
      return
    }
    recyclePendingPlotIdByRoleId.set(roleId, focused.plotId)
    recyclePendingAmountByRoleId.set(roleId, amount)
    render(role)
  },

  handleRecycleCancel(role: Role): void {
    const roleId = role.get_roleid()
    recyclePendingPlotIdByRoleId.set(roleId, null)
    recyclePendingAmountByRoleId.set(roleId, 0)
    render(role)
  },

  handlePrimaryModalCancel(role: Role): void {
    const roleId = role.get_roleid()
    const adPlotId = adUnlockPendingPlotIdByRoleId.get(roleId)
    if (adPlotId !== undefined && adPlotId !== null) {
      log(`[AdUnlock] cancel modal role=${tostring(roleId)} plotId=${adPlotId}`)
      clearAdUnlockState(role)
      render(role)
      return
    }
    this.handleRecycleCancel(role)
  },

  handleRecycleConfirm(role: Role): void {
    const roleId = role.get_roleid()
    const storedPlotId = recyclePendingPlotIdByRoleId.get(roleId)
    if (storedPlotId === undefined || storedPlotId === null) {
      this.handleRecycleCancel(role)
      return
    }

    const plotId = storedPlotId

    const plot = MapGenerator.getPlotById(roleId, plotId)
    if (plot === undefined || !plot.isUnlocked || !plot.hasAnimal || plot.animalUnitId === null) {
      this.handleRecycleCancel(role)
      return
    }

    // Collect stored wallet coins before destroying.
    try {
      AnimalWalletSystem.collect(role, plot.animalUnitId)
    } catch {
      // ignore
    }

    // Recycle (destroys unit + unregisters).
    const price = AnimalSystem.recycleAnimal(plot.animalUnitId)
    if (price > 0) {
      role.show_tips(`+$${tostring(price)}`, 1.2 as Fixed)
    }

    // Clear save fields.
    const island = PlayerSaveSystem.getIsland(role)
    if (island.plots === undefined) island.plots = {}
    let st = island.plots[plotId]
    if (st === undefined) {
      st = new PlotSaveData()
      island.plots[plotId] = st
    }
    st.animalTypeId = undefined
    st.animalScale = undefined
    st.animalRarityId = undefined
    st.sourceEggTypeId = undefined
    PlayerSaveSystem.setIsland(role, island)
    PlayerSaveSystem.save(role)

    this.handleRecycleCancel(role)
  },

  handlePrimaryModalConfirm(role: Role): void {
    this.handleRecycleConfirm(role)
  },

  handleAdUnlockConfirm(role: Role): void {
    const roleId = role.get_roleid()
    const plotId = adUnlockPendingPlotIdByRoleId.get(roleId)
    if (plotId === undefined || plotId === null) return

    const plot = MapGenerator.getPlotById(roleId, plotId)
    if (plot === undefined || plot.isUnlocked || !isAdUnlockPlot(plotId)) {
      log(`[AdUnlock] skip unlock role=${tostring(roleId)} plotId=${tostring(plotId)} reason=invalid_or_unlocked`)
      clearAdUnlockState(role)
      render(role)
      return
    }

    const ok = PlotSystem.unlockPlotForFree(role, plotId)
    log(`[AdUnlock] confirm unlock role=${tostring(roleId)} plotId=${plotId} success=${tostring(ok)}`)
    role.show_tips(ok ? "地块解锁成功" : "地块解锁失败", 1.5 as Fixed)
    clearAdUnlockState(role)
    render(role)
  },

  handleSwapClicked(role: Role): void {
    const roleId = role.get_roleid()
    const mode = modeByRoleId.get(roleId)
    if (mode !== undefined && mode !== "normal") return

    const focused = getFocusedPlot(role)
    if (focused === null) return
    const plot: PlotData = focused.plot
    if (!plot.isUnlocked || !plot.hasAnimal) return

    modeByRoleId.set(roleId, "swap")
    swapStateByRoleId.set(roleId, { sourcePlotId: focused.plotId, targetPlotId: null })
    render(role)
  },

  handleSwapExit(role: Role): void {
    const roleId = role.get_roleid()
    modeByRoleId.set(roleId, "normal")
    swapStateByRoleId.set(roleId, null)
    render(role)
  },

  handleSwapConfirm(role: Role): void {
    const roleId = role.get_roleid()
    const st = swapStateByRoleId.get(roleId)
    if (st === undefined || st === null) return
    if (st.targetPlotId === null) {
      role.show_tips("请选择目标地块", 1.2 as Fixed)
      return
    }

    const sourcePlot = MapGenerator.getPlotById(roleId, st.sourcePlotId)
    const targetPlot = MapGenerator.getPlotById(roleId, st.targetPlotId)
    if (
      sourcePlot === undefined ||
      targetPlot === undefined ||
      !sourcePlot.isUnlocked ||
      !targetPlot.isUnlocked ||
      !sourcePlot.hasAnimal ||
      sourcePlot.animalUnitId === null
    ) {
      role.show_tips("换位失败", 1.2 as Fixed)
      return
    }

    if (st.sourcePlotId === st.targetPlotId) {
      role.show_tips("不能选择同一地块", 1.2 as Fixed)
      return
    }

    // Update runtime first.
    let ok = false
    if (targetPlot.hasAnimal && targetPlot.animalUnitId !== null) {
      ok = AnimalSystem.swapAnimals(sourcePlot.animalUnitId, targetPlot.animalUnitId)
    } else {
      ok = AnimalSystem.moveAnimalToPlot(sourcePlot.animalUnitId, st.targetPlotId)
    }

    if (!ok) {
      role.show_tips("换位失败", 1.2 as Fixed)
      return
    }

    // Persist plot animal fields.
    const island = PlayerSaveSystem.getIsland(role)
    if (island.plots === undefined) island.plots = {}
    let srcSave = island.plots[st.sourcePlotId]
    if (srcSave === undefined) {
      srcSave = new PlotSaveData()
      island.plots[st.sourcePlotId] = srcSave
    }
    let dstSave = island.plots[st.targetPlotId]
    if (dstSave === undefined) {
      dstSave = new PlotSaveData()
      island.plots[st.targetPlotId] = dstSave
    }
    srcSave.unlocked = true
    dstSave.unlocked = true

    if (targetPlot.hasAnimal) {
      // Swap animal fields.
      const tmpType = srcSave.animalTypeId
      const tmpScale = srcSave.animalScale
      const tmpRarity = srcSave.animalRarityId
      const tmpEgg = srcSave.sourceEggTypeId
      srcSave.animalTypeId = dstSave.animalTypeId
      srcSave.animalScale = dstSave.animalScale
      srcSave.animalRarityId = dstSave.animalRarityId
      srcSave.sourceEggTypeId = dstSave.sourceEggTypeId
      dstSave.animalTypeId = tmpType
      dstSave.animalScale = tmpScale
      dstSave.animalRarityId = tmpRarity
      dstSave.sourceEggTypeId = tmpEgg
    } else {
      // Move animal fields to target.
      dstSave.animalTypeId = srcSave.animalTypeId
      dstSave.animalScale = srcSave.animalScale
      dstSave.animalRarityId = srcSave.animalRarityId
      dstSave.sourceEggTypeId = srcSave.sourceEggTypeId
      srcSave.animalTypeId = undefined
      srcSave.animalScale = undefined
      srcSave.animalRarityId = undefined
      srcSave.sourceEggTypeId = undefined
    }

    PlayerSaveSystem.setIsland(role, island)
    PlayerSaveSystem.save(role)

    this.handleSwapExit(role)
  },

  handleMutateClicked(role: Role): void {
    role.show_tips("未开放", 1.2 as Fixed)
  },

  handleUpgradeClicked(role: Role): void {
    const roleId = role.get_roleid()
    const mode = modeByRoleId.get(roleId)
    if (mode !== undefined && mode !== "normal") return

    const focused = getFocusedPlot(role)
    if (focused === null) return
    const plot: PlotData = focused.plot
    if (!plot.isUnlocked) return
    if (focused.plotId.indexOf("sp:") !== 0) {
      role.show_tips("该地块不可升级", 1.2 as Fixed)
      return
    }

    const curLevel = MapGenerator.getPlotLevel(roleId, focused.plotId)
    const nextLevel = curLevel + 1
    const cfg = ExcelData.getPlotLevelConfig(plot.plotTypeId, nextLevel)
    const cost = cfg === null ? GameConfig.SUPER_PLOT_UPGRADE_COST : cfg.cost
    if (cost > 0 && !EconomySystem.spendCoins(role, cost)) {
      role.show_tips(`金币不足，需要$${tostring(cost)}`, 1.5 as Fixed)
      return
    }

    MapGenerator.setPlotLevel(roleId, focused.plotId, nextLevel)

    const island = PlayerSaveSystem.getIsland(role)
    if (island.plots === undefined) island.plots = {}
    let st = island.plots[focused.plotId]
    if (st === undefined) {
      st = new PlotSaveData()
      island.plots[focused.plotId] = st
    }
    st.unlocked = true
    st.plotLevel = nextLevel
    PlayerSaveSystem.setIsland(role, island)
    PlayerSaveSystem.save(role)

    role.show_tips(`升级成功 Lv.${tostring(nextLevel)}`, 1.2 as Fixed)
    render(role)
  },
}
