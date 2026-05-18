import { log } from "@common/utils"
import { toNumberOrThrow } from "@common/num"
import { PrefabRegistry } from "../config"
import {
  EconomySystem,
  AnimalSystem,
  MapGenerator,
  AnimalWalletSystem,
  AnimalPanelSystem,
  PlayerSaveSystem,
  PlotActionSystem,
  DailySignInSystem,
  CombatSystem,
} from "../systems"
import { InventorySystem } from "../systems"
import { PlantingSystem } from "../systems"
import { PlotFocusSystem } from "../systems"
import { EntityFactory } from "../systems"

const initializedPlayers: Set<RoleID> = new Set()
const loadingPlayers: Set<RoleID> = new Set()

function getRoleKey(role: Role): RoleID {
  return role.get_roleid()
}

function coerceNumber(value: unknown, ctx: string): number {
  return toNumberOrThrow(value, {
    ctx,
    logger: (msg) => GlobalAPI.warning(`[OfflineIncome] ${msg}`),
  })
}

function formatOfflineDuration(totalSeconds: number): string {
  const safeSeconds = totalSeconds > 0 ? math.floor(totalSeconds) : 0
  const totalMinutes = math.floor(safeSeconds / 60)
  const hours = math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const hourText = hours < 10 ? `0${hours}` : `${hours}`
  const minuteText = minutes < 10 ? `0${minutes}` : `${minutes}`
  return `离线时长-${hourText}:${minuteText}`
}

export const PlayerManager = {
  initPlayer(role: Role): void {
    const roleId = getRoleKey(role)
    if (initializedPlayers.has(roleId)) return

    loadingPlayers.add(roleId)

    // Spawn this role's private ground group aligned via "地板-原点".
    MapGenerator.ensureGround(role)

    // Spawn this role's island runtime (plots/triggers) near login position.
    // (Uses ground anchors when available.)
    MapGenerator.ensureIsland(role)

    // Spawn this role's private conveyor (and end-zone cleanup trigger).
    MapGenerator.ensureConveyor(role)

    // Spawn this role's private shop beside the conveyor.
    MapGenerator.ensureShop(role)

    EconomySystem.initPlayer(role)

    // UI tweak: inventory -> gold striped button image
    role.set_button_normal_image(PrefabRegistry.hudButtons["金色条纹按钮"], 16612 as ImageKey)

    InventorySystem.initPlayer(role)
    PlotFocusSystem.initPlayer(role)
    PlantingSystem.initPlayer(role)
    PlotActionSystem.initPlayer(role)
    DailySignInSystem.initPlayer(role)
    CombatSystem.initPlayer(role)
    log(`[PlayerManager] initPlayer role=${tostring(roleId)}`)
    try {
      role.set_node_visible(PrefabRegistry.shopUI.root as unknown as ENode, false)
    } catch {
      // ignore
    }
    try {
      role.set_node_visible(PrefabRegistry.offlineIncomeUI.root as unknown as ENode, false)
    } catch {
      // ignore
    }

    try {
      role.set_node_visible(PrefabRegistry.dailyRewardUI.root as unknown as ENode, false)
    } catch {
      // ignore
    }

    // Plot action / swap / recycle-confirm UIs default hidden.
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

    initializedPlayers.add(roleId)
  },

  loadPlayerData(role: Role): void {
    EconomySystem.loadFromArchive(role)

    // Load island state (plots + inventory + animals) from per-role archive.
    const island = PlayerSaveSystem.getIsland(role)
    const roleId = role.get_roleid()

    if (island.inventorySlots.length > 0) {
      InventorySystem.loadFromSave(role, island.inventorySlots, island.inventoryRarityIds)
    }

    if (island.plots !== undefined) {
      let saveMigrated = false
      for (const plotId in island.plots) {
        const st = island.plots[plotId]
        if (st === undefined) continue

        if (st.unlocked) {
          MapGenerator.unlockPlot(roleId, plotId, { silent: true })
        }

        // Restore plot level (special plot upgrades).
        if (typeof st.plotLevel === "number" && st.plotLevel === st.plotLevel && st.plotLevel > 0) {
          MapGenerator.setPlotLevel(roleId, plotId, st.plotLevel)
        }

        const animalTypeId = st.animalTypeId
        if (typeof animalTypeId === "number" && animalTypeId > 0) {
          const expectedScale = EntityFactory.getScaledAnimalCreateScale(animalTypeId, plotId.indexOf("premium_") === 0 ? 3 : 1)
          if (st.animalScale !== expectedScale) {
            st.animalScale = expectedScale
            saveMigrated = true
          }
          PlantingSystem.spawnAnimalOnPlotFromSave(role, plotId, animalTypeId, {
            rarityId: st.animalRarityId,
            sourceEggTypeId: st.sourceEggTypeId,
          })
        }
      }
      if (saveMigrated) {
        PlayerSaveSystem.save(role)
      }
    }

    MapGenerator.ensurePlotSalePlaceholders(roleId)

    const now = coerceNumber(GameAPI.get_timestamp() as unknown as Fixed, "now")
    const rawLastExit = PlayerSaveSystem.getLastExitTimestamp(role)
    const rawLastSave = PlayerSaveSystem.getLastSaveTimestamp(role)
    const lastExit = rawLastExit === undefined ? 0 : coerceNumber(rawLastExit, "lastExitTimestamp")
    const lastSave = rawLastSave === undefined ? 0 : coerceNumber(rawLastSave, "lastSaveTimestamp")
    let baseTimestamp = lastExit
    if (typeof lastSave === "number") {
      if (baseTimestamp === undefined || lastSave > baseTimestamp) {
        baseTimestamp = lastSave
      }
    }
    let offlineSeconds = 0
    if (typeof baseTimestamp === "number") {
      offlineSeconds = now - baseTimestamp
      if (offlineSeconds < 0) offlineSeconds = 0
    }
    const maxOfflineSeconds = 7 * 24 * 3600
    if (offlineSeconds > maxOfflineSeconds) offlineSeconds = maxOfflineSeconds

    let pendingTotal = 0
    if (island.plots !== undefined) {
      for (const plotId in island.plots) {
        const st = island.plots[plotId]
        if (st === undefined) continue
        const pending = st.pendingCoins
        if (typeof pending === "number" && pending > 0) {
          pendingTotal += pending
          st.pendingCoins = 0
        }
      }
    }
    const incomePerSecond = coerceNumber(AnimalSystem.calculateTotalIncome(role), "incomePerSecond")
    const offlineIncome = offlineSeconds > 0 ? math.floor((incomePerSecond * offlineSeconds) / 4) : 0
    const existingPending = PlayerSaveSystem.getPendingOfflineCoins(role)
    const totalPending = pendingTotal + offlineIncome + (existingPending > 0 ? existingPending : 0)
    PlayerSaveSystem.setPendingOfflineCoins(role, totalPending)

    log(
      `[OfflineIncome] load role=${tostring(role.get_roleid())} lastExit=${tostring(lastExit)} lastSave=${tostring(
        lastSave
      )} base=${tostring(baseTimestamp)} now=${tostring(now)} offlineSeconds=${tostring(offlineSeconds)} ` +
        `incomePerSecond=${tostring(incomePerSecond)} ` +
        `offlineIncome=${tostring(offlineIncome)} pendingTotal=${tostring(pendingTotal)} ` +
        `existingPending=${tostring(existingPending)} totalPending=${tostring(totalPending)}`
    )

    try {
      if (totalPending > 0) {
        role.set_label_text(PrefabRegistry.offlineIncomeUI.amountLabel, `${totalPending}`)
        role.set_label_text(PrefabRegistry.offlineIncomeUI.durationLabel, formatOfflineDuration(offlineSeconds))
        role.set_node_visible(PrefabRegistry.offlineIncomeUI.root as unknown as ENode, true)
      } else {
        role.set_node_visible(PrefabRegistry.offlineIncomeUI.root as unknown as ENode, false)
      }
    } catch {
      // ignore
    }

    PlayerSaveSystem.setLastExitTimestamp(role, now)
    PlayerSaveSystem.save(role)

    log(
      `[PlayerManager] load done role=${tostring(roleId)} totalPending=${tostring(totalPending)} ` +
        `coins=${tostring(EconomySystem.getCoins(role))}`
    )

    PlayerSaveSystem.startAutoSave(role)

    loadingPlayers.delete(getRoleKey(role))
  },

  isLoading(role: Role): boolean {
    return loadingPlayers.has(getRoleKey(role))
  },

  isInitialized(role: Role): boolean {
    return initializedPlayers.has(getRoleKey(role))
  },

  getAllInitializedPlayers(): RoleID[] {
    const result: RoleID[] = []
    for (const roleId of initializedPlayers) {
      result.push(roleId)
    }
    return result
  },

  getPlayerStats(role: Role): {
    coins: number
    mutationStones: number
    ore: number
    incomePerSecond: number
    collectionCount: number
    plotProgress: { unlocked: number; total: number }
  } {
    const economyData = EconomySystem.getData(role)
    const income = AnimalSystem.calculateTotalIncome(role)
    const collectionCount = PlayerSaveSystem.getEncyclopediaAnimalCount(role)
    const roleId = role.get_roleid()
    const plots = MapGenerator.getUnlockedPlots(roleId)
    const allPlots = MapGenerator.getAllPlotsByOwner(roleId)

    return {
      coins: economyData.coins,
      mutationStones: economyData.mutationStones,
      ore: economyData.ore,
      incomePerSecond: income,
      collectionCount,
      plotProgress: { unlocked: plots.length, total: allPlots.length },
    }
  },

  giveStarterPack(role: Role): void {
    role.show_tips("Welcome!", 3.01 as Fixed)
  },

  removePlayer(role: Role): void {
    const roleId = getRoleKey(role)

    // Tear down this player's runtime island. Archives are per-role and are NOT deleted.
    try {
      InventorySystem.cleanupPlayer(role)
    } catch {
      // ignore
    }
    try {
      PlotFocusSystem.cleanupPlayer(role)
    } catch {
      // ignore
    }
    try {
      EconomySystem.cleanupPlayer(role)
    } catch {
      // ignore
    }
    try {
      PlantingSystem.cleanupOwner(roleId)
    } catch {
      // ignore
    }
    try {
      PlotActionSystem.cleanupOwner(roleId)
    } catch {
      // ignore
    }
    try {
      AnimalWalletSystem.cleanupOwner(roleId)
    } catch {
      // ignore
    }
    try {
      AnimalPanelSystem.cleanupOwner(roleId)
    } catch {
      // ignore
    }
    try {
      AnimalSystem.cleanupOwner(roleId)
    } catch {
      // ignore
    }
    try {
      CombatSystem.cleanupPlayer(role)
    } catch {
      // ignore
    }
    try {
      MapGenerator.destroyConveyor(roleId)
    } catch {
      // ignore
    }
    try {
      MapGenerator.destroyGround(roleId)
    } catch {
      // ignore
    }
    try {
      MapGenerator.destroyShop(roleId)
    } catch {
      // ignore
    }
    try {
      MapGenerator.destroyIsland(roleId)
    } catch {
      // ignore
    }

    // Clear per-role save cache and cancel pending autosave tokens.
    // Persistent archives are not deleted.
    try {
      PlayerSaveSystem.remove(role)
    } catch {
      // ignore
    }

    loadingPlayers.delete(roleId)
    initializedPlayers.delete(roleId)
  },
}
