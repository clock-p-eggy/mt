import { log } from "@common/utils"

type UnitTriggerState = {
  unit: Unit
  ids: number[]
}

type WeaponKind = "咸鱼" | "突击步枪" | "炸弹"

type PlayerWeaponState = {
  kind: WeaponKind
  nextAttackAt: number
}

type MutantRuntime = {
  id: number
  name: string
  unit: Unit
  lifeEntity: LifeEntity | null
  hp: number
  maxHp: number
  attack: number
  moveSpeed: number
  nextHitByRoleId: Map<RoleID, number>
  nextContactAttackByRoleId: Map<RoleID, number>
  triggers: number[]
  dead: boolean
}

type MoveSpeedUnit = {
  set_move_speed(this: void, speed: Fixed): void
}

const PLAYER_HP = 10
const PLAYER_ATTACK = 4
const PLAYER_MOVE_SPEED = 4

const MUTANT_HP = 10
const MUTANT_ATTACK = 2
const MUTANT_MOVE_SPEED = 4

const AI_TICK = 0.1
const DISCOVER_TICK = 1
const CONTACT_RADIUS = 1.4
const CONTACT_RADIUS_SQ = CONTACT_RADIUS * CONTACT_RADIUS
const MUTANT_ATTACK_COOLDOWN = 0.7
const PLAYER_MELEE_COOLDOWN = 0.45
const RIFLE_ATTACK_COOLDOWN = 0.55
const RIFLE_RANGE = 14
const BOMB_RANGE = 5

const weaponPool: WeaponKind[] = ["咸鱼", "突击步枪", "炸弹"]

const mutantNameGroups: ReadonlyArray<ReadonlyArray<string>> = [
  ["变异蛋C1", "变异蛋 C1", "变异蛋_C1", "变异蛋-C1"],
  ["变异蛋C2", "变异蛋 C2", "变异蛋_C2", "变异蛋-C2"],
  ["变异蛋C3", "变异蛋 C3", "变异蛋_C3", "变异蛋-C3"],
]

const mutantsByUnitId: Map<number, MutantRuntime> = new Map()
const playerTriggersByRoleId: Map<RoleID, UnitTriggerState> = new Map()
const playerWeaponByRoleId: Map<RoleID, PlayerWeaponState> = new Map()
const deadMutantIds: Set<number> = new Set()

let initialized = false
let aiTickStarted = false
let discoverStarted = false
let abilityHitTriggerId: number | null = null

function nowSeconds(): number {
  const ts = GameAPI.get_timestamp() as unknown as Fixed
  try {
    return math.toreal(ts)
  } catch {
    const n = tonumber(ts as unknown as number) as number | undefined
    return typeof n === "number" && n === n ? n : 0
  }
}

function distanceSqXZ(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function normalizeXZ(from: Vector3, to: Vector3): Vector3 {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len <= 0.00001) return math.Vector3(0, 0, 0)
  return math.Vector3(dx / len, 0, dz / len)
}

function getUnitId(unit: Unit): number | null {
  try {
    return LuaAPI.get_unit_id(unit)
  } catch {
    return null
  }
}

function isSameUnit(a: Unit, b: Unit): boolean {
  if (a === b) return true
  const aId = getUnitId(a)
  const bId = getUnitId(b)
  return aId !== null && bId !== null && aId === bId
}

function getLifeEntity(unit: Unit): LifeEntity | null {
  const maybe = unit as unknown as LifeEntity
  try {
    maybe.get_hp()
    return maybe
  } catch {
    return null
  }
}

function isRoleCtrl(unit: Unit, role: Role): boolean {
  try {
    return isSameUnit(unit, role.get_ctrl_unit())
  } catch {
    return false
  }
}

function roleByCtrlUnit(unit: Unit): Role | null {
  const roles = GameAPI.get_all_roles()
  for (const role of roles) {
    if (isRoleCtrl(unit, role)) return role
  }
  return null
}

function getNearestRole(pos: Vector3): Role | null {
  const roles = GameAPI.get_all_roles()
  let best: Role | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const role of roles) {
    let ctrl: Character
    let ctrlPos: Vector3
    try {
      ctrl = role.get_ctrl_unit()
      if (ctrl.is_die_status()) continue
      ctrlPos = ctrl.get_position()
    } catch {
      continue
    }
    const distSq = distanceSqXZ(pos, ctrlPos)
    if (distSq < bestDist) {
      bestDist = distSq
      best = role
    }
  }
  return best
}

function isMutantName(name: string): boolean {
  for (let i = 0; i < mutantNameGroups.length; i++) {
    const group = mutantNameGroups[i]!
    for (let j = 0; j < group.length; j++) {
      if (name === group[j]) return true
    }
  }
  return false
}

function findMutantByUnit(unit: Unit): MutantRuntime | null {
  const unitId = getUnitId(unit)
  if (unitId !== null) {
    const rt = mutantsByUnitId.get(unitId)
    if (rt !== undefined) return rt
  }

  for (const rt of mutantsByUnitId.values()) {
    if (isSameUnit(rt.unit, unit)) return rt
  }
  return null
}

function applyPlayerStats(role: Role): void {
  let ctrl: Character
  try {
    ctrl = role.get_ctrl_unit()
  } catch {
    return
  }

  try {
    ctrl.set_hp_max(math.tofixed(PLAYER_HP))
    const current = ctrl.get_hp() as unknown as number
    ctrl.change_hp(math.tofixed(PLAYER_HP - current))
  } catch (e) {
    GlobalAPI.warning(`[Combat] set player hp failed role=${tostring(role.get_roleid())} err=${tostring(e)}`)
  }

  try {
    ;(ctrl as unknown as MoveSpeedUnit).set_move_speed(math.tofixed(PLAYER_MOVE_SPEED))
  } catch (e) {
    GlobalAPI.warning(`[Combat] set player speed failed role=${tostring(role.get_roleid())} err=${tostring(e)}`)
  }

  try {
    ctrl.set_kv_by_type(Enums.ValueType.Int, "combatMaxHp", PLAYER_HP)
    ctrl.set_kv_by_type(Enums.ValueType.Int, "combatAttack", PLAYER_ATTACK)
    ctrl.set_kv_by_type(Enums.ValueType.Int, "combatMoveSpeed", PLAYER_MOVE_SPEED)
  } catch {
    // ignore
  }
}

function damagePlayer(role: Role, mutant: MutantRuntime): void {
  const now = nowSeconds()
  const roleId = role.get_roleid()
  const next = mutant.nextHitByRoleId.get(roleId)
  if (next !== undefined && now < next) return
  mutant.nextHitByRoleId.set(roleId, now + MUTANT_ATTACK_COOLDOWN)

  let ctrl: Character
  try {
    ctrl = role.get_ctrl_unit()
    if (ctrl.is_die_status()) return
  } catch {
    return
  }

  try {
    GameAPI.deal_damage(ctrl, math.tofixed(mutant.attack), mutant.unit)
  } catch {
    try {
      ctrl.change_hp(math.tofixed(-mutant.attack))
    } catch {
      // ignore
    }
  }

  try {
    role.show_tips(`受到${mutant.name}撞击 -${tostring(mutant.attack)}`, 0.8 as Fixed)
  } catch {
    // ignore
  }
}

function damageMutant(mutant: MutantRuntime, amount: number, src?: Unit, hintRole?: Role): void {
  if (mutant.dead) return
  const dmg = amount > 0 ? Math.floor(amount) : 0
  if (dmg <= 0) return

  mutant.hp -= dmg
  try {
    mutant.unit.set_kv_by_type(Enums.ValueType.Int, "combatHp", mutant.hp > 0 ? mutant.hp : 0)
  } catch {
    // ignore
  }

  if (hintRole !== undefined) {
    try {
      hintRole.show_tips(`${mutant.name} -${tostring(dmg)} HP ${tostring(mutant.hp > 0 ? mutant.hp : 0)}/${tostring(mutant.maxHp)}`, 0.8 as Fixed)
    } catch {
      // ignore
    }
  }

  if (mutant.hp > 0) return

  mutant.dead = true
  deadMutantIds.add(mutant.id)
  try {
    if (mutant.lifeEntity !== null) {
      mutant.lifeEntity.die(src)
    } else {
      GameAPI.destroy_unit(mutant.unit)
    }
  } catch {
    try {
      GameAPI.destroy_unit(mutant.unit)
    } catch {
      // ignore
    }
  }

  log(`[Combat] mutant defeated name=${mutant.name} id=${tostring(mutant.id)}`)
}

function playerAttackMutant(role: Role, mutant: MutantRuntime, forcedKind?: WeaponKind): void {
  const roleId = role.get_roleid()
  const weapon = playerWeaponByRoleId.get(roleId)
  const kind = forcedKind !== undefined ? forcedKind : weapon?.kind
  if (kind === undefined) return

  const now = nowSeconds()
  const next = mutant.nextContactAttackByRoleId.get(roleId)
  if (next !== undefined && now < next) return
  mutant.nextContactAttackByRoleId.set(roleId, now + PLAYER_MELEE_COOLDOWN)

  let damage = PLAYER_ATTACK
  if (kind === "炸弹") {
    damage = PLAYER_ATTACK
    playerWeaponByRoleId.delete(roleId)
  }

  damageMutant(mutant, damage, role.get_ctrl_unit(), role)
}

function nearestMutant(pos: Vector3, maxRange: number): MutantRuntime | null {
  let best: MutantRuntime | null = null
  let bestDist = maxRange * maxRange
  for (const mutant of mutantsByUnitId.values()) {
    if (mutant.dead) continue
    let p: Vector3
    try {
      p = mutant.unit.get_position()
    } catch {
      continue
    }
    const d = distanceSqXZ(pos, p)
    if (d <= bestDist) {
      bestDist = d
      best = mutant
    }
  }
  return best
}

function tickPlayerWeapons(): void {
  const now = nowSeconds()
  for (const [roleId, weapon] of playerWeaponByRoleId) {
    if (weapon.kind !== "突击步枪" && weapon.kind !== "炸弹") continue
    if (now < weapon.nextAttackAt) continue

    let role: Role | null = null
    const roles = GameAPI.get_all_roles()
    for (const r of roles) {
      if (r.get_roleid() === roleId) {
        role = r
        break
      }
    }
    if (role === null) continue

    let pos: Vector3
    try {
      pos = role.get_ctrl_unit().get_position()
    } catch {
      continue
    }

    if (weapon.kind === "突击步枪") {
      const target = nearestMutant(pos, RIFLE_RANGE)
      if (target !== null) {
        weapon.nextAttackAt = now + RIFLE_ATTACK_COOLDOWN
        damageMutant(target, PLAYER_ATTACK, role.get_ctrl_unit(), role)
      }
      continue
    }

    const target = nearestMutant(pos, BOMB_RANGE)
    if (target !== null) {
      damageMutant(target, PLAYER_ATTACK, role.get_ctrl_unit(), role)
      playerWeaponByRoleId.delete(roleId)
      try {
        role.show_tips("炸弹已引爆", 0.8 as Fixed)
      } catch {
        // ignore
      }
    }
  }
}

function moveMutants(): void {
  for (const mutant of mutantsByUnitId.values()) {
    if (mutant.dead) continue

    let pos: Vector3
    try {
      pos = mutant.unit.get_position()
    } catch {
      mutant.dead = true
      continue
    }

    const role = getNearestRole(pos)
    if (role === null) continue

    let targetPos: Vector3
    try {
      targetPos = role.get_ctrl_unit().get_position()
    } catch {
      continue
    }

    const distSq = distanceSqXZ(pos, targetPos)
    if (distSq <= CONTACT_RADIUS_SQ) {
      damagePlayer(role, mutant)
      continue
    }

    const dir = normalizeXZ(pos, targetPos)
    if (dir.x === 0 && dir.z === 0) continue

    const step = mutant.moveSpeed * AI_TICK
    const nextPos = math.Vector3(pos.x + dir.x * step, pos.y, pos.z + dir.z * step)
    try {
      if (mutant.lifeEntity !== null) {
        mutant.lifeEntity.set_direction(dir)
        mutant.lifeEntity.start_move_to_pos_with_threshold(nextPos, math.tofixed(AI_TICK), math.tofixed(0.2))
      } else {
        mutant.unit.set_position(nextPos)
      }
    } catch {
      try {
        mutant.unit.set_position(nextPos)
      } catch {
        // ignore
      }
    }
  }
}

function registerMutant(unit: Unit, label: string): void {
  const unitId = getUnitId(unit)
  if (unitId === null || deadMutantIds.has(unitId) || mutantsByUnitId.has(unitId)) return

  const lifeEntity = getLifeEntity(unit)
  const name = label
  const mutant: MutantRuntime = {
    id: unitId,
    name,
    unit,
    lifeEntity,
    hp: MUTANT_HP,
    maxHp: MUTANT_HP,
    attack: MUTANT_ATTACK,
    moveSpeed: MUTANT_MOVE_SPEED,
    nextHitByRoleId: new Map(),
    nextContactAttackByRoleId: new Map(),
    triggers: [],
    dead: false,
  }

  try {
    unit.set_kv_by_type(Enums.ValueType.Str, "combatType", "mutantEgg")
    unit.set_kv_by_type(Enums.ValueType.Int, "combatHp", MUTANT_HP)
    unit.set_kv_by_type(Enums.ValueType.Int, "combatAttack", MUTANT_ATTACK)
    unit.set_kv_by_type(Enums.ValueType.Int, "combatMoveSpeed", MUTANT_MOVE_SPEED)
  } catch {
    // ignore
  }

  if (lifeEntity !== null) {
    try {
      lifeEntity.set_hp_max(math.tofixed(MUTANT_HP))
      const current = lifeEntity.get_hp() as unknown as number
      lifeEntity.change_hp(math.tofixed(MUTANT_HP - current))
    } catch {
      // ignore
    }
    try {
      ;(lifeEntity as unknown as MoveSpeedUnit).set_move_speed(math.tofixed(MUTANT_MOVE_SPEED))
    } catch {
      // ignore
    }
  }

  try {
    const id = LuaAPI.unit_register_trigger_event(
      unit,
      [EVENT.SPEC_OBSTACLE_CONTACT_BEGIN],
      function (_event_name: unknown, _actor: unknown, data: { unit1: Obstacle; unit2: Unit }) {
        const role = roleByCtrlUnit(data.unit2)
        if (role !== null) damagePlayer(role, mutant)
      }
    )
    mutant.triggers.push(id)
  } catch {
    // This event only exists for Obstacle; creatures are handled by distance tick/player contact.
  }

  try {
    const id = LuaAPI.unit_register_trigger_event(
      unit,
      [EVENT.SPEC_OBSTACLE_ON_DAMAGED],
      function (_event_name: unknown, _actor: unknown, data: { src: Unit; damage: Fixed }) {
        const srcRole = roleByCtrlUnit(data.src)
        const raw = data.damage as unknown as number
        const amount = typeof raw === "number" && raw === raw ? raw : PLAYER_ATTACK
        damageMutant(mutant, amount, data.src, srcRole === null ? undefined : srcRole)
      }
    )
    mutant.triggers.push(id)
  } catch {
    // ignore
  }

  mutantsByUnitId.set(unitId, mutant)
  log(`[Combat] registered mutant ${name} id=${tostring(unitId)} lifeEntity=${tostring(lifeEntity !== null)}`)
}

function queryUnitByName(name: string): Unit | null {
  try {
    const unit = LuaAPI.query_unit(name)
    if (unit !== null && unit !== undefined) return unit
  } catch {
    // ignore
  }
  return null
}

function discoverMutants(): void {
  for (const group of mutantNameGroups) {
    for (let i = 0; i < group.length; i++) {
      const name = group[i]!
      const unit = queryUnitByName(name)
      if (unit !== null) {
        registerMutant(unit, name)
      }
    }
  }

  try {
    const obstacles = GameAPI.get_all_obstacles()
    for (const obstacle of obstacles) {
      const name = obstacle.get_name()
      if (isMutantName(name)) {
        registerMutant(obstacle, name)
      }
    }
  } catch {
    // ignore
  }

  try {
    const creatures = GameAPI.get_all_creatures()
    for (const creature of creatures) {
      const name = creature.get_name()
      if (isMutantName(name)) {
        registerMutant(creature, name)
      }
    }
  } catch {
    // ignore
  }
}

function startDiscoverLoop(): void {
  if (discoverStarted) return
  discoverStarted = true

  function tick(): void {
    discoverMutants()
    LuaAPI.call_delay_time(math.tofixed(DISCOVER_TICK), tick)
  }

  tick()
}

function startAiTick(): void {
  if (aiTickStarted) return
  aiTickStarted = true

  function tick(): void {
    moveMutants()
    tickPlayerWeapons()
    LuaAPI.call_delay_time(math.tofixed(AI_TICK), tick)
  }

  LuaAPI.call_delay_time(math.tofixed(AI_TICK), tick)
}

function grantRandomWeapon(role: Role): void {
  const roll = GameAPI.random_int(1, weaponPool.length)
  const kind = weaponPool[roll - 1]!
  playerWeaponByRoleId.set(role.get_roleid(), {
    kind,
    nextAttackAt: 0,
  })

  try {
    role.show_tips(`获得道具：${kind}`, 1.2 as Fixed)
  } catch {
    // ignore
  }
}

export const CombatSystem = {
  init(): void {
    if (initialized) return
    initialized = true
    startDiscoverLoop()
    startAiTick()

    try {
      abilityHitTriggerId = LuaAPI.global_register_trigger_event(
        [EVENT.ABILITY_BULLET_HIT],
        function (_event_name: unknown, _actor: unknown, data: { unit: Unit; target_unit: Unit; dmg: Fixed }) {
          const mutant = findMutantByUnit(data.target_unit)
          if (mutant === null) return
          const role = roleByCtrlUnit(data.unit)
          const raw = data.dmg as unknown as number
          const damage = typeof raw === "number" && raw === raw && raw > 0 ? raw : PLAYER_ATTACK
          damageMutant(mutant, damage, data.unit, role === null ? undefined : role)
        }
      )
    } catch (e) {
      abilityHitTriggerId = null
      GlobalAPI.warning(`[Combat] register ABILITY_BULLET_HIT failed: ${tostring(e)}`)
    }
  },

  initPlayer(role: Role): void {
    this.init()
    const roleId = role.get_roleid()
    applyPlayerStats(role)

    if (playerTriggersByRoleId.has(roleId)) return

    let ctrl: Character
    try {
      ctrl = role.get_ctrl_unit()
    } catch {
      return
    }

    const ids: number[] = []
    try {
      const id = LuaAPI.unit_register_trigger_event(
        ctrl,
        [EVENT.SPEC_LIFEENTITY_GET_ITEMBOX],
        function (_event_name: unknown, _actor: unknown, _data: { life_entity: LifeEntity }) {
          grantRandomWeapon(role)
        }
      )
      ids.push(id)
    } catch (e) {
      GlobalAPI.warning(`[Combat] register item box trigger failed role=${tostring(roleId)} err=${tostring(e)}`)
    }

    try {
      const id = LuaAPI.unit_register_trigger_event(
        ctrl,
        [EVENT.SPEC_LIFEENTITY_CONTACT_BEGIN],
        function (_event_name: unknown, _actor: unknown, data: { unit1: LifeEntity; unit2: Unit }) {
          const mutant = findMutantByUnit(data.unit2)
          if (mutant === null) return
          damagePlayer(role, mutant)
          playerAttackMutant(role, mutant)
        }
      )
      ids.push(id)
    } catch (e) {
      GlobalAPI.warning(`[Combat] register player contact trigger failed role=${tostring(roleId)} err=${tostring(e)}`)
    }

    playerTriggersByRoleId.set(roleId, { unit: ctrl, ids })
  },

  cleanupPlayer(role: Role): void {
    const roleId = role.get_roleid()
    const st = playerTriggersByRoleId.get(roleId)
    if (st !== undefined) {
      for (let i = 0; i < st.ids.length; i++) {
        try {
          LuaAPI.unit_unregister_trigger_event(st.unit, st.ids[i]!)
        } catch {
          // ignore
        }
      }
      playerTriggersByRoleId.delete(roleId)
    }
    playerWeaponByRoleId.delete(roleId)
  },

  getRegisteredMutantCount(): number {
    return mutantsByUnitId.size
  },

  dispose(): void {
    if (abilityHitTriggerId !== null) {
      try {
        LuaAPI.global_unregister_trigger_event(abilityHitTriggerId)
      } catch {
        // ignore
      }
      abilityHitTriggerId = null
    }
  },
}
