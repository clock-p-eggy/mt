import { PrefabRegistry } from "../config"
import { safeCreateCustomTriggerSpace, safeDestroyUnit } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { EconomySystem } from "./EconomySystem"
import { AnimalSystem } from "./AnimalSystem"
import { EntityFactory } from "./EntityFactory"
import { PlotSystem } from "./PlotSystem"
import { MapGenerator } from "./MapGenerator"
import { GameEvents } from "../utils"

type UnitId = number

interface AnimalWalletData {
  unitId: UnitId
  ownerRoleId: RoleID
  plotId: string

  storedCoins: number
  lastKnownIncomePerSecond: number
  coinVisuals: CoinVisualData[]

  collectTrigger?: CustomTriggerSpace
  collectEnterEventId?: number
  collectLeaveEventId?: number
}

interface CoinVisualData {
  obstacle: Obstacle
  value: number
  spinAngle: number
  createdSeq: number
}

const wallets: Map<UnitId, AnimalWalletData> = new Map()
const COIN_VALUE_PER_VISUAL = 10
const CHEST_VALUE_PER_VISUAL = 100
const COIN_DROP_DURATION = math.toreal(0.35)
const COIN_FLY_DURATION = math.toreal(0.4)
const COIN_SPIN_SPEED = Math.PI * 1.4
const MAX_SCENE_COIN_VISUALS = 100
const MAX_PLOT_COIN_VISUALS = 10
const COIN_PREFAB_KEY = 1073963079 as UnitKey
const DIAMOND_PREFAB_KEY = 1073967135 as UnitKey
const CHEST_PREFAB_KEY = 1073971315 as UnitKey
const COIN_VISUAL_SCALE = math.Vector3(0.5, 0.5, 0.5)
const CHEST_VISUAL_SCALE = math.Vector3(0.35, 0.35, 0.35)
const DEFAULT_VISUAL_ROTATION = math.Quaternion(0, 0, 0)
const COLLECT_TEXT_COLOR: Color = 0xff8d0a

let spinLoopStarted = false
let coinVisualSeq = 0

function findRoleByLifeEntity(unit: LifeEntity): Role | null {
  const roles = GameAPI.get_all_roles()
  for (const role of roles) {
    if (role.get_ctrl_unit() === unit) {
      return role
    }
  }
  return null
}

function showCollectDynamicText(role: Role, amount: number): void {
  const ctrl = role.get_ctrl_unit()
  const rolePos = ctrl.get_position()
  const textPos = math.Vector3(rolePos.x, rolePos.y + 1.4, rolePos.z)
  role.show_dynamic_text(`+$${amount}`, textPos, COLLECT_TEXT_COLOR, 0.5 as Fixed, 1)
}

function resolveCoinPrefab(): { key: UnitKey; scale: Vector3; rotation: Quaternion } | null {
  return { key: COIN_PREFAB_KEY, scale: COIN_VISUAL_SCALE, rotation: DEFAULT_VISUAL_ROTATION }
}

function resolveDiamondPrefab(): { key: UnitKey; scale: Vector3; rotation: Quaternion } | null {
  return { key: DIAMOND_PREFAB_KEY, scale: COIN_VISUAL_SCALE, rotation: DEFAULT_VISUAL_ROTATION }
}

function resolveChestPrefab(): { key: UnitKey; scale: Vector3; rotation: Quaternion } | null {
  return { key: CHEST_PREFAB_KEY, scale: CHEST_VISUAL_SCALE, rotation: DEFAULT_VISUAL_ROTATION }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpPos(a: Vector3, b: Vector3, t: number): Vector3 {
  return math.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}

function randomCoinScatterPos(basePos: Vector3): Vector3 {
  const angle = (GameAPI.random_int(0, 10000) / 10000) * Math.PI * 2
  const radius = 0.5 + Math.sqrt(GameAPI.random_int(0, 10000) / 10000) * 1.5
  return math.Vector3(basePos.x + Math.cos(angle) * radius, basePos.y + 0.12, basePos.z + Math.sin(angle) * radius)
}

function updateCoinSpin(visual: CoinVisualData, deltaSeconds: number): void {
  visual.spinAngle += deltaSeconds * COIN_SPIN_SPEED
  try {
    visual.obstacle.set_orientation(math.Quaternion(0, visual.spinAngle, 0))
  } catch {
    return
  }
}

function getTotalCoinVisualCount(): number {
  let total = 0
  for (const wallet of wallets.values()) {
    total += wallet.coinVisuals.length
  }
  return total
}

function getPlotCoinVisualCount(plotId: string): number {
  let total = 0
  for (const wallet of wallets.values()) {
    if (wallet.plotId !== plotId) continue
    total += wallet.coinVisuals.length
  }
  return total
}

function isChestVisual(visual: CoinVisualData): boolean {
  return visual.value >= CHEST_VALUE_PER_VISUAL
}

function removeOldestCoinVisual(filter?: (wallet: AnimalWalletData) => boolean): boolean {
  let targetWallet: AnimalWalletData | null = null
  let targetIndex = -1
  let oldestSeq = 0

  for (const wallet of wallets.values()) {
    if (filter !== undefined && !filter(wallet)) continue
    for (let i = 0; i < wallet.coinVisuals.length; i++) {
      const visual = wallet.coinVisuals[i]!
      if (isChestVisual(visual)) continue
      if (targetWallet === null || visual.createdSeq < oldestSeq) {
        targetWallet = wallet
        targetIndex = i
        oldestSeq = visual.createdSeq
      }
    }
  }

  if (targetWallet === null || targetIndex < 0) return false
  const removed = targetWallet.coinVisuals.splice(targetIndex, 1)[0]
  if (removed !== undefined) {
    safeDestroyUnit(removed.obstacle)
  }
  return true
}

function enforceCoinVisualLimits(plotId: string): void {
  while (getPlotCoinVisualCount(plotId) > MAX_PLOT_COIN_VISUALS) {
    if (!removeOldestCoinVisual((wallet) => wallet.plotId === plotId)) break
  }
  while (getTotalCoinVisualCount() > MAX_SCENE_COIN_VISUALS) {
    if (!removeOldestCoinVisual()) break
  }
}

function ensureSpinLoop(): void {
  if (spinLoopStarted) return
  spinLoopStarted = true

  const tickS = math.toreal(0.03)
  function tick(): void {
    for (const wallet of wallets.values()) {
      for (let i = 0; i < wallet.coinVisuals.length; i++) {
        updateCoinSpin(wallet.coinVisuals[i]!, tickS)
      }
    }
    LuaAPI.call_delay_time(tickS, tick)
  }

  LuaAPI.call_delay_time(tickS, tick)
}

function animateCoin(coin: Obstacle, fromPos: Vector3, toPos: Vector3, duration: number, arcHeight: number, onDone?: () => void): void {
  try {
    coin.set_position(toPos)
  } catch {
    // ignore
  }
  if (onDone !== undefined) {
    LuaAPI.call_delay_time(math.toreal(Math.max(0, duration)), onDone)
  }
}

function spawnCoinVisual(creature: Creature, wallet: AnimalWalletData, value: number): void {
  const prefab = value >= CHEST_VALUE_PER_VISUAL ? resolveChestPrefab() : resolveCoinPrefab()
  if (prefab === null) return

  const creaturePos = creature.get_position()
  const startPos = math.Vector3(creaturePos.x, creaturePos.y + 1.35, creaturePos.z)
  const endPos = randomCoinScatterPos(creaturePos)

  let coin: Obstacle
  try {
    coin = GameAPI.create_obstacle(prefab.key, startPos, prefab.rotation, prefab.scale)
  } catch (e) {
    GlobalAPI.warning(`[AnimalWallet] create coin visual failed: ${tostring(e)}`)
    return
  }

  try {
    coin.disable_interact()
    coin.set_interact_enabled(false)
    coin.disable_gravity()
    coin.set_physics_active(false)
  } catch {
    // ignore
  }

  const plot = MapGenerator.getPlotById(wallet.ownerRoleId, wallet.plotId)
  if (plot !== undefined) {
    try {
      plot.obstacle.add_child(coin)
    } catch {
      // ignore
    }
    try {
      coin.set_position(startPos)
    } catch {
      // ignore
    }
  }

  wallet.coinVisuals.push({
    obstacle: coin,
    value,
    spinAngle: 0,
    createdSeq: coinVisualSeq++,
  })
  enforceCoinVisualLimits(wallet.plotId)
  animateCoin(coin, startPos, endPos, COIN_DROP_DURATION, 0.35)
}

function syncCoinVisuals(creature: Creature, wallet: AnimalWalletData): void {
  const desiredChestCount = Math.floor(wallet.storedCoins / CHEST_VALUE_PER_VISUAL)
  const desiredCoinCount = Math.floor((wallet.storedCoins % CHEST_VALUE_PER_VISUAL) / COIN_VALUE_PER_VISUAL)

  let currentChestCount = 0
  let currentCoinCount = 0
  for (let i = 0; i < wallet.coinVisuals.length; i++) {
    const visual = wallet.coinVisuals[i]!
    if (visual.value >= CHEST_VALUE_PER_VISUAL) currentChestCount += 1
    else currentCoinCount += 1
  }

  while (currentChestCount < desiredChestCount) {
    spawnCoinVisual(creature, wallet, CHEST_VALUE_PER_VISUAL)
    currentChestCount += 1
  }
  while (currentCoinCount < desiredCoinCount) {
    spawnCoinVisual(creature, wallet, COIN_VALUE_PER_VISUAL)
    currentCoinCount += 1
  }

  while (currentCoinCount > desiredCoinCount) {
    let removed = false
    for (let i = wallet.coinVisuals.length - 1; i >= 0; i--) {
      const visual = wallet.coinVisuals[i]!
      if (isChestVisual(visual)) continue
      wallet.coinVisuals.splice(i, 1)
      currentCoinCount -= 1
      safeDestroyUnit(visual.obstacle)
      removed = true
      break
    }
    if (!removed) break
  }
}

function playCollectCoinFly(role: Role, wallet: AnimalWalletData): void {
  const visuals = wallet.coinVisuals.splice(0, wallet.coinVisuals.length)
  for (let i = 0; i < visuals.length; i++) {
    const coin = visuals[i]!.obstacle
    safeDestroyUnit(coin)
  }
}

function ensureCollectTrigger(creature: Creature, data: AnimalWalletData): void {
  if (data.collectTrigger !== undefined) return

  const triggerKey = PrefabRegistry.zone.plot
  const plot = MapGenerator.getPlotById(data.ownerRoleId, data.plotId)
  const basePos = plot === undefined ? creature.get_position() : plot.obstacle.get_position()
  const plotScale = plot === undefined ? math.Vector3(4, 2, 4) : plot.obstacleScale
  const triggerPos = math.Vector3(basePos.x, basePos.y + 0.8, basePos.z)
  const triggerScale = math.Vector3(Math.max(plotScale.x, 4), 2.4, Math.max(plotScale.z, 4))

  const trigger = safeCreateCustomTriggerSpace(triggerKey, triggerPos, triggerScale, {
    tag: `[AnimalWallet] create_customtriggerspace key=${tostring(triggerKey)}`,
  }) as CustomTriggerSpace | null
  if (trigger === null) return

  try {
    trigger.set_kv_by_type(Enums.ValueType.Str, "zoneType", "animal_collect")
    trigger.set_kv_by_type(Enums.ValueType.Int, "unitId", data.unitId)
  } catch {
    // ignore
  }

  try {
    creature.add_child(trigger)
  } catch {
    // ignore
  }

  // Re-apply world position after parenting.
  try {
    trigger.set_position(triggerPos)
  } catch {
    // ignore
  }

  const zoneId = trigger.get_id()
  let enterId: number | undefined
  let leaveId: number | undefined

  try {
    const regId = TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, zoneId],
      function (_event_name: unknown, _actor: unknown, evt: { event_unit: LifeEntity }) {
        const role = findRoleByLifeEntity(evt.event_unit)
        if (role === null) return

        // Only the owner can collect.
        if (role.get_roleid() !== data.ownerRoleId) return

        AnimalWalletSystem.collect(role, data.unitId)
      }
    )
    enterId = regId === null ? undefined : regId
  } catch (e) {
    GlobalAPI.warning(`[AnimalWallet] register ENTER failed unitId=${tostring(data.unitId)} err=${tostring(e)}`)
  }

  // LEAVE exists mainly to enforce "leave then re-enter" semantics in the future.
  // For now, ENTER already naturally fires only once per overlap.
  try {
    const regId = TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.LEAVE, zoneId],
      function (_event_name: unknown, _actor: unknown, _evt: { event_unit: LifeEntity }) {
        // no-op
      }
    )
    leaveId = regId === null ? undefined : regId
  } catch (e) {
    GlobalAPI.warning(`[AnimalWallet] register LEAVE failed unitId=${tostring(data.unitId)} err=${tostring(e)}`)
  }

  data.collectTrigger = trigger
  if (enterId !== undefined) data.collectEnterEventId = enterId
  if (leaveId !== undefined) data.collectLeaveEventId = leaveId
}

function cleanupWallet(unitId: UnitId): void {
  const data = wallets.get(unitId)
  if (data === undefined) return

  if (data.collectEnterEventId !== undefined) {
    TriggerHub.unregister(data.collectEnterEventId, {
      safe: true,
      logger: (msg) => GlobalAPI.warning(`[AnimalWallet] ${msg} unitId=${tostring(unitId)}`),
    })
  }
  if (data.collectLeaveEventId !== undefined) {
    TriggerHub.unregister(data.collectLeaveEventId, {
      safe: true,
      logger: (msg) => GlobalAPI.warning(`[AnimalWallet] ${msg} unitId=${tostring(unitId)}`),
    })
  }
  if (data.collectTrigger !== undefined) {
    safeDestroyUnit(data.collectTrigger, {
      tag: `[AnimalWallet] destroy collect trigger unitId=${tostring(unitId)}`,
    })
  }
  for (let i = 0; i < data.coinVisuals.length; i++) {
    safeDestroyUnit(data.coinVisuals[i]!.obstacle)
  }

  wallets.delete(unitId)
}

export const AnimalWalletSystem = {
  /**
   * Tick wallet accumulation for animals owned by this role.
   * Coins are stored on each animal, NOT directly added to the player.
   */
  tick(role: Role, deltaSeconds: number): void {
    ensureSpinLoop()
    const roleId = role.get_roleid()
    const animals = AnimalSystem.getAnimalsByOwner(role)

    const aliveUnitIds = new Set<number>()

    for (const animal of animals) {
      const unitId = LuaAPI.get_unit_id(animal.creature)
      aliveUnitIds.add(unitId)

      let wallet = wallets.get(unitId)
      if (wallet === undefined) {
        wallet = {
          unitId,
          ownerRoleId: roleId,
          plotId: animal.plotId,
          storedCoins: 0,
          lastKnownIncomePerSecond: 0,
          coinVisuals: [],
        }
        wallets.set(unitId, wallet)
      } else {
        wallet.plotId = animal.plotId
        wallet.ownerRoleId = roleId
      }

      const baseIncome = EntityFactory.getAnimalIncome(animal.creature)
    const multiplier = PlotSystem.getPlotMultiplier(roleId, animal.plotId)
      const incomePerSecond = baseIncome * multiplier
      wallet.lastKnownIncomePerSecond = incomePerSecond

      if (incomePerSecond > 0) {
        const gained = Math.floor(incomePerSecond * deltaSeconds)
        if (gained > 0) {
          wallet.storedCoins += gained
        }
      }

      syncCoinVisuals(animal.creature, wallet)
      ensureCollectTrigger(animal.creature, wallet)
    }

    // Cleanup wallets for animals that no longer exist for this owner.
    for (const [unitId, wallet] of wallets) {
      if (wallet.ownerRoleId !== roleId) continue
      if (!aliveUnitIds.has(unitId)) {
        cleanupWallet(unitId)
      }
    }
  },

  getStoredCoins(unitId: number): number {
    const data = wallets.get(unitId)
    if (data === undefined) return 0
    return data.storedCoins
  },

  getIncomePerSecond(unitId: number): number {
    const data = wallets.get(unitId)
    if (data === undefined) return 0
    return data.lastKnownIncomePerSecond
  },

  cleanupOwner(ownerRoleId: RoleID): void {
    const toDelete: number[] = []
    for (const [unitId, wallet] of wallets) {
      if (wallet.ownerRoleId === ownerRoleId) {
        toDelete.push(unitId)
      }
    }
    for (const unitId of toDelete) {
      cleanupWallet(unitId)
    }
  },

  exportPendingCoinsByPlot(ownerRoleId: RoleID): Record<string, number> {
    const result: Record<string, number> = {}
    for (const wallet of wallets.values()) {
      if (wallet.ownerRoleId !== ownerRoleId) continue
      if (wallet.storedCoins <= 0) continue

      const existing = result[wallet.plotId]
      result[wallet.plotId] = (existing === undefined ? 0 : existing) + wallet.storedCoins
      wallet.storedCoins = 0
      for (let i = 0; i < wallet.coinVisuals.length; i++) {
        safeDestroyUnit(wallet.coinVisuals[i]!.obstacle)
      }
      wallet.coinVisuals = []
    }
    return result
  },

  collect(role: Role, unitId: number): number {
    const data = wallets.get(unitId)
    if (data === undefined) return 0
    if (role.get_roleid() !== data.ownerRoleId) return 0

    const amount = data.storedCoins
    if (amount <= 0) return 0

    playCollectCoinFly(role, data)
    data.storedCoins = 0
    EconomySystem.addCoins(role, amount)
    showCollectDynamicText(role, amount)
    EventBus.emit(GameEvents.WALLET_COINS_COLLECTED, role, amount, data.plotId)
    return amount
  },
}
