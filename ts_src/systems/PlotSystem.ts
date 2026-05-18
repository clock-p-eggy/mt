import { EventBus } from "@common/event_bus"
import { ExcelData, GameConfig, getPlotTypeById } from "../config"
import { GameEvents } from "../utils"
import { EconomySystem } from "./EconomySystem"
import { MapGenerator, PlotData } from "./MapGenerator"
import { PlayerSaveSystem, PlotSaveData } from "./PlayerSaveSystem"

const collectionCountByOwner: Map<RoleID, number> = new Map()

function getPlotUnlockPrice(plot: PlotData): number {
  if (plot.id.indexOf("premium_") === 0) {
    return 1000
  }

  try {
    if (plot.obstacle.has_kv("unlockPrice") === true) {
      const kv = plot.obstacle.get_kv_by_type(Enums.ValueType.Int, "unlockPrice") as number | undefined
      if (typeof kv === "number" && kv === kv) {
        return kv
      }
    }
  } catch {
    // ignore
  }

  const plotType = getPlotTypeById(plot.plotTypeId)
  return plotType === undefined ? 0 : plotType.unlockPrice
}

function getPlotIncomeMultiplier(plot: PlotData): number {
  if (plot.id.indexOf("premium_") === 0) {
    return 10.0
  }

  const plotType = getPlotTypeById(plot.plotTypeId)
  const incomeMultiplier = plotType === undefined ? undefined : plotType.incomeMultiplier
  return incomeMultiplier === undefined ? 1.0 : incomeMultiplier
}

export const PlotSystem = {
  canUnlockPlot(role: Role, plotId: string): { canUnlock: boolean; reason?: string } {
    const plot = MapGenerator.getPlotById(role.get_roleid(), plotId)
    if (plot === undefined) {
      return { canUnlock: false, reason: "plot_not_found" }
    }
    
    if (plot.isUnlocked) {
      return { canUnlock: false, reason: "already_unlocked" }
    }

    const coins = EconomySystem.getCoins(role)
    const unlockPrice = getPlotUnlockPrice(plot)
    if (unlockPrice <= 0) {
      return { canUnlock: false, reason: "invalid_plot_type" }
    }
    if (coins < unlockPrice) {
      return { canUnlock: false, reason: "not_enough_coins" }
    }

    return { canUnlock: true }
  },

  unlockPlot(role: Role, plotId: string): boolean {
    const check = this.canUnlockPlot(role, plotId)
    if (!check.canUnlock) return false

    const plot = MapGenerator.getPlotById(role.get_roleid(), plotId)
    if (plot === undefined) return false

    const unlockPrice = getPlotUnlockPrice(plot)
    if (unlockPrice <= 0) return false

    if (!EconomySystem.spendCoins(role, unlockPrice)) {
      return false
    }

    const ok = MapGenerator.unlockPlot(role.get_roleid(), plotId)
    if (ok) {
      const island = PlayerSaveSystem.getIsland(role)
      if (island.plots === undefined) island.plots = {}
      let st = island.plots[plotId]
      if (st === undefined) {
        st = new PlotSaveData()
        island.plots[plotId] = st
      }
      st.unlocked = true
      PlayerSaveSystem.setIsland(role, island)
      PlayerSaveSystem.save(role)
    }
    return ok
  },

  unlockPlotForFree(role: Role, plotId: string): boolean {
    const plot = MapGenerator.getPlotById(role.get_roleid(), plotId)
    if (plot === undefined || plot.isUnlocked) return false

    const ok = MapGenerator.unlockPlot(role.get_roleid(), plotId)
    if (ok) {
      const island = PlayerSaveSystem.getIsland(role)
      if (island.plots === undefined) island.plots = {}
      let st = island.plots[plotId]
      if (st === undefined) {
        st = new PlotSaveData()
        island.plots[plotId] = st
      }
      st.unlocked = true
      PlayerSaveSystem.setIsland(role, island)
      PlayerSaveSystem.save(role)
    }
    return ok
  },

  canUnlockSuperPlot(): { canUnlock: boolean; reason?: string } {
    // Super plot is not yet sharded per owner; disable for now.
    return { canUnlock: false, reason: "disabled" }
  },

  unlockSuperPlot(): boolean {
    const check = this.canUnlockSuperPlot()
    if (!check.canUnlock) return false

    return MapGenerator.unlockSuperPlot()
  },

  canUpgradeSuperPlot(role: Role): { canUpgrade: boolean; reason?: string } {
    const superPlot = MapGenerator.getSuperPlot()
    if (superPlot === null || !superPlot.isUnlocked) {
      return { canUpgrade: false, reason: "super_plot_locked" }
    }

    const coins = EconomySystem.getCoins(role)
    if (coins < GameConfig.SUPER_PLOT_UPGRADE_COST) {
      return { canUpgrade: false, reason: "not_enough_coins" }
    }

    return { canUpgrade: true }
  },

  upgradeSuperPlot(role: Role): boolean {
    const check = this.canUpgradeSuperPlot(role)
    if (!check.canUpgrade) return false

    if (!EconomySystem.spendCoins(role, GameConfig.SUPER_PLOT_UPGRADE_COST)) {
      return false
    }

    return MapGenerator.upgradeSuperPlot()
  },

  getPlotAtPosition(position: Vector3): PlotData | null {
    const plots = MapGenerator.getAllPlots()
    const threshold = GameConfig.PLOT_SPACING * 0.4

    for (const plot of plots) {
      const plotPos = plot.obstacle.get_position()
      const dx = Math.abs(position.x - plotPos.x)
      const dz = Math.abs(position.z - plotPos.z)
      
      if (dx < threshold && dz < threshold) {
        return plot
      }
    }

    return null
  },

  getNearestEmptyPlot(position: Vector3): PlotData | null {
    const emptyPlots: PlotData[] = []
    for (const plot of MapGenerator.getAllPlots()) {
      if (plot.isUnlocked && !plot.hasAnimal) {
        emptyPlots.push(plot)
      }
    }
    if (emptyPlots.length === 0) return null

    let nearest: PlotData | null = null
    let minDistance = Infinity

    for (const plot of emptyPlots) {
      const plotPos = plot.obstacle.get_position()
      const dx = position.x - plotPos.x
      const dz = position.z - plotPos.z
      const distance = Math.sqrt(dx * dx + dz * dz)

      if (distance < minDistance) {
        minDistance = distance
        nearest = plot
      }
    }

    return nearest
  },

  getCollectionCount(ownerRoleId: RoleID): number {
    const v = collectionCountByOwner.get(ownerRoleId)
    return v === undefined ? 0 : v
  },

  incrementCollection(ownerRoleId: RoleID): void {
    const cur = this.getCollectionCount(ownerRoleId)
    const next = cur + 1
    collectionCountByOwner.set(ownerRoleId, next)
    EventBus.emit(GameEvents.COLLECTION_UPDATED, next)
  },

  getPlotMultiplier(ownerRoleId: RoleID, plotId: string): number {
    if (plotId === "super") {
      return MapGenerator.getSuperPlotMultiplier()
    }
    
    const plot = MapGenerator.getPlotById(ownerRoleId, plotId)
    if (plot === undefined) return 1.0

    // Special plot: use per-plot level (stored on obstacle/save).
    const isSpecialPlot = plotId.indexOf("sp:") === 0
    if (isSpecialPlot) {
      const level = MapGenerator.getPlotLevel(ownerRoleId, plotId)
      if (level <= 0) return GameConfig.SUPER_PLOT_BASE_MULTIPLIER
      const cfg = ExcelData.getPlotLevelConfig(plot.plotTypeId, level)
      if (cfg !== null) {
        return cfg.multiplier
      }
      return GameConfig.SUPER_PLOT_BASE_MULTIPLIER + level * GameConfig.SUPER_PLOT_MULTIPLIER_PER_LEVEL
    }

    return getPlotIncomeMultiplier(plot)
  },

  getUnlockProgress(): { unlocked: number; total: number } {
    // Legacy (single owner): keep using all plots. UI should eventually show per-owner progress.
    const all = MapGenerator.getAllPlots()
    return { unlocked: 0, total: all.length }
  },
}
