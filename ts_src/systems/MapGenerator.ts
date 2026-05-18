import { log } from "@common/utils"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { ExcelData, GameConfig, PlotGridLayout, getEggActualPrice, getEggTypeById, getPlotTypeById, PrefabRegistry } from "../config"
import { GameEvents } from "../utils"
import { EconomySystem } from "./EconomySystem"
import { InventorySystem } from "./InventorySystem"
import { PlayerSaveSystem } from "./PlayerSaveSystem"
import { PlotKey, makePlotKey } from "../utils/plotKey"

function isEggObstacle(obstacle: Obstacle): boolean {
  const key = obstacle.get_key() as unknown as number
  for (const k in PrefabRegistry.egg) {
    const v = (PrefabRegistry.egg as unknown as Record<string, number>)[k]
    if (v === key) return true
  }
  return false
}

export interface PlotData {
  ownerRoleId: RoleID
  id: string
  row: number
  col: number
  plotTypeId: number
  isUnlocked: boolean
  hasAnimal: boolean
  animalUnitId: number | null
  obstacle: Obstacle
  salePlaceholder?: Obstacle | null
  trigger: CustomTriggerSpace | null
  triggerEnterEventId: number | null
  triggerLeaveEventId: number | null
  obstacleScale: Vector3
}

const plotsByOwner: Map<RoleID, Map<string, PlotData>> = new Map()
let superPlotData: PlotData | null = null
let superPlotLevel = 0

function getOrCreateOwnerPlots(ownerRoleId: RoleID): Map<string, PlotData> {
  let m = plotsByOwner.get(ownerRoleId)
  if (m === undefined) {
    m = new Map()
    plotsByOwner.set(ownerRoleId, m)
  }
  return m
}

function getOwnerPlots(ownerRoleId: RoleID): Map<string, PlotData> | undefined {
  return plotsByOwner.get(ownerRoleId)
}

function parseUnsignedInt10(s: string): number | null {
  if (s.length === 0) return null
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return null
    n = n * 10 + (c - 48)
  }
  return n
}

function parseSpecialPlotIdFromPlotId(plotId: string): number | null {
  if (plotId.indexOf("sp:") !== 0) return null
  return parseUnsignedInt10(plotId.slice(3))
}

type ObstacleInteractionHandler = (data: {
  interact_lifeentity: LifeEntity
  interact_unit: Obstacle
  interact_id: InteractBtnID
}) => void

let obstacleInteractionHandler: ObstacleInteractionHandler | null = null
let mineZoneId: CustomTriggerSpaceID | null = null

const roleLastPlotId: Map<RoleID, PlotKey | null> = new Map()

const usedObstacleUnitIds: Set<number> = new Set()


const authoredSceneSearchCenter = math.Vector3(21.5, 0.25, -2)
const authoredSceneSearchHalfExtents = {
  x: math.tofixed(300),
  y: math.tofixed(80),
  z: math.tofixed(300),
} as const
const fallbackSceneOriginRot = math.Quaternion(0, 0, 0)

type ConveyorRuntime = {
  group: Unit
  startPos: Vector3
  endZone: CustomTriggerSpace
  endEnterTriggerId: number | null
}

const conveyorByOwner: Map<RoleID, ConveyorRuntime> = new Map()

type ShopRuntime = {
  group: Unit
  triggerZone: CustomTriggerSpace
  enterTriggerId: number | null
}

const shopByOwner: Map<RoleID, ShopRuntime> = new Map()

type GroundRuntime = {
  group: Unit
}

const groundByOwner: Map<RoleID, GroundRuntime> = new Map()
const defaultPlotScale = math.Vector3(4, 2, 4)
const namedPremiumPlotScale = math.Vector3(12, 1, 12)
const plotVisualYOffset = 0

type NamedPremiumPlotDef = {
  id: string
  obstacle: Obstacle
}

const namedPremiumPlotNames = [
  "高级地块1",
  "高级地块2",
  "高级地块3",
  "高级地块4",
  "高级地块5",
  "高级地块6",
] as const

// Eggs spawned by the conveyor spawner (tracked for cap + cleanup).
// NOTE: in this runtime, Set/Map keys must be primitive (string/number), so we track by UnitID.
const conveyorEggIdsAll: Set<number> = new Set()
const conveyorEggIdsByOwner: Map<RoleID, Set<number>> = new Map()
const conveyorEggById: Map<number, Obstacle> = new Map()
const conveyorEggOwnerById: Map<number, RoleID> = new Map()

// Egg price SceneUI (not bound; positioned per-role every tick)
const eggPriceLayerByEggId: Map<number, E3DLayer> = new Map()
const eggIdByEggPriceLayer: Map<string, number> = new Map()
let eggPriceUiTickStarted = false
const EGG_PRICE_UI_SHOW_DISTANCE = 8
const CONVEYOR_EGG_BIRTH_JUMP_DELAY = math.toreal(4)
const CONVEYOR_EGG_BIRTH_JUMP_DURATION = 0.5
const CONVEYOR_EGG_BIRTH_JUMP_TICK = math.toreal(0.033)
const CONVEYOR_EGG_BIRTH_JUMP_HEIGHT = 2.0

function getOrCreateConveyorEggIdSet(ownerRoleId: RoleID): Set<number> {
  let s = conveyorEggIdsByOwner.get(ownerRoleId)
  if (s === undefined) {
    s = new Set()
    conveyorEggIdsByOwner.set(ownerRoleId, s)
  }
  return s
}

function removeConveyorEggById(eggId: number): void {
  const layer = eggPriceLayerByEggId.get(eggId)
  if (layer !== undefined) {
    eggPriceLayerByEggId.delete(eggId)
    eggIdByEggPriceLayer.delete(layer)
    try {
      GameAPI.destroy_scene_ui(layer)
    } catch {
      // ignore
    }
  }

  conveyorEggIdsAll.delete(eggId)
  conveyorEggById.delete(eggId)
  const ownerRoleId = conveyorEggOwnerById.get(eggId)
  conveyorEggOwnerById.delete(eggId)

  if (ownerRoleId === undefined) return
  const s = conveyorEggIdsByOwner.get(ownerRoleId)
  if (s === undefined) return
  s.delete(eggId)
  if (s.size === 0) conveyorEggIdsByOwner.delete(ownerRoleId)
}

function pruneConveyorEggs(): void {
  const toDelete: number[] = []
  for (const eggId of conveyorEggIdsAll) {
    const egg = conveyorEggById.get(eggId)
    if (egg === undefined) {
      toDelete.push(eggId)
      continue
    }
    try {
      egg.get_position()
    } catch {
      toDelete.push(eggId)
    }
  }

  for (const eggId of toDelete) {
    removeConveyorEggById(eggId)
  }
}

function removeConveyorEgg(egg: Obstacle): void {
  let eggId: number | null = null
  try {
    eggId = LuaAPI.get_unit_id(egg)
  } catch {
    eggId = null
  }
  if (eggId === null) return
  removeConveyorEggById(eggId)
}

function canSpawnConveyorEggForOwner(ownerRoleId: RoleID): boolean {
  const s = conveyorEggIdsByOwner.get(ownerRoleId)
  const count = s === undefined ? 0 : s.size
  return count < GameConfig.CONVEYOR_EGG_CAP
}

function scheduleConveyorEggBirthJump(eggId: number, egg: Obstacle): void {
  LuaAPI.call_delay_time(CONVEYOR_EGG_BIRTH_JUMP_DELAY, () => {
    if (conveyorEggById.get(eggId) !== egg) return

    let elapsed = 0
    let lastYOffset = 0

    function tick(): void {
      if (conveyorEggById.get(eggId) !== egg) return

      elapsed += CONVEYOR_EGG_BIRTH_JUMP_TICK
      const t = Math.min(1, elapsed / CONVEYOR_EGG_BIRTH_JUMP_DURATION)
      const yOffset = Math.sin(t * Math.PI) * CONVEYOR_EGG_BIRTH_JUMP_HEIGHT

      try {
        const cur = egg.get_position()
        const baseY = cur.y - lastYOffset
        egg.set_position(math.Vector3(cur.x, baseY + yOffset, cur.z))
      } catch {
        return
      }

      lastYOffset = yOffset

      if (t < 1) {
        LuaAPI.call_delay_time(CONVEYOR_EGG_BIRTH_JUMP_TICK, tick)
      }
    }

    tick()
  })
}

function startEggPriceUiTick(): void {
  if (eggPriceUiTickStarted) return
  eggPriceUiTickStarted = true

  const tickInterval = math.toreal(0.05)

  function tick(): void {
    // roleId -> role
    const roleMap: Map<RoleID, Role> = new Map()
    try {
      const roles = GameAPI.get_all_roles()
      for (const r of roles) {
        roleMap.set(r.get_roleid(), r)
      }
    } catch {
      // ignore
    }

    const toRemove: number[] = []
    for (const eggId of eggPriceLayerByEggId.keys()) {
      const egg = conveyorEggById.get(eggId)
      const layer = eggPriceLayerByEggId.get(eggId)
      if (egg === undefined || layer === undefined) {
        toRemove.push(eggId)
        continue
      }

      let ownerRoleId: RoleID | null = null
      const o = conveyorEggOwnerById.get(eggId)
      if (o !== undefined) ownerRoleId = o
      if (ownerRoleId === null) continue

      const role = roleMap.get(ownerRoleId)
      if (role === undefined) continue

      try {
        const eggPos = egg.get_position()
        const rolePos = role.get_ctrl_unit().get_position()
        let dir = normalizeXZ(subtract(rolePos, eggPos))
        if (lengthXZ(dir) <= 0.00001) {
          dir = math.Vector3(0, 0, 1)
        }
        // Place on the player's side of the egg to reduce "skew"/occlusion.
        const desired = add(eggPos, add(multiply(dir, 0.7), math.Vector3(0, 1.1, 0)))
        GameAPI.set_scene_ui_position(role, layer, desired)

        const dx = rolePos.x - eggPos.x
        const dy = rolePos.y - eggPos.y
        const dz = rolePos.z - eggPos.z
        const visible = dx * dx + dy * dy + dz * dz <= EGG_PRICE_UI_SHOW_DISTANCE * EGG_PRICE_UI_SHOW_DISTANCE
        GameAPI.set_scene_ui_visible(layer, role, visible)
      } catch {
        // ignore
      }
    }

    for (let i = 0; i < toRemove.length; i++) {
      removeConveyorEggById(toRemove[i]!)
    }

    LuaAPI.call_delay_time(tickInterval, tick)
  }

  LuaAPI.call_delay_time(tickInterval, tick)
}



function registerObstacleInteraction(obstacle: Obstacle): void {
  if (obstacleInteractionHandler === null) return

  try {
    obstacle.enable_interact()
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] register obstacle trigger failed: ${tostring(e)}`)
  }
}

function getPlotId(row: number, col: number): string {
  return `${row}_${col}`
}

function safeCreateObstacle(uKey: UnitKey, pos: Vector3, scale: Vector3): Obstacle | null {
  try {
    return GameAPI.create_obstacle(uKey, pos, math.Quaternion(0, 0, 0), scale) as Obstacle
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] create_obstacle key=${tostring(uKey)} err=${tostring(e)}`)
    return null
  }
}

function safeDestroyUnit(unit: Unit): void {
  try {
    GameAPI.destroy_unit(unit)
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] destroy_unit err=${tostring(e)}`)
  }
}

function applyPlotVisualOffset(pos: Vector3): Vector3 {
  return math.Vector3(pos.x, pos.y + plotVisualYOffset, pos.z)
}

function hashStringSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 131 + input.charCodeAt(i)) % 1000003
  }
  return hash
}

function seededUnitFloat(seed: number): number {
  const next = (seed * 1103515245 + 12345) % 2147483647
  return next / 2147483647
}

function getPlotPlaceholderTransform(plotId: string): { rotation: Quaternion; scale: Vector3 } {
  const seed = hashStringSeed(plotId)
  const scaleT = seededUnitFloat(seed)
  const rotationT = seededUnitFloat(seed ^ 0x9e3779b9)
  const uniformScale = 0.7 + scaleT * 0.5
  const yaw = (rotationT - 0.5) * (Math.PI / 5)
  return {
    rotation: math.Quaternion(0, yaw, 0),
    scale: math.Vector3(uniformScale, uniformScale, uniformScale),
  }
}

function getBoolKvSafe(unit: Unit, key: string): boolean {
  try {
    if (unit.has_kv(key) !== true) return false
  } catch {
    return false
  }

  try {
    return unit.get_kv_by_type(Enums.ValueType.Bool, key) === true
  } catch {
    return false
  }
}


function safeCreateCustomTriggerSpace(
  uKey: CustomTriggerSpaceKey,
  pos: Vector3,
  scale: Vector3
): CustomTriggerSpace | null {
  try {
    return GameAPI.create_customtriggerspace(uKey, pos, math.Quaternion(0, 0, 0), scale) as CustomTriggerSpace
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] create_customtriggerspace key=${tostring(uKey)} err=${tostring(e)}`)
    return null
  }
}

function createPlotSalePlaceholder(plot: PlotData): void {
  if (plot.salePlaceholder !== null && plot.salePlaceholder !== undefined) return

  const pos = plot.obstacle.get_position()
  const placeholderPos = math.Vector3(pos.x, pos.y + 0.15, pos.z)
  const transform = getPlotPlaceholderTransform(plot.id)
  let placeholder: Obstacle
  try {
    placeholder = GameAPI.create_obstacle(
      PrefabRegistry.plot.forSale as unknown as UnitKey,
      placeholderPos,
      transform.rotation,
      transform.scale
    )
  } catch (e) {
    log(`[PlotSale] create_obstacle failed: plotId=${plot.id} prefabId=${tostring(PrefabRegistry.plot.forSale)} err=${tostring(e)}`)
    return
  }

  try {
    placeholder.disable_interact()
    placeholder.set_interact_enabled(false)
  } catch (e) {
    log(`[PlotSale] disable interact failed: ${tostring(e)}`)
  }

  try {
    placeholder.disable_gravity()
    placeholder.set_physics_active(false)
  } catch {
    // ignore
  }

  try {
    plot.obstacle.add_child(placeholder)
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] add_child sale placeholder failed: plotId=${plot.id} err=${tostring(e)}`)
  }

  try {
    placeholder.set_position(placeholderPos)
  } catch {
    // ignore
  }

  placeholder.set_kv_by_type(Enums.ValueType.Str, "plotId", plot.id)
  placeholder.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", plot.ownerRoleId)
  plot.salePlaceholder = placeholder
}

function registerPlotTrigger(trigger: CustomTriggerSpace, ownerRoleId: RoleID, plotId: string): {
  enterId: number | null
  leaveId: number | null
} {
  const zoneId = trigger.get_id()

  const plotKey = makePlotKey(ownerRoleId, plotId)

  let enterId: number | null = null
  let leaveId: number | null = null

  try {
    enterId = TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, zoneId],
      function (_event_name: unknown, _actor: unknown, data: { event_unit: LifeEntity }) {
        const roles = GameAPI.get_all_roles()
        for (const role of roles) {
          if (role.get_ctrl_unit() === data.event_unit) {
            const roleId = role.get_roleid()
            const cached = roleLastPlotId.get(roleId)
            const lastKey = cached === undefined ? null : cached
            if (lastKey === plotKey) {
              return
            }
            roleLastPlotId.set(roleId, plotKey)
            EventBus.emit(GameEvents.PLOT_SELECTED, plotKey, role)
            return
          }
        }
      }
    )
  } catch (e) {
    GlobalAPI.warning(`[PlotTrigger] register ENTER failed plotKey=${plotKey} err=${tostring(e)}`)
  }

  try {
    leaveId = TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.LEAVE, zoneId],
      function (_event_name: unknown, _actor: unknown, data: { event_unit: LifeEntity }) {
        const roles = GameAPI.get_all_roles()
        for (const role of roles) {
          if (role.get_ctrl_unit() === data.event_unit) {
            roleLastPlotId.set(role.get_roleid(), null)
            EventBus.emit(GameEvents.PLOT_UNSELECTED, plotKey, role)
            return
          }
        }
      }
    )
  } catch (e) {
    GlobalAPI.warning(`[PlotTrigger] register LEAVE failed plotKey=${plotKey} err=${tostring(e)}`)
  }

  return { enterId, leaveId }
}

function safeCreateUnitGroup(uKey: UnitGroupKey, pos: Vector3, rot: Quaternion): Unit | null {
  try {
    return GameAPI.create_unit_group(uKey, pos, rot) as Unit
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] create_unit_group key=${tostring(uKey)} err=${tostring(e)}`)
    return null
  }
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return math.Vector3(a.x - b.x, a.y - b.y, a.z - b.z)
}

function add(a: Vector3, b: Vector3): Vector3 {
  return math.Vector3(a.x + b.x, a.y + b.y, a.z + b.z)
}

function multiply(v: Vector3, s: number): Vector3 {
  return math.Vector3(v.x * s, v.y * s, v.z * s)
}

function dotXZ(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.z * b.z
}

function quatClone(q: Quaternion): Quaternion {
  return math.Quaternion(q.x, q.y, q.z, q.w)
}

function quatInverse(q: Quaternion): Quaternion {
  const out = quatClone(q)
  out.inverse()
  return out
}

function quatMultiply(a: Quaternion, b: Quaternion): Quaternion {
  const ax = a.x
  const ay = a.y
  const az = a.z
  const aw = a.w

  const bx = b.x
  const by = b.y
  const bz = b.z
  const bw = b.w

  const x = aw * bx + ax * bw + ay * bz - az * by
  const y = aw * by - ax * bz + ay * bw + az * bx
  const z = aw * bz + ax * by - ay * bx + az * bw
  const w = aw * bw - ax * bx - ay * by - az * bz
  return math.Quaternion(x, y, z, w)
}

function findChildObstacleByName(group: Unit, childName: string): Obstacle | null {
  const obstacles = group.get_child_obstacles()
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!
    if (o.get_name() === childName) return o
  }
  return null
}

function findChildUnitByName(group: Unit, childName: string): Unit | null {
  const children = group.get_children()
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (child.get_name() === childName) return child
  }
  return null
}

function findChildObstacleByNames(group: Unit, names: ReadonlyArray<string>): Obstacle | null {
  const obstacles = group.get_child_obstacles()
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!
    const n = o.get_name()
    for (let j = 0; j < names.length; j++) {
      if (n === names[j]) return o
    }
  }
  return null
}

function collectNamedPremiumPlotsFromObstacles(obstacles: ReadonlyArray<Obstacle>): NamedPremiumPlotDef[] {
  const out: NamedPremiumPlotDef[] = []

  for (let i = 0; i < namedPremiumPlotNames.length; i++) {
    const expectedName = namedPremiumPlotNames[i]!
    for (let j = 0; j < obstacles.length; j++) {
      const obstacle = obstacles[j]!
      if (obstacle.get_name() !== expectedName) continue
      out.push({
        id: `premium_${String(i + 1)}`,
        obstacle,
      })
      break
    }
  }

  return out
}

function collectNamedPremiumPlots(group: Unit, scanCenter: Vector3): NamedPremiumPlotDef[] {
  const groupObstacles = group.get_child_obstacles()
  const inGroup = collectNamedPremiumPlotsFromObstacles(groupObstacles)
  if (inGroup.length > 0) return inGroup

  try {
    const nearby = GameAPI.get_obstacles_in_aabb(scanCenter, math.tofixed(200), math.tofixed(20), math.tofixed(200))
    return collectNamedPremiumPlotsFromObstacles(nearby)
  } catch {
    return []
  }
}

function alignGroupToNamedOriginObstacle(
  group: Unit,
  originObstacleName: string,
  targetPos: Vector3,
  targetRot: Quaternion,
  opts?: { destroyOrigin?: boolean }
): boolean {
  const origin = findChildUnitByName(group, originObstacleName)
  if (origin === null) return false

  const groupPos = group.get_position()
  const groupRot = group.get_orientation()
  const originPos = origin.get_position()
  const originRot = origin.get_orientation()

  const invGroupRot = quatInverse(groupRot)
  const originLocalPos = invGroupRot.apply(subtract(originPos, groupPos))
  const originLocalRot = quatMultiply(invGroupRot, originRot)

  const invOriginLocalRot = quatInverse(originLocalRot)
  const newGroupRot = quatMultiply(targetRot, invOriginLocalRot)
  const newGroupPos = subtract(targetPos, newGroupRot.apply(originLocalPos))

  group.set_orientation(newGroupRot)
  group.set_position(newGroupPos)

  if (opts?.destroyOrigin !== false) {
    try {
      GameAPI.destroy_unit(origin)
    } catch {
      // ignore
    }
  }

  return true
}

function findWorldObstacleByNames(names: ReadonlyArray<string>, scanCenter?: Vector3): Obstacle | null {
  try {
    const center = scanCenter === undefined ? authoredSceneSearchCenter : scanCenter
    const obstacles = GameAPI.get_obstacles_in_aabb(
      center,
      authoredSceneSearchHalfExtents.x,
      authoredSceneSearchHalfExtents.y,
      authoredSceneSearchHalfExtents.z
    )
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i]!
      const obstacleName = obstacle.get_name()
      for (let j = 0; j < names.length; j++) {
        if (obstacleName === names[j]) return obstacle
      }
    }
  } catch {
    // ignore
  }
  return null
}

function resolveSceneOrigin(names: ReadonlyArray<string>, fallbackPos?: Vector3): { pos: Vector3; rot: Quaternion } {
  const fallback = fallbackPos === undefined ? authoredSceneSearchCenter : fallbackPos
  const obstacle = findWorldObstacleByNames(names, fallback)
  if (obstacle === null) {
    return { pos: fallback, rot: fallbackSceneOriginRot }
  }
  try {
    return {
      pos: obstacle.get_position(),
      rot: obstacle.get_orientation(),
    }
  } catch {
    return { pos: fallback, rot: fallbackSceneOriginRot }
  }
}

function lengthXZ(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.z * v.z)
}

function normalizeXZ(v: Vector3): Vector3 {
  const len = lengthXZ(v)
  if (len <= 0.00001) {
    return math.Vector3(0, 0, 0)
  }
  return math.Vector3(v.x / len, 0, v.z / len)
}

function findNearestTouchableObstacle(pos: Vector3, radius: Fixed): Obstacle | null {
  try {
    const candidates = GameAPI.get_obstacles_in_aabb(pos, radius, 3.01 as Fixed, radius)

    let best: Obstacle | null = null
    let bestDistSq = Number.POSITIVE_INFINITY

    for (const candidate of candidates) {
      if (candidate.is_touchable() === false) continue

      const unitId = LuaAPI.get_unit_id(candidate)
      if (usedObstacleUnitIds.has(unitId)) continue

      const p = candidate.get_position()
      const dx = p.x - pos.x
      const dy = p.y - pos.y
      const dz = p.z - pos.z
      const distSq = dx * dx + dy * dy + dz * dz

      if (distSq < bestDistSq) {
        bestDistSq = distSq
        best = candidate
      }
    }

    if (best !== null) {
      usedObstacleUnitIds.add(LuaAPI.get_unit_id(best))
    }

    return best
  } catch (e) {
    GlobalAPI.warning(`[MapGenerator] findNearestTouchableObstacle failed: ${tostring(e)}`)
    return null
  }
}

function rollbackEggPurchaseLock(unit: Obstacle): void {
  try {
    unit.set_kv_by_type(Enums.ValueType.Bool, "eggPurchaseLocked", false)
    unit.set_interact_enabled(true)
    unit.set_interact_enabled_by_index(0, true)
  } catch {
    // ignore
  }
}

function tryPurchaseConveyorEgg(role: Role, unit: Obstacle): void {
  let clickedEggTypeId: number | undefined
  try {
    clickedEggTypeId = unit.get_kv_by_type(Enums.ValueType.Int, "eggTypeId") as number | undefined
  } catch {
    clickedEggTypeId = undefined
  }
  if (clickedEggTypeId === undefined) return
  if (!isEggObstacle(unit)) return

  let realOwnerRoleId: RoleID | null = null
  try {
    const id = LuaAPI.get_unit_id(unit)
    const o = conveyorEggOwnerById.get(id)
    if (o !== undefined) {
      realOwnerRoleId = o
    }
  } catch {
    realOwnerRoleId = null
  }

  if (realOwnerRoleId !== null && role.get_roleid() !== realOwnerRoleId) {
    role.show_tips("Only owner can buy", 1.2 as Fixed)
    return
  }

  // Once-only guard for multi-player interactions.
  try {
    if (unit.has_kv("eggPurchaseLocked")) {
      const locked = unit.get_kv_by_type(Enums.ValueType.Bool, "eggPurchaseLocked") as boolean | undefined
      if (locked === true) return
    }
  } catch {
    // ignore
  }

  // Lock ASAP to prevent concurrent buyers; rollback on failure.
  try {
    unit.set_kv_by_type(Enums.ValueType.Bool, "eggPurchaseLocked", true)
    unit.set_interact_enabled(false)
    unit.set_interact_enabled_by_index(0, false)
  } catch {
    // ignore
  }

  const clickedEggType = getEggTypeById(clickedEggTypeId)
  if (clickedEggType === undefined) {
      rollbackEggPurchaseLock(unit)
    return
  }

  let clickedPrice: number
  try {
      const stored = unit.get_kv_by_type(Enums.ValueType.Int, "eggPrice") as number | undefined
    clickedPrice = typeof stored === "number" && stored === stored ? Math.floor(stored) : getEggActualPrice(clickedEggType)
  } catch {
    clickedPrice = getEggActualPrice(clickedEggType)
  }

  if (!InventorySystem.hasEmptySlot(role)) {
    role.show_tips("Inventory full", 1.5 as Fixed)
    rollbackEggPurchaseLock(unit)
    return
  }

  if (!EconomySystem.spendCoins(role, clickedPrice)) {
    role.show_tips("Not enough coins", 1.5 as Fixed)
    rollbackEggPurchaseLock(unit)
    return
  }

  const rarityId = ExcelData.rollEggRarity().id

  const added = InventorySystem.addEggToFirstEmptySlot(role, clickedEggTypeId, rarityId)
  if (!added.ok) {
    role.show_tips("Inventory full", 1.5 as Fixed)
    EconomySystem.addCoins(role, clickedPrice)
    rollbackEggPurchaseLock(unit)
    return
  }

  // UX: newly purchased egg becomes the active selection by default.
  InventorySystem.selectSlot(role, added.slot)

  let discountIdText = ""
  let discountRatioText = ""
  try {
      const id = unit.get_kv_by_type(Enums.ValueType.Int, "eggDiscountId") as number | undefined
    if (typeof id === "number" && id === id) {
      discountIdText = tostring(id)
    }
  } catch {
    // ignore
  }
  try {
      const ratio = unit.get_kv_by_type(Enums.ValueType.Fixed, "eggDiscountRatio") as number | undefined
    if (typeof ratio === "number" && ratio === ratio) {
      discountRatioText = tostring(ratio)
    }
  } catch {
    // ignore
  }

  log(
    `[EggPurchase] role=${role.get_roleid()} eggTypeId=${tostring(clickedEggTypeId)} rarityId=${tostring(rarityId)} price=${tostring(clickedPrice)} discountId=${discountIdText} discountRatio=${discountRatioText} -> slot=${added.slot}`
  )

  removeConveyorEgg(unit)
  GameAPI.destroy_unit(unit)
  PlayerSaveSystem.save(role)
}

export const MapGenerator = {
  handleEggPricePurchaseClicked(role: Role, actor: unknown, nodeId: ENode): void {
    log(
      `[EggBuy] handler role=${tostring(role.get_roleid())} nodeId=${tostring(nodeId)} actor=${tostring(actor)} actorType=${type(actor)}`
    )

    // NOTE: Do NOT compare nodeId against PrefabRegistry.
    // SceneUI instances may produce per-instance node ids.

    // Some runtimes pass the clicking Role as the actor for UI_CUSTOM_EVENT.
    // In that case, we must NOT treat actor as a unit; fall back to proximity.
    try {
      const maybeRole = actor as Role
      const actorRoleId = maybeRole.get_roleid()
      if (typeof actorRoleId === "number" && actorRoleId === actorRoleId) {
        // Only accept when it matches the role in event data.
        if (actorRoleId === role.get_roleid()) {
          actor = null
        }
      }
    } catch {
      // ignore
    }

    // If actor doesn't identify the SceneUI instance, try derive a layer key from nodeId.
    // Observed formats:
    // - "eui3d@<layer>@<node>" (SceneUI)
    // - "<layer>|<node>" (some exported UI nodes)
    try {
      const raw = nodeId as unknown as string
      if (typeof raw === "string") {
        // SceneUI format: eui3d@<layer>@<node>
        if (raw.startsWith("eui3d@")) {
          const p1 = raw.indexOf("@")
          const p2 = raw.indexOf("@", p1 + 1)
          if (p1 >= 0 && p2 > p1 + 1) {
            const layerKey = raw.slice(p1 + 1, p2)
            const eggId = eggIdByEggPriceLayer.get(layerKey)
            if (eggId !== undefined) {
              const egg = conveyorEggById.get(eggId)
              if (egg !== undefined) {
                tryPurchaseConveyorEgg(role, egg)
                return
              }
            }
          }
        }

        const bar = raw.indexOf("|")
        if (bar > 0) {
          const layerKey = raw.slice(0, bar)
          const eggId = eggIdByEggPriceLayer.get(layerKey)
          if (eggId !== undefined) {
            const egg = conveyorEggById.get(eggId)
            if (egg !== undefined) {
              tryPurchaseConveyorEgg(role, egg)
              return
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // Actor may be the SceneUI layer (string) when not bound to a unit.
    if (typeof actor === "string") {
      const eggId = eggIdByEggPriceLayer.get(actor)
      if (eggId === undefined) {
        log(`[EggBuy] no layer mapping for actor=${tostring(actor)}`)
        return
      }
      const egg = conveyorEggById.get(eggId)
      if (egg === undefined) return
      tryPurchaseConveyorEgg(role, egg)
      return
    }

    // Fallback: actor is the obstacle (bound mode).
      const unit = actor as unknown as Obstacle
    try {
      LuaAPI.get_unit_id(unit)
    } catch {
      // Last resort: resolve by nearest egg for this owner.
      const ownerRoleId = role.get_roleid()
      const s = conveyorEggIdsByOwner.get(ownerRoleId)
      if (s === undefined || s.size === 0) return
      const rolePos = role.get_ctrl_unit().get_position()
      let bestEgg: Obstacle | null = null
      let bestDistSq = Number.POSITIVE_INFINITY
      for (const eggId of s) {
        const egg = conveyorEggById.get(eggId)
        if (egg === undefined) continue
        try {
          const p = egg.get_position()
          const dx = p.x - rolePos.x
          const dy = p.y - rolePos.y
          const dz = p.z - rolePos.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < bestDistSq) {
            bestDistSq = d2
            bestEgg = egg
          }
        } catch {
          // ignore
        }
      }
      if (bestEgg === null) return
      // Avoid buying something far away due to missing actor mapping.
      if (bestDistSq > 25) return
      tryPurchaseConveyorEgg(role, bestEgg)
      return
    }
    tryPurchaseConveyorEgg(role, unit)
  },

  setObstacleInteractionHandler(handler: ObstacleInteractionHandler): void {
    obstacleInteractionHandler = handler
  },

  getMineZoneId(): CustomTriggerSpaceID | null {
    return mineZoneId
  },

  generateAll(): void {
    this.generateAllBatched(undefined)
  },

  generateAllBatched(onDone?: () => void): void {
    // Plot grids are now spawned per-role on demand (islands).
    this.generateShopArea()
    this.generateMiningArea()
    this.generateSuperPlot()
    if (onDone !== undefined) {
      onDone()
    }
  },

  generatePlotGrid(): Map<string, PlotData> {
    return this.generatePlotGridSync()
  },

  generatePlotGridSync(): Map<string, PlotData> {
    return this.generatePlotGridBatched(undefined)
  },

  generatePlotGridBatched(onDone?: () => void): Map<string, PlotData> {
    GlobalAPI.warning("[MapGenerator] generatePlotGridBatched is deprecated; use ensureIsland(role)")
    if (onDone !== undefined) {
      onDone()
    }
    return getOrCreateOwnerPlots(0 as unknown as RoleID)
  },

  ensureIsland(role: Role): void {
    const ownerRoleId = role.get_roleid()
    if (plotsByOwner.has(ownerRoleId)) return

    const ownerPlots = getOrCreateOwnerPlots(ownerRoleId)

    let originPos = authoredSceneSearchCenter
    try {
      originPos = resolveSceneOrigin(["地块原点"], authoredSceneSearchCenter).pos
    } catch {
      // ignore
    }

    let useAnchors = false
    let anchorOrigin = math.Vector3(0, 0, 0)
    let anchorStepU = math.Vector3(0, 0, 0)
    let anchorStepV = math.Vector3(0, 0, 0)
    const ground = groundByOwner.get(ownerRoleId)
    if (ground !== undefined) {
      const a1 = findChildObstacleByNames(ground.group, ["a1", "A1"])
      const a2 = findChildObstacleByNames(ground.group, ["a2", "A2"])
      const a3 = findChildObstacleByNames(ground.group, ["a3", "A3"])
      if (a1 !== null && a2 !== null && a3 !== null) {
        const p1 = a1.get_position()
        const p2 = a2.get_position()
        const p3 = a3.get_position()
        const uVec = math.Vector3(p2.x - p1.x, 0, p2.z - p1.z)
        const vVec = math.Vector3(p3.x - p1.x, 0, p3.z - p1.z)
        const uLen = lengthXZ(uVec)
        if (uLen > 0.00001 && lengthXZ(vVec) > 0.00001) {
          const uHat = normalizeXZ(uVec)
          const vDotU = dotXZ(vVec, uHat)
          const vPerp = subtract(vVec, multiply(uHat, vDotU))
          const vLen = lengthXZ(vPerp)
          if (vLen > 0.00001) {
            const vHat = normalizeXZ(vPerp)
            useAnchors = true
            anchorOrigin = p1
            anchorStepU = multiply(uHat, uLen / GameConfig.PLOT_COLS)
            anchorStepV = multiply(vHat, vLen / GameConfig.PLOT_ROWS)
          }
        }
      }
    }

    const spacing = GameConfig.PLOT_SPACING
    const baseX = originPos.x + GameConfig.PLOT_START_X
    const baseZ = originPos.z + GameConfig.PLOT_START_Z
    const baseY = originPos.y

    const cols = GameConfig.PLOT_COLS
    const rows = GameConfig.PLOT_ROWS

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = getPlotId(row, col)

        let plotTypeId = 1
        let initialUnlocked = false
        for (let i = 0; i < PlotGridLayout.length; i++) {
          const cfg = PlotGridLayout[i]
          if (cfg.row === row && cfg.col === col) {
            plotTypeId = cfg.plotTypeId
            initialUnlocked = cfg.initialUnlocked
            break
          }
        }

        if (plotTypeId === 2) {
          plotTypeId = 1
        }

        const plotType = getPlotTypeById(plotTypeId)
        const unlockPrice = plotType === undefined ? 0 : plotType.unlockPrice

        let prefabId: number
        if (!initialUnlocked) {
          prefabId = PrefabRegistry.plot.locked
        } else if (plotTypeId === 1) {
          prefabId = PrefabRegistry.plot.normal
        } else if (plotTypeId === 2) {
          prefabId = PrefabRegistry.plot.premium
        } else {
          prefabId = PrefabRegistry.plot.elite
        }

        let pos: Vector3
        if (useAnchors) {
          pos = add(anchorOrigin, add(multiply(anchorStepU, col + 0.5), multiply(anchorStepV, row + 0.5)))
        } else {
          pos = math.Vector3(baseX + (col + 0.5) * spacing, baseY, baseZ + (row + 0.5) * spacing)
        }

        const plotPos = initialUnlocked ? applyPlotVisualOffset(pos) : pos
        const obstacle = safeCreateObstacle(prefabId as unknown as UnitKey, plotPos, defaultPlotScale)
        if (obstacle === null) {
          GlobalAPI.warning(`[MapGenerator] create island plot failed owner=${tostring(ownerRoleId)} plotId=${id}`)
          continue
        }

        obstacle.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", ownerRoleId)
        obstacle.set_kv_by_type(Enums.ValueType.Str, "plotId", id)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "row", row)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "col", col)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "plotTypeId", plotTypeId)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "plotLevel", 0)
        obstacle.set_kv_by_type(Enums.ValueType.Bool, "isUnlocked", initialUnlocked)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "unlockPrice", unlockPrice)

        const triggerPos = math.Vector3(plotPos.x, plotPos.y + 0.5, plotPos.z)
        const triggerScale = math.Vector3(spacing * 0.7, 2, spacing * 0.7)
        const trigger = safeCreateCustomTriggerSpace(PrefabRegistry.zone.plot, triggerPos, triggerScale)
        let triggerEnterEventId: number | null = null
        let triggerLeaveEventId: number | null = null
        if (trigger !== null) {
          trigger.set_kv_by_type(Enums.ValueType.Str, "zoneType", "plot")
          trigger.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", ownerRoleId)
          trigger.set_kv_by_type(Enums.ValueType.Str, "plotId", id)

          const ids = registerPlotTrigger(trigger, ownerRoleId, id)
          triggerEnterEventId = ids.enterId
          triggerLeaveEventId = ids.leaveId
        }

        const plotData: PlotData = {
          ownerRoleId,
          id,
          row,
          col,
          plotTypeId,
          isUnlocked: initialUnlocked,
          hasAnimal: false,
          animalUnitId: null,
          obstacle,
          salePlaceholder: null,
          trigger,
          triggerEnterEventId,
          triggerLeaveEventId,
          obstacleScale: defaultPlotScale,
        }

        registerObstacleInteraction(obstacle)
        if (!initialUnlocked) {
          createPlotSalePlaceholder(plotData)
        }
        ownerPlots.set(id, plotData)
      }
    }

    // Special plots are temporarily disabled for this scene.

    if (ground !== undefined) {
      const namedPremiumPlots = collectNamedPremiumPlots(ground.group, originPos)
      log(`[PremiumPlot] found named premium plots owner=${tostring(ownerRoleId)} count=${namedPremiumPlots.length}`)
      for (let i = 0; i < namedPremiumPlots.length; i++) {
        const def = namedPremiumPlots[i]!
        if (ownerPlots.has(def.id)) continue

        const obstacle = def.obstacle
        const pos = applyPlotVisualOffset(obstacle.get_position())
        try {
          obstacle.set_position(pos)
        } catch {
          // ignore
        }
        const plotTypeId = 2
        const plotType = getPlotTypeById(plotTypeId)
        const unlockPrice = plotType === undefined ? 1000 : plotType.unlockPrice
        obstacle.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", ownerRoleId)
        obstacle.set_kv_by_type(Enums.ValueType.Str, "plotId", def.id)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "row", -1)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "col", -1)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "plotTypeId", plotTypeId)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "plotLevel", 0)
        obstacle.set_kv_by_type(Enums.ValueType.Bool, "isUnlocked", false)
        obstacle.set_kv_by_type(Enums.ValueType.Int, "unlockPrice", unlockPrice)
        obstacle.set_kv_by_type(Enums.ValueType.Bool, "isNamedPremiumPlot", true)

        const triggerPos = math.Vector3(pos.x, pos.y + 0.5, pos.z)
        const triggerScale = math.Vector3(12, 2, 12)
        const trigger = safeCreateCustomTriggerSpace(PrefabRegistry.zone.plot, triggerPos, triggerScale)
        let triggerEnterEventId: number | null = null
        let triggerLeaveEventId: number | null = null
        if (trigger !== null) {
          trigger.set_kv_by_type(Enums.ValueType.Str, "zoneType", "plot")
          trigger.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", ownerRoleId)
          trigger.set_kv_by_type(Enums.ValueType.Str, "plotId", def.id)

          const ids = registerPlotTrigger(trigger, ownerRoleId, def.id)
          triggerEnterEventId = ids.enterId
          triggerLeaveEventId = ids.leaveId
        }

        const plotData: PlotData = {
          ownerRoleId,
          id: def.id,
          row: -1,
          col: -1,
          plotTypeId,
          isUnlocked: false,
          hasAnimal: false,
          animalUnitId: null,
          obstacle,
          salePlaceholder: null,
          trigger,
          triggerEnterEventId,
          triggerLeaveEventId,
          obstacleScale: namedPremiumPlotScale,
        }

        registerObstacleInteraction(obstacle)
        createPlotSalePlaceholder(plotData)
        ownerPlots.set(def.id, plotData)
        log(`[PremiumPlot] registered plot owner=${tostring(ownerRoleId)} plotId=${def.id} name=${obstacle.get_name()}`)
      }
    }
  },

  destroyIsland(ownerRoleId: RoleID): void {
    const m = plotsByOwner.get(ownerRoleId)
    if (m === undefined) return

    for (const plot of m.values()) {
      if (plot.triggerEnterEventId !== null) {
        try {
          TriggerHub.unregister(plot.triggerEnterEventId)
        } catch {
          // ignore
        }
      }
      if (plot.triggerLeaveEventId !== null) {
        try {
          TriggerHub.unregister(plot.triggerLeaveEventId)
        } catch {
          // ignore
        }
      }

      if (plot.trigger !== null) {
        try {
          GameAPI.destroy_unit(plot.trigger)
        } catch {
          // ignore
        }
      }

      if (plot.salePlaceholder !== null && plot.salePlaceholder !== undefined) {
        safeDestroyUnit(plot.salePlaceholder)
      }

      try {
        GameAPI.destroy_unit(plot.obstacle)
      } catch {
        // ignore
      }
    }

    plotsByOwner.delete(ownerRoleId)
    roleLastPlotId.delete(ownerRoleId)
  },


  generateShopArea(): void {
    GlobalAPI.warning("[MapGenerator] shop area generation is disabled (requires valid prefabs in scene)")
  },

  generateMiningArea(): void {
    mineZoneId = null
    GlobalAPI.warning("[MapGenerator] mining area generation is disabled (requires valid prefabs in scene)")
  },

  generateSuperPlot(): PlotData | null {
    const superPos = math.Vector3(0, 0, 15)

    const obstacle = findNearestTouchableObstacle(superPos, 2.01 as Fixed)
    if (obstacle === null) {
      GlobalAPI.warning("[MapGenerator] super plot obstacle not found in scene")
      superPlotData = null
      return null
    }

    obstacle.set_kv_by_type(Enums.ValueType.Str, "plotType", "super")
    obstacle.set_kv_by_type(Enums.ValueType.Int, "level", 0)
    obstacle.set_kv_by_type(Enums.ValueType.Bool, "isUnlocked", false)
    obstacle.set_kv_by_type(Enums.ValueType.Fixed, "multiplier", GameConfig.SUPER_PLOT_BASE_MULTIPLIER)

    superPlotData = {
      ownerRoleId: 0 as unknown as RoleID,
      id: "super",
      row: -1,
      col: -1,
      plotTypeId: 4,
      isUnlocked: false,
      hasAnimal: false,
      animalUnitId: null,
      obstacle,
      salePlaceholder: null,
      trigger: null,
      triggerEnterEventId: null,
      triggerLeaveEventId: null,
      obstacleScale: math.Vector3(1, 1, 1),
    }

    return superPlotData
  },

  getPlot(ownerRoleId: RoleID, row: number, col: number): PlotData | undefined {
    return this.getPlotById(ownerRoleId, getPlotId(row, col))
  },

  // Legacy helper (single-island): assumes ownerRoleId=0.
  getPlotLegacy(row: number, col: number): PlotData | undefined {
    return this.getPlot(0 as unknown as RoleID, row, col)
  },

  getPlotById(ownerRoleId: RoleID, id: string): PlotData | undefined {
    const m = getOwnerPlots(ownerRoleId)
    return m === undefined ? undefined : m.get(id)
  },

  // Legacy helper (single-island): assumes ownerRoleId=0.
  getPlotByIdLegacy(id: string): PlotData | undefined {
    return this.getPlotById(0 as unknown as RoleID, id)
  },

  getAllPlotsByOwner(ownerRoleId: RoleID): PlotData[] {
    const m = getOwnerPlots(ownerRoleId)
    if (m === undefined) return []
    const result: PlotData[] = []
    for (const plot of m.values()) {
      result.push(plot)
    }
    return result
  },

  getAllPlots(): PlotData[] {
    const result: PlotData[] = []
    for (const m of plotsByOwner.values()) {
      for (const plot of m.values()) {
        result.push(plot)
      }
    }
    return result
  },


  ensureGround(role: Role): void {
    const ownerRoleId = role.get_roleid()
    if (groundByOwner.has(ownerRoleId)) return

    const target = resolveSceneOrigin(["地块原点"], authoredSceneSearchCenter)
    const basePos = target.pos
    const baseRot = target.rot

    const group = safeCreateUnitGroup(PrefabRegistry.group.ground, basePos, baseRot)
    if (group === null) return

    if (!alignGroupToNamedOriginObstacle(group, "地板-原点", basePos, baseRot)) {
      GlobalAPI.warning("[Ground] origin obstacle not found in group: 地板-原点")
      try {
        GameAPI.destroy_unit(group)
      } catch {
        // ignore
      }
      return
    }

    groundByOwner.set(ownerRoleId, { group })
  },

  ensureConveyor(role: Role): void {
    const ownerRoleId = role.get_roleid()
    if (conveyorByOwner.has(ownerRoleId)) return

    const target = resolveSceneOrigin(["传送带原点"], authoredSceneSearchCenter)
    const basePos = target.pos
    const baseRot = target.rot

    const spawnPos = basePos
    const group = safeCreateUnitGroup(PrefabRegistry.group.conveyor, spawnPos, baseRot)
    if (group === null) {
      return
    }

    if (!alignGroupToNamedOriginObstacle(group, "传送带-原点", basePos, baseRot)) {
      GlobalAPI.warning("[Conveyor] origin obstacle not found in group: 传送带-原点")
      GameAPI.destroy_unit(group)
      return
    }

    const children = group.get_children()

    let start: Unit | null = null
    for (let i = 0; i < children.length; i++) {
      const c = children[i]
      const name = c.get_name()
      if (name === "传送带起点") {
        start = c
        break
      }
      if (start === null && name === "起点") {
        start = c
      }
    }

    const childZones = group.get_child_customtriggerspaces()
    let endZone: CustomTriggerSpace | null = null
    for (let i = 0; i < childZones.length; i++) {
      const z = childZones[i]
      const name = z.get_name()
      if (name === "传送带终点") {
        endZone = z
        break
      }
      if (endZone === null && name === "终点") {
        endZone = z
      }
    }

    if (start === null || endZone === null) {
      GlobalAPI.warning(`[Conveyor] nodes not found in group: 起点(${start})/终点(${endZone})`)
      GameAPI.destroy_unit(group)
      return
    }

    const startPos = start.get_position()

    // Register end-zone destroy for this owner's conveyor.
    let triggerId: number | null = null
    try {
      const zoneId = endZone.get_id()
      triggerId = TriggerHub.register(
        [EVENT.ANY_OBSTACLE_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, zoneId],
        function (_event_name: unknown, _actor: unknown, data: { event_unit: Obstacle }) {
          const obstacle = data.event_unit
          if (!isEggObstacle(obstacle)) return

          let eggId: number | null = null
          try {
            eggId = LuaAPI.get_unit_id(obstacle)
          } catch {
            eggId = null
          }

          if (eggId !== null) {
            const trackedOwner = conveyorEggOwnerById.get(eggId)
            if (trackedOwner !== undefined && trackedOwner !== ownerRoleId) {
              return
            }
          } else {
            // Fallback to KV check when unit id is unavailable.
            try {
              const kvOwner = obstacle.get_kv_by_type(Enums.ValueType.Int, "eggOwnerRoleId") as unknown as RoleID
              if (typeof kvOwner === "number" && kvOwner !== ownerRoleId) {
                return
              }
            } catch {
              // ignore
            }
          }

          removeConveyorEgg(obstacle)
          try {
            GameAPI.destroy_unit(obstacle)
          } catch {
            // ignore
          }
        }
      )
    } catch (e) {
      triggerId = null
      GlobalAPI.warning(`[Conveyor] register end trigger failed: ${tostring(e)}`)
    }

    conveyorByOwner.set(ownerRoleId, {
      group,
      startPos: startPos,
      endZone,
      endEnterTriggerId: triggerId,
    })

    try {
      GameAPI.destroy_unit(start)
    } catch {
      // ignore
    }
  },

  ensureShop(role: Role): void {
    const ownerRoleId = role.get_roleid()
    if (shopByOwner.has(ownerRoleId)) return

    const target = resolveSceneOrigin(["商店原点"], authoredSceneSearchCenter)
    const basePos = target.pos
    const baseRot = target.rot

    const shopPos = basePos
    const shopRot = baseRot
    log(`[Shop] spawn group owner=${tostring(ownerRoleId)} pos=(${tostring(shopPos.x)},${tostring(shopPos.y)},${tostring(shopPos.z)})`)
    const group = safeCreateUnitGroup(PrefabRegistry.group.shop, shopPos, shopRot)
    if (group === null) {
      log(`[Shop] create group failed owner=${tostring(ownerRoleId)}`)
      return
    }

    if (!alignGroupToNamedOriginObstacle(group, "商店-原点", shopPos, shopRot)) {
      GlobalAPI.warning("[Shop] origin obstacle not found in group: 商店-原点")
      try {
        GameAPI.destroy_unit(group)
      } catch {
        // ignore
      }
      return
    }

    // Find trigger zone "商店触发区域" (authored in prefab). We'll use it as an anchor.
    const childZones = group.get_child_customtriggerspaces()
    let triggerZone: CustomTriggerSpace | null = null
    for (let i = 0; i < childZones.length; i++) {
      const z = childZones[i]
      if (z.get_name() === "商店触发区域") {
        triggerZone = z
        break
      }
    }

    if (triggerZone === null) {
      GlobalAPI.warning("[Shop] CustomTriggerSpace '商店触发区域' not found under shop group")
      try {
        GameAPI.destroy_unit(group)
      } catch {
        // ignore
      }
      return
    }

    let triggerPos = math.Vector3(0, 0, 0)
    let triggerScale = math.Vector3(1, 1, 1)
    try {
      triggerPos = triggerZone.get_position()
      triggerScale = triggerZone.get_scale()
    } catch {
      // ignore
    }

    log(
      `[Shop] found prefab trigger owner=${tostring(ownerRoleId)} zoneId=${tostring(
        triggerZone.get_id()
      )} pos=(${tostring(triggerPos.x)},${tostring(triggerPos.y)},${tostring(triggerPos.z)}) scale=(${tostring(
        triggerScale.x
      )},${tostring(triggerScale.y)},${tostring(triggerScale.z)})`
    )

    const prefabZoneId = triggerZone.get_id()

    function registerEnter(zoneId: CustomTriggerSpaceID, label: string): number | null {
      let id: number | null = null
      try {
        id = TriggerHub.register(
          [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, zoneId],
          function (_event_name: unknown, _actor: unknown, data: { event_unit: LifeEntity }) {
            const roles = GameAPI.get_all_roles()
            for (const r of roles) {
              if (r.get_ctrl_unit() !== data.event_unit) continue

              if (r.get_roleid() !== ownerRoleId) {
                log(
                  `[Shop] ENTER[${label}] ignored: role=${tostring(r.get_roleid())} owner=${tostring(
                    ownerRoleId
                  )} zoneId=${tostring(zoneId)}`
                )
                return
              }

              log(
                `[Shop] ENTER[${label}]: role=${tostring(r.get_roleid())} owner=${tostring(ownerRoleId)} zoneId=${tostring(
                  zoneId
                )}`
              )
              try {
                r.set_node_visible(PrefabRegistry.shopUI.root as unknown as ENode, true)
              } catch {
                // ignore
              }

              // Default level display when opening the shop.
              // If no button has been clicked yet, UI should show "一级".
              try {
                r.set_label_text(PrefabRegistry.shopUI.levelDisplay, "一级")
              } catch (e) {
                GlobalAPI.warning(
                  `[Shop] set default level display failed: role=${tostring(r.get_roleid())} err=${tostring(e)}`
                )
              }

              // Default purchase button text based on unlocked level.
              try {
                const island = PlayerSaveSystem.getIsland(r)
                const maxUnlocked = typeof island.shopMaxUnlockedLevel === "number" ? island.shopMaxUnlockedLevel : 1
                // Default selection is level 1.
                let text: string
                if (1 <= maxUnlocked) {
                  text = "已解锁"
                } else if (1 === maxUnlocked + 1) {
                  const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })
                  const price = maxLevel >= 1 ? ExcelData.getConveyorUpgradePrice(1) : null
                  if (price !== null && price > 0) {
                    text = `购买 $${tostring(price)}`
                  } else {
                    text = "购买"
                  }
                } else {
                  text = "未解锁"
                }
                r.set_button_text(PrefabRegistry.shopUI.purchaseButton, text)
              } catch (e) {
                GlobalAPI.warning(
                  `[Shop] set default purchase button text failed: role=${tostring(r.get_roleid())} err=${tostring(e)}`
                )
              }

              // Replace the list area with a single image.
              // The exported node "商店列表-列表" is not guaranteed to be an EImage at runtime,
              // so we treat it as a container and show an explicit Image node instead.
              // NOTE: Do not hide list/listContainer here.
              // The level buttons may be nested under these nodes in UI hierarchy.

              // Hide unavailable levels (UI has 1..5; table may have fewer).
              try {
                const maxLevel = ExcelData.getConveyorMaxLevel({ cap: 5 })
                for (let level = 1; level <= 5; level++) {
                  const btn = PrefabRegistry.shopUI.levelButtons[level] as unknown as ENode
                  const visible = maxLevel <= 0 ? true : level <= maxLevel
                  r.set_node_visible(btn, visible)
                }
              } catch {
                // ignore
              }

              try {
                const nodeHandle = PrefabRegistry.shopUI.display as unknown as string
                log(`[Shop] set display image: role=${tostring(r.get_roleid())} node=${tostring(nodeHandle)} imageKey=14956`)
                // Keep the editor-authored size; do NOT reset size to the image's native dimensions.
                r.set_image_texture_by_key_with_auto_resize(PrefabRegistry.shopUI.display, 14956 as ImageKey, false)
                r.set_node_visible(PrefabRegistry.shopUI.display as unknown as ENode, true)
              } catch (e) {
                const nodeHandle = PrefabRegistry.shopUI.display as unknown as string
                GlobalAPI.warning(
                  `[Shop] set display image failed: role=${tostring(r.get_roleid())} node=${tostring(nodeHandle)} err=${tostring(e)}`
                )
              }
              return
            }
          }
        )
      } catch (e) {
        id = null
        GlobalAPI.warning(`[Shop] register enter trigger failed label=${label} err=${tostring(e)}`)
      }
      log(`[Shop] registered enter trigger label=${label} owner=${tostring(ownerRoleId)} id=${tostring(id)} zoneId=${tostring(zoneId)}`)
      return id
    }

    const enterId = registerEnter(prefabZoneId, "prefab")
    if (enterId === null) {
      GlobalAPI.warning(`[Shop] ENTER[prefab] trigger registration returned null owner=${tostring(ownerRoleId)} zoneId=${tostring(prefabZoneId)}`)
    } else {
      log(`[Shop] ENTER[prefab] trigger ready owner=${tostring(ownerRoleId)} id=${tostring(enterId)} zoneId=${tostring(prefabZoneId)}`)
    }

    shopByOwner.set(ownerRoleId, {
      group,
      triggerZone,
      enterTriggerId: enterId,
    })
  },

  destroyShop(ownerRoleId: RoleID): void {
    const rt = shopByOwner.get(ownerRoleId)
    if (rt === undefined) return

    log(`[Shop] destroy owner=${tostring(ownerRoleId)} triggerId=${tostring(rt.enterTriggerId)}`)

    if (rt.enterTriggerId !== null) {
      try {
        TriggerHub.unregister(rt.enterTriggerId)
      } catch {
        // ignore
      }
    }

    try {
      GameAPI.destroy_unit(rt.group)
    } catch {
      // ignore
    }

    shopByOwner.delete(ownerRoleId)
  },

  destroyGround(ownerRoleId: RoleID): void {
    const rt = groundByOwner.get(ownerRoleId)
    if (rt === undefined) return

    try {
      GameAPI.destroy_unit(rt.group)
    } catch {
      // ignore
    }

    groundByOwner.delete(ownerRoleId)
  },

  cleanupConveyorEggs(ownerRoleId: RoleID): void {
    const s = conveyorEggIdsByOwner.get(ownerRoleId)
    if (s === undefined) return

    const ids: number[] = []
    for (const eggId of s) ids.push(eggId)

    for (const eggId of ids) {
      const egg = conveyorEggById.get(eggId)
      removeConveyorEggById(eggId)
      if (egg !== undefined) {
        try {
          GameAPI.destroy_unit(egg)
        } catch {
          // ignore
        }
      }
    }
  },

  destroyConveyor(ownerRoleId: RoleID): void {
    const rt = conveyorByOwner.get(ownerRoleId)
    if (rt === undefined) return

    // Destroy this owner's eggs first.
    this.cleanupConveyorEggs(ownerRoleId)

    // Unregister per-owner end trigger.
    if (rt.endEnterTriggerId !== null) {
      try {
        TriggerHub.unregister(rt.endEnterTriggerId)
      } catch {
        // ignore
      }
    }

    // Destroy group.
    try {
      GameAPI.destroy_unit(rt.group)
    } catch {
      // ignore
    }

    conveyorByOwner.delete(ownerRoleId)
  },

  spawnEggAtConveyorStartForOwner(ownerRoleId: RoleID, eggTypeId: number): Obstacle | null {
    const rt = conveyorByOwner.get(ownerRoleId)
    if (rt === undefined) return null

    pruneConveyorEggs()

    if (!canSpawnConveyorEggForOwner(ownerRoleId)) {
      return null
    }

    const prefabId = (PrefabRegistry.egg as Record<number, number>)[eggTypeId]
    if (prefabId === undefined) return null

    const pos = math.Vector3(rt.startPos.x, rt.startPos.y + 0.2, rt.startPos.z)
    let obstacle: Obstacle | null = null

    try {
      obstacle = GameAPI.create_obstacle(prefabId as unknown as UnitKey, pos, math.Quaternion(0, 0, 0), math.Vector3(1, 1, 1))
      const eggUnitId = LuaAPI.get_unit_id(obstacle)

      conveyorEggIdsAll.add(eggUnitId)
      conveyorEggById.set(eggUnitId, obstacle)
      conveyorEggOwnerById.set(eggUnitId, ownerRoleId)
      getOrCreateConveyorEggIdSet(ownerRoleId).add(eggUnitId)
      scheduleConveyorEggBirthJump(eggUnitId, obstacle)

      // Mark ownership on the unit for debugging/UI gating (do not rely on it for correctness).
      try {
        obstacle.set_kv_by_type(Enums.ValueType.Int, "eggOwnerRoleId", ownerRoleId)
      } catch {
        // ignore
      }

      obstacle.set_kv_by_type(Enums.ValueType.Int, "eggTypeId", eggTypeId)

      const eggType = getEggTypeById(eggTypeId)
      if (eggType !== undefined) {
        const discount = ExcelData.rollEggDiscount()
        const basePrice = getEggActualPrice(eggType)
        const price = Math.floor(basePrice * discount.ratio)

        try {
          obstacle.set_kv_by_type(Enums.ValueType.Int, "eggPrice", price)
          obstacle.set_kv_by_type(Enums.ValueType.Int, "eggDiscountId", discount.id)
          obstacle.set_kv_by_type(Enums.ValueType.Fixed, "eggDiscountRatio", discount.ratio)
          if (discount.labelText !== "") {
            obstacle.set_kv_by_type(Enums.ValueType.Str, "eggDiscountLabel", discount.labelText)
          }
        } catch {
          // ignore
        }

        startEggPriceUiTick()

        const initialPos = add(pos, math.Vector3(0, 1.1, 0))
        const layer = GameAPI.create_scene_ui_at_point(PrefabRegistry.sceneUI.eggPrice, initialPos, math.tofixed(-1))
        eggPriceLayerByEggId.set(eggUnitId, layer)
        eggIdByEggPriceLayer.set(layer, eggUnitId)

        // Only show SceneUI to the owner.
        try {
          const roles = GameAPI.get_all_roles()
          for (const rr of roles) {
            GameAPI.set_scene_ui_visible(layer, rr, rr.get_roleid() === ownerRoleId)
          }
        } catch {
          // ignore
        }

        const priceNode = GameAPI.get_eui_node_at_scene_ui(layer, PrefabRegistry.hudUI["价格"] as unknown as ENode)
        const priceLabel = priceNode as unknown as ELabel

        const nameNode = GameAPI.get_eui_node_at_scene_ui(layer, PrefabRegistry.hudUI["名字"] as unknown as ENode)
        const nameLabel = nameNode as unknown as ELabel

        const discountNode = GameAPI.get_eui_node_at_scene_ui(
          layer,
          PrefabRegistry.eggPriceUINodes["蛋价格-折扣text"] as unknown as ENode
        )
        const discountLabel = discountNode as unknown as ELabel

        const buyNode = GameAPI.get_eui_node_at_scene_ui(
          layer,
          PrefabRegistry.eggPriceUINodes["蛋价格-购买按钮"] as unknown as ENode
        )
        const buyButton = buyNode as unknown as EButton

        const nameText = `#f(c:R)(${eggType.rarity})${eggType.name}#l`

        const roles = GameAPI.get_all_roles()
        for (const rr of roles) {
          if (rr.get_roleid() !== ownerRoleId) continue
          rr.set_label_text(priceLabel, `$${price}`)
          rr.set_label_text(nameLabel, nameText)
          const ratio10 = Math.floor(discount.ratio * 10 + 0.5)
          if (ratio10 < 10) {
            rr.set_node_visible(discountNode as unknown as ENode, true)
            rr.set_label_text(discountLabel, `${tostring(ratio10)}折`)
          } else {
            rr.set_node_visible(discountNode as unknown as ENode, false)
          }
          rr.set_button_text(buyButton, "购买")
        }

      }

      return obstacle
    } catch (e) {
      GlobalAPI.warning(`[Conveyor] spawn egg failed: ${tostring(e)}`)

      if (obstacle !== null) {
        removeConveyorEgg(obstacle)
        try {
          GameAPI.destroy_unit(obstacle)
        } catch {
          // ignore
        }
      }
      return null
    }
  },

  getUnlockedPlots(ownerRoleId: RoleID): PlotData[] {
    const m = getOwnerPlots(ownerRoleId)
    if (m === undefined) return []
    const result: PlotData[] = []
    for (const plot of m.values()) {
      if (plot.isUnlocked) result.push(plot)
    }
    return result
  },

  getUnlockedPlotsAll(): PlotData[] {
    const result: PlotData[] = []
    for (const m of plotsByOwner.values()) {
      for (const plot of m.values()) {
        if (plot.isUnlocked) result.push(plot)
      }
    }
    return result
  },

  getEmptyPlots(ownerRoleId: RoleID): PlotData[] {
    const m = getOwnerPlots(ownerRoleId)
    if (m === undefined) return []
    const result: PlotData[] = []
    for (const plot of m.values()) {
      if (plot.isUnlocked && !plot.hasAnimal) result.push(plot)
    }
    return result
  },

  getLockedPlots(ownerRoleId: RoleID): PlotData[] {
    const m = getOwnerPlots(ownerRoleId)
    if (m === undefined) return []
    const result: PlotData[] = []
    for (const plot of m.values()) {
      if (!plot.isUnlocked) result.push(plot)
    }
    return result
  },

  getLockedPlotsAll(): PlotData[] {
    const result: PlotData[] = []
    for (const m of plotsByOwner.values()) {
      for (const plot of m.values()) {
        if (!plot.isUnlocked) result.push(plot)
      }
    }
    return result
  },

  unlockPlot(ownerRoleId: RoleID, id: string, opts?: { silent?: boolean }): boolean {
    const m = getOwnerPlots(ownerRoleId)
    const plot = m === undefined ? undefined : m.get(id)
    if (plot === undefined || plot.isUnlocked) return false

    if (plot.salePlaceholder !== null && plot.salePlaceholder !== undefined) {
      safeDestroyUnit(plot.salePlaceholder)
      plot.salePlaceholder = null
    }

    plot.isUnlocked = true
    plot.obstacle.set_kv_by_type(Enums.ValueType.Bool, "isUnlocked", true)

    const isNamedPremiumPlot = getBoolKvSafe(plot.obstacle, "isNamedPremiumPlot")

    const isSpecialPlot = id.indexOf("sp:") === 0

    let specialPlotId: number | null = null
    if (isSpecialPlot) {
      try {
        const v = plot.obstacle.get_kv_by_type(Enums.ValueType.Int, "specialPlotId") as number | undefined
        if (typeof v === "number" && v === v && v > 0) {
          specialPlotId = v
        }
      } catch {
        // ignore
      }

      if (specialPlotId === null) {
        specialPlotId = parseSpecialPlotIdFromPlotId(id)
      }
    }

    const plotType = getPlotTypeById(plot.plotTypeId)
    const unlockPrice = plotType === undefined ? 0 : plotType.unlockPrice

    let newPrefabId: number
    if (isSpecialPlot) {
      // Special plots always reuse the normal plot prefab.
      newPrefabId = PrefabRegistry.plot.normal
    } else if (plot.plotTypeId === 1) {
      newPrefabId = PrefabRegistry.plot.normal
    } else if (plot.plotTypeId === 2) {
      newPrefabId = PrefabRegistry.plot.premium
    } else {
      newPrefabId = PrefabRegistry.plot.elite
    }

    if (isNamedPremiumPlot) {
      const pos = plot.obstacle.get_position()
      if (opts?.silent !== true) {
        GameAPI.play_sfx_by_key(
          PrefabRegistry.sfx.unlock as SfxKey,
          pos,
          math.Quaternion(0, 0, 0),
          math.tofixed(1),
          math.tofixed(1.5)
        )

        EventBus.emit(GameEvents.PLOT_UNLOCKED, plot)
      }
      return true
    }

    const pos = applyPlotVisualOffset(plot.obstacle.get_position())

    const newObstacle = safeCreateObstacle(newPrefabId as unknown as UnitKey, pos, plot.obstacleScale)
    if (newObstacle === null) return false

    GameAPI.destroy_unit(plot.obstacle)

    newObstacle.set_kv_by_type(Enums.ValueType.Str, "plotId", id)
    newObstacle.set_kv_by_type(Enums.ValueType.Int, "ownerRoleId", ownerRoleId)

    newObstacle.set_kv_by_type(Enums.ValueType.Int, "row", plot.row)
    newObstacle.set_kv_by_type(Enums.ValueType.Int, "col", plot.col)
    newObstacle.set_kv_by_type(Enums.ValueType.Int, "plotTypeId", plot.plotTypeId)
    newObstacle.set_kv_by_type(Enums.ValueType.Bool, "isUnlocked", true)
    newObstacle.set_kv_by_type(Enums.ValueType.Int, "plotLevel", 0)
    newObstacle.set_kv_by_type(Enums.ValueType.Int, "unlockPrice", unlockPrice)
    if (isSpecialPlot) {
      newObstacle.set_kv_by_type(Enums.ValueType.Bool, "isSpecialPlot", true)
      if (specialPlotId !== null && typeof specialPlotId === "number" && specialPlotId === specialPlotId && specialPlotId > 0) {
        newObstacle.set_kv_by_type(Enums.ValueType.Int, "specialPlotId", specialPlotId)
      }
    }

    plot.obstacle = newObstacle
    registerObstacleInteraction(newObstacle)

    if (opts?.silent !== true) {
      GameAPI.play_sfx_by_key(
        PrefabRegistry.sfx.unlock as SfxKey,
        pos,
        math.Quaternion(0, 0, 0),
        math.tofixed(1),
        math.tofixed(1.5)
      )

      EventBus.emit(GameEvents.PLOT_UNLOCKED, plot)
    }
    return true
  },

  ensurePlotSalePlaceholders(ownerRoleId: RoleID): void {
    const lockedPlots = this.getLockedPlots(ownerRoleId)
    log(`[PlotSale] ensurePlaceholders owner=${tostring(ownerRoleId)} locked=${lockedPlots.length}`)
    for (const plot of lockedPlots) {
      log(`[PlotSale] ensure placeholder plotId=${plot.id}`)
      createPlotSalePlaceholder(plot)
    }
  },

  setPlotAnimal(ownerRoleId: RoleID, id: string, animalUnitId: number | null): void {
    const plot = this.getPlotById(ownerRoleId, id)
    if (plot === undefined) return

    plot.hasAnimal = animalUnitId !== null
    plot.animalUnitId = animalUnitId
    plot.obstacle.set_kv_by_type(Enums.ValueType.Bool, "hasAnimal", plot.hasAnimal)
  },

  getPlotLevel(ownerRoleId: RoleID, id: string): number {
    const plot = this.getPlotById(ownerRoleId, id)
    if (plot === undefined) return 0
    try {
      const v = plot.obstacle.get_kv_by_type(Enums.ValueType.Int, "plotLevel") as number | undefined
      return typeof v === "number" && v === v && v > 0 ? Math.floor(v) : 0
    } catch {
      return 0
    }
  },

  setPlotLevel(ownerRoleId: RoleID, id: string, level: number): void {
    const plot = this.getPlotById(ownerRoleId, id)
    if (plot === undefined) return
    const lv = level > 0 ? Math.floor(level) : 0
    try {
      plot.obstacle.set_kv_by_type(Enums.ValueType.Int, "plotLevel", lv)
    } catch {
      // ignore
    }
  },

  getSuperPlot(): PlotData | null {
    return superPlotData
  },

  getSuperPlotLevel(): number {
    return superPlotLevel
  },

  getSuperPlotMultiplier(): number {
    return GameConfig.SUPER_PLOT_BASE_MULTIPLIER + superPlotLevel * GameConfig.SUPER_PLOT_MULTIPLIER_PER_LEVEL
  },

  unlockSuperPlot(): boolean {
    if (superPlotData === null || superPlotData.isUnlocked) return false

    superPlotData.isUnlocked = true
    superPlotData.obstacle.set_kv_by_type(Enums.ValueType.Bool, "isUnlocked", true)

    EventBus.emit(GameEvents.SUPER_PLOT_UNLOCKED, superPlotData)
    return true
  },

  upgradeSuperPlot(): boolean {
    if (superPlotData === null || !superPlotData.isUnlocked) return false

    superPlotLevel += 1
    superPlotData.obstacle.set_kv_by_type(Enums.ValueType.Int, "level", superPlotLevel)
    superPlotData.obstacle.set_kv_by_type(Enums.ValueType.Fixed, "multiplier", this.getSuperPlotMultiplier())

    EventBus.emit(GameEvents.SUPER_PLOT_UPGRADED, superPlotLevel, this.getSuperPlotMultiplier())
    return true
  },
}
