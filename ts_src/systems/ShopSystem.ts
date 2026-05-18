import { log } from "@common/utils"
import { PrefabRegistry } from "../config"

export const ShopSystem = {
  initPlayer(role: Role): void {
    try {
      role.set_node_visible(PrefabRegistry.shopUI.root, false)
    } catch {
      // ignore
    }
  },

  show(role: Role): void {
    log(`[Shop] show role=${tostring(role.get_roleid())}`)
    try {
      role.set_node_visible(PrefabRegistry.shopUI.root, true)
    } catch {
      // ignore
    }
  },

  hide(role: Role): void {
    log(`[Shop] hide role=${tostring(role.get_roleid())}`)
    try {
      role.set_node_visible(PrefabRegistry.shopUI.root, false)
    } catch {
      // ignore
    }
  },
}
