import { EventBus } from "@common/event_bus"
import { GameConfig, getAnimalTypeById, AnimalType } from "../config"
import { GameEvents } from "../utils"
import { EconomySystem } from "./EconomySystem"
import { EntityFactory } from "./EntityFactory"
import { MapGenerator, PlotData } from "./MapGenerator"
import { PlotSystem } from "./PlotSystem"

interface AnimalData {
  creature: Creature
  animalTypeId: number
  plotId: string
  owner: Role
}

const animals: Map<number, AnimalData> = new Map()
const collectedAnimalsByOwner: Map<RoleID, Set<number>> = new Map()

function getPlotAnimalScaleMultiplier(plotId: string): number {
  return plotId.indexOf("premium_") === 0 ? 3 : 1
}

function getAnimalSpawnPos(plotPos: Vector3): Vector3 {
  return math.Vector3(plotPos.x, plotPos.y + 0.1, plotPos.z)
}

function getCreatureIntKvSafe(creature: Creature, key: string): number | undefined {
  try {
    if (creature.has_kv(key) !== true) return undefined
  } catch {
    return undefined
  }

  try {
    const v = creature.get_kv_by_type(Enums.ValueType.Int, key) as number | undefined
    return typeof v === "number" && v === v ? v : undefined
  } catch {
    return undefined
  }
}

function setCreatureScaleMarker(creature: Creature, animalTypeId: number, plotId: string): void {
  try {
    creature.set_kv_by_type(
      Enums.ValueType.Int,
      "plotScaleMultiplier",
      EntityFactory.getAnimalScaleMarkerByTypeId(animalTypeId, getPlotAnimalScaleMultiplier(plotId))
    )
  } catch {
    // ignore
  }
}

function recreateAnimalForPlot(data: AnimalData): AnimalData | null {
  const ownerRoleId = data.owner.get_roleid()
  const plot = MapGenerator.getPlotById(ownerRoleId, data.plotId)
  const spawnPos = plot === undefined ? data.creature.get_position() : getAnimalSpawnPos(plot.obstacle.get_position())
  const rarityId = getCreatureIntKvSafe(data.creature, "animalRarityId")
  const sourceEggTypeId = getCreatureIntKvSafe(data.creature, "sourceEggTypeId")

  const newCreature = EntityFactory.createAnimal(data.animalTypeId, spawnPos, data.owner, {
    rarityId,
    sourceEggTypeId,
    scaleMultiplier: getPlotAnimalScaleMultiplier(data.plotId),
  })
  if (newCreature === null) return null

  try {
    newCreature.disable_gravity()
    newCreature.set_physics_active(false)
    newCreature.set_interact_enabled(false)
  } catch {
    // ignore
  }

  if (plot !== undefined) {
    try {
      plot.obstacle.add_child(newCreature)
    } catch {
      // ignore
    }
    try {
      newCreature.set_position(spawnPos)
    } catch {
      // ignore
    }
  }

  setCreatureScaleMarker(newCreature, data.animalTypeId, data.plotId)

  const oldUnitId = LuaAPI.get_unit_id(data.creature)
  const newUnitId = LuaAPI.get_unit_id(newCreature)
  const nextData: AnimalData = {
    creature: newCreature,
    animalTypeId: data.animalTypeId,
    plotId: data.plotId,
    owner: data.owner,
  }

  animals.delete(oldUnitId)
  animals.set(newUnitId, nextData)
  MapGenerator.setPlotAnimal(ownerRoleId, data.plotId, newUnitId)

  try {
    GameAPI.destroy_unit(data.creature)
  } catch {
    // ignore
  }

  return nextData
}

function updateAnimalScaleForPlot(data: AnimalData): AnimalData {
  const currentMultiplier = getCreatureIntKvSafe(data.creature, "plotScaleMultiplier")
  if (currentMultiplier === EntityFactory.getAnimalScaleMarkerByTypeId(data.animalTypeId, getPlotAnimalScaleMultiplier(data.plotId))) {
    return data
  }

  const recreated = recreateAnimalForPlot(data)
  if (recreated !== null) {
    return recreated
  }
  return data
}

function getOrCreateCollectedSet(ownerRoleId: RoleID): Set<number> {
  let s = collectedAnimalsByOwner.get(ownerRoleId)
  if (s === undefined) {
    s = new Set()
    collectedAnimalsByOwner.set(ownerRoleId, s)
  }
  return s
}

export const AnimalSystem = {
  refreshAnimalScale(unitId: number): void {
    const data = animals.get(unitId)
    if (data === undefined) return
    updateAnimalScaleForPlot(data)
  },

  refreshOwnerAnimalScales(ownerRoleId: RoleID): void {
    for (const data of animals.values()) {
      if (data.owner.get_roleid() !== ownerRoleId) continue
      updateAnimalScaleForPlot(data)
    }
  },

  registerAnimal(creature: Creature, plotId: string, owner: Role): void {
    const unitId = LuaAPI.get_unit_id(creature)
    const animalTypeId = creature.get_kv_by_type(Enums.ValueType.Int, "animalTypeId") as number
    const ownerRoleId = owner.get_roleid()

    animals.set(unitId, {
      creature,
      animalTypeId,
      plotId,
      owner,
    })

    this.refreshAnimalScale(unitId)

    const currentData = this.getAnimalOnPlot(ownerRoleId, plotId)
    const currentUnitId = currentData === undefined ? unitId : LuaAPI.get_unit_id(currentData.creature)

    MapGenerator.setPlotAnimal(ownerRoleId, plotId, currentUnitId)

    const collected = getOrCreateCollectedSet(ownerRoleId)
    if (!collected.has(animalTypeId)) {
      collected.add(animalTypeId)
      PlotSystem.incrementCollection(ownerRoleId)
    }
  },

  unregisterAnimal(unitId: number): AnimalData | undefined {
    const data = animals.get(unitId)
    if (data === undefined) return undefined

    MapGenerator.setPlotAnimal(data.owner.get_roleid(), data.plotId, null)
    animals.delete(unitId)
    
    return data
  },

  getAnimal(unitId: number): AnimalData | undefined {
    return animals.get(unitId)
  },

  getAllAnimals(): AnimalData[] {
    const result: AnimalData[] = []
    for (const data of animals.values()) {
      result.push(data)
    }
    return result
  },

  getAnimalsByOwner(role: Role): AnimalData[] {
    const result: AnimalData[] = []
    const roleId = role.get_roleid()
    for (const data of animals.values()) {
      if (data.owner.get_roleid() === roleId) {
        result.push(data)
      }
    }
    return result
  },

  recycleAnimal(unitId: number): number {
    const data = animals.get(unitId)
    if (data === undefined) return 0

    const recyclePrice = EntityFactory.recycleAnimal(data.creature, data.owner)
    
    if (recyclePrice > 0) {
      EconomySystem.addCoins(data.owner, recyclePrice)
    }

    this.unregisterAnimal(unitId)
    
    return recyclePrice
  },

  mutateAnimal(
    unitId: number, 
    extraCoins: number = 0
  ): { success: boolean; newUnitId: number | null } {
    const data = animals.get(unitId)
    if (data === undefined) {
      return { success: false, newUnitId: null }
    }

    const totalCost = GameConfig.MUTATION_BASE_COST + extraCoins
    
    if (!EconomySystem.spendMutationStone(data.owner)) {
      return { success: false, newUnitId: null }
    }
    
    if (!EconomySystem.spendCoins(data.owner, totalCost)) {
      EconomySystem.addMutationStone(data.owner)
      return { success: false, newUnitId: null }
    }

    this.unregisterAnimal(unitId)

    const result = EntityFactory.mutateAnimal(data.creature, data.owner, extraCoins)

    if (!result.success || result.newAnimal === null) {
      return { success: false, newUnitId: null }
    }

    const newUnitId = LuaAPI.get_unit_id(result.newAnimal)
    this.registerAnimal(result.newAnimal, data.plotId, data.owner)

    return { success: true, newUnitId }
  },

  calculateTotalIncome(role: Role): number {
    const playerAnimals = this.getAnimalsByOwner(role)
    let totalIncome = 0

    for (const data of playerAnimals) {
      const baseIncome = EntityFactory.getAnimalIncome(data.creature)
      const multiplier = PlotSystem.getPlotMultiplier(role.get_roleid(), data.plotId)
      totalIncome += baseIncome * multiplier
    }

    return totalIncome
  },

  tickIncome(role: Role): number {
    const income = this.calculateTotalIncome(role)
    
    if (income > 0) {
      EconomySystem.addCoins(role, income)
      EventBus.emit(GameEvents.INCOME_TICK, role, income)
    }

    return income
  },

  getCollectionProgress(role: Role): { collected: number; total: number } {
    const s = collectedAnimalsByOwner.get(role.get_roleid())
    return { collected: s === undefined ? 0 : s.size, total: 12 }
  },

  isAnimalCollected(role: Role, animalTypeId: number): boolean {
    const s = collectedAnimalsByOwner.get(role.get_roleid())
    return s !== undefined && s.has(animalTypeId)
  },

  getAnimalOnPlot(ownerRoleId: RoleID, plotId: string): AnimalData | undefined {
    for (const data of animals.values()) {
      if (data.owner.get_roleid() === ownerRoleId && data.plotId === plotId) {
        return data
      }
    }
    return undefined
  },

  swapAnimals(unitId1: number, unitId2: number): boolean {
    let data1 = animals.get(unitId1)
    let data2 = animals.get(unitId2)
    
    if (data1 === undefined || data2 === undefined) return false
    if (data1.owner !== data2.owner) return false

    const pos1 = data1.creature.get_position()
    const pos2 = data2.creature.get_position()
    
    data1.creature.set_position(pos2)
    data2.creature.set_position(pos1)

    const tempPlotId = data1.plotId
    data1.plotId = data2.plotId
    data2.plotId = tempPlotId

    data1 = updateAnimalScaleForPlot(data1)
    data2 = updateAnimalScaleForPlot(data2)

    const ownerRoleId = data1.owner.get_roleid()
    const nextUnitId1 = LuaAPI.get_unit_id(data1.creature)
    const nextUnitId2 = LuaAPI.get_unit_id(data2.creature)

    MapGenerator.setPlotAnimal(ownerRoleId, data1.plotId, nextUnitId1)
    MapGenerator.setPlotAnimal(ownerRoleId, data2.plotId, nextUnitId2)

    return true
  },

  moveAnimalToPlot(unitId: number, newPlotId: string): boolean {
    let data = animals.get(unitId)
    if (data === undefined) return false

    const ownerRoleId = data.owner.get_roleid()
    const newPlot = MapGenerator.getPlotById(ownerRoleId, newPlotId)
    if (newPlot === undefined || !newPlot.isUnlocked || newPlot.hasAnimal) {
      return false
    }

    MapGenerator.setPlotAnimal(ownerRoleId, data.plotId, null)
    
    const newPos = getAnimalSpawnPos(newPlot.obstacle.get_position())
    data.creature.set_position(newPos)
    data.plotId = newPlotId
    data = updateAnimalScaleForPlot(data)
    const nextUnitId = LuaAPI.get_unit_id(data.creature)

    MapGenerator.setPlotAnimal(ownerRoleId, newPlotId, nextUnitId)

    return true
  },

  cleanupOwner(ownerRoleId: RoleID): void {
    const toDelete: number[] = []
    for (const [unitId, data] of animals) {
      if (data.owner.get_roleid() === ownerRoleId) {
        toDelete.push(unitId)
      }
    }

    for (const unitId of toDelete) {
      const data = animals.get(unitId)
      if (data !== undefined) {
        MapGenerator.setPlotAnimal(ownerRoleId, data.plotId, null)
        try {
          GameAPI.destroy_unit(data.creature)
        } catch {
          // ignore
        }
      }
      animals.delete(unitId)
    }
  },
}
