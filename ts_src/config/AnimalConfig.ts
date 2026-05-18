/**
 * 动物类型配置
 */

import { 动物类型行表 } from "../generated/excel_data"
import type { 动物类型行 } from "../generated/excel_class"
import { ExcelData } from "./ExcelData"

/** 动物稀有度 */
export enum AnimalRarity {
  COMMON = "常见",
  RARE = "稀有",
  EPIC = "史诗",
  LEGENDARY = "传说",
}

/** 动物类型定义 */
export interface AnimalType {
  /** 动物类型ID */
  id: number
  /** 动物名称 */
  name: string
  /** 稀有度 */
  rarity: AnimalRarity
  /** 每秒基础产金 */
  baseIncome: number
  /** 可变异成的动物ID列表 */
  mutationTargets: number[]
  /** 回收返还金币比例 */
  recycleRatio: number
  /** 基础购买价格(用于计算回收价) */
  baseValue: number
  /** 描述 */
  description: string
}

function parseAnimalRarity(value: string): AnimalRarity {
  if (value === AnimalRarity.COMMON) return AnimalRarity.COMMON
  if (value === AnimalRarity.RARE) return AnimalRarity.RARE
  if (value === AnimalRarity.EPIC) return AnimalRarity.EPIC
  if (value === AnimalRarity.LEGENDARY) return AnimalRarity.LEGENDARY
  throw new Error(`[AnimalConfig] unknown rarity: ${String(value)}`)
}

function uniqueNumberList(list: ReadonlyArray<number>): number[] {
  const seen: Record<string, boolean> = {}
  const out: number[] = []
  for (let i = 0; i < list.length; i++) {
    const id = list[i]!
    const k = String(id)
    if (seen[k] === true) continue
    seen[k] = true
    out.push(id)
  }
  return out
}

/** 所有动物类型（由 Excel 导出表驱动） */
export const AnimalTypes: AnimalType[] = (() => {
  ExcelData.init()
  const rows = 动物类型行表
  const animals: AnimalType[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const id = row["动物ID"]
    const pool = ExcelData.getMutationPoolBySourceAnimalId(id)
    const targetIds: number[] = []
    for (let j = 0; j < pool.length; j++) {
      targetIds.push(pool[j]!.id)
    }

    animals.push({
      id,
      name: row["动物名称"],
      rarity: parseAnimalRarity(row["稀有度"]),
      baseIncome: row["每秒基础产金"],
      // Weighted selection is handled by EntityFactory; keep a unique list for compatibility.
      mutationTargets: uniqueNumberList(targetIds),
      recycleRatio: row["回收比例"],
      baseValue: row["基础价值"],
      description: row["描述"] === undefined ? "" : row["描述"],
    })
  }

  animals.sort((a, b) => a.id - b.id)
  return animals
})()

/**
 * 根据ID获取动物类型
 */
export function getAnimalTypeById(id: number): AnimalType | undefined {
  for (let i = 0; i < AnimalTypes.length; i++) {
    const animal = AnimalTypes[i]
    if (animal.id === id) {
      return animal
    }
  }
  return undefined
}

/**
 * 获取动物回收价格
 */
export function getAnimalRecyclePrice(animalType: AnimalType): number {
  return Math.floor(animalType.baseValue * animalType.recycleRatio)
}

/**
 * 根据稀有度获取动物列表
 */
export function getAnimalsByRarity(rarity: AnimalRarity): AnimalType[] {
  const result: AnimalType[] = []
  for (let i = 0; i < AnimalTypes.length; i++) {
    const animal = AnimalTypes[i]
    if (animal.rarity === rarity) {
      result.push(animal)
    }
  }
  return result
}

/**
 * 获取动物可变异的目标列表
 */
export function getMutationTargets(animalId: number): AnimalType[] {
  const animal = getAnimalTypeById(animalId)
  if (animal === undefined) return []

  const result: AnimalType[] = []
  const targets = animal.mutationTargets
  for (let i = 0; i < targets.length; i++) {
    const targetId = targets[i]
    const target = getAnimalTypeById(targetId)
    if (target !== undefined) {
      result.push(target)
    }
  }

  return result
}
