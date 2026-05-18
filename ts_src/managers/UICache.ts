import { log } from "@common/utils"
import { PrefabRegistry } from "../config"

declare const set_label_font_size: ((label: ELabel, fontSize: number, transitionTime: Fixed) => void) | undefined
declare const set_label_color: ((label: ELabel, color: Color, transitionTime: Fixed) => void) | undefined

type HudUIKey = keyof typeof PrefabRegistry.hudUI
type HudUIHandle = (typeof PrefabRegistry.hudUI)[HudUIKey]

const cache = new Map<HudUIKey, ELabel | null>()
const coinPulseSeqByRole = new Map<RoleID, number>()
let initialized = false

const COINS_FONT_SIZE_NORMAL = 55
const COINS_FONT_SIZE_PULSE = 75
const COINS_FONT_RESTORE_DELAY = 0.25 as Fixed
const COINS_FONT_TRANSITION = 0.25 as Fixed
const COINS_COLOR_NORMAL = 0xFFFFFF
const COINS_COLOR_PULSE = 0xE5A61D
const COINS_COLOR_TRANSITION = 0.25 as Fixed

function setCoinLabelFontSize(role: Role, label: ELabel, fontSize: number, transitionTime: Fixed): boolean {
  try {
    if (typeof set_label_font_size === "function") {
      set_label_font_size(label, fontSize, transitionTime)
      return true
    }
    const gameApi = GameAPI as unknown as {
      set_label_font_size?: (label: ELabel, nextFontSize: number, nextTransitionTime: Fixed) => void
    }
    if (typeof gameApi.set_label_font_size === "function") {
      gameApi.set_label_font_size(label, fontSize, transitionTime)
      return true
    }
    role.set_label_font_size(label, fontSize as integer, transitionTime)
    return true
  } catch {
    return false
  }
}

function setCoinLabelColor(role: Role, label: ELabel, color: Color, transitionTime: Fixed): boolean {
  try {
    if (typeof set_label_color === "function") {
      set_label_color(label, color, transitionTime)
      return true
    }
    const gameApi = GameAPI as unknown as {
      set_label_color?: (targetLabel: ELabel, nextColor: Color, nextTransitionTime: Fixed) => void
    }
    if (typeof gameApi.set_label_color === "function") {
      gameApi.set_label_color(label, color, transitionTime)
      return true
    }
    role.set_label_color(label, color, transitionTime)
    return true
  } catch {
    return false
  }
}

export const UICache = {
  init(): void {
    if (initialized) return

    const hudUI = PrefabRegistry.hudUI
    const entries: [HudUIKey, HudUIHandle][] = [
      ["金币", hudUI["金币"]],
      ["收入", hudUI["收入"]],
      ["动物收集", hudUI["动物收集"]],
      ["地块进度", hudUI["地块进度"]],
      ["矿石", hudUI["矿石"]],
      ["变异石", hudUI["变异石"]],
    ]

    for (const [key, handle] of entries) {
      cache.set(key, handle as unknown as ELabel)
    }

    initialized = true
    log(`[UICache] Initialized, cached ${cache.size} nodes`)
  },

  get(key: HudUIKey): ELabel | null {
    const result = cache.get(key)
    if (result === undefined) return null
    return result
  },

  setText(role: Role, key: HudUIKey, text: string): boolean {
    const label = this.get(key)
    if (label === null) {
      return false
    }

    role.set_label_text(label, text)
    return true
  },

  pulseCoins(role: Role): boolean {
    const label = this.get("金币")
    if (label === null) {
      return false
    }

    const roleId = role.get_roleid()
    const prevSeq = coinPulseSeqByRole.get(roleId)
    const nextSeq = (prevSeq === undefined ? 0 : prevSeq) + 1
    coinPulseSeqByRole.set(roleId, nextSeq)

    const pulseFontOk = setCoinLabelFontSize(role, label, COINS_FONT_SIZE_PULSE, COINS_FONT_TRANSITION)
    const pulseColorOk = setCoinLabelColor(role, label, COINS_COLOR_PULSE as Color, COINS_COLOR_TRANSITION)
    if (!pulseFontOk || !pulseColorOk) {
      log(`[UICache] pulseCoins apply failed role=${tostring(roleId)} label=${label}`)
    }

    LuaAPI.call_delay_time(COINS_FONT_RESTORE_DELAY, () => {
      if (coinPulseSeqByRole.get(roleId) !== nextSeq) {
        return
      }
      const restoreFontOk = setCoinLabelFontSize(role, label, COINS_FONT_SIZE_NORMAL, COINS_FONT_TRANSITION)
      const restoreColorOk = setCoinLabelColor(role, label, COINS_COLOR_NORMAL as Color, COINS_COLOR_TRANSITION)
      if (!restoreFontOk || !restoreColorOk) {
        log(`[UICache] pulseCoins restore failed role=${tostring(roleId)} label=${label}`)
      }
    })

    return true
  },

  updateAllStats(
    role: Role,
    stats: {
      coins: number
      incomePerSecond: number
      collectionCount: number
      plotProgress: { unlocked: number; total: number }
      ore: number
      mutationStones: number
    }
  ): void {
    this.setText(role, "金币", tostring(stats.coins))
    this.setText(role, "收入", `${stats.incomePerSecond}/s`)
    this.setText(role, "动物收集", tostring(stats.collectionCount))
    this.setText(role, "地块进度", `${stats.plotProgress.unlocked}/${stats.plotProgress.total}`)
    this.setText(role, "矿石", tostring(stats.ore))
    this.setText(role, "变异石", tostring(stats.mutationStones))
  },

  isAvailable(key: HudUIKey): boolean {
    return this.get(key) !== null
  },
}
