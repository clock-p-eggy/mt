import { GameConfig, ArchiveKeys } from "../config"
import { Field, FieldArray, FieldMap, to_archive, from_archive } from "@common/archive"
import { json_parse, json_stringify } from "@common/json"
import { toIntOrThrow } from "@common/num"

// NOTE: Eggy only supports per-role archives.
// We store the entire save root as a single JSON string at ArchiveKeys.PLAYER_SAVE_JSON (1010).

export class PlayerEconomySaveData {
  @Field("number")
  coins: number = GameConfig.INITIAL_COINS

  @Field("number")
  mutationStones = 0

  @Field("number")
  mutationStonesToday = 0

  @Field("number")
  ore = 0

  @Field("boolean")
  hasMiningPrivilege = false

  @Field("number")
  lastDailyReset?: number
}

export class PlotSaveData {
  @Field("boolean")
  unlocked = false

  @Field("number")
  animalTypeId?: number

  @Field("number")
  animalScale?: number

  // Instance rarity inherited from the purchased egg.
  @Field("number")
  animalRarityId?: number

  // Source egg type that produced this animal (used for rarity-based formulas, recycle, etc.).
  @Field("number")
  sourceEggTypeId?: number

  // Special plot level (used by plotTypeId=4 for now).
  @Field("number")
  plotLevel?: number

  @Field("number")
  pendingCoins = 0
}

export class EncyclopediaAnimalEntry {
  // Timestamp when this animal type was first hatched (GameAPI.get_timestamp()).
  @Field("number")
  discoveredAt = 0
}

export class IslandSaveData {
  // plotId -> plot state
  @FieldMap("string", PlotSaveData)
  plots?: Record<string, PlotSaveData>

  // Inventory slots (eggTypeId). Use 0 for empty.
  @FieldArray("number")
  inventorySlots: number[] = []

  // Inventory rarity per slot (rarityId). Same length as inventorySlots; use 0 for empty.
  @FieldArray("number")
  inventoryRarityIds: number[] = []

  // Shop progression: maximum unlocked shop level for this role.
  // Default 1 (level 1 is available without purchase).
  @Field("number")
  shopMaxUnlockedLevel = 1

  // Animal encyclopedia (per-role): animalTypeId -> discovery metadata.
  @FieldMap("number", EncyclopediaAnimalEntry)
  encyclopediaAnimals?: Record<number, EncyclopediaAnimalEntry>
}

export class PlayerSaveRoot {
  @Field(PlayerEconomySaveData)
  economy = new PlayerEconomySaveData()

  @Field(IslandSaveData)
  island = new IslandSaveData()

  @Field("number")
  saveVersion?: number

  @Field("number")
  pendingOfflineCoins = 0

  @Field("number")
  lastSaveTimestamp?: number

  @Field("number")
  lastExitTimestamp?: number

  // Daily sign-in: last claimed day number (timestamp/86400).
  @Field("number")
  dailySignInLastClaimDay?: number
}

const playerSaves: Map<RoleID, PlayerSaveRoot> = new Map()
const autoSaveTokens: Map<RoleID, number> = new Map()
const AUTO_SAVE_INTERVAL_SECONDS = 60
type SaveHook = (role: Role) => void
const saveHooks: SaveHook[] = []

function isTable(value: unknown): value is object {
  return type(value) === "table"
}

function normalizeNumber(value: unknown, ctx: string): number {
  return toIntOrThrow(value, {
    ctx,
    logger: (msg) => GlobalAPI.warning(`[Save] ${msg}`),
  })
}

function safeGetPlayerSaveJson(role: Role): string | undefined {
  try {
    const v = role.get_archive_by_type(Enums.ArchiveType.Str, ArchiveKeys.PLAYER_SAVE_JSON) as unknown
    return typeof v === "string" ? v : undefined
  } catch (e) {
    GlobalAPI.warning(
      `[Save] get_archive_by_type failed role=${tostring(role.get_roleid())} err=${tostring(e)}`
    )
    return undefined
  }
}

function safeSetPlayerSaveJson(role: Role, val: string): void {
  try {
    role.set_archive_by_type(Enums.ArchiveType.Str, ArchiveKeys.PLAYER_SAVE_JSON, val)
  } catch (e) {
    GlobalAPI.warning(
      `[Save] set_archive_by_type failed role=${tostring(role.get_roleid())} err=${tostring(e)}`
    )
  }
}

function canUseArchives(): boolean {
  if (!GameConfig.ENABLE_ARCHIVES) {
    GlobalAPI.warning("[Save] disabled by config")
    return false
  }

  try {
    const enabled = GameAPI.is_archives_enabled()
    if (!enabled) {
      GlobalAPI.warning("[Save] GameAPI.is_archives_enabled=false")
      return false
    }
  } catch (e) {
    GlobalAPI.warning(`[Save] GameAPI.is_archives_enabled error err=${tostring(e)}`)
    return false
  }

  return true
}

function isLegacyEconomyTable(t: object): boolean {
  const m = t as Record<string, unknown>
  return m.economy === undefined && (typeof m.coins === "number" || typeof m.mutationStones === "number")
}

function loadRootFromArchive(role: Role): PlayerSaveRoot {
  const roleId = role.get_roleid()

  const raw = safeGetPlayerSaveJson(role)
  if (raw === undefined || raw.length === 0) {
    const fresh = new PlayerSaveRoot()
    playerSaves.set(roleId, fresh)
    return fresh
  }

  let decoded: unknown
  try {
    decoded = json_parse(raw)
  } catch {
    decoded = undefined
  }
  if (!isTable(decoded)) {
    const fresh = new PlayerSaveRoot()
    playerSaves.set(roleId, fresh)
    return fresh
  }
  const savedTable = decoded as object

  // Backward compatibility: older builds stored economy fields at the root.
  if (isLegacyEconomyTable(savedTable)) {
    const economy = from_archive(PlayerEconomySaveData, savedTable)
    const root = new PlayerSaveRoot()
    root.economy = economy
    playerSaves.set(roleId, root)
    return root
  }

  const loaded = from_archive(PlayerSaveRoot, savedTable)
  if (loaded.saveVersion === undefined) {
    if (Number(loaded.economy.coins) === 1000000) {
      loaded.economy.coins = GameConfig.INITIAL_COINS
    }
    loaded.saveVersion = 1
  }
  playerSaves.set(roleId, loaded)
  return loaded
}

function saveRootToArchive(role: Role, root: PlayerSaveRoot): void {
  if (!canUseArchives()) {
    GlobalAPI.warning(`[Save] skip canUseArchives=false role=${tostring(role.get_roleid())}`)
    return
  }

  try {
    GlobalAPI.warning(
      `[Save] write attempt role=${tostring(role.get_roleid())} coins=${tostring(root.economy.coins)} ` +
        `pendingOffline=${tostring(root.pendingOfflineCoins)} lastSave=${tostring(root.lastSaveTimestamp)}`
    )
    const payload = to_archive(root)
    const raw = json_stringify(payload)
    safeSetPlayerSaveJson(role, raw)
    GlobalAPI.warning(
      `[Save] write ok role=${tostring(role.get_roleid())} coins=${tostring(root.economy.coins)} ` +
        `pendingOffline=${tostring(root.pendingOfflineCoins)} lastSave=${tostring(root.lastSaveTimestamp)}`
    )
  } catch (e) {
    GlobalAPI.warning(`[Save] write failed role=${tostring(role.get_roleid())} err=${tostring(e)}`)
  }
}

function scheduleAutoSave(role: Role): void {
  const roleId = role.get_roleid()
  const prevToken = autoSaveTokens.get(roleId)
  const token = (prevToken === undefined ? 0 : prevToken) + 1
  autoSaveTokens.set(roleId, token)

  const delay = math.toreal(AUTO_SAVE_INTERVAL_SECONDS)
  LuaAPI.call_delay_time(delay, function () {
    const latest = autoSaveTokens.get(roleId)
    if (latest !== token) return

    try {
      role.get_roleid()
    } catch {
      return
    }

    PlayerSaveSystem.save(role)
  })
}

export const PlayerSaveSystem = {
  registerSaveHook(hook: SaveHook): void {
    saveHooks.push(hook)
  },
  load(role: Role): PlayerSaveRoot {
    const roleId = role.get_roleid()
    const cached = playerSaves.get(roleId)
    if (cached !== undefined) return cached
    if (!canUseArchives()) {
      const fresh = new PlayerSaveRoot()
      playerSaves.set(roleId, fresh)
      return fresh
    }
    return loadRootFromArchive(role)
  },

  save(role: Role): void {
    const roleId = role.get_roleid()
    const root = playerSaves.get(roleId)
    if (root === undefined) return
    if (root.saveVersion === undefined) {
      root.saveVersion = 1
    }
    for (const hook of saveHooks) {
      try {
        hook(role)
      } catch {
        // ignore
      }
    }
    root.lastSaveTimestamp = normalizeNumber(GameAPI.get_timestamp() as unknown as number, "lastSaveTimestamp")
    GlobalAPI.warning(
      `[Save] begin role=${tostring(roleId)} coins=${tostring(root.economy.coins)} ` +
        `pendingOffline=${tostring(root.pendingOfflineCoins)} lastExit=${tostring(root.lastExitTimestamp)}`
    )
    saveRootToArchive(role, root)
    scheduleAutoSave(role)
  },

  getEconomy(role: Role): PlayerEconomySaveData {
    return this.load(role).economy
  },

  setEconomy(role: Role, economy: PlayerEconomySaveData): void {
    const root = this.load(role)
    root.economy = economy
    this.save(role)
  },

  setEconomyNoSave(role: Role, economy: PlayerEconomySaveData): void {
    const root = this.load(role)
    root.economy = economy
  },

  getIsland(role: Role): IslandSaveData {
    return this.load(role).island
  },

  getEncyclopediaAnimalCount(role: Role): number {
    const island = this.getIsland(role)
    const m = island.encyclopediaAnimals
    if (m === undefined) return 0
    let count = 0
    for (const _k in m) {
      count++
    }
    return count
  },

  setIsland(role: Role, island: IslandSaveData): void {
    const root = this.load(role)
    root.island = island
    this.save(role)
  },

  getPendingOfflineCoins(role: Role): number {
    return this.load(role).pendingOfflineCoins
  },

  setPendingOfflineCoins(role: Role, amount: number): void {
    const root = this.load(role)
    root.pendingOfflineCoins = normalizeNumber(amount, "pendingOfflineCoins")
  },

  getLastExitTimestamp(role: Role): number | undefined {
    return this.load(role).lastExitTimestamp
  },

  getDailySignInLastClaimDay(role: Role): number | undefined {
    return this.load(role).dailySignInLastClaimDay
  },

  setDailySignInLastClaimDay(role: Role, day: number): void {
    const root = this.load(role)
    root.dailySignInLastClaimDay = normalizeNumber(day, "dailySignInLastClaimDay")
  },

  getLastSaveTimestamp(role: Role): number | undefined {
    return this.load(role).lastSaveTimestamp
  },

  setLastExitTimestamp(role: Role, timestamp: unknown): void {
    const root = this.load(role)
    root.lastExitTimestamp = normalizeNumber(timestamp, "lastExitTimestamp")
  },

  remove(role: Role): void {
    const roleId = role.get_roleid()
    playerSaves.delete(roleId)
    autoSaveTokens.delete(roleId)
  },

  clearArchive(role: Role): void {
    // Clears persistent storage and resets in-memory cache for this role.
    // Runtime world state is not automatically reset; caller may reload if desired.
    const roleId = role.get_roleid()
    playerSaves.delete(roleId)
    if (!canUseArchives()) return
    try {
      safeSetPlayerSaveJson(role, "")
    } catch {
      // ignore
    }
  },

  startAutoSave(role: Role): void {
    scheduleAutoSave(role)
  },
}
