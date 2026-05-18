/**
 * 蛋类型配置
 */

import { 蛋类型行表 } from "../generated/excel_data"
import type { 蛋类型行 } from "../generated/excel_class"
import { ExcelData } from "./ExcelData"

/** 蛋的稀有度 */
export enum EggRarity {
  NORMAL = "普通",
  PREMIUM = "至臻",
  BLIND_BOX = "盲盒",
}

/** 蛋类型定义 */
export interface EggType {
  /** 蛋类型ID */
  id: number
  /** 蛋名称 */
  name: string
  /** 稀有度 */
  rarity: EggRarity
  /** 原价 */
  price: number
  /** 折扣(0.7 = 7折)，可选 */
  discount?: number
  /** 可孵化的动物ID列表 */
  possibleAnimals: number[]
  /** 描述 */
  description: string
}

/** 所有蛋类型 */
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

export const EggTypes: EggType[] = (() => {
  ExcelData.init()

  const rows = 蛋类型行表
  const orderById: Map<number, number> = new Map()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    orderById.set(r["蛋ID"], r["排序"])
  }
  const eggs: EggType[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const id = row["蛋ID"]
    const pool = ExcelData.getHatchPoolByEggId(id)
    const animalIds: number[] = []
    for (let j = 0; j < pool.length; j++) {
      animalIds.push(pool[j]!.id)
    }

    eggs.push({
      id,
      name: row["蛋名称"],
      // Out of scope for now: Excel-driven rarity/discount.
      rarity: EggRarity.NORMAL,
      price: row["基础售价"],
      discount: undefined,
      possibleAnimals: uniqueNumberList(animalIds),
      description: row["备注"] === undefined ? "" : row["备注"],
    })
  }

  // Stable order: by "排序" then id.
  eggs.sort((a, b) => {
    const oaMaybe = orderById.get(a.id)
    const obMaybe = orderById.get(b.id)
    const oa = oaMaybe === undefined ? 0 : oaMaybe
    const ob = obMaybe === undefined ? 0 : obMaybe
    if (oa !== ob) return oa - ob
    return a.id - b.id
  })

  return eggs
})()

/**
 * 根据ID获取蛋类型
 */
export function getEggTypeById(id: number): EggType | undefined {
  for (let i = 0; i < EggTypes.length; i++) {
    const egg = EggTypes[i]
    if (egg.id === id) {
      return egg
    }
  }
  return undefined
}

/**
 * 获取蛋的实际价格(考虑折扣)
 */
export function getEggActualPrice(eggType: EggType): number {
  if (eggType.discount !== undefined) {
    return Math.floor(eggType.price * eggType.discount)
  }
  return eggType.price
}
