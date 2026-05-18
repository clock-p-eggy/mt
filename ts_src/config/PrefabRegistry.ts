import { toIntOrThrow } from "@common/num"
import { EggitorExport } from "../generated/eggitor_export"

type UIHandle = string

type PrefabCategoryMap = Record<string, number>
type PrefabExportMap = Record<string, PrefabCategoryMap>
type UINodeExportMap = Record<string, string>

function requireNumber(raw: unknown, label: string): number {
  return toIntOrThrow(raw, { ctx: label })
}

function requireString(raw: unknown, label: string): string {
  if (typeof raw !== "string" || raw === "") {
    throw new Error(`[PrefabRegistry] ${label} 必须是非空字符串，当前=${String(raw)}`)
  }
  return raw
}

function isAsciiDigits(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

const prefabGroups = EggitorExport.Prefab as unknown as PrefabExportMap
const uiNodes = EggitorExport.UINodes as unknown as UINodeExportMap

function requirePrefab(category: string, name: string): number {
  const bucket = prefabGroups[category]
  if (bucket === undefined || bucket === null) {
    throw new Error(`[PrefabRegistry] 缺少 Prefab 分类: ${category}`)
  }
  return requireNumber(bucket[name], `Prefab.${category}.${name}`)
}

function requireNode(name: string): string {
  return requireString(uiNodes[name], `UINodes.${name}`)
}

function buildPrefixedPrefabMap(category: string, prefix: string): Record<number, number> {
  const bucket = prefabGroups[category]
  if (bucket === undefined || bucket === null) {
    throw new Error(`[PrefabRegistry] 缺少 Prefab 分类: ${category}`)
  }

  const out: Record<number, number> = {}
  for (const name in bucket) {
    if (!name.startsWith(prefix)) continue
    const suffix = name.slice(prefix.length)
    if (!isAsciiDigits(suffix)) continue
    const id = toIntOrThrow(suffix, { ctx: `Prefab.${category}.${name}.suffix` })
    const rawId = bucket[name]
    out[id] = requireNumber(rawId, `Prefab.${category}.${name}`)
  }
  return out
}

const animalPrefabByTypeId = buildPrefixedPrefabMap("character", "动物_")
const eggPrefabByTypeId = buildPrefixedPrefabMap("unit", "蛋_")

eggPrefabByTypeId[1] = 1073975389

export const PrefabRegistry = {
  plot: {
    normal: requirePrefab("unit", "地块_普通"),
    premium: requirePrefab("unit", "地块_高级"),
    elite: requirePrefab("unit", "地块_精英"),
    super: requirePrefab("unit", "地块_超级"),
    locked: requirePrefab("unit", "地块_锁定"),
    forSale: requirePrefab("unit", "地块代售占位"),
  },

  npc: {
    shop: requirePrefab("unit", "商店"),
    miner: requirePrefab("character", "矿工"),
  },

  animal: animalPrefabByTypeId as Record<number, number>,

  egg: eggPrefabByTypeId as Record<number, number>,

  zone: {
    plot: requirePrefab("trigger", "事件触发区域") as CustomTriggerSpaceKey,
    conveyor: requirePrefab("trigger", "事件触发区域") as CustomTriggerSpaceKey,
  },

  group: {
    ground: requirePrefab("group", "绑定组 地板") as unknown as UnitGroupKey,
    conveyor: requirePrefab("group", "绑定组 传送带") as unknown as UnitGroupKey,
    shop: requirePrefab("group", "绑定组 商店") as unknown as UnitGroupKey,
  },

  sfx: {
    hatch: 60001 as SfxKey,
    coin: 60002 as SfxKey,
    mutate: 60003 as SfxKey,
    unlock: 60004 as SfxKey,
    mine: 60005 as SfxKey,
  },

  sound: {
    coin: 70001,
    purchase: 70002,
    hatch: 70003,
    mutateSuccess: 70004,
    mutateFail: 70005,
  },

  sceneUI: {
    priceLabel: 80001 as E3DLayerKey,
    incomeText: 80002 as E3DLayerKey,
    eggPrice: requirePrefab("scene_eui", "蛋价格") as E3DLayerKey,
    eggPanel: requirePrefab("scene_eui", "蛋面板") as E3DLayerKey,
    floorBuyPricePanel: requirePrefab("scene_eui", "地板购买价格面板") as E3DLayerKey,
  },

  hudUI: {
    "金币": requireNode("金币"),
    "收入": requireNode("收入"),
    "动物收集": requireNode("动物收集"),
    "地块进度": requireNode("地块进度"),
    "矿石": requireNode("矿石"),
    "变异石": requireNode("变异石"),
    "价格": requireNode("价格"),
    "名字": requireNode("名字"),
  } satisfies Record<string, UIHandle>,

  sceneUINodes: {
    "蛋面板-名字": requireNode("蛋面板-名字"),
    "蛋面板-待提款数额": requireNode("蛋面板-待提款数额"),
    "蛋面板-钱每秒": requireNode("蛋面板-钱每秒"),
  } satisfies Record<string, UIHandle>,

  floorBuyPriceUINodes: {
    "地板购买价格面板-价格": requireNode("地板购买价格面板-价格"),
  } satisfies Record<string, UIHandle>,

  eggPriceUINodes: {
    "蛋价格-折扣text": requireNode("蛋价格-折扣text"),
    "蛋价格-购买按钮": requireNode("蛋价格-购买按钮"),
  } satisfies Record<string, UIHandle>,

  hudButtons: {
    "金色条纹按钮": requireNode("金色条纹按钮") as unknown as EButton,
  },

  inventoryUI: {
    plantButton: requireNode("种植按钮") as unknown as EButton,
    plantRoot: requireNode("种植相关") as unknown as ENode,
  },

  shopUI: {
    root: requireNode("商店界面") as unknown as ENode,
    display: requireNode("商店界面-展示") as unknown as EImage,
    list: requireNode("商店界面-列表") as unknown as ENode,
    listContainer: requireNode("商店界面-列表容器") as unknown as ENode,
    levelDisplay: requireNode("商店界面-级别展示") as unknown as ELabel,
    purchaseButton: requireNode("商店界面-购买按钮") as unknown as EButton,
    levelButtons: {
      1: requireNode("商店界面-一级按钮") as unknown as EButton,
      2: requireNode("商店界面-二级按钮") as unknown as EButton,
      3: requireNode("商店界面-三级按钮") as unknown as EButton,
      4: requireNode("商店界面-四级按钮") as unknown as EButton,
      5: requireNode("商店界面-五级按钮") as unknown as EButton,
    } as Record<number, EButton>,
  },

  offlineIncomeUI: {
    root: requireNode("离线收益") as unknown as ENode,
    amountLabel: requireNode("离线收益-金额") as unknown as ELabel,
    durationLabel: "1735260903" as unknown as ELabel,
    collectButton: requireNode("离线收益-收下按钮") as unknown as EButton,
  },

  dailyRewardUI: {
    root: requireNode("每日奖励面板") as unknown as ENode,
    descLabel: requireNode("每日奖励面板-desc") as unknown as ELabel,
    closeButton: requireNode("每日奖励面板-关闭按钮") as unknown as EButton,
    signInButton: requireNode("每日奖励面板-签到按钮") as unknown as EButton,
  },

  plotActionUI: {
    root: requireNode("地块操作面板") as unknown as ENode,
    recycleButton: requireNode("地块操作面板-回收按钮") as unknown as EButton,
    swapButton: requireNode("地块操作面板-换位按钮") as unknown as EButton,
    mutateButton: requireNode("地块操作面板-变异按钮") as unknown as EButton,
    upgradeButton: requireNode("地块操作面板-升级按钮") as unknown as EButton,
  },

  swapOverlayUI: {
    root: requireNode("换位浮层") as unknown as ENode,
    exitButton: requireNode("换位-退出按钮") as unknown as EButton,
    confirmButton: requireNode("换位-确认按钮") as unknown as EButton,
  },

  recycleConfirmUI: {
    root: requireNode("回收确认面板") as unknown as ENode,
    amountLabel: requireNode("回收确认面板-金额") as unknown as ELabel,
    confirmButton: requireNode("回收确认面板-确认按钮") as unknown as EButton,
    cancelButton: requireNode("回收确认面板-取消按钮") as unknown as EButton,
  },

  adUnlockUI: {
    root: "1182212283" as unknown as ENode,
    confirmButton: "2130725186" as unknown as EButton,
    cancelButton: "1101287796" as unknown as EButton,
  },

  inventoryButtons: {
    "背包slot1": requireNode("背包slot1") as unknown as EButton,
    "背包slot2": requireNode("背包slot2") as unknown as EButton,
    "背包slot3": requireNode("背包slot3") as unknown as EButton,
    "背包slot4": requireNode("背包slot4") as unknown as EButton,
    "背包slot5": requireNode("背包slot5") as unknown as EButton,
    "背包slot6": requireNode("背包slot6") as unknown as EButton,
    "背包slot7": requireNode("背包slot7") as unknown as EButton,
    "背包slot8": requireNode("背包slot8") as unknown as EButton,
  },

  inventoryIcons: {
    empty: 16208 as ImageKey,
    egg: {
      1: 16613 as ImageKey,
      2: 16614 as ImageKey,
      3: 16615 as ImageKey,
      4: 16616 as ImageKey,
      5: 16617 as ImageKey,
      6: 16618 as ImageKey,
    } as Record<number, ImageKey>,
  },
} as const

export type PrefabRegistryType = typeof PrefabRegistry
