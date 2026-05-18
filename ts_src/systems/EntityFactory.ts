import { log } from "@common/utils"
import { toIntOrThrow } from "@common/num"
import { EventBus } from "@common/event_bus"
import { ExcelData, GameConfig, PrefabRegistry, getEggTypeById, getAnimalTypeById, EggType, AnimalType } from "../config"
import { GameEvents } from "../utils"

const defaultAnimalRotation = math.Quaternion(0, -Math.PI / 2, 0)
export const EntityFactory = {
  normalizeScaleMultiplier(scale?: number): number {
    return typeof scale === "number" && scale === scale && scale > 0 ? scale : 1
  },

  getAnimalCreateScaleByTypeId(animalTypeId: number): number {
    const normalizedAnimalTypeId = toIntOrThrow(animalTypeId, { ctx: "EntityFactory.animalTypeId" })
    switch (normalizedAnimalTypeId) {
      case 1:
      case 2:
        return 0.2
      case 3:
      case 5:
        return 0.5
      case 4:
        return 1.4
      case 6:
      case 7:
        return 1.1
      case 8:
      case 9:
      case 11:
        return 0.2
      case 10:
        return 0.6
      case 12:
        return 0.1
      default:
        return 1
    }
  },

  getScaledAnimalCreateScale(animalTypeId: number, scaleMultiplier?: number): number {
    return this.getAnimalCreateScaleByTypeId(animalTypeId) * this.normalizeScaleMultiplier(scaleMultiplier)
  },

  encodeScaleMarker(scale?: number): number {
    return math.floor(this.normalizeScaleMultiplier(scale) * 1000 + 0.5)
  },

  getAnimalScaleMarkerByTypeId(animalTypeId: number, scaleMultiplier?: number): number {
    return this.encodeScaleMarker(this.getScaledAnimalCreateScale(animalTypeId, scaleMultiplier))
  },

  createAnimal(
    animalTypeId: number,
    position: Vector3,
    owner?: Role,
    opts?: { rarityId?: number; sourceEggTypeId?: number; scaleMultiplier?: number }
  ): Creature | null {
    const prefabId = PrefabRegistry.animal[animalTypeId]
    if (prefabId === undefined) return null
    
    const animalConfig = getAnimalTypeById(animalTypeId)
    if (animalConfig === undefined) return null

    // Compute income first so we can derive scale before spawning the unit.
    let baseIncome = animalConfig.baseIncome
    const rarityId = opts?.rarityId
    if (typeof rarityId === "number" && rarityId === rarityId && rarityId > 0) {
      const row = ExcelData.getEggRarityRow(rarityId)
      if (row !== null) {
        const bonusPct = row["金钱加成百分比"]
        const pct = typeof bonusPct === "number" && bonusPct === bonusPct ? bonusPct : 0
        baseIncome = Math.floor((baseIncome * (100 + pct)) / 100)
      }
    }

    const createScale = this.getScaledAnimalCreateScale(animalTypeId, opts?.scaleMultiplier)
    log(`[AnimalScale] create animalTypeId=${tostring(animalTypeId)} prefabId=${tostring(prefabId)} scale=${tostring(createScale)} animalTypeKind=${type(animalTypeId as unknown)}`)
    const creature = GameAPI.create_creature_fixed_scale(
      prefabId,
      position,
      defaultAnimalRotation,
      math.tofixed(createScale),
      owner
    )

    if (creature === null) return null

    try {
      creature.set_name(animalConfig.name)
    } catch {
      // ignore
    }

    creature.set_kv_by_type(Enums.ValueType.Int, "animalTypeId", animalTypeId)
    creature.set_kv_by_type(Enums.ValueType.Str, "rarity", animalConfig.rarity)
    if (typeof rarityId === "number" && rarityId === rarityId && rarityId > 0) {
      try {
        creature.set_kv_by_type(Enums.ValueType.Int, "animalRarityId", rarityId)
      } catch {
        // ignore
      }
    }
    const sourceEggTypeId = opts?.sourceEggTypeId
    if (typeof sourceEggTypeId === "number" && sourceEggTypeId === sourceEggTypeId && sourceEggTypeId > 0) {
      try {
        creature.set_kv_by_type(Enums.ValueType.Int, "sourceEggTypeId", sourceEggTypeId)
      } catch {
        // ignore
      }
    }

    creature.set_kv_by_type(Enums.ValueType.Int, "baseIncome", baseIncome)
    creature.set_kv_by_type(
      Enums.ValueType.Int,
      "plotScaleMultiplier",
      this.encodeScaleMarker(createScale)
    )
    creature.set_kv_by_type(Enums.ValueType.Int, "incomeAccumulated", 0)
    creature.set_kv_by_type(Enums.ValueType.Timestamp, "createdAt", GameAPI.get_timestamp())

    EventBus.emit(GameEvents.ANIMAL_CREATED, creature, animalConfig)
    return creature
  },

  getAnimalRecyclePrice(animal: Creature, owner?: Role): number {
    // Prefer instance-derived price from (source egg, rarity).
    let sourceEggTypeId: number | undefined
    let rarityId: number | undefined

    // Avoid engine-level error logs by checking key existence first.
    // get_kv_by_type may log an error when the key is missing even if caught.
    if (animal.has_kv("sourceEggTypeId")) {
      try {
        sourceEggTypeId = animal.get_kv_by_type(Enums.ValueType.Int, "sourceEggTypeId") as number | undefined
      } catch {
        sourceEggTypeId = undefined
      }
    }
    if (animal.has_kv("animalRarityId")) {
      try {
        rarityId = animal.get_kv_by_type(Enums.ValueType.Int, "animalRarityId") as number | undefined
      } catch {
        rarityId = undefined
      }
    }

    if (
      typeof sourceEggTypeId === "number" &&
      sourceEggTypeId === sourceEggTypeId &&
      sourceEggTypeId > 0 &&
      typeof rarityId === "number" &&
      rarityId === rarityId &&
      rarityId > 0
    ) {
      const egg = getEggTypeById(sourceEggTypeId)
      const row = ExcelData.getEggRarityRow(rarityId)
      if (egg !== undefined && row !== null) {
        const bonusPct = row["金钱加成百分比"]
        const pct = typeof bonusPct === "number" && bonusPct === bonusPct ? bonusPct : 0
        const base = egg.price
        const ratio = GameConfig.RECYCLE_FROM_EGG_BASE_RATIO
        const price = Math.floor(base * ratio * (1 + pct / 100))
        return price > 0 ? price : 0
      }
    }

    // Fallback: animal-config based price.
    const animalTypeId = animal.get_kv_by_type(Enums.ValueType.Int, "animalTypeId") as number
    const animalConfig = getAnimalTypeById(animalTypeId)
    if (animalConfig === undefined) return 0
    return Math.floor(animalConfig.baseValue * animalConfig.recycleRatio)
  },


  recycleAnimal(animal: Creature, owner: Role): number {
    const animalTypeId = animal.get_kv_by_type(Enums.ValueType.Int, "animalTypeId") as number
    const animalConfig = getAnimalTypeById(animalTypeId)
    if (animalConfig === undefined) {
      GameAPI.destroy_unit(animal)
      return 0
    }

    const recyclePrice = this.getAnimalRecyclePrice(animal, owner)
    
    EventBus.emit(GameEvents.ANIMAL_RECYCLED, animal, animalConfig, recyclePrice)
    
    GameAPI.destroy_unit(animal)
    
    return recyclePrice
  },

  mutateAnimal(
    animal: Creature, 
    owner: Role,
    extraCoinsForRate: number = 0
  ): { success: boolean; newAnimal: Creature | null; newConfig: AnimalType | null } {
    const animalTypeId = animal.get_kv_by_type(Enums.ValueType.Int, "animalTypeId") as number
    const animalConfig = getAnimalTypeById(animalTypeId)
    
    const pool = ExcelData.getMutationPoolBySourceAnimalId(animalTypeId)

    if (animalConfig === undefined || pool.length === 0) {
      return { success: false, newAnimal: null, newConfig: null }
    }

    const position = animal.get_position()
    
    const baseRate = 0.25
    const bonusRate = Math.min(extraCoinsForRate / 1000, 0.5) * 0.05
    const finalRate = Math.min(baseRate + bonusRate, 0.75)
    
    const roll = GameAPI.random_int(1, 100)
    const success = roll <= finalRate * 100

    GameAPI.play_sfx_by_key(
      PrefabRegistry.sfx.mutate as SfxKey,
      position,
      math.Quaternion(0, 0, 0),
      math.tofixed(1),
      math.tofixed(2)
    )

    if (!success) {
      return { success: false, newAnimal: null, newConfig: null }
    }

    const newAnimalTypeId = ExcelData.pickMutationTargetAnimalId(animalTypeId)
    if (newAnimalTypeId === null) {
      return { success: false, newAnimal: null, newConfig: null }
    }
    const newConfigMaybe = getAnimalTypeById(newAnimalTypeId)
    const newConfig = newConfigMaybe === undefined ? null : newConfigMaybe

    // Create first; destroy old only after new spawn succeeds.
    const newAnimal = this.createAnimal(newAnimalTypeId, position, owner)
    if (newAnimal === null || newConfig === null) {
      GlobalAPI.warning(
        `[Mutate] createAnimal failed: old=${tostring(animalTypeId)} new=${tostring(newAnimalTypeId)} cfg=${tostring(newConfig === null)}`
      )
      owner.show_tips("Mutation failed", 1.5 as Fixed)
      return { success: false, newAnimal: null, newConfig: null }
    }

    try {
      GameAPI.destroy_unit(animal)
    } catch {
      // ignore
    }

    owner.show_tips(`${newConfig.rarity} ${newConfig.name}!`, 2.01 as Fixed)
    EventBus.emit(GameEvents.ANIMAL_MUTATED, newAnimal, newConfig, animalConfig)
    return { success: true, newAnimal, newConfig }
  },

  getAnimalIncome(animal: Creature): number {
    const baseIncome = animal.get_kv_by_type(Enums.ValueType.Int, "baseIncome") as number | undefined
    return baseIncome === undefined ? 0 : baseIncome
  },

  getAnimalType(animal: Creature): AnimalType | null {
    const animalTypeId = animal.get_kv_by_type(Enums.ValueType.Int, "animalTypeId") as number
    const animalType = getAnimalTypeById(animalTypeId)
    return animalType === undefined ? null : animalType
  },

}
