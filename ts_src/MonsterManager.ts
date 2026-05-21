import { safeCall, safeDestroySceneUi, safeVoid } from "@common/engine_safe"
import * as PlayerStats from "./PlayerStats"

type MonsterKind = "A" | "B" | "C" | "S"

interface MonsterConfig {
  kind: MonsterKind
  maxHp: Fixed
  attack: number
  moveSpeed: Fixed
  killExp: number
}

interface MonsterData {
  unitId: UnitID
  name: string
  unit: Creature
  config: MonsterConfig
  bornPos: Vector3
  hp: Fixed
  dead: boolean
  expAwarded: boolean
  aiState: "idle" | "chase" | "return"
  lastHitRoleId?: RoleID
  chaseRoleId?: RoleID
  lastCollisionAttackTime?: Fixed
  collisionAttackCooling: boolean
  returnMoveBlocked: boolean
  engineEventSeq: number
  lastEngineDamageEventSeq?: number
  damageBeforeEventId?: integer
  damageEventId?: integer
  dieEventId?: integer
  contactEventId?: integer
  abcHpbarSceneUi?: E3DLayer
  lastSightBlockedLogTime?: Fixed
}

interface MonsterSpec {
  unitId: UnitID
  name?: string
  kind?: MonsterKind
}

interface DamageResult {
  oldHp: Fixed
  newHp: Fixed
  maxHp: Fixed
  applied: Fixed
  dead: boolean
}

type EngineDamageInterceptor = (monster: MonsterData, eventData: unknown) => boolean
type MonsterKilledListener = (name: string, unitId: UnitID, role: Role | undefined) => void
type DamageApi = {
  get_damage_value?: (damage: Damage) => Fixed
  set_damage_value?: (damage: Damage, value: Fixed) => void
  get_damage_source?: (damage: Damage) => Unit
  get_damage_target?: (damage: Damage) => LifeEntity
}

const MONSTER_CONFIG: Record<MonsterKind, MonsterConfig> = {
  C: {
    kind: "C",
    maxHp: math.tofixed(10),
    attack: 2,
    moveSpeed: math.tofixed(3),
    killExp: 4,
  },
  B: {
    kind: "B",
    maxHp: math.tofixed(30),
    attack: 4,
    moveSpeed: math.tofixed(4),
    killExp: 10,
  },
  A: {
    kind: "A",
    maxHp: math.tofixed(60),
    attack: 6,
    moveSpeed: math.tofixed(5),
    killExp: 14,
  },
  S: {
    kind: "S",
    maxHp: math.tofixed(100),
    attack: 6,
    moveSpeed: math.tofixed(5),
    killExp: 20,
  },
}

const MONSTER_NAMES = [
  "变异蛋C11",
  "变异蛋C10",
  "变异蛋C9",
  "变异蛋C7",
  "变异蛋C6",
  "变异蛋C5",
  "变异蛋C3",
  "变异蛋C2",
  "变异蛋C1",
  "变异蛋B13",
  "变异蛋B12",
  "变异蛋B11",
  "变异蛋B10",
  "变异蛋B7",
  "变异蛋B6",
  "变异蛋B5",
  "变异蛋A14",
  "变异蛋A13",
  "变异蛋A12",
  "变异蛋A11",
  "变异蛋A10",
  "变异蛋A8",
  "变异蛋A7",
  "变异蛋A6",
  "变异蛋A4",
  "变异蛋A3",
]

const MONSTER_IDS = [
  1534008757,
  1512540079,
  1062383567,
  1078008687,
  1784268053,
  2041243566,
  1743679626,
  1643323093,
  1115853218,
  1854567188,
  1101855552,
  2115675148,
  1502667218,
  1760381794,
  1080764999,
  1881048733,
  1997721046,
  1731296382,
  1073930844,
  1549045028,
  1135616291,
  1327462744,
  1303708057,
  1526475831,
  2105425904,
  1904726297,
]

const MONSTER_KINDS: MonsterKind[] = [
  "C",
  "C",
  "C",
  "C",
  "C",
  "C",
  "C",
  "C",
  "C",
  "B",
  "B",
  "B",
  "B",
  "B",
  "B",
  "B",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
]

const EXTRA_MONSTER_SPECS: MonsterSpec[] = [
  { unitId: 1518591746, kind: "A" },
  { unitId: 1491798607, kind: "S" },
]

const MONSTER_SPECS: MonsterSpec[] = []
for (let index = 0; index < MONSTER_NAMES.length; index = index + 1) {
  MONSTER_SPECS[index] = {
    unitId: MONSTER_IDS[index],
    name: MONSTER_NAMES[index],
    kind: MONSTER_KINDS[index],
  }
}

for (const spec of EXTRA_MONSTER_SPECS) {
  MONSTER_SPECS[MONSTER_SPECS.length] = spec
}

const monstersByName: Record<string, MonsterData> = {}
const monstersByUnitId: Record<number, MonsterData> = {}
const allMonsters: MonsterData[] = []
let engineDamageInterceptor: EngineDamageInterceptor | undefined
let engineDeathInterceptor: EngineDamageInterceptor | undefined
const monsterKilledListeners: MonsterKilledListener[] = []
let aiTickEventId: integer | undefined
let aiClock: Fixed = math.tofixed(0)

const AI_TICK_SECONDS = math.tofixed(0.4)
const AI_DETECT_RANGE = math.tofixed(16)
const AI_LOST_RANGE = math.tofixed(30)
const AI_ATTACK_RANGE = math.tofixed(3)
const AI_ATTACK_COOLDOWN = math.tofixed(2.4)
const AI_SCRIPT_STOP_RANGE = math.tofixed(0.6)
const AI_RETURN_THRESHOLD = math.tofixed(1.5)
const AI_SIGHT_HEIGHT = math.tofixed(0.8)
const KNOCK_CHECK_DELAY = math.tofixed(0.18)
const KNOCK_FORCE_XZ = math.tofixed(7)
const KNOCK_FORCE_Y = math.tofixed(3.5)
const KNOCK_MAX_SPEED = math.tofixed(11)
const KNOCK_LOST_CONTROL_SECONDS = math.tofixed(0.35)
const KNOCK_MIN_MOVE_SQ = math.tofixed(0.12)
const KNOCK_MIN_SPEED_SQ = math.tofixed(4)
const KNOCK_MIN_UP_DELTA = math.tofixed(0.08)
const BLOCKING_OBSTACLE_RADIUS = math.tofixed(4.6)
const BLOCKING_OBSTACLE_PREFIXES = ["方墙", "机械墙", "欧式方形窄门", "穿梭电门"]
const AI_SIGHT_BLOCK_LOG_COOLDOWN = math.tofixed(2)
const HP_PER_TICK_C = 2
const HP_PER_TICK_B = 6
const HP_PER_TICK_A = 12
const HP_PER_TICK_S = 20
const ABC_C_HPBAR_LAYER_KEY = 1073741933 as E3DLayerKey
const ABC_C_HPBAR_OFFSET = math.Vector3(0, math.tofixed(0.65), 0)
const ABC_C_HPBAR_DURATION = math.tofixed(3600)

function monsterKindOfName(name: string): MonsterKind | undefined {
  if (name.indexOf("变异蛋A") === 0) {
    return "A"
  }
  if (name.indexOf("变异蛋B") === 0) {
    return "B"
  }
  if (name.indexOf("变异蛋C") === 0) {
    return "C"
  }
  return undefined
}

function clamp(value: Fixed, minValue: Fixed, maxValue: Fixed): Fixed {
  if (value < minValue) {
    return minValue
  }
  if (value > maxValue) {
    return maxValue
  }
  return value
}

function hpText(data: MonsterData): string {
  return `${tostring(math.tointeger(data.hp))}/${tostring(math.tointeger(data.config.maxHp))}`
}

function hpPerTick(data: MonsterData): number {
  if (data.config.kind === "S") {
    return HP_PER_TICK_S
  }
  if (data.config.kind === "A") {
    return HP_PER_TICK_A
  }
  if (data.config.kind === "B") {
    return HP_PER_TICK_B
  }
  return HP_PER_TICK_C
}

function hpTickBarText(data: MonsterData): string {
  const perTick = hpPerTick(data)
  const totalTicks = math.tointeger(data.config.maxHp / math.tofixed(perTick))
  let ticks = ""
  for (let index = 1; index <= totalTicks; index = index + 1) {
    const lowerBound = math.tofixed((index - 1) * perTick)
    ticks = `${ticks}${data.hp > lowerBound ? "❤️" : "♡"}`
    if (index % 5 === 0 && index < totalTicks) {
      ticks = `${ticks} `
    }
  }
  return `[${ticks}]`
}

function monsterHpNameText(data: MonsterData): string {
  return `${data.name} HP ${hpText(data)} ${hpTickBarText(data)}`
}

function ensureAbcHpbarForC(data: MonsterData): void {
  if (data.config.kind !== "C" || data.dead || data.abcHpbarSceneUi !== undefined) {
    return
  }

  const layer = safeCall(
    () => data.unit.create_scene_ui_bind_unit(
      ABC_C_HPBAR_LAYER_KEY,
      Enums.ModelSocket.socket_head,
      ABC_C_HPBAR_OFFSET,
      ABC_C_HPBAR_DURATION,
      false,
      true
    ),
    { tag: `Monster ABC hpbar create ${data.name}`, fallback: undefined, logger: (msg: string) => print(msg) }
  )
  if (layer === undefined) {
    print(`[Stage2][MonsterManager] ABC hpbar create failed name=${data.name} key=${tostring(ABC_C_HPBAR_LAYER_KEY)}`)
    return
  }

  data.abcHpbarSceneUi = layer
  print(
    `[Stage2][MonsterManager] ABC hpbar created` +
      ` name=${data.name}` +
      ` key=${tostring(ABC_C_HPBAR_LAYER_KEY)}` +
      ` layer=${tostring(layer)}`
  )
}

function destroyAbcHpbar(data: MonsterData, reason: string): void {
  if (data.abcHpbarSceneUi === undefined) {
    return
  }

  safeDestroySceneUi(data.abcHpbarSceneUi, { tag: `Monster destroy ABC hpbar ${data.name}`, logger: (msg: string) => print(msg) })
  print(
    `[Stage2][MonsterManager] ABC hpbar destroyed` +
      ` name=${data.name}` +
      ` reason=${reason}`
  )
  data.abcHpbarSceneUi = undefined
}

function roleById(roleId: RoleID | undefined): Role | undefined {
  if (roleId === undefined) {
    return undefined
  }

  for (const role of GameAPI.get_all_valid_roles()) {
    if (role.get_roleid() === roleId) {
      return role
    }
  }

  return undefined
}

function firstValidRole(): Role | undefined {
  for (const role of GameAPI.get_all_valid_roles()) {
    if (!role.is_lost()) {
      return role
    }
  }

  return undefined
}

function distSq(a: Vector3, b: Vector3): Fixed {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function vectorTo(from: Vector3, to: Vector3): Vector3 {
  return math.Vector3(to.x - from.x, to.y - from.y, to.z - from.z)
}

function absFixed(value: Fixed): Fixed {
  return value < 0 ? -value : value
}

function sightPoint(pos: Vector3): Vector3 {
  return math.Vector3(pos.x, pos.y + AI_SIGHT_HEIGHT, pos.z)
}

function vectorLengthSq(vector: Vector3): Fixed {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
}

function knockForceFromMonster(monsterPos: Vector3, rolePos: Vector3): Vector3 {
  const dx = rolePos.x - monsterPos.x
  const dz = rolePos.z - monsterPos.z
  let divisor = absFixed(dx) + absFixed(dz)
  if (divisor <= math.tofixed(0.001)) {
    divisor = math.tofixed(1)
  }

  return math.Vector3((dx / divisor) * KNOCK_FORCE_XZ, KNOCK_FORCE_Y, (dz / divisor) * KNOCK_FORCE_XZ)
}

function isBlockingObstacle(unit: Unit | undefined): boolean {
  if (unit === undefined) {
    return false
  }

  const visible = safeCall(
    () => unit.is_model_visible(),
    { tag: `Monster sight obstacle visible ${unit.get_name()}`, fallback: true, logger: (msg: string) => print(msg) }
  )
  if (visible === false) {
    return false
  }

  const name = unit.get_name()
  for (const prefix of BLOCKING_OBSTACLE_PREFIXES) {
    if (name.indexOf(prefix) === 0) {
      return true
    }
  }

  return false
}

function isBlockingObstacleInRaycast(from: Vector3, to: Vector3): boolean {
  let blocked = false
  safeVoid(() => {
    GameAPI.raycast_unit(sightPoint(from), sightPoint(to), [Enums.UnitType.OBSTACLE], (unit: Unit) => {
      if (isBlockingObstacle(unit)) {
        blocked = true
      }
    })
  }, { tag: "Monster sight raycast_unit", logger: (msg: string) => print(msg) })
  return blocked
}

function distSqPointToSegmentXZ(px: Fixed, pz: Fixed, ax: Fixed, az: Fixed, bx: Fixed, bz: Fixed): Fixed {
  const dx = bx - ax
  const dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (lenSq <= math.tofixed(0.001)) {
    const pxToAx = px - ax
    const pzToAz = pz - az
    return pxToAx * pxToAx + pzToAz * pzToAz
  }

  const rawT = ((px - ax) * dx + (pz - az) * dz) / lenSq
  const t = clamp(rawT, math.tofixed(0), math.tofixed(1))
  const closestX = ax + dx * t
  const closestZ = az + dz * t
  const offX = px - closestX
  const offZ = pz - closestZ
  return offX * offX + offZ * offZ
}

function isNearBlockingObstacleBetween(from: Vector3, to: Vector3): boolean {
  const radiusSq = BLOCKING_OBSTACLE_RADIUS * BLOCKING_OBSTACLE_RADIUS
  let obstacles = safeCall(
    () => GameAPI.get_all_obstacles(),
    { tag: "Monster sight get_all_obstacles", fallback: [] as Obstacle[], logger: (msg: string) => print(msg) }
  )
  if (obstacles === undefined) {
    obstacles = []
  }
  for (const obstacle of obstacles) {
    if (!isBlockingObstacle(obstacle)) {
      continue
    }

    const pos = obstacle.get_position()
    const distSq = distSqPointToSegmentXZ(pos.x, pos.z, from.x, from.z, to.x, to.z)
    if (distSq <= radiusSq) {
      return true
    }
  }

  return false
}

function isLineBlockedBySceneObstacle(from: Vector3, to: Vector3): boolean {
  if (isBlockingObstacleInRaycast(from, to)) {
    return true
  }

  const firstObstacle = safeCall(
    () => GameAPI.get_obstacle_by_raycast(sightPoint(from), sightPoint(to)),
    { tag: "Monster sight get_obstacle_by_raycast", fallback: undefined, logger: (msg: string) => print(msg) }
  )
  if (isBlockingObstacle(firstObstacle)) {
    return true
  }

  let obstacles = safeCall(
    () => GameAPI.get_obstacles_by_raycast(sightPoint(from), sightPoint(to)),
    { tag: "Monster sight get_obstacles_by_raycast", fallback: [] as Obstacle[], logger: (msg: string) => print(msg) }
  )
  if (obstacles === undefined) {
    obstacles = []
  }
  for (const obstacle of obstacles) {
    if (isBlockingObstacle(obstacle)) {
      return true
    }
  }

  return isNearBlockingObstacleBetween(from, to)
}

function roleFromAny(value: unknown): Role | undefined {
  if (value === undefined) {
    return undefined
  }

  const obj = value as {
    get_role?: () => Role
    get_ctrl_role?: () => Role
    get_owner?: () => unknown
    get_owner_role?: () => Role
    get_owner_character?: () => unknown
    get_owner_creature?: () => unknown
    get_owner_equipment?: () => unknown
  }

  const getRole = obj.get_role
  if (type(getRole) === "function") {
    const role = (getRole as () => Role)()
    if (role !== undefined) {
      return role
    }
  }

  const getCtrlRole = obj.get_ctrl_role
  if (type(getCtrlRole) === "function") {
    const role = (getCtrlRole as () => Role)()
    if (role !== undefined) {
      return role
    }
  }

  const getOwnerRole = obj.get_owner_role
  if (type(getOwnerRole) === "function") {
    const role = (getOwnerRole as () => Role)()
    if (role !== undefined) {
      return role
    }
  }

  const getOwner = obj.get_owner
  if (type(getOwner) === "function") {
    const role = roleFromAny((getOwner as () => unknown)())
    if (role !== undefined) {
      return role
    }
  }

  const getOwnerEquipment = obj.get_owner_equipment
  if (type(getOwnerEquipment) === "function") {
    const role = roleFromAny((getOwnerEquipment as () => unknown)())
    if (role !== undefined) {
      return role
    }
  }

  const getOwnerCharacter = obj.get_owner_character
  if (type(getOwnerCharacter) === "function") {
    const role = roleFromAny((getOwnerCharacter as () => unknown)())
    if (role !== undefined) {
      return role
    }
  }

  const getOwnerCreature = obj.get_owner_creature
  if (type(getOwnerCreature) === "function") {
    const role = roleFromAny((getOwnerCreature as () => unknown)())
    if (role !== undefined) {
      return role
    }
  }

  return undefined
}

function onlyValidRole(): Role | undefined {
  const roles = GameAPI.get_all_valid_roles()
  if (roles.length === 1) {
    return roles[0]
  }

  return undefined
}

function roleFromUnit(unit: Unit | undefined): Role | undefined {
  if (unit === undefined) {
    return undefined
  }

  const directRole = roleFromAny(unit)
  if (directRole !== undefined) {
    return directRole
  }

  for (const role of GameAPI.get_all_valid_roles()) {
    const character = role.get_ctrl_unit()
    if (character !== undefined && character.get_id() === unit.get_id()) {
      return role
    }
  }

  return undefined
}

function nearestVisibleRoleInRange(data: MonsterData, maxRange: Fixed): Role | undefined {
  const maxRangeSq = maxRange * maxRange
  let bestRole: Role | undefined
  let bestDistSq = maxRangeSq
  const monsterPos = data.unit.get_position()

  for (const role of GameAPI.get_all_valid_roles()) {
    if (role.is_lost()) {
      continue
    }

    const character = role.get_ctrl_unit()
    if (character === undefined) {
      continue
    }

    const characterPos = character.get_position()
    const currentDistSq = distSq(monsterPos, characterPos)
    if (currentDistSq <= bestDistSq && canMonsterSeeRole(data, role, maxRange)) {
      bestRole = role
      bestDistSq = currentDistSq
    }
  }

  return bestRole
}

function getChaseRole(data: MonsterData): Role | undefined {
  if (data.chaseRoleId === undefined) {
    return undefined
  }

  const role = roleById(data.chaseRoleId)
  if (role === undefined || role.is_lost()) {
    return undefined
  }

  return role
}

function isRoleInRange(data: MonsterData, role: Role, maxRange: Fixed): boolean {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return false
  }

  return distSq(data.unit.get_position(), character.get_position()) <= maxRange * maxRange
}

function canMonsterSeeRole(data: MonsterData, role: Role, maxRange: Fixed): boolean {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return false
  }

  const monsterPos = data.unit.get_position()
  const characterPos = character.get_position()
  if (distSq(monsterPos, characterPos) > maxRange * maxRange) {
    return false
  }

  if (!isLineBlockedBySceneObstacle(characterPos, monsterPos)) {
    return true
  }

  const lastLogTime = data.lastSightBlockedLogTime
  if (lastLogTime === undefined || aiClock - lastLogTime >= AI_SIGHT_BLOCK_LOG_COOLDOWN) {
    print(
      `[Stage6][MonsterManager] sight blocked ${data.name}` +
        ` role=${tostring(role.get_roleid())}` +
        ` range=${tostring(maxRange)}`
    )
    data.lastSightBlockedLogTime = aiClock
  }
  return false
}

function configureStage6Ai(data: MonsterData): void {
  safeVoid(() => {
    data.unit.start_ai()
  }, { tag: `Monster start_ai ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    data.unit.force_stop_move()
  }, { tag: `Monster force_stop_move ${data.name}`, logger: (msg: string) => print(msg) })
}

function commandMoveTo(data: MonsterData, targetPos: Vector3, threshold: Fixed, reason: string): boolean {
  const moved = safeVoid(() => {
    data.unit.start_move_to_pos_with_threshold(targetPos, AI_TICK_SECONDS, threshold)
  }, { tag: `Monster ${reason} move ${data.name}`, logger: (msg: string) => print(msg) })
  if (moved) {
    return true
  }

  return safeVoid(() => {
    data.unit.ai_command_start_move_high_priority([targetPos], AI_TICK_SECONDS, threshold)
  }, { tag: `Monster ${reason} high priority move ${data.name}`, logger: (msg: string) => print(msg) })
}

function commandChase(data: MonsterData, role: Role): void {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return
  }

  if (!canMonsterSeeRole(data, role, AI_DETECT_RANGE)) {
    commandReturn(data)
    return
  }

  const roleId = role.get_roleid()
  const wasSameTarget = data.aiState === "chase" && data.chaseRoleId === roleId
  data.aiState = "chase"
  data.chaseRoleId = roleId
  data.returnMoveBlocked = false

  const unitPos = data.unit.get_position()
  const targetPos = character.get_position()
  const direction = vectorTo(unitPos, targetPos)
  if (distSq(unitPos, targetPos) <= AI_SCRIPT_STOP_RANGE * AI_SCRIPT_STOP_RANGE) {
    safeVoid(() => {
      data.unit.force_stop_move()
    }, { tag: `Monster chase force_stop_move ${data.name}`, logger: (msg: string) => print(msg) })
    return
  }

  commandMoveTo(data, targetPos, AI_SCRIPT_STOP_RANGE, "chase")
  if (!wasSameTarget) {
    print(`[Stage6][MonsterManager] script chase ${data.name} role=${tostring(roleId)}`)
  }
}

function commandReturn(data: MonsterData): void {
  if (data.returnMoveBlocked) {
    data.aiState = "idle"
    data.chaseRoleId = undefined
    return
  }

  const wasReturning = data.aiState === "return"
  data.aiState = "return"
  data.chaseRoleId = undefined

  const unitPos = data.unit.get_position()
  if (distSq(unitPos, data.bornPos) <= AI_RETURN_THRESHOLD * AI_RETURN_THRESHOLD) {
    commandIdle(data)
    return
  }

  const moved = commandMoveTo(data, data.bornPos, AI_RETURN_THRESHOLD, "return")
  if (!moved) {
    data.aiState = "idle"
    data.returnMoveBlocked = true
    return
  }
  if (!wasReturning) {
    print(`[Stage6][MonsterManager] script return ${data.name}`)
  }
}

function commandIdle(data: MonsterData): void {
  data.aiState = "idle"
  data.chaseRoleId = undefined
  safeVoid(() => {
    data.unit.force_stop_move()
  }, { tag: `Monster idle force_stop_move ${data.name}`, logger: (msg: string) => print(msg) })
}

function updateMonsterAi(data: MonsterData): void {
  if (data.dead) {
    return
  }

  let targetRole = getChaseRole(data)
  if (targetRole !== undefined && !canMonsterSeeRole(data, targetRole, AI_LOST_RANGE)) {
    targetRole = undefined
  }

  if (targetRole === undefined) {
    targetRole = nearestVisibleRoleInRange(data, AI_DETECT_RANGE)
  }

  if (targetRole !== undefined) {
    commandChase(data, targetRole)
    return
  }

  if (distSq(data.unit.get_position(), data.bornPos) > AI_RETURN_THRESHOLD * AI_RETURN_THRESHOLD) {
    commandReturn(data)
    return
  }

  if (data.aiState !== "idle") {
    commandIdle(data)
  }
}

function updateAllMonsterAi(): void {
  aiClock = aiClock + AI_TICK_SECONDS

  for (const data of allMonsters) {
    updateMonsterAi(data)
  }
}

function ensureStage6AiTick(): void {
  if (aiTickEventId !== undefined) {
    return
  }

  aiTickEventId = LuaAPI.global_register_trigger_event([EVENT.REPEAT_TIMEOUT, AI_TICK_SECONDS], () => {
    updateAllMonsterAi()
  })
  print("[Stage6][MonsterManager] ai tick enabled")
}

function tryCollisionAttack(data: MonsterData, otherUnit: Unit | undefined): void {
  if (data.dead || data.aiState !== "chase") {
    return
  }

  const role = roleFromUnit(otherUnit)
  if (role === undefined || !canMonsterSeeRole(data, role, AI_ATTACK_RANGE + math.tofixed(0.8))) {
    return
  }

  if (data.collisionAttackCooling) {
    return
  }

  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return
  }

  data.collisionAttackCooling = true
  data.lastCollisionAttackTime = aiClock
  LuaAPI.call_delay_time(AI_ATTACK_COOLDOWN, () => {
    data.collisionAttackCooling = false
  })

  const beforePos = character.get_position()
  const beforeMonsterPos = data.unit.get_position()
  character.apply_impact_force(
    knockForceFromMonster(beforeMonsterPos, beforePos),
    KNOCK_MAX_SPEED,
    true,
    KNOCK_LOST_CONTROL_SECONDS
  )

  LuaAPI.call_delay_time(KNOCK_CHECK_DELAY, () => {
    const currentCharacter = role.get_ctrl_unit()
    if (currentCharacter === undefined || data.dead) {
      return
    }

    const afterPos = currentCharacter.get_position()
    const velocity = currentCharacter.get_linear_velocity()
    const moveSq = distSq(beforePos, afterPos)
    const speedSq = vectorLengthSq(velocity)
    const upDelta = afterPos.y - beforePos.y
    const knocked = moveSq >= KNOCK_MIN_MOVE_SQ || speedSq >= KNOCK_MIN_SPEED_SQ || upDelta >= KNOCK_MIN_UP_DELTA

    if (!knocked) {
      print(
        `[Stage6][MonsterManager] collision no knock ${data.name}` +
          ` role=${tostring(role.get_roleid())}` +
          ` moveSq=${tostring(moveSq)}` +
          ` speedSq=${tostring(speedSq)}` +
          ` upDelta=${tostring(upDelta)}`
      )
      return
    }

    role.show_tips(`${data.name} 撞飞`, math.tofixed(1.2))
    print(
      `[Stage6][MonsterManager] knock effect ${data.name}` +
        ` role=${tostring(role.get_roleid())}` +
        " damage=0" +
        ` moveSq=${tostring(moveSq)}` +
        ` speedSq=${tostring(speedSq)}`
    )
  })

  print(
    `[Stage6][MonsterManager] collision knock check ${data.name}` +
      ` role=${tostring(role.get_roleid())}` +
      ` delay=${tostring(KNOCK_CHECK_DELAY)}`
  )
}

function roleFromDeathEvent(eventData: unknown): Role | undefined {
  const data = eventData as {
    damage_source?: unknown
    _src?: unknown
    src?: unknown
    source?: unknown
    unit?: unknown
    ability?: unknown
    equipment?: unknown
  }
  const candidates = [data.damage_source, data._src, data.src, data.source, data.unit, data.ability, data.equipment]
  for (const candidate of candidates) {
    const role = roleFromAny(candidate)
    if (role !== undefined) {
      return role
    }
  }

  return onlyValidRole()
}

function roleFromDamageEvent(eventData: unknown): Role | undefined {
  const data = eventData as {
    _src?: unknown
    src?: unknown
    source?: unknown
    unit?: unknown
    ability?: unknown
    equipment?: unknown
    _dmg?: Damage
  }
  const candidates = [data._src, data.src, data.source, data.unit, data.ability, data.equipment]
  for (const candidate of candidates) {
    const role = roleFromAny(candidate)
    if (role !== undefined) {
      return role
    }
  }

  if (data._dmg !== undefined) {
    const damageApi = GameAPI as unknown as DamageApi
    const getDamageSource = damageApi.get_damage_source
    if (type(getDamageSource) === "function") {
      const role = roleFromAny((getDamageSource as (damage: Damage) => Unit)(data._dmg))
      if (role !== undefined) {
        return role
      }
    }
  }

  return onlyValidRole()
}

function clampNativeDamageToPlayerAttack(data: MonsterData, eventData: unknown): void {
  if (data.dead) {
    return
  }

  const damageData = eventData as { _dmg?: Damage }
  if (damageData._dmg === undefined) {
    return
  }

  const role = roleFromDamageEvent(eventData)
  if (role === undefined) {
    return
  }

  const damageApi = GameAPI as unknown as DamageApi
  const setDamageValue = damageApi.set_damage_value
  if (type(setDamageValue) !== "function") {
    print(`[Stage2][MonsterManager] native damage clamp unavailable ${data.name}`)
    return
  }

  const getDamageValue = damageApi.get_damage_value
  const originalDamage = type(getDamageValue) === "function"
    ? (getDamageValue as (damage: Damage) => Fixed)(damageData._dmg)
    : math.tofixed(-1)
  const attackDamage = math.tofixed(PlayerStats.GetAttack(role))
  const nativeDamage = clamp(attackDamage, math.tofixed(0), data.hp)
  ;(setDamageValue as (damage: Damage, value: Fixed) => void)(damageData._dmg, nativeDamage)
  print(
    `[Stage2][MonsterManager] native damage clamped` +
      ` name=${data.name}` +
      ` role=${tostring(role.get_roleid())}` +
      ` original=${tostring(originalDamage)}` +
      ` atk=${tostring(attackDamage)}` +
      ` native=${tostring(nativeDamage)}` +
      ` hp=${hpText(data)}`
  )
}

function syncEngineStats(data: MonsterData): void {
  const unit = data.unit
  safeVoid(() => {
    unit.set_hp_max(data.config.maxHp)
  }, { tag: `Monster set_hp_max ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    unit.set_attr_by_type(Enums.ValueType.Fixed, "hp_max", data.config.maxHp)
  }, { tag: `Monster set hp_max attr ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    unit.set_attr_ratio_fixed("move_speed", data.config.moveSpeed - math.tofixed(1))
  }, { tag: `Monster set move_speed ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    unit.set_hpbar_scale(math.tofixed(1), math.tofixed(1))
  }, { tag: `Monster set_hpbar_scale ${data.name}`, logger: (msg: string) => print(msg) })
}

function syncEngineHp(data: MonsterData): void {
  const unit = data.unit
  const targetHp = data.dead ? math.tofixed(0) : data.hp
  const currentHp = safeCall(
    () => unit.get_hp(),
    { tag: `Monster get_hp ${data.name}`, fallback: undefined, logger: (msg: string) => print(msg) }
  )
  if (currentHp === undefined) {
    return
  }

  const delta = targetHp - currentHp
  if (delta !== 0) {
    safeVoid(() => {
      unit.change_hp(delta)
    }, { tag: `Monster change_hp ${data.name}`, logger: (msg: string) => print(msg) })
  }
}

function refreshDisplay(data: MonsterData): void {
  const unit = data.unit
  if (data.dead) {
    destroyAbcHpbar(data, "dead")
    safeVoid(() => {
      unit.set_name_visible(false)
    }, { tag: `Monster hide name ${data.name}`, logger: (msg: string) => print(msg) })
    safeVoid(() => {
      unit.set_attr_by_type(Enums.ValueType.HpBarDisplayMode, "HpBarDisplayMode", Enums.HpBarDisplayMode.NONE)
    }, { tag: `Monster hide hpbar ${data.name}`, logger: (msg: string) => print(msg) })
    return
  }

  syncEngineStats(data)
  syncEngineHp(data)
  ensureAbcHpbarForC(data)
  safeVoid(() => {
    unit.set_name(monsterHpNameText(data))
  }, { tag: `Monster set_name ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    unit.set_name_visible(true)
  }, { tag: `Monster show name ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    unit.set_mass_bar_visible(false)
  }, { tag: `Monster hide native mass bar ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    unit.set_attr_by_type(
      Enums.ValueType.HpBarDisplayMode,
      "HpBarDisplayMode",
      Enums.HpBarDisplayMode.NONE
    )
  }, { tag: `Monster hide native hpbar ${data.name}`, logger: (msg: string) => print(msg) })
}

function hideMonster(data: MonsterData): void {
  destroyAbcHpbar(data, "hide")
  safeVoid(() => {
    data.unit.stop_ai()
  }, { tag: `Monster stop_ai ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    data.unit.force_stop_move()
  }, { tag: `Monster force_stop_move hide ${data.name}`, logger: (msg: string) => print(msg) })
  data.aiState = "idle"
  data.chaseRoleId = undefined
  safeVoid(() => {
    data.unit.set_model_visible(false)
  }, { tag: `Monster hide model ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    data.unit.set_physics_active(false)
  }, { tag: `Monster disable physics ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    data.unit.set_name_visible(false)
  }, { tag: `Monster hide name ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    data.unit.set_attr_by_type(Enums.ValueType.HpBarDisplayMode, "HpBarDisplayMode", Enums.HpBarDisplayMode.NONE)
  }, { tag: `Monster hide hpbar ${data.name}`, logger: (msg: string) => print(msg) })
}

function resolveRewardRole(data: MonsterData, role: Role | undefined): Role | undefined {
  if (role !== undefined) {
    return role
  }

  const lastHitRole = roleById(data.lastHitRoleId)
  if (lastHitRole !== undefined) {
    return lastHitRole
  }

  return firstValidRole()
}

function awardKillExp(data: MonsterData, role: Role | undefined): void {
  const rewardRole = resolveRewardRole(data, role)
  if (rewardRole === undefined || data.expAwarded) {
    return
  }

  data.expAwarded = true
  PlayerStats.AddExp(rewardRole, data.config.killExp)
  print(
    `[Stage4][MonsterManager] kill exp ${data.name}` +
      ` id=${tostring(data.unitId)}` +
      ` role=${rewardRole === undefined ? "nil" : tostring(rewardRole.get_roleid())}` +
      ` lastHit=${data.lastHitRoleId === undefined ? "nil" : tostring(data.lastHitRoleId)}` +
      ` exp=${tostring(data.config.killExp)}` +
      ` kind=${data.config.kind}`
  )
}

function notifyMonsterKilled(data: MonsterData, role: Role | undefined): void {
  const rewardRole = resolveRewardRole(data, role)
  for (const listener of monsterKilledListeners) {
    listener(data.name, data.unitId, rewardRole)
  }
}

function killMonster(data: MonsterData, role: Role | undefined): void {
  if (data.dead) {
    awardKillExp(data, role)
    return
  }

  data.dead = true
  data.hp = math.tofixed(0)
  awardKillExp(data, role)
  notifyMonsterKilled(data, role)
  hideMonster(data)
  print(
    `[Stage2][MonsterManager] dead ${data.name}` +
      ` kind=${data.config.kind}` +
      " revive=disabled"
  )
}

function recoverFromUnauthorizedEngineDeath(data: MonsterData, reason: string = "blocked unauthorized death"): void {
  safeVoid(() => {
    data.unit.set_model_visible(true)
  }, { tag: `Monster recover show model ${data.name}`, logger: (msg: string) => print(msg) })
  safeVoid(() => {
    data.unit.set_physics_active(true)
  }, { tag: `Monster recover enable physics ${data.name}`, logger: (msg: string) => print(msg) })
  refreshDisplay(data)
  print(`[Stage2][MonsterManager] ${reason} ${data.name} hp=${hpText(data)}`)
}

function syncFromEngine(data: MonsterData): void {
  if (data.dead) {
    return
  }

  refreshDisplay(data)
}

function handleEngineDamage(data: MonsterData, eventData: unknown): void {
  if (data.dead) {
    return
  }

  data.engineEventSeq = data.engineEventSeq + 1
  data.lastEngineDamageEventSeq = data.engineEventSeq

  const handled = engineDamageInterceptor !== undefined && engineDamageInterceptor(data, eventData)
  if (handled) {
    return
  }

  syncFromEngine(data)
  print(`[Stage2][MonsterManager] blocked unauthorized damage ${data.name} hp=${hpText(data)}`)
}

function hasDamageEventImmediatelyBeforeDeath(data: MonsterData): boolean {
  return data.lastEngineDamageEventSeq !== undefined &&
    data.lastEngineDamageEventSeq === data.engineEventSeq - 1
}

function initMonsterUnit(unit: Creature, editorUnitId: UnitID, specName?: string, specKind?: MonsterKind): void {
  const unitId = unit.get_id()
  if (monstersByUnitId[unitId] !== undefined || monstersByUnitId[editorUnitId] !== undefined) {
    return
  }
  if (specName !== undefined && monstersByName[specName] !== undefined) {
    return
  }

  const actualName = unit.get_name()
  const name = specName === undefined ? actualName : specName
  const kind = specKind === undefined ? monsterKindOfName(actualName) : specKind
  if (kind === undefined) {
    print(
      `[Stage2][MonsterManager] monster kind missing` +
        ` name=${actualName}` +
        ` id=${tostring(unitId)}` +
        ` editorId=${tostring(editorUnitId)}`
    )
    return
  }

  const config = MONSTER_CONFIG[kind]
  const data: MonsterData = {
    unitId,
    name,
    unit,
    config,
    bornPos: unit.get_position(),
    hp: config.maxHp,
    dead: false,
    expAwarded: false,
    aiState: "idle",
    collisionAttackCooling: false,
    returnMoveBlocked: false,
    engineEventSeq: 0,
  }
  if (specName !== undefined) {
    monstersByName[specName] = data
  }
  monstersByName[name] = data
  monstersByName[actualName] = data
  monstersByUnitId[unitId] = data
  monstersByUnitId[editorUnitId] = data
  allMonsters[allMonsters.length] = data

  syncEngineStats(data)
  syncEngineHp(data)
  unit.set_auto_reborn_enabled(false)
  unit.set_infinite_reborn_enabled(false)
  configureStage6Ai(data)
  refreshDisplay(data)

  data.damageBeforeEventId = LuaAPI.unit_register_trigger_event(unit, [EVENT.SPEC_LIFEENTITY_DMGED_BEFORE], (_: string, __: unknown, eventData: unknown) => {
    clampNativeDamageToPlayerAttack(data, eventData)
  })
  data.damageEventId = LuaAPI.unit_register_trigger_event(unit, [EVENT.SPEC_LIFEENTITY_DMGED_AFTER], (_: string, __: unknown, eventData: unknown) => {
    handleEngineDamage(data, eventData)
  })
  data.dieEventId = LuaAPI.unit_register_trigger_event(unit, [EVENT.SPEC_LIFEENTITY_DIE], (_: string, __: unknown, eventData: unknown) => {
    data.engineEventSeq = data.engineEventSeq + 1
    const role = roleFromDeathEvent(eventData)
    if (data.dead || data.hp <= math.tofixed(0)) {
      killMonster(data, role)
      return
    }

    if (hasDamageEventImmediatelyBeforeDeath(data)) {
      recoverFromUnauthorizedEngineDeath(data, "restore engine death after damage event")
      return
    }

    if (engineDeathInterceptor !== undefined && engineDeathInterceptor(data, eventData)) {
      if (!data.dead) {
        recoverFromUnauthorizedEngineDeath(data, "restore engine death after one scripted hit")
      }
      return
    }

    recoverFromUnauthorizedEngineDeath(data, "restore unauthorized engine death")
    print(`[Stage2][MonsterManager] blocked unauthorized death ${data.name} hp=${hpText(data)}`)
  })
  data.contactEventId = LuaAPI.unit_register_trigger_event(unit, [EVENT.SPEC_LIFEENTITY_CONTACT_BEGIN], (_: string, __: unknown, eventData: unknown) => {
    const contactData = eventData as { unit2?: Unit }
    tryCollisionAttack(data, contactData.unit2)
  })

  print(
    `[Stage2][MonsterManager] init ${name}` +
      ` id=${tostring(unitId)}` +
      ` editorId=${tostring(editorUnitId)}` +
      ` kind=${kind}` +
      ` sceneName=${actualName}` +
      ` hp=${hpText(data)}` +
      ` attack=${tostring(config.attack)}` +
      ` moveSpeed=${tostring(config.moveSpeed)}` +
      ` killExp=${tostring(config.killExp)}` +
      ` detectRange=${tostring(AI_DETECT_RANGE)}`
  )
}

function initMonster(spec: MonsterSpec): void {
  if (monstersByUnitId[spec.unitId] !== undefined) {
    return
  }

  const unitById = GameAPI.get_unit(spec.unitId) as unknown as Creature | undefined
  const unit = unitById === undefined && spec.name !== undefined ? (LuaAPI.query_unit(spec.name) as unknown as Creature | undefined) : unitById
  if (unit === undefined) {
    print(`[Stage2][MonsterManager] monster missing name=${spec.name === undefined ? "nil" : spec.name} id=${tostring(spec.unitId)}`)
    return
  }

  initMonsterUnit(unit, spec.unitId, spec.name, spec.kind)
}

function initSceneNamedMonsters(): void {
  const units = GameAPI.get_all_lifientities()
  for (const unit of units) {
    const kind = monsterKindOfName(unit.get_name())
    if (kind !== undefined) {
      initMonsterUnit(unit as unknown as Creature, unit.get_id(), undefined, kind)
    }
  }
}

export function InitAllMonsters(): void {
  for (const spec of MONSTER_SPECS) {
    initMonster(spec)
  }
  initSceneNamedMonsters()

  ensureStage6AiTick()
}

export function GetMonster(name: string): MonsterData | undefined {
  return monstersByName[name]
}

export function GetMonsterByUnit(unit: Unit | undefined): MonsterData | undefined {
  if (unit === undefined) {
    return undefined
  }

  return monstersByUnitId[unit.get_id()]
}

export function FindNearestMonster(position: Vector3, maxRange: Fixed): MonsterData | undefined {
  const maxRangeSq = maxRange * maxRange
  let best: MonsterData | undefined
  let bestDistSq = maxRangeSq

  for (const data of allMonsters) {
    if (data.dead) {
      continue
    }

    const monsterPos = data.unit.get_position()
    const dx = monsterPos.x - position.x
    const dy = monsterPos.y - position.y
    const dz = monsterPos.z - position.z
    const distSq = dx * dx + dy * dy + dz * dz
    if (distSq <= bestDistSq) {
      best = data
      bestDistSq = distSq
    }
  }

  return best
}

export function SetEngineDamageInterceptor(interceptor: EngineDamageInterceptor): void {
  engineDamageInterceptor = interceptor
}

export function SetEngineDeathInterceptor(interceptor: EngineDamageInterceptor): void {
  engineDeathInterceptor = interceptor
}

export function OnMonsterKilled(listener: MonsterKilledListener): void {
  monsterKilledListeners[monsterKilledListeners.length] = listener
}

export function IsLineBlockedBySceneObstacle(from: Vector3, to: Vector3): boolean {
  return isLineBlockedBySceneObstacle(from, to)
}

export function ApplyDamage(name: string, damage: Fixed, killerRole?: Role): DamageResult | undefined {
  const data = monstersByName[name]
  if (data === undefined || data.dead) {
    return undefined
  }

  const oldHp = data.hp
  data.hp = clamp(data.hp - damage, math.tofixed(0), data.config.maxHp)
  const result: DamageResult = {
    oldHp,
    newHp: data.hp,
    maxHp: data.config.maxHp,
    applied: oldHp - data.hp,
    dead: data.hp <= math.tofixed(0),
  }

  if (data.hp <= math.tofixed(0)) {
    killMonster(data, killerRole)
    return result
  }

  refreshDisplay(data)
  return result
}

export function ApplyDamageFromRole(name: string, role: Role, damage: Fixed): void {
  const data = monstersByName[name]
  if (data === undefined || data.dead) {
    return
  }

  data.lastHitRoleId = role.get_roleid()
  const result = ApplyDamage(name, damage, role)
  if (result !== undefined) {
    const oldHpText = tostring(math.tointeger(result.oldHp))
    const newHpText = tostring(math.tointeger(result.newHp))
    const maxHpText = tostring(math.tointeger(result.maxHp))
    const appliedText = tostring(math.tointeger(result.applied))
    const feedback = `${name} HP ${oldHpText} -> ${newHpText}/${maxHpText} (-${appliedText})`
    role.show_tips(feedback, math.tofixed(1.5))
    if (!result.dead) {
      data.unit.show_bubble_msg(feedback, math.tofixed(1.2), math.tofixed(60), math.Vector3(0, 2.2, 0))
    }
  }
  print(
    `[Stage3][MonsterManager] authorized hit ${name}` +
      ` role=${tostring(role.get_roleid())}` +
      ` damage=${tostring(damage)}` +
      ` hp=${data.dead ? "0" : hpText(data)}`
  )
}

export function ApplyDamageFromRoleByUnit(unit: Unit | undefined, role: Role, damage: Fixed): void {
  const data = GetMonsterByUnit(unit)
  if (data === undefined) {
    print(
      `[Stage4][MonsterManager] damage target not registered` +
        ` unit=${unit === undefined ? "nil" : tostring(unit.get_id())}` +
        ` role=${tostring(role.get_roleid())}`
    )
    return
  }

  ApplyDamageFromRole(data.name, role, damage)
}
