import { log } from "@common/utils"
import { EventBus } from "@common/event_bus"
import { ExcelData, PrefabRegistry } from "../config"
import { getAnimalTypeById } from "../config"
import { getEggTypeById } from "../config"
import { GameEvents } from "../utils"
import { AnimalSystem } from "./AnimalSystem"
import { EntityFactory } from "./EntityFactory"
import { EggHatchingSystem } from "./EggHatchingSystem"
import { InventorySystem } from "./InventorySystem"
import { MapGenerator } from "./MapGenerator"
import { PlotFocusSystem } from "./PlotFocusSystem"
import { PlotActionSystem } from "./PlotActionSystem"
import { PlotKey, makePlotKey, parsePlotKey } from "../utils/plotKey"
import { EncyclopediaAnimalEntry, PlayerSaveSystem, PlotSaveData } from "./PlayerSaveSystem"

const rolePlantButtonVisible: Map<RoleID, boolean> = new Map()
const plantedEggUnitByPlotKey: Map<PlotKey, Obstacle> = new Map()

let initialized = false

function getPlotAnimalScaleMultiplier(plotId: string): number {
  return plotId.indexOf("premium_") === 0 ? 3 : 1
}

function getRoleKey(role: Role): RoleID {
  return role.get_roleid()
}

function getAnimalSpawnPos(plotPos: Vector3): Vector3 {
  return math.Vector3(plotPos.x, plotPos.y + 0.1, plotPos.z)
}



function setPlantButtonVisible(role: Role, visible: boolean): void {
  const roleId = getRoleKey(role)
  const cached = rolePlantButtonVisible.get(roleId)
  if (cached === visible) return

  rolePlantButtonVisible.set(roleId, visible)

  // Drive UI visibility through UI-side custom events.
  // The button (or its container) should be configured in editor to respond to these events.
  if (visible) {
    role.send_ui_custom_event("显示种植按钮事件", {})
  } else {
    role.send_ui_custom_event("隐藏种植按钮事件", {})
  }

  // Also force the visibility as a fallback (in case UI event wiring is incorrect).
  role.set_node_visible(PrefabRegistry.inventoryUI.plantRoot as unknown as ENode, visible)
  role.set_node_visible(PrefabRegistry.inventoryUI.plantButton as unknown as ENode, visible)
}

function canPlantAtPlot(role: Role, plotKey: PlotKey): boolean {
  // Do not allow planting while in swap mode.
  if (PlotActionSystem.isSwapMode(role)) return false

  const roleId = getRoleKey(role)
  const parsed = parsePlotKey(plotKey)
  if (parsed === null) return false
  if (parsed.ownerRoleId !== roleId) return false

  const plotId = parsed.plotId
  const selected = InventorySystem.getSelectedEgg(role)
  if (selected === null) return false

  const plot = MapGenerator.getPlotById(parsed.ownerRoleId, plotId)
  if (plot === undefined) return false
  if (!plot.isUnlocked) return false
  if (plot.hasAnimal) return false
  if (plantedEggUnitByPlotKey.has(plotKey)) return false
  return true
}

function updatePlantButton(role: Role): void {
  const plotKey = PlotFocusSystem.getCurrentPlotKey(role)
  if (plotKey === null) {
    setPlantButtonVisible(role, false)
    return
  }

  const desired = canPlantAtPlot(role, plotKey)
  setPlantButtonVisible(role, desired)
}

export const PlantingSystem = {
  init(): void {
    if (initialized) return
    initialized = true

     PlotFocusSystem.init()

    EventBus.on(GameEvents.PLOT_FOCUS_CHANGED, (role: unknown) => {
      const r = role as Role
      updatePlantButton(r)
    })

    EventBus.on(GameEvents.INVENTORY_CHANGED, (role: unknown) => {
      const r = role as Role
      updatePlantButton(r)
    })
  },

  initPlayer(role: Role): void {
    const roleId = getRoleKey(role)
    rolePlantButtonVisible.set(roleId, false)
    setPlantButtonVisible(role, false)
  },

  handlePlantClicked(role: Role): void {
    const roleId = getRoleKey(role)
    const plotKey = PlotFocusSystem.getCurrentPlotKey(role)
    if (plotKey === null) return
    if (!canPlantAtPlot(role, plotKey)) return

    const parsed = parsePlotKey(plotKey)
    if (parsed === null) return
    const plotId = parsed.plotId

    const selected = InventorySystem.getSelectedEgg(role)
    if (selected === null) return
    const eggTypeId = selected.eggTypeId
    const eggRarityId = selected.rarityId

    // Pre-pick the hatched animal so we can fail fast without consuming the egg.
    const hatchedAnimalTypeId = ExcelData.pickHatchedAnimalId(eggTypeId)
    if (hatchedAnimalTypeId === null) {
      role.show_tips("Egg has no hatch pool", 1.5 as Fixed)
      return
    }

    // Validate prefabs/config before consuming.
    const eggPrefabId = (PrefabRegistry.egg as Record<number, number>)[eggTypeId]
    if (eggPrefabId === undefined) {
      role.show_tips("Missing egg prefab", 1.5 as Fixed)
      return
    }

    const animalPrefabId = (PrefabRegistry.animal as Record<number, number>)[hatchedAnimalTypeId]
    const animalCfg = getAnimalTypeById(hatchedAnimalTypeId)
    if (animalPrefabId === undefined || animalCfg === undefined) {
      role.show_tips("Missing animal prefab", 1.5 as Fixed)
      return
    }

    const plot = MapGenerator.getPlotById(parsed.ownerRoleId, plotId)
    if (plot === undefined) return

    // If something stale exists for this plot key, cancel it first.
    EggHatchingSystem.cancel(plotKey)

    // Spawn a real egg unit at plot and attach it to plot.
    // This is more reliable than bind_model for prefab-based eggs.
    const basePos = plot.obstacle.get_position()
    // Keep egg above the plot surface; hatching animation does not move Y.
    const pos = math.Vector3(basePos.x, basePos.y + 0.6, basePos.z)

    let egg: Obstacle
    try {
      egg = GameAPI.create_obstacle(eggPrefabId as unknown as UnitKey, pos, math.Quaternion(0, 0, 0), math.Vector3(1, 1, 1))
    } catch (e) {
      log(`[Plant] create_obstacle failed: plotId=${plotId} prefabId=${tostring(eggPrefabId)} err=${tostring(e)}`)
      return
    }

    const consumed = InventorySystem.consumeSelectedEgg(role)
    if (consumed === null || consumed.eggTypeId !== eggTypeId) {
      // Rollback: do not leave spawned egg without inventory cost.
      try {
        GameAPI.destroy_unit(egg)
      } catch {
        // ignore
      }
      return
    }
    const consumedRarityId = consumed.rarityId

    try {
      egg.disable_interact()
      egg.set_interact_enabled(false)
    } catch (e) {
      log(`[Plant] disable interact failed: ${tostring(e)}`)
    }

    // Ensure it stays put.
    try {
      egg.disable_gravity()
      egg.set_physics_active(false)
    } catch (_e) {
      // ignore
    }

    try {
      plot.obstacle.add_child(egg)
    } catch (e) {
      log(`[Plant] add_child failed: ${tostring(e)}`)
    }

    // Re-apply position after parenting (some engines switch to local transforms).
    try {
      egg.set_position(pos)
    } catch (_e) {
      // ignore
    }

    egg.set_kv_by_type(Enums.ValueType.Str, "plotId", plotId)
    egg.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", roleId)
    egg.set_kv_by_type(Enums.ValueType.Int, "eggTypeId", eggTypeId)
    egg.set_kv_by_type(Enums.ValueType.Int, "eggRarityId", consumedRarityId)
    egg.set_kv_by_type(Enums.ValueType.Int, "hatchedAnimalTypeId", hatchedAnimalTypeId)
    egg.set_kv_by_type(Enums.ValueType.Bool, "isPlantedEgg", true)
    plantedEggUnitByPlotKey.set(plotKey, egg)

    let hatchPos = pos
    let hatchRot = math.Quaternion(0, 0, 0)
    try {
      hatchPos = egg.get_position()
    } catch {
      // ignore
    }
    try {
      hatchRot = egg.get_orientation()
    } catch {
      // ignore
    }

    EggHatchingSystem.startShake({
      key: plotKey,
      role,
      egg,
      basePos: hatchPos,
      baseRot: hatchRot,
      onComplete: () => {
        // Guard: only complete if this planted egg is still the active one for this plot.
        const active = plantedEggUnitByPlotKey.get(plotKey)
        if (active !== egg) {
          return
        }
        this.hatchEggToAnimal(role, plotKey, plotId, egg, eggTypeId, consumedRarityId, hatchPos)
      },
    })

    log(
      `[Plant] role=${roleId} plotId=${plotId} eggTypeId=${eggTypeId} rarityId=${tostring(eggRarityId)} -> animalTypeId=${hatchedAnimalTypeId}`
    )
    updatePlantButton(role)
    PlayerSaveSystem.save(role)
  },

  hatchEggToAnimal(
    role: Role,
    plotKey: PlotKey,
    plotId: string,
    egg: Obstacle,
    eggTypeId: number,
    eggRarityId: number,
    basePos: Vector3
  ): void {
    const eggType = getEggTypeById(eggTypeId)
    if (eggType === undefined) {
      log(`[Hatch] missing eggType eggTypeId=${tostring(eggTypeId)}`)
      return
    }

    let animalTypeId: number | undefined
    try {
      animalTypeId = egg.get_kv_by_type(Enums.ValueType.Int, "hatchedAnimalTypeId") as number | undefined
    } catch {
      animalTypeId = undefined
    }
    if (animalTypeId === undefined) {
      const picked = ExcelData.pickHatchedAnimalId(eggTypeId)
      if (picked === null) {
        log(`[Hatch] no hatch pool eggTypeId=${tostring(eggTypeId)}`)
        return
      }
      animalTypeId = picked
      try {
        egg.set_kv_by_type(Enums.ValueType.Int, "hatchedAnimalTypeId", animalTypeId)
      } catch {
        // ignore
      }
    }

    // Spawn a creature (animals are implemented as Creature in this project).
    // GameAPI.create_obstacle cannot create characters/creatures.
    const parsed = parsePlotKey(plotKey)
    const ownerRoleId = parsed === null ? role.get_roleid() : parsed.ownerRoleId

    const plot = MapGenerator.getPlotById(ownerRoleId, plotId)
    const plotPos = plot === undefined ? basePos : plot.obstacle.get_position()
    const spawnPos = getAnimalSpawnPos(plotPos)
    const creature = EntityFactory.createAnimal(animalTypeId, spawnPos, role, {
      rarityId: eggRarityId,
      sourceEggTypeId: eggTypeId,
      scaleMultiplier: getPlotAnimalScaleMultiplier(plotId),
    })
    if (creature === null) {
      log(`[Hatch] createAnimal failed plotId=${plotId} animalTypeId=${tostring(animalTypeId)}`)
      role.show_tips("Hatch failed", 1.5 as Fixed)
      return
    }

    // Remove egg only after spawn succeeds.
    try {
      GameAPI.destroy_unit(egg)
    } catch {
      // ignore
    }
    plantedEggUnitByPlotKey.delete(plotKey)

    // Attach to plot so it stays aligned.
    if (plot !== undefined) {
      try {
        plot.obstacle.add_child(creature)
      } catch {
        // ignore
      }

      // Re-apply world position after parenting.
      try {
        creature.set_position(spawnPos)
      } catch {
        // ignore
      }
    }

    // Disable physics so it doesn't fall/slide.
    try {
      creature.disable_gravity()
      creature.set_physics_active(false)
      creature.set_interact_enabled(false)
    } catch {
      // ignore
    }

    // Register so other systems (income, collection, swap, etc.) can see it.
    AnimalSystem.registerAnimal(creature, plotId, role)

    // Persist island state (plot -> animalTypeId).
    const island = PlayerSaveSystem.getIsland(role)

    // Encyclopedia (single source of truth): hatch success.
    if (island.encyclopediaAnimals === undefined) island.encyclopediaAnimals = {} as Record<number, EncyclopediaAnimalEntry>
    if (island.encyclopediaAnimals[animalTypeId] === undefined) {
      const entry = new EncyclopediaAnimalEntry()
      try {
        entry.discoveredAt = GameAPI.get_timestamp() as unknown as number
      } catch {
        entry.discoveredAt = 0
      }
      island.encyclopediaAnimals[animalTypeId] = entry
    }

    if (island.plots === undefined) island.plots = {}
    let st = island.plots[plotId]
    if (st === undefined) {
      st = new PlotSaveData()
      island.plots[plotId] = st
    }
    st.unlocked = true
    st.animalTypeId = animalTypeId
    st.animalScale = EntityFactory.getScaledAnimalCreateScale(animalTypeId, getPlotAnimalScaleMultiplier(plotId))
    st.animalRarityId = eggRarityId
    st.sourceEggTypeId = eggTypeId
    PlayerSaveSystem.setIsland(role, island)
    PlayerSaveSystem.save(role)

    log(
      `[Hatch] hatched plotId=${plotId} eggTypeId=${tostring(eggTypeId)} rarityId=${tostring(eggRarityId)} -> animalTypeId=${tostring(
        animalTypeId
      )}`
    )
  },

  cleanupOwner(ownerRoleId: RoleID): void {
    rolePlantButtonVisible.delete(ownerRoleId)

    const toDelete: PlotKey[] = []
    for (const key of plantedEggUnitByPlotKey.keys()) {
      const parsed = parsePlotKey(key)
      if (parsed !== null && parsed.ownerRoleId === ownerRoleId) {
        toDelete.push(key)
      }
    }

    for (const key of toDelete) {
      EggHatchingSystem.cancel(key)
      const egg = plantedEggUnitByPlotKey.get(key)
      if (egg !== undefined) {
        try {
          GameAPI.destroy_unit(egg)
        } catch {
          // ignore
        }
      }
      plantedEggUnitByPlotKey.delete(key)
    }
  },

  spawnAnimalOnPlotFromSave(role: Role, plotId: string, animalTypeId: number, opts?: { rarityId?: number; sourceEggTypeId?: number }): void {
    const roleId = getRoleKey(role)
    const plotKey = makePlotKey(roleId, plotId)

    // Ensure plot is unlocked in runtime.
    const plot = MapGenerator.getPlotById(roleId, plotId)
    if (plot === undefined) return
    if (!plot.isUnlocked) {
      MapGenerator.unlockPlot(roleId, plotId, { silent: true })
    }

    const refreshed = MapGenerator.getPlotById(roleId, plotId)
    const targetPlot = refreshed === undefined ? plot : refreshed
    if (targetPlot.hasAnimal) return

    const plotPos = targetPlot.obstacle.get_position()
    const spawnPos = getAnimalSpawnPos(plotPos)
    const creature = EntityFactory.createAnimal(animalTypeId, spawnPos, role, {
      rarityId: opts?.rarityId,
      sourceEggTypeId: opts?.sourceEggTypeId,
      scaleMultiplier: getPlotAnimalScaleMultiplier(plotId),
    })
    if (creature === null) return

    try {
      targetPlot.obstacle.add_child(creature)
    } catch {
      // ignore
    }
    try {
      creature.set_position(spawnPos)
    } catch {
      // ignore
    }
    try {
      creature.disable_gravity()
      creature.set_physics_active(false)
      creature.set_interact_enabled(false)
    } catch {
      // ignore
    }

    AnimalSystem.registerAnimal(creature, plotId, role)

    // Keep planted egg map consistent (should already be empty after reload).
    plantedEggUnitByPlotKey.delete(plotKey)
  },
}
