import {
  动物变异池行表,
  动物类型行索引,
  动物类型行表,
  地块布局行表,
  传送带蛋池行表,
  传送带等级行表,
  传送带等级行索引,
  蛋稀有度行索引,
  蛋稀有度行表,
  蛋折扣行索引,
  蛋折扣行表,
  蛋孵化池行表,
  蛋类型行索引,
  蛋类型行表,
} from "../generated/excel_data"

import * as ExcelExportModule from "../generated/excel_data"

import type {
  动物类型行,
  地块布局行,
  传送带等级行,
  蛋稀有度行,
  蛋折扣行,
  蛋类型行,
} from "../generated/excel_class"

type WeightedId = { id: number; weight: number }

type AnyExcelRow = Record<string, unknown>

function getOptionalExport(name: string): unknown {
  return (ExcelExportModule as unknown as Record<string, unknown>)[name]
}

function getOptionalRowTable(name: string): ReadonlyArray<AnyExcelRow> | null {
  const v = getOptionalExport(name)
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) {
    throw new Error(`[ExcelData] expected ${name} to be an array, got: ${typeof v}`)
  }
  return v as ReadonlyArray<AnyExcelRow>
}

function requireNumber(n: unknown, name: string): number {
  if (typeof n === "number" && n === n) {
    return n
  }
  // Some numeric values may come from the engine as Fixed userdata.
  // Use math.isfinite to validate without relying on Lua's tonumber (not available in this runtime).
  try {
    const f = n as unknown as Fixed
    if (math.isfinite(f)) {
      return f as unknown as number
    }
  } catch {
    // ignore
  }
  throw new Error(`[ExcelData] invalid number for ${name}: ${tostring(n)}`)
}

function requireInt(n: unknown, name: string): number {
  const v = requireNumber(n, name)
  if (Math.floor(v) !== v) {
    throw new Error(`[ExcelData] expected int for ${name}: ${tostring(v)}`)
  }
  return v
}

function pickWeightedId(items: ReadonlyArray<WeightedId>): number | null {
  let total = 0
  for (let i = 0; i < items.length; i++) {
    const weight = requireInt(items[i]!.weight, `WeightedId[${String(i)}].weight`)
    if (weight > 0) total += weight
  }
  if (total <= 0) return null

  const roll = GameAPI.random_int(1, total)
  let acc = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const weight = requireInt(item.weight, `WeightedId[${String(i)}].weight`)
    if (weight <= 0) continue
    acc += weight
    if (roll <= acc) return item.id
  }
  return null
}

function hasPositiveWeightLocal(items: ReadonlyArray<WeightedId>): boolean {
  for (let i = 0; i < items.length; i++) {
    const weight = requireInt(items[i]!.weight, `WeightedId[${String(i)}].weight`)
    if (weight > 0) return true
  }
  return false
}

function makeKey2(a: number, b: number): string {
  return `${String(a)}:${String(b)}`
}

function makePlotLevelKey(plotTypeId: number, level: number): string {
  return `${String(plotTypeId)}:${String(level)}`
}

let validated = false
let enabledEggIdsCache: number[] | null = null
let conveyorMaxLevelCache: number | null = null

const hatchPoolByEggId: Map<number, WeightedId[]> = new Map()
const mutationPoolBySourceAnimalId: Map<number, WeightedId[]> = new Map()
const conveyorEggPoolByLevel: Map<number, WeightedId[]> = new Map()
const eggDiscountPool: WeightedId[] = []
const eggRarityPool: WeightedId[] = []

type PlotLevelRow = { cost: number; multiplier: number }
const plotLevelByTypeAndLevel: Map<string, PlotLevelRow> = new Map()
let plotLevelMaxByType: Map<number, number> | null = null

type SpecialPlotDef = {
  id: number
  row: number
  col: number
  plotTypeId: number
  initialUnlocked: boolean
}

const specialPlots: SpecialPlotDef[] = []

function getConveyorMaxLevelInternal(): number {
  if (conveyorMaxLevelCache !== null) return conveyorMaxLevelCache
  let maxLevel = 0
  for (let i = 0; i < 传送带等级行表.length; i++) {
    const row = 传送带等级行表[i] as unknown as Record<string, unknown>
    const level = requireInt(row["传送带等级"] as number, "传送带等级行.传送带等级")
    if (level > maxLevel) maxLevel = level
  }
  conveyorMaxLevelCache = maxLevel
  return maxLevel
}

function ensureBuilt(): void {
  if (validated) return

  // Build hatch pools.
  for (let i = 0; i < 蛋孵化池行表.length; i++) {
    const row = 蛋孵化池行表[i]!
    const eggId = requireInt(row["蛋ID"], "蛋孵化池行.蛋ID")
    const animalId = requireInt(row["动物ID"], "蛋孵化池行.动物ID")
    const weight = requireInt(row["权重"], "蛋孵化池行.权重")

    const eggRow = 蛋类型行索引[String(eggId)]
    if (eggRow === undefined) {
      throw new Error(`[ExcelData] 蛋孵化池引用了不存在的蛋ID=${String(eggId)}`)
    }
    const animalRow = 动物类型行索引[String(animalId)]
    if (animalRow === undefined) {
      throw new Error(`[ExcelData] 蛋孵化池引用了不存在的动物ID=${String(animalId)}`)
    }

    // Disabled animals are excluded from random pools (save/load remains compatible).
    if (animalRow["是否启用"] !== true) {
      continue
    }

    let list = hatchPoolByEggId.get(eggId)
    if (list === undefined) {
      list = []
      hatchPoolByEggId.set(eggId, list)
    }
    list.push({ id: animalId, weight })
  }

  // Build mutation pools.
  for (let i = 0; i < 动物变异池行表.length; i++) {
    const row = 动物变异池行表[i]!
    const srcId = requireInt(row["源动物ID"], "动物变异池行.源动物ID")
    const dstId = requireInt(row["目标动物ID"], "动物变异池行.目标动物ID")
    const weight = requireInt(row["权重"], "动物变异池行.权重")

    const srcRow = 动物类型行索引[String(srcId)]
    if (srcRow === undefined) {
      throw new Error(`[ExcelData] 动物变异池引用了不存在的源动物ID=${String(srcId)}`)
    }
    const dstRow = 动物类型行索引[String(dstId)]
    if (dstRow === undefined) {
      throw new Error(`[ExcelData] 动物变异池引用了不存在的目标动物ID=${String(dstId)}`)
    }

    // Disabled targets are excluded from mutation random pools.
    if (dstRow["是否启用"] !== true) {
      continue
    }

    let list = mutationPoolBySourceAnimalId.get(srcId)
    if (list === undefined) {
      list = []
      mutationPoolBySourceAnimalId.set(srcId, list)
    }
    list.push({ id: dstId, weight })
  }

  // Build conveyor pools.
  for (let i = 0; i < 传送带蛋池行表.length; i++) {
    const row = 传送带蛋池行表[i]!
    const level = requireInt(row["传送带等级"], "传送带蛋池行.传送带等级")
    const eggId = requireInt(row["蛋ID"], "传送带蛋池行.蛋ID")
    const weight = requireInt(row["权重"], "传送带蛋池行.权重")

    if (传送带等级行索引[String(level)] === undefined) {
      throw new Error(`[ExcelData] 传送带蛋池引用了不存在的传送带等级=${String(level)}`)
    }
    const eggRow = 蛋类型行索引[String(eggId)]
    if (eggRow === undefined) {
      throw new Error(`[ExcelData] 传送带蛋池引用了不存在的蛋ID=${String(eggId)}`)
    }

    let list = conveyorEggPoolByLevel.get(level)
    if (list === undefined) {
      list = []
      conveyorEggPoolByLevel.set(level, list)
    }
    list.push({ id: eggId, weight })
  }

  // Build egg discount pool.
  for (let i = 0; i < 蛋折扣行表.length; i++) {
    const row = 蛋折扣行表[i] as unknown as Record<string, unknown>
    const id = requireInt(row["折扣ID"] as number, "蛋折扣行.折扣ID")
    const weight = requireInt(row["权重"] as number, "蛋折扣行.权重")
    const ratio = requireNumber(row["折扣比例"] as number, "蛋折扣行.折扣比例")
    const labelText = row["标签文本"]
    if (typeof labelText !== "string") {
      throw new Error(`[ExcelData] invalid string for 蛋折扣行.标签文本(discountId=${String(id)}): ${String(labelText)}`)
    }
    if (ratio <= 0) {
      throw new Error(`[ExcelData] invalid ratio for 蛋折扣行.折扣比例(discountId=${String(id)}): ${tostring(ratio)}`)
    }
    eggDiscountPool.push({ id, weight })
  }

  // Build egg rarity pool.
  for (let i = 0; i < 蛋稀有度行表.length; i++) {
    const row = 蛋稀有度行表[i] as unknown as Record<string, unknown>
    const id = requireInt(row["稀有度ID"] as number, "蛋稀有度行.稀有度ID")
    const weight = requireInt(row["权重"] as number, "蛋稀有度行.权重")
    const bonusPct = requireNumber(row["金钱加成百分比"] as number, "蛋稀有度行.金钱加成百分比")
    const name = row["稀有度名称"]
    if (typeof name !== "string") {
      throw new Error(`[ExcelData] invalid string for 蛋稀有度行.稀有度名称(rarityId=${String(id)}): ${String(name)}`)
    }
    // bonusPct can be 0; negative does not make sense.
    if (bonusPct < 0) {
      throw new Error(`[ExcelData] invalid bonus pct for 蛋稀有度行.金钱加成百分比(rarityId=${String(id)}): ${tostring(bonusPct)}`)
    }
    eggRarityPool.push({ id, weight })
  }

  // Optional: special plot level table.
  // Enables non-linear per-level cost/multiplier.
  // Expected sheet name suggestion: "特殊地块等级" -> export name "特殊地块等级行表".
  const specialPlotLevelRows = getOptionalRowTable("特殊地块等级行表")
  if (specialPlotLevelRows !== null) {
    plotLevelMaxByType = new Map()
    for (let i = 0; i < specialPlotLevelRows.length; i++) {
      const raw = specialPlotLevelRows[i]!
      const plotTypeId = requireInt(raw["地块类型ID"], "特殊地块等级.地块类型ID")
      const level = requireInt(raw["等级"], "特殊地块等级.等级")
      const cost = requireInt(raw["升级费用"], "特殊地块等级.升级费用")
      const multiplier = requireNumber(raw["收益倍率"], "特殊地块等级.收益倍率")
      if (level <= 0) {
        throw new Error(`[ExcelData] 特殊地块等级.等级 must be >= 1: plotTypeId=${String(plotTypeId)} level=${String(level)}`)
      }
      if (multiplier <= 0) {
        throw new Error(
          `[ExcelData] 特殊地块等级.收益倍率 must be > 0: plotTypeId=${String(plotTypeId)} level=${String(level)} multiplier=${tostring(
            multiplier
          )}`
        )
      }
      const key = makePlotLevelKey(plotTypeId, level)
      if (plotLevelByTypeAndLevel.has(key)) {
        throw new Error(`[ExcelData] duplicate 特殊地块等级 row: plotTypeId=${String(plotTypeId)} level=${String(level)}`)
      }
      plotLevelByTypeAndLevel.set(key, { cost, multiplier })
      const storedCurMax = plotLevelMaxByType.get(plotTypeId)
      const curMax = storedCurMax === undefined ? 0 : storedCurMax
      if (level > curMax) {
        plotLevelMaxByType.set(plotTypeId, level)
      }
    }
  }

  // Optional: special plot definitions (placement/initial unlock).
  // Expected sheet name suggestion: "特殊地块" -> export name "特殊地块行表".
  const specialPlotRows = getOptionalRowTable("特殊地块行表")
  if (specialPlotRows !== null) {
    const seen: Set<number> = new Set()
    for (let i = 0; i < specialPlotRows.length; i++) {
      const raw = specialPlotRows[i]!
      const id = requireInt(raw["特殊地块ID"], "特殊地块.特殊地块ID")
      const row = requireInt(raw["行"], "特殊地块.行")
      const col = requireInt(raw["列"], "特殊地块.列")

      let plotTypeId = 1
      const plotTypeIdRaw = raw["地块类型ID"]
      if (plotTypeIdRaw !== undefined && plotTypeIdRaw !== null) {
        plotTypeId = requireInt(plotTypeIdRaw, "特殊地块.地块类型ID")
      }

      const initialUnlocked = raw["是否默认解锁"] === true || raw["默认解锁"] === true

      if (id <= 0) {
        throw new Error(`[ExcelData] 特殊地块.特殊地块ID must be > 0: id=${String(id)}`)
      }
      if (seen.has(id)) {
        throw new Error(`[ExcelData] duplicate 特殊地块 row: id=${String(id)}`)
      }
      seen.add(id)

      specialPlots.push({ id, row, col, plotTypeId, initialUnlocked })
    }
  }

  // Sanity: enabled eggs should have hatch pools (unless explicitly allowed later).
  for (let i = 0; i < 蛋类型行表.length; i++) {
    const row = 蛋类型行表[i]!
    const eggId = requireInt(row["蛋ID"], "蛋类型行.蛋ID")
    const enabled = row["是否启用"] === true
    if (!enabled) continue

    const pool = hatchPoolByEggId.get(eggId)
    if (pool === undefined || pool.length === 0) {
      throw new Error(`[ExcelData] 启用的蛋缺少孵化池配置: eggId=${String(eggId)}`)
    }
    if (!hasPositiveWeightLocal(pool)) {
      throw new Error(`[ExcelData] 启用的蛋孵化池权重全为0: eggId=${String(eggId)}`)
    }
  }

  // Sanity: plot layout must not duplicate (row,col).
  const seenPlotKeys: Set<string> = new Set()
  for (let i = 0; i < 地块布局行表.length; i++) {
    const row = 地块布局行表[i]!
    const r = requireInt(row["行"], "地块布局行.行")
    const c = requireInt(row["列"], "地块布局行.列")
    const k = makeKey2(r, c)
    if (seenPlotKeys.has(k)) {
      throw new Error(`[ExcelData] 地块布局重复坐标: ${k}`)
    }
    seenPlotKeys.add(k)
  }

  // Sanity: ensure expected conveyor levels exist and are well-typed.
  // Current gameplay/UI assumes levels 1..5.
  for (let level = 1; level <= 5; level++) {
    const row = 传送带等级行索引[String(level)] as unknown as Record<string, unknown> | undefined
    if (row === undefined) {
      throw new Error(`[ExcelData] missing conveyor level row: level=${String(level)}`)
    }
    requireInt(row["升级价格"] as number, `传送带等级行.升级价格(level=${String(level)})`)
    const desc = row["解锁说明"]
    if (typeof desc !== "string") {
      throw new Error(`[ExcelData] invalid string for 传送带等级行.解锁说明(level=${String(level)}): ${String(desc)}`)
    }
  }

  validated = true

  // Cache max conveyor level for callers.
  getConveyorMaxLevelInternal()
}

export const ExcelData = {
  init(): void {
    ensureBuilt()
  },

  /** Optional sheet (exported as 地块类型行表 when configured in 导出目录). */
  tryGetPlotTypeRows(): ReadonlyArray<AnyExcelRow> | null {
    ensureBuilt()
    return getOptionalRowTable("地块类型行表")
  },

  /** Optional sheet (exported as 特殊地块行表). */
  getSpecialPlots(): ReadonlyArray<SpecialPlotDef> {
    ensureBuilt()
    return specialPlots
  },

  getEggRowById(eggId: number): 蛋类型行 | null {
    ensureBuilt()
    const row = 蛋类型行索引[String(eggId)]
    return row === undefined ? null : row
  },

  getAllEggRows(): ReadonlyArray<蛋类型行> {
    ensureBuilt()
    return 蛋类型行表
  },

  getEnabledEggIds(): number[] {
    ensureBuilt()
    if (enabledEggIdsCache !== null) return enabledEggIdsCache

    const ids: number[] = []
    for (let i = 0; i < 蛋类型行表.length; i++) {
      const row = 蛋类型行表[i]!
      if (row["是否启用"] === true) {
        ids.push(requireInt(row["蛋ID"], "蛋类型行.蛋ID"))
      }
    }

    // Stable order: sort by "排序" then by eggId.
    ids.sort((a, b) => {
      const ra = 蛋类型行索引[String(a)]
      const rb = 蛋类型行索引[String(b)]
      const oa = ra === undefined ? 0 : ra["排序"]
      const ob = rb === undefined ? 0 : rb["排序"]
      if (oa !== ob) return oa - ob
      return a - b
    })

    enabledEggIdsCache = ids
    return ids
  },

  getHatchPoolByEggId(eggId: number): ReadonlyArray<WeightedId> {
    ensureBuilt()
    const pool = hatchPoolByEggId.get(eggId)
    return pool === undefined ? [] : pool
  },

  pickHatchedAnimalId(eggId: number): number | null {
    ensureBuilt()
    const pool = hatchPoolByEggId.get(eggId)
    if (pool === undefined || pool.length === 0) return null
    return pickWeightedId(pool)
  },

  getAnimalRowById(animalId: number): 动物类型行 | null {
    ensureBuilt()
    const row = 动物类型行索引[String(animalId)]
    return row === undefined ? null : row
  },

  getAllAnimalRows(): ReadonlyArray<动物类型行> {
    ensureBuilt()
    return 动物类型行表
  },

  getMutationPoolBySourceAnimalId(animalId: number): ReadonlyArray<WeightedId> {
    ensureBuilt()
    const pool = mutationPoolBySourceAnimalId.get(animalId)
    return pool === undefined ? [] : pool
  },

  pickMutationTargetAnimalId(animalId: number): number | null {
    ensureBuilt()
    const pool = mutationPoolBySourceAnimalId.get(animalId)
    if (pool === undefined || pool.length === 0) return null
    return pickWeightedId(pool)
  },

  getPlotLayoutRows(): ReadonlyArray<地块布局行> {
    ensureBuilt()
    return 地块布局行表
  },

  getConveyorLevelRow(level: number): 传送带等级行 | null {
    ensureBuilt()
    const row = 传送带等级行索引[String(level)]
    return row === undefined ? null : row
  },

  getConveyorMaxLevel(opts?: { cap?: number }): number {
    ensureBuilt()
    const maxLevel = getConveyorMaxLevelInternal()
    const cap = opts?.cap
    if (typeof cap === "number" && cap === cap && cap > 0) {
      return Math.min(maxLevel, Math.floor(cap))
    }
    return maxLevel
  },

  getConveyorUpgradePrice(level: number): number | null {
    ensureBuilt()
    const row = 传送带等级行索引[String(level)]
    if (row === undefined) return null
    return requireInt(row["升级价格"], `传送带等级行.升级价格(level=${String(level)})`)
  },

  getConveyorUnlockDesc(level: number): string {
    ensureBuilt()
    const row = 传送带等级行索引[String(level)]
    if (row === undefined) return ""
    const desc = row["解锁说明"]
    return typeof desc === "string" ? desc : ""
  },

  getConveyorEggPoolByLevel(level: number): ReadonlyArray<WeightedId> {
    ensureBuilt()
    const pool = conveyorEggPoolByLevel.get(level)
    return pool === undefined ? [] : pool
  },

  pickConveyorEggId(level: number, opts?: { enabledOnly?: boolean }): number | null {
    ensureBuilt()
    const pool = conveyorEggPoolByLevel.get(level)
    if (pool === undefined || pool.length === 0) return null

    if (opts?.enabledOnly !== true) {
      return pickWeightedId(pool)
    }

    const enabled: WeightedId[] = []
    for (let i = 0; i < pool.length; i++) {
      const it = pool[i]!
      const row = 蛋类型行索引[String(it.id)] as 蛋类型行 | undefined
      if (row !== undefined && row["是否启用"] === true) {
        enabled.push(it)
      }
    }
    if (enabled.length === 0) return null
    return pickWeightedId(enabled)
  },

  rollEggDiscount(): { id: number; ratio: number; labelText: string } {
    ensureBuilt()
    let id = pickWeightedId(eggDiscountPool)
    if (id === null) {
      // Fallback: treat as no-discount when weights are all 0.
      return { id: 0, ratio: 1, labelText: "" }
    }
    const row = 蛋折扣行索引[String(id)] as 蛋折扣行 | undefined
    if (row === undefined) {
      throw new Error(`[ExcelData] 蛋折扣索引缺失: 折扣ID=${String(id)}`)
    }
    const ratio = requireNumber(row["折扣比例"], `蛋折扣行.折扣比例(discountId=${String(id)})`)
    const labelText = row["标签文本"]
    return { id, ratio, labelText: typeof labelText === "string" ? labelText : "" }
  },

  getEggRarityRow(rarityId: number): 蛋稀有度行 | null {
    ensureBuilt()
    const row = 蛋稀有度行索引[String(rarityId)] as 蛋稀有度行 | undefined
    return row === undefined ? null : row
  },

  rollEggRarity(): { id: number; name: string; moneyBonusPct: number } {
    ensureBuilt()
    let id = pickWeightedId(eggRarityPool)
    if (id === null) {
      // Fallback to rarityId=1 when weights are all 0.
      id = 1
    }
    const row = 蛋稀有度行索引[String(id)] as 蛋稀有度行 | undefined
    if (row === undefined) {
      throw new Error(`[ExcelData] 蛋稀有度索引缺失: 稀有度ID=${String(id)}`)
    }
    const name = row["稀有度名称"]
    const pct = requireNumber(row["金钱加成百分比"], `蛋稀有度行.金钱加成百分比(rarityId=${String(id)})`)
    return { id, name: typeof name === "string" ? name : "", moneyBonusPct: pct }
  },

  getPlotLevelConfig(plotTypeId: number, level: number): PlotLevelRow | null {
    ensureBuilt()
    const row = plotLevelByTypeAndLevel.get(makePlotLevelKey(plotTypeId, level))
    return row === undefined ? null : row
  },

  getPlotMaxLevel(plotTypeId: number): number {
    ensureBuilt()
    if (plotLevelMaxByType === null) return 0
    const v = plotLevelMaxByType.get(plotTypeId)
    return v === undefined ? 0 : v
  },
}
