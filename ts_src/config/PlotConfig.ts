/**
 * 地块类型配置
 */

import type { 地块布局行 } from "../generated/excel_class"
import { ExcelData } from "./ExcelData"
import { GameConfig } from "./GameConfig"

/** 地块解锁条件类型 */
export type PlotUnlockCondition = 
  | { type: "price"; amount: number }  // 金币解锁
  | { type: "collection"; count: number }  // 收集数解锁

/** 地块类型定义 */
export interface PlotType {
  /** 地块类型ID */
  id: number
  /** 地块名称 */
  name: string
  /** 解锁价格(金币) */
  unlockPrice: number
  /** 收益倍率 */
  incomeMultiplier: number
  /** 特殊解锁条件(可选) */
  unlockCondition?: PlotUnlockCondition
  /** 描述 */
  description: string
}

/** 所有地块类型 */
const DefaultPlotTypes: PlotType[] = [
  {
    id: 1,
    name: "普通地块",
    unlockPrice: 350,
    incomeMultiplier: 1.0,
    description: "基础放置位",
  },
  {
    id: 2,
    name: "高级地块",
    unlockPrice: 1000,
    incomeMultiplier: 10.0,
    description: "10倍收益地块",
  },
  {
    id: 3,
    name: "顶级地块",
    unlockPrice: 40000,
    incomeMultiplier: 1.0,
    description: "豪华地块",
  },
  {
    id: 4,
    name: "超级地块",
    unlockPrice: 2500, // 升级费用
    incomeMultiplier: 2.0,
    unlockCondition: { type: "collection", count: 20 },
    description: "200%收益倍率，可升级到300%",
  },
]

type PlotTypeExcelRow = { plotTypeId: number; unlockPrice: number }

function requireExcelInt(v: unknown, name: string): number {
  // Use n !== n for NaN check (avoids TSTL polyfill issues with Number.isFinite)
  if (typeof v !== "number" || v !== v || Math.floor(v) !== v) {
    throw new Error(`[PlotConfig] expected int for ${name}: ${tostring(v)}`)
  }
  return v
}

function parsePlotTypeRow(raw: Record<string, unknown>): PlotTypeExcelRow {
  const plotTypeId = requireExcelInt(raw["地块类型ID"], "地块类型.地块类型ID")
  const unlockPrice = requireExcelInt(raw["解锁价格"], "地块类型.解锁价格")
  return { plotTypeId, unlockPrice }
}

export const PlotTypes: PlotType[] = (() => {
  const rows = ExcelData.tryGetPlotTypeRows()
  if (rows === null) return DefaultPlotTypes

  const byId: Map<number, PlotTypeExcelRow> = new Map()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const row = parsePlotTypeRow(r)
    if (byId.has(row.plotTypeId)) {
      throw new Error(`[PlotConfig] duplicate 地块类型ID in 地块类型: ${String(row.plotTypeId)}`)
    }
    byId.set(row.plotTypeId, row)
  }

  const out: PlotType[] = []
  for (let i = 0; i < DefaultPlotTypes.length; i++) {
    const base = DefaultPlotTypes[i]!
    const override = byId.get(base.id)
    if (override === undefined) {
      throw new Error(`[PlotConfig] missing 地块类型 row for plotTypeId=${String(base.id)}`)
    }
    out.push({ ...base, unlockPrice: override.unlockPrice })
  }

  for (const key of byId.keys()) {
    let known = false
    for (let i = 0; i < DefaultPlotTypes.length; i++) {
      if (DefaultPlotTypes[i]!.id === key) {
        known = true
        break
      }
    }
    if (!known) {
      throw new Error(`[PlotConfig] unknown 地块类型ID in 地块类型: ${String(key)}`)
    }
  }

  return out
})()

/** 地块网格位置配置 */
export interface PlotGridConfig {
  /** 行 */
  row: number
  /** 列 */
  col: number
  /** 地块类型ID */
  plotTypeId: number
  /** 是否初始解锁 */
  initialUnlocked: boolean
}

/**
 * 地块网格布局
 * 4行5列 = 20个地块
 * 1 = 普通, 2 = 高级, 3 = 顶级
 */
function plotKey(row: number, col: number): string {
  return `${String(row)}:${String(col)}`
}

function isKnownPlotTypeId(plotTypeId: number): boolean {
  for (let i = 0; i < PlotTypes.length; i++) {
    if (PlotTypes[i]!.id === plotTypeId) return true
  }
  return false
}

export const PlotGridLayout: PlotGridConfig[] = (() => {
  ExcelData.init()
  const rows = ExcelData.getPlotLayoutRows()
  const layout: PlotGridConfig[] = []
  const seen: Record<string, boolean> = {}

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const row = r["行"]
    const col = r["列"]
    const plotTypeId = r["地块类型ID"]
    const initialUnlocked = r["初始解锁"] === true

    const key = plotKey(row, col)
    if (seen[key] === true) {
      throw new Error(`[PlotConfig] duplicate plot layout entry: ${key}`)
    }
    seen[key] = true

    if (row < 0 || row >= GameConfig.PLOT_ROWS || col < 0 || col >= GameConfig.PLOT_COLS) {
      throw new Error(`[PlotConfig] plot layout out of bounds: ${key}`)
    }
    if (!isKnownPlotTypeId(plotTypeId)) {
      throw new Error(`[PlotConfig] unknown plotTypeId in layout: ${String(plotTypeId)} at ${key}`)
    }

    layout.push({ row, col, plotTypeId, initialUnlocked })
  }

  // Ensure full coverage.
  for (let r = 0; r < GameConfig.PLOT_ROWS; r++) {
    for (let c = 0; c < GameConfig.PLOT_COLS; c++) {
      const key = plotKey(r, c)
      if (seen[key] !== true) {
        throw new Error(`[PlotConfig] missing plot layout entry: ${key}`)
      }
    }
  }

  layout.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row
    return a.col - b.col
  })

  return layout
})()

/**
 * 根据ID获取地块类型
 */
export function getPlotTypeById(id: number): PlotType | undefined {
  for (let i = 0; i < PlotTypes.length; i++) {
    const plot = PlotTypes[i]
    if (plot.id === id) {
      return plot
    }
  }
  return undefined
}

/**
 * 获取地块配置
 */
export function getPlotGridConfig(row: number, col: number): PlotGridConfig | undefined {
  for (let i = 0; i < PlotGridLayout.length; i++) {
    const grid = PlotGridLayout[i]
    if (grid.row === row && grid.col === col) {
      return grid
    }
  }
  return undefined
}

/**
 * 获取指定类型的地块数量
 */
export function countPlotsByType(plotTypeId: number): number {
  let count = 0
  for (let i = 0; i < PlotGridLayout.length; i++) {
    const grid = PlotGridLayout[i]
    if (grid.plotTypeId === plotTypeId) {
      count += 1
    }
  }
  return count
}
