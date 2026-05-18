import { GameConfig, PrefabRegistry } from "../config"
import { EconomySystem } from "./EconomySystem"
import { PlayerSaveSystem } from "./PlayerSaveSystem"

function getDayNumber(): number {
  const timestamp = GameAPI.get_timestamp() as unknown as Fixed
  return math.tointeger(timestamp / 86400)
}

function isClaimedToday(role: Role): boolean {
  const today = getDayNumber()
  const last = PlayerSaveSystem.getDailySignInLastClaimDay(role)
  return typeof last === "number" && last >= today
}

function setVisible(role: Role, visible: boolean): void {
  try {
    role.set_node_visible(PrefabRegistry.dailyRewardUI.root as unknown as ENode, visible)
  } catch {
    // ignore
  }
}

function render(role: Role): void {
  const claimed = isClaimedToday(role)
  const text = claimed ? "今日已领取" : "点击签到领取奖励"
  try {
    role.set_label_text(PrefabRegistry.dailyRewardUI.descLabel, text)
  } catch {
    // ignore
  }

  // Hide the sign-in button once claimed.
  try {
    role.set_node_visible(PrefabRegistry.dailyRewardUI.signInButton as unknown as ENode, !claimed)
  } catch {
    // ignore
  }
}

export const DailySignInSystem = {
  initPlayer(role: Role): void {
    setVisible(role, false)
  },

  show(role: Role): void {
    render(role)
    setVisible(role, true)
  },

  hide(role: Role): void {
    setVisible(role, false)
  },

  handleClose(role: Role): void {
    this.hide(role)
  },

  handleSignIn(role: Role): void {
    if (isClaimedToday(role)) {
      this.hide(role)
      return
    }

    const today = getDayNumber()
    PlayerSaveSystem.setDailySignInLastClaimDay(role, today)

    const amount = GameConfig.DAILY_SIGN_IN_COINS
    this.grantReward(role, amount, "签到成功")

    PlayerSaveSystem.save(role)
    this.hide(role)
  },

  grantReward(role: Role, amount: number, label?: string): void {
    const text = label === undefined || label.length === 0 ? "奖励领取成功" : label
    if (amount > 0) {
      EconomySystem.addCoins(role, amount)
      role.show_tips(`${text}：+$${tostring(amount)}`, 1.5 as Fixed)
      return
    }
    role.show_tips(text, 1.2 as Fixed)
  },
}
