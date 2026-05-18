import { EventBus } from "@common/event_bus"
import { GameConfig, ArchiveKeys } from "../config"
import { GameEvents } from "../utils"
import { PlayerEconomySaveData, PlayerSaveSystem } from "./PlayerSaveSystem"

const playerData: Map<RoleID, PlayerEconomySaveData> = new Map()

function getRoleKey(role: Role): RoleID {
  return role.get_roleid()
}

function getOrCreateData(role: Role): PlayerEconomySaveData {
  const roleId = getRoleKey(role)
  let data = playerData.get(roleId)
  if (data === undefined) {
    data = new PlayerEconomySaveData()
    playerData.set(roleId, data)
  }
  return data
}

function getDayNumber(): number {
  const timestamp = GameAPI.get_timestamp() as unknown as Fixed
  return math.tointeger(timestamp / 86400)
}

function checkAndResetDaily(role: Role, data: PlayerEconomyData): void {
  if (!GameConfig.ENABLE_ARCHIVES) return

  const currentDay = getDayNumber()
  const lastReset = data.lastDailyReset

  if (lastReset === undefined || lastReset < currentDay) {
    data.mutationStonesToday = 0
    data.lastDailyReset = currentDay
  }
}

type PlayerEconomyData = PlayerEconomySaveData

export const EconomySystem = {
  initPlayer(role: Role): void {
    getOrCreateData(role)
  },

  loadFromArchive(role: Role): void {
    if (!GameConfig.ENABLE_ARCHIVES) return

    const data = PlayerSaveSystem.getEconomy(role)
    playerData.set(getRoleKey(role), data)
    checkAndResetDaily(role, data)
    GlobalAPI.warning(
      `[Economy] load role=${tostring(role.get_roleid())} coins=${tostring(data.coins)} ` +
        `mutations=${tostring(data.mutationStones)} ore=${tostring(data.ore)}`
    )
  },

  getCoins(role: Role): number {
    return getOrCreateData(role).coins
  },

  addCoins(role: Role, amount: number): void {
    const data = getOrCreateData(role)
    data.coins += amount
    GlobalAPI.warning(
      `[Economy] addCoins role=${tostring(role.get_roleid())} amount=${tostring(amount)} now=${tostring(data.coins)}`
    )
    EventBus.emit(GameEvents.COINS_CHANGED, role, data.coins, amount)
  },

  spendCoins(role: Role, amount: number): boolean {
    const data = getOrCreateData(role)
    if (data.coins < amount) return false

    data.coins -= amount
    GlobalAPI.warning(
      `[Economy] spendCoins role=${tostring(role.get_roleid())} amount=${tostring(amount)} now=${tostring(data.coins)}`
    )
    EventBus.emit(GameEvents.COINS_CHANGED, role, data.coins, -amount)
    return true
  },

  getMutationStones(role: Role): number {
    return getOrCreateData(role).mutationStones
  },

  addMutationStone(role: Role): boolean {
    const data = getOrCreateData(role)
    const limit = data.hasMiningPrivilege
      ? GameConfig.MUTATION_STONE_DAILY_LIMIT * GameConfig.MINING_PRIVILEGE_MULTIPLIER
      : GameConfig.MUTATION_STONE_DAILY_LIMIT

    if (data.mutationStonesToday >= limit) return false

    data.mutationStones += 1
    data.mutationStonesToday += 1
    EventBus.emit(GameEvents.MUTATION_STONES_CHANGED, role, data.mutationStones, 1)
    return true
  },

  spendMutationStone(role: Role): boolean {
    const data = getOrCreateData(role)
    if (data.mutationStones < 1) return false

    data.mutationStones -= 1
    EventBus.emit(GameEvents.MUTATION_STONES_CHANGED, role, data.mutationStones, -1)
    return true
  },

  getDailyMutationProgress(role: Role): { current: number; max: number } {
    const data = getOrCreateData(role)
    const max = data.hasMiningPrivilege
      ? GameConfig.MUTATION_STONE_DAILY_LIMIT * GameConfig.MINING_PRIVILEGE_MULTIPLIER
      : GameConfig.MUTATION_STONE_DAILY_LIMIT
    return { current: data.mutationStonesToday, max }
  },

  getOre(role: Role): number {
    return getOrCreateData(role).ore
  },

  addOre(role: Role, amount: number): void {
    const data = getOrCreateData(role)
    data.ore += amount
  },

  sellOre(role: Role, amount: number): number {
    const data = getOrCreateData(role)
    const toSell = Math.min(amount, data.ore)
    if (toSell <= 0) return 0

    data.ore -= toSell
    const goldEarned = toSell * GameConfig.ORE_SELL_PRICE
    data.coins += goldEarned

    EventBus.emit(GameEvents.ORE_SOLD, role, toSell, goldEarned)
    EventBus.emit(GameEvents.COINS_CHANGED, role, data.coins, goldEarned)
    return goldEarned
  },

  hasMiningPrivilege(role: Role): boolean {
    return getOrCreateData(role).hasMiningPrivilege
  },

  purchaseMiningPrivilege(role: Role): boolean {
    const data = getOrCreateData(role)
    if (data.hasMiningPrivilege) return false

    data.hasMiningPrivilege = true
    return true
  },

  resetDailyProgress(role: Role): void {
    const data = getOrCreateData(role)
    data.mutationStonesToday = 0
    data.lastDailyReset = getDayNumber()
  },

  getData(role: Role): PlayerEconomyData {
    const data = getOrCreateData(role)
    return { ...data }
  },

  cleanupPlayer(role: Role): void {
    playerData.delete(role.get_roleid())
  },
}

PlayerSaveSystem.registerSaveHook((role: Role) => {
  const data = getOrCreateData(role)
  PlayerSaveSystem.setEconomyNoSave(role, data)
})
