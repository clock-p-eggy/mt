import { EventBus } from "@common/event_bus"
import { GameConfig, PrefabRegistry } from "../config"
import { GameEvents } from "../utils"
import { EconomySystem } from "./EconomySystem"
import { MapGenerator } from "./MapGenerator"
import { AnimalSystem } from "./AnimalSystem"
import { PlotSystem } from "./PlotSystem"

const playerMiningCooldown: Map<RoleID, number> = new Map()
const playerInMineZone: Map<RoleID, boolean> = new Map()

function getRoleKey(role: Role): RoleID {
  return role.get_roleid()
}

export const MiningSystem = {
  enterMineZone(role: Role): void {
    playerInMineZone.set(getRoleKey(role), true)
  },

  leaveMineZone(role: Role): void {
    playerInMineZone.set(getRoleKey(role), false)
  },

  isInMineZone(role: Role): boolean {
    const flag = playerInMineZone.get(getRoleKey(role))
    return flag === undefined ? false : flag
  },

  canMine(role: Role): { canMine: boolean; reason?: string } {
    if (this.isInMineZone(role) === false) {
      return { canMine: false, reason: "not_in_mine_zone" }
    }

    const lastMineTimeValue = playerMiningCooldown.get(getRoleKey(role))
    const lastMineTime = lastMineTimeValue === undefined ? 0 : lastMineTimeValue
    const currentTime = GameAPI.get_timestamp() as unknown as number

    if (currentTime - lastMineTime < GameConfig.MINING_COOLDOWN) {
      return { canMine: false, reason: "on_cooldown" }
    }

    return { canMine: true }
  },

  mine(role: Role): { ore: number; mutationStone: boolean } {
    const check = this.canMine(role)
    if (check.canMine === false) {
      return { ore: 0, mutationStone: false }
    }

    const currentTime = GameAPI.get_timestamp() as unknown as number
    playerMiningCooldown.set(getRoleKey(role), currentTime)

    const hasPrivilege = EconomySystem.hasMiningPrivilege(role)
    const oreAmount = hasPrivilege ? 2 : 1

    EconomySystem.addOre(role, oreAmount)

    const gotMutationStone = EconomySystem.addMutationStone(role)

    const unit = role.get_ctrl_unit()
    const playerPos = (unit as any) !== undefined ? unit.get_position() : math.Vector3(0, 0, 0)
    GameAPI.play_sfx_by_key(
      PrefabRegistry.sfx.mine as SfxKey,
      playerPos,
      math.Quaternion(0, 0, 0),
      math.tofixed(1),
      math.tofixed(1.5)
    )

    EventBus.emit(GameEvents.MINING_COMPLETED, role, oreAmount, gotMutationStone)

    return { ore: oreAmount, mutationStone: gotMutationStone }
  },

  getCooldownRemaining(role: Role): number {
    const lastMineTimeValue = playerMiningCooldown.get(getRoleKey(role))
    const lastMineTime = lastMineTimeValue === undefined ? 0 : lastMineTimeValue
    const currentTime = GameAPI.get_timestamp() as unknown as number
    
    const remaining = GameConfig.MINING_COOLDOWN - (currentTime - lastMineTime)
    return Math.max(0, remaining)
  },

  sellAllOre(role: Role): number {
    const ore = EconomySystem.getOre(role)
    if (ore <= 0) return 0

    return EconomySystem.sellOre(role, ore)
  },

  getMiningProgress(role: Role): { current: number; max: number } {
    return EconomySystem.getDailyMutationProgress(role)
  },
}
