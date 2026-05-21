import { safeCall } from "@common/engine_safe"
import * as MonsterManager from "./MonsterManager"
import * as PlayerStats from "./PlayerStats"

type AttackItemKind = "fish" | "rifle" | "bomb"

interface AttackItemConfig {
  key: EquipmentKey
  abilityKey?: AbilityKey
  kind: AttackItemKind
  name: string
  maxEffectiveHits?: number
}

interface AttackItemState {
  key: EquipmentKey
  kind: AttackItemKind
  roleId: RoleID
  role: Role
  equipment: Equipment
  effectiveHits: number
}

type DamageApi = {
  get_damage_value?: (damage: Damage) => Fixed
  set_damage_value?: (damage: Damage, value: Fixed) => void
}

const ATTACK_ITEMS: AttackItemConfig[] = [
  { key: 6000033, kind: "fish", name: "咸鱼", maxEffectiveHits: 3 },
  { key: 6000026, abilityKey: 10030, kind: "rifle", name: "突击步枪" },
  { key: 6000029, kind: "bomb", name: "炸弹", maxEffectiveHits: 1 },
]

const ITEM_BOX_NAMES = [
  "道具箱16",
  "道具箱15",
  "道具箱14",
  "道具箱13",
  "道具箱12",
  "道具箱11",
  "道具箱10",
  "道具箱9",
  "道具箱8",
  "道具箱1",
]

const itemByKey: Record<number, AttackItemConfig> = {}
const trackedItems: Record<string, AttackItemState> = {}
const latestItemByRoleId: Record<number, string> = {}
const equipmentHitRegistered: Record<string, boolean> = {}
const abilityHitRegistered: Record<string, boolean> = {}
const recentHitTokens: Record<string, boolean> = {}
let initialized = false

for (const config of ATTACK_ITEMS) {
  itemByKey[config.key] = config
}

function equipmentToken(equipment: Equipment): string {
  return tostring(equipment)
}

function abilityToken(ability: Ability): string {
  return tostring(ability)
}

function roleIdOf(role: Role): RoleID {
  return role.get_roleid()
}

function compactDescribe(value: unknown): string {
  if (value === undefined) {
    return "nil"
  }

  const obj = value as {
    get_key?: () => integer
    get_name?: () => string
    get_roleid?: () => RoleID
  }
  let result = `${type(value)}:${tostring(value)}`
  const getKey = obj.get_key
  if (type(getKey) === "function") {
    result = `${result} key=${tostring((getKey as () => integer)())}`
  }
  const getName = obj.get_name
  if (type(getName) === "function") {
    result = `${result} name=${(getName as () => string)()}`
  }
  const getRoleId = obj.get_roleid
  if (type(getRoleId) === "function") {
    result = `${result} role=${tostring((getRoleId as () => RoleID)())}`
  }
  return result
}

function roleFromAny(value: unknown): Role | undefined {
  if (value === undefined) {
    return undefined
  }

  const obj = value as {
    get_role?: () => Role
    get_ctrl_role?: () => Role
    get_owner?: () => LifeEntity
    get_owner_role?: () => Role
    get_owner_character?: () => Unit
    get_owner_creature?: () => Unit
    get_owner_equipment?: () => Equipment
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
    const role = roleFromAny((getOwner as () => LifeEntity)())
    if (role !== undefined) {
      return role
    }
  }
  const getOwnerEquipment = obj.get_owner_equipment
  if (type(getOwnerEquipment) === "function") {
    const role = roleFromAny((getOwnerEquipment as () => Equipment)())
    if (role !== undefined) {
      return role
    }
  }
  const getOwnerCharacter = obj.get_owner_character
  if (type(getOwnerCharacter) === "function") {
    const role = roleFromAny((getOwnerCharacter as () => Unit)())
    if (role !== undefined) {
      return role
    }
  }
  const getOwnerCreature = obj.get_owner_creature
  if (type(getOwnerCreature) === "function") {
    const role = roleFromAny((getOwnerCreature as () => Unit)())
    if (role !== undefined) {
      return role
    }
  }

  return undefined
}

function roleFromEquipment(equipment: Equipment): Role | undefined {
  return roleFromAny(equipment)
}

function onlyValidRole(): Role | undefined {
  const roles = GameAPI.get_all_valid_roles()
  if (roles.length === 1 && !roles[0].is_lost()) {
    return roles[0]
  }

  return undefined
}

function equipmentFromAny(value: unknown): Equipment | undefined {
  if (value === undefined) {
    return undefined
  }

  const obj = value as {
    get_owner_equipment?: () => Equipment
    get_key?: () => EquipmentKey
  }
  const getOwnerEquipment = obj.get_owner_equipment
  if (type(getOwnerEquipment) === "function") {
    return (getOwnerEquipment as () => Equipment)()
  }
  const getKey = obj.get_key
  if (type(getKey) === "function" && itemByKey[(getKey as () => EquipmentKey)()] !== undefined) {
    return value as Equipment
  }

  return undefined
}

function stateFromEquipment(equipment: Equipment | undefined): AttackItemState | undefined {
  if (equipment === undefined) {
    return undefined
  }

  return trackedItems[equipmentToken(equipment)]
}

function attackItemName(key: EquipmentKey): string {
  const config = itemByKey[key]
  return config === undefined ? tostring(key) : config.name
}

function hitToken(role: Role, target: Unit): string {
  return `${tostring(role.get_roleid())}:${tostring(target.get_id())}`
}

function markHitThisFrame(role: Role, target: Unit): boolean {
  const token = hitToken(role, target)
  if (recentHitTokens[token] === true) {
    return false
  }

  recentHitTokens[token] = true
  LuaAPI.call_delay_frame(1, () => {
    delete recentHitTokens[token]
  })
  return true
}

function minFixed(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b
}

function maxEffectiveHits(state: AttackItemState): number {
  const config = itemByKey[state.key]
  if (config !== undefined && config.maxEffectiveHits !== undefined) {
    return config.maxEffectiveHits
  }
  if (state.kind === "rifle") {
    return 30
  }
  return 1
}

function destroyTrackedItem(token: string, reason: string): void {
  const state = trackedItems[token]
  if (state === undefined) {
    return
  }

  if (latestItemByRoleId[state.roleId] === token) {
    delete latestItemByRoleId[state.roleId]
  }

  delete trackedItems[token]
  delete equipmentHitRegistered[token]
  state.equipment.destroy_equipment()
  print(
    `[Stage3][ItemAttack] destroy item=${attackItemName(state.key)}` +
      ` role=${tostring(state.roleId)}` +
      ` reason=${reason}`
  )
}

function noteItemUsed(state: AttackItemState): void {
  print(
    `[Stage3][ItemAttack] use item=${attackItemName(state.key)}` +
      ` key=${tostring(state.key)}` +
      ` role=${tostring(state.roleId)}`
  )
}

function applyHitTargetUnit(target: Unit | undefined, role: Role | undefined, sourceName: string): "applied" | "duplicate" | "no_role" | "no_target" {
  if (role === undefined) {
    return "no_role"
  }
  const typedMonster = MonsterManager.GetMonsterByUnit(target) as unknown as { name: string; unit: Creature; dead?: boolean } | undefined
  if (typedMonster === undefined || typedMonster.dead === true) {
    return "no_target"
  }

  if (!markHitThisFrame(role, typedMonster.unit)) {
    print(
      `[Stage3][ItemAttack] duplicate hit ignored` +
        ` source=${sourceName}` +
        ` monster=${typedMonster.name}` +
        ` role=${tostring(role.get_roleid())}`
    )
    return "duplicate"
  }

  const attack = PlayerStats.GetAttack(role)
  MonsterManager.ApplyDamageFromRoleByUnit(typedMonster.unit, role, math.tofixed(attack))
  print(
    `[Stage3][ItemAttack] hit-event damage` +
      ` source=${sourceName}` +
      ` monster=${typedMonster.name}` +
      ` role=${tostring(role.get_roleid())}` +
      ` attack=${tostring(attack)}`
  )
  return "applied"
}

function abilityFromAny(value: unknown): Ability | undefined {
  if (value === undefined) {
    return undefined
  }

  const obj = value as {
    ability?: Ability
    get_ability_slot?: () => AbilitySlot
    get_key?: () => AbilityKey
  }
  if (obj.ability !== undefined) {
    return obj.ability
  }
  if (type(obj.get_ability_slot) === "function" && type(obj.get_key) === "function") {
    return value as Ability
  }

  return undefined
}

function abilityFromCreationArgs(abilityArg: unknown, ownerArg: unknown, dataArg: unknown): Ability | undefined {
  let ability = abilityFromAny(abilityArg)
  if (ability !== undefined) {
    return ability
  }

  ability = abilityFromAny(ownerArg)
  if (ability !== undefined) {
    return ability
  }

  return abilityFromAny(dataArg)
}

function roleForAbility(ability: Ability | undefined): Role | undefined {
  const role = roleFromAny(ability)
  if (role !== undefined) {
    return role
  }

  return onlyValidRole()
}

function registerAbilityHitEvents(ability: Ability | undefined, role: Role | undefined, reason: string): void {
  if (ability === undefined || role === undefined) {
    return
  }

  const token = abilityToken(ability)
  if (abilityHitRegistered[token] === true) {
    return
  }

  const eventId = safeCall(() => LuaAPI.unit_register_trigger_event(ability as unknown as Unit, [EVENT.ABILITY_BULLET_HIT], (_: string, actor: unknown, eventData: unknown) => {
    const data = eventData as { ability?: Ability; unit?: Unit; target_unit?: Unit; dmg?: Fixed }
    const unitRole = roleFromAny(data.unit)
    const eventRole = unitRole === undefined ? role : unitRole
    const target = data.target_unit
    const state = eventTrackedItem(eventRole, eventData)
    const result = applyHitTargetUnit(
      target,
      eventRole,
      `ability_bullet:${tostring(ability.get_key())}`
    )

    print(
      `[Stage3][Probe] ability bullet hit` +
        ` reason=${reason}` +
        ` actor=${compactDescribe(actor)}` +
        ` ability=${compactDescribe(data.ability)}` +
        ` owner=${compactDescribe(data.unit)}` +
        ` target=${compactDescribe(target)}` +
        ` dmg=${data.dmg === undefined ? "nil" : tostring(data.dmg)}` +
        ` result=${result}`
    )

    if (result === "applied" && state !== undefined) {
      consumeEffectiveHit(state)
    }
  }), { tag: `ItemAttack register ability hit key=${tostring(ability.get_key())}`, fallback: undefined, logger: (msg: string) => print(msg) })

  if (eventId === undefined) {
    print(
      `[Stage3][ItemAttack] register ability hit skipped` +
        ` key=${tostring(ability.get_key())}` +
        ` role=${tostring(role.get_roleid())}` +
        ` reason=${reason}`
    )
    return
  }

  abilityHitRegistered[token] = true

  print(
    `[Stage3][ItemAttack] register ability hit` +
      ` key=${tostring(ability.get_key())}` +
      ` role=${tostring(role.get_roleid())}` +
      ` reason=${reason}`
  )
}

function registerCharacterAbilities(role: Role, reason: string): void {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return
  }

  const abilities = character.get_ability_list()
  for (const ability of abilities) {
    registerAbilityHitEvents(ability, role, reason)
  }

  const propAbility = character.get_prop_ability()
  if (propAbility !== undefined) {
    registerAbilityHitEvents(propAbility, role, `${reason}:prop`)
  }
}

function registerEquipmentHitEvents(equipment: Equipment, role: Role, state: AttackItemState | undefined, reason: string): void {
  const token = equipmentToken(equipment)
  if (equipmentHitRegistered[token] === true) {
    return
  }

  const obstacle = safeCall(
    () => equipment.get_unit(),
    { tag: `ItemAttack get equipment unit key=${tostring(equipment.get_key())}`, fallback: undefined, logger: (msg: string) => print(msg) }
  )
  if (obstacle === undefined) {
    print(
      `[Stage3][ItemAttack] register equipment hit skipped` +
        ` item=${attackItemName(equipment.get_key())}` +
        ` key=${tostring(equipment.get_key())}` +
        ` reason=${reason}` +
        " noUnit=true"
    )
    return
  }

  const eventId = safeCall(() => LuaAPI.unit_register_trigger_event(obstacle as unknown as Unit, [EVENT.SPEC_OBSTACLE_CONTACT_BEGIN], (_: string, actor: unknown, eventData: unknown) => {
    const data = eventData as { unit1?: Obstacle; unit2?: Unit; contact_pos?: Vector3 }
    const result = applyHitTargetUnit(
      data.unit2,
      role,
      `equipment_contact:${attackItemName(equipment.get_key())}`
    )

    print(
      `[Stage3][Probe] equipment contact` +
        ` reason=${reason}` +
        ` actor=${compactDescribe(actor)}` +
        ` item=${attackItemName(equipment.get_key())}` +
        ` key=${tostring(equipment.get_key())}` +
        ` target=${compactDescribe(data.unit2)}` +
        ` result=${result}`
    )

    if (result === "applied" && state !== undefined) {
      consumeEffectiveHit(state)
    }
  }), { tag: `ItemAttack register equipment contact key=${tostring(equipment.get_key())}`, fallback: undefined, logger: (msg: string) => print(msg) })
  if (eventId === undefined) {
    print(
      `[Stage3][ItemAttack] register equipment hit skipped` +
        ` item=${attackItemName(equipment.get_key())}` +
        ` key=${tostring(equipment.get_key())}` +
        ` role=${tostring(role.get_roleid())}` +
        ` reason=${reason}`
    )
    return
  }

  equipmentHitRegistered[token] = true

  const propAbility = (equipment as unknown as { get_prop_ability?: () => Ability }).get_prop_ability
  if (type(propAbility) === "function") {
    registerAbilityHitEvents((propAbility as () => Ability)(), role, `${reason}:equipment_prop`)
  }

  print(
    `[Stage3][ItemAttack] register equipment hit` +
      ` item=${attackItemName(equipment.get_key())}` +
      ` key=${tostring(equipment.get_key())}` +
      ` role=${tostring(role.get_roleid())}` +
      ` reason=${reason}`
  )
}

function clampOutgoingNativeDamage(role: Role, eventData: unknown, sourceName: string): void {
  const data = eventData as { _dst?: Unit; _dmg?: Damage }
  const typedMonster = MonsterManager.GetMonsterByUnit(data._dst) as unknown as { name: string; hp: Fixed; dead?: boolean } | undefined
  if (typedMonster === undefined || typedMonster.dead === true || data._dmg === undefined) {
    return
  }

  const damageApi = GameAPI as unknown as DamageApi
  const setDamageValue = damageApi.set_damage_value
  if (type(setDamageValue) !== "function") {
    print(`[Stage3][ItemAttack] outgoing native damage clamp unavailable monster=${typedMonster.name}`)
    return
  }

  const getDamageValue = damageApi.get_damage_value
  const originalDamage = type(getDamageValue) === "function"
    ? (getDamageValue as (damage: Damage) => Fixed)(data._dmg)
    : math.tofixed(-1)
  const attackDamage = math.tofixed(PlayerStats.GetAttack(role))
  const nativeDamage = minFixed(attackDamage, typedMonster.hp)
  ;(setDamageValue as (damage: Damage, value: Fixed) => void)(data._dmg, nativeDamage)
  print(
    `[Stage3][ItemAttack] outgoing native damage clamped` +
      ` source=${sourceName}` +
      ` monster=${typedMonster.name}` +
      ` role=${tostring(role.get_roleid())}` +
      ` original=${tostring(originalDamage)}` +
      ` atk=${tostring(attackDamage)}` +
      ` native=${tostring(nativeDamage)}`
  )
}

function registerEquipment(equipment: Equipment, role: Role): void {
  const config = itemByKey[equipment.get_key()]
  if (config === undefined) {
    return
  }

  const token = equipmentToken(equipment)
  if (trackedItems[token] !== undefined) {
    return
  }

  const state: AttackItemState = {
    key: config.key,
    kind: config.kind,
    roleId: roleIdOf(role),
    role,
    equipment,
    effectiveHits: 0,
  }
  trackedItems[token] = state
  latestItemByRoleId[state.roleId] = token

  equipment.set_droppable(false)
  equipment.set_usable(true)
  equipment.set_name(config.name)
  equipment.set_current_stack_num(maxEffectiveHits(state))
  equipment.set_max_stack_num(maxEffectiveHits(state))
  registerEquipmentHitEvents(equipment, role, state, "tracked_item")

  const equipmentUnit = equipment as unknown as Unit
  LuaAPI.unit_register_trigger_event(equipmentUnit, [EVENT.SPEC_EQUIPMENT_USE_BEFORE], (_: string, actor: unknown, eventData: unknown) => {
    print(
      `[Stage3][Probe] equipment use before key=${tostring(state.key)}` +
        ` actor=${compactDescribe(actor)}` +
        ` equipment_user=${compactDescribe((eventData as { equipment_user?: unknown }).equipment_user)}`
    )
    noteItemUsed(state)
  })
  LuaAPI.unit_register_trigger_event(equipmentUnit, [EVENT.SPEC_EQUIPMENT_USE], (_: string, actor: unknown, eventData: unknown) => {
    print(
      `[Stage3][Probe] equipment use key=${tostring(state.key)}` +
      ` actor=${compactDescribe(actor)}` +
        ` equipment=${compactDescribe((eventData as { equipment?: unknown }).equipment)}`
    )
  })
  LuaAPI.unit_register_trigger_event(equipmentUnit, [EVENT.SPEC_EQUIPMENT_LOST], () => {
    delete trackedItems[token]
    delete equipmentHitRegistered[token]
  })
  LuaAPI.unit_register_trigger_event(equipmentUnit, [EVENT.SPEC_EQUIPMENT_DESTROY], () => {
    delete trackedItems[token]
    delete equipmentHitRegistered[token]
  })

  role.show_tips(`获得${config.name}`, math.tofixed(1.5))
  print(`[Stage3][ItemAttack] track item=${config.name} key=${tostring(config.key)} role=${tostring(state.roleId)}`)
}

function registerSelectedAttackItem(role: Role, reason: string): void {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return
  }

  const equipment = character.get_selected_equipment()
  if (equipment === undefined) {
    print(`[Stage3][ItemAttack] no selected item after ${reason} role=${tostring(role.get_roleid())}`)
    return
  }

  print(
    `[Stage3][Probe] selected item after ${reason}` +
      ` role=${tostring(role.get_roleid())}` +
      ` equipment=${compactDescribe(equipment)}` +
      ` key=${tostring(equipment.get_key())}`
  )
  registerEquipment(equipment, role)
}

function registerRole(role: Role): void {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return
  }

  LuaAPI.unit_register_trigger_event(character, [EVENT.SPEC_CHARACTER_GET_EQUIPMENT], (_: string, __: unknown, eventData: unknown) => {
    const data = eventData as { equipment?: Equipment }
    print(
      `[Stage3][Probe] character get equipment role=${tostring(role.get_roleid())}` +
        ` equipment=${compactDescribe(data.equipment)}` +
        ` key=${data.equipment === undefined ? "nil" : tostring(data.equipment.get_key())}` +
        ` name=${data.equipment === undefined ? "nil" : data.equipment.get_name()}`
    )
    if (data.equipment !== undefined) {
      if (itemByKey[data.equipment.get_key()] !== undefined) {
        registerEquipment(data.equipment, role)
      } else {
        registerEquipmentHitEvents(data.equipment, role, undefined, "character_get_equipment")
      }
    }
  })

  LuaAPI.unit_register_trigger_event(character, [EVENT.SPEC_LIFEENTITY_DMG_BEFORE], (_: string, __: unknown, eventData: unknown) => {
    clampOutgoingNativeDamage(role, eventData, "role_damage_before")
  })

  LuaAPI.unit_register_trigger_event(character, [EVENT.SPEC_LIFEENTITY_DMG_AFTER], (_: string, actor: unknown, eventData: unknown) => {
    const data = eventData as { _src?: unknown; _dst?: Unit; ability?: Ability; equipment?: Equipment; _dmg?: unknown }
    const state = eventTrackedItem(role, eventData)
    const result = applyHitTargetUnit(data._dst, role, "role_damage_after")
    print(
      `[Stage3][Probe] role damage after` +
        ` actor=${compactDescribe(actor)}` +
        ` src=${compactDescribe(data._src)}` +
        ` dst=${compactDescribe(data._dst)}` +
        ` ability=${compactDescribe(data.ability)}` +
        ` equipment=${compactDescribe(data.equipment)}` +
        ` result=${result}`
    )
    if (result === "applied" && state !== undefined) {
      consumeEffectiveHit(state)
    }
  })

  LuaAPI.unit_register_trigger_event(character, [EVENT.SPEC_LIFEENTITY_ABILITY_OBTAIN], (_: string, actor: unknown, eventData: unknown) => {
    const ability = abilityFromAny(eventData)
    print(
      `[Stage3][Probe] role ability obtain` +
        ` actor=${compactDescribe(actor)}` +
        ` ability=${compactDescribe(ability)}`
    )
    registerAbilityHitEvents(ability, role, "role_ability_obtain")
  })

  registerCharacterAbilities(role, "role_init")
}

function configureItemBoxes(): void {
  for (const name of ITEM_BOX_NAMES) {
    const itemBox = LuaAPI.query_unit(name) as unknown as ItemBox | undefined
    if (itemBox === undefined) {
      print(`[Stage3][ItemAttack] item box missing name=${name}`)
    } else {
      print(`[Stage3][ItemAttack] item box ready name=${name}`)
    }
  }
}

function selectedTrackedItem(role: Role): AttackItemState | undefined {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return undefined
  }

  const selected = character.get_selected_equipment()
  if (selected === undefined) {
    return undefined
  }

  const token = equipmentToken(selected)
  const state = trackedItems[token]
  if (state === undefined || state.roleId !== roleIdOf(role)) {
    return undefined
  }

  return state
}

function eventTrackedItem(role: Role | undefined, eventData: unknown): AttackItemState | undefined {
  const data = eventData as {
    ability?: unknown
    equipment?: Equipment
    _src?: unknown
    unit?: unknown
  }
  const fromEquipment = stateFromEquipment(data.equipment)
  if (fromEquipment !== undefined) {
    return fromEquipment
  }

  const abilityEquipment = equipmentFromAny(data.ability)
  const fromAbility = stateFromEquipment(abilityEquipment)
  if (fromAbility !== undefined) {
    return fromAbility
  }

  const sourceEquipment = equipmentFromAny(data._src)
  const fromSource = stateFromEquipment(sourceEquipment)
  if (fromSource !== undefined) {
    return fromSource
  }

  if (role !== undefined) {
    return selectedTrackedItem(role)
  }

  return undefined
}

function consumeEffectiveHit(state: AttackItemState): void {
  state.effectiveHits = state.effectiveHits + 1

  const maxHits = maxEffectiveHits(state)
  const remaining = maxHits - state.effectiveHits
  state.equipment.set_current_stack_num(remaining < 0 ? 0 : remaining)
  if (state.effectiveHits >= maxHits) {
    destroyTrackedItem(equipmentToken(state.equipment), "effective_hits_used")
  }
}

function handleMonsterEngineHit(monster: unknown, eventData: unknown, reason: string): boolean {
  const typedMonster = monster as { name: string; unit: Creature }
  const data = eventData as { _src?: unknown; _dst?: unknown; ability?: unknown; equipment?: Equipment }
  let role = roleFromAny(data._src)
  if (role === undefined) {
    role = roleFromAny(data.ability)
  }
  if (role === undefined && data.equipment !== undefined) {
    role = roleFromEquipment(data.equipment)
  }
  const roleFromFallback = role === undefined ? onlyValidRole() : undefined
  if (role === undefined) {
    role = roleFromFallback
  }
  print(
    `[Stage3][Probe] monster damaged monster=${typedMonster.name}` +
      ` src=${compactDescribe(data._src)}` +
      ` dst=${compactDescribe(data._dst)}` +
      ` ability=${compactDescribe(data.ability)}` +
      ` equipment=${compactDescribe(data.equipment)}` +
      ` role=${role === undefined ? "nil" : tostring(role.get_roleid())}` +
      ` fallbackRole=${roleFromFallback === undefined ? "nil" : tostring(roleFromFallback.get_roleid())}`
  )
  if (role === undefined) {
    return false
  }

  const state = eventTrackedItem(role, eventData)
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return false
  }

  if (state === undefined) {
    const result = applyHitTargetUnit(typedMonster.unit, role, `monster_${reason}:weapon`)
    return result === "applied" || result === "duplicate"
  }

  print(
    `[Stage3][Probe] item hit accepted item=${attackItemName(state.key)}` +
      ` key=${tostring(state.key)}` +
      ` kind=${state.kind}` +
      ` monster=${typedMonster.name}`
  )
  const result = applyHitTargetUnit(typedMonster.unit, role, `monster_${reason}:${attackItemName(state.key)}`)
  if (result === "applied") {
    consumeEffectiveHit(state)
  }
  return result === "applied" || result === "duplicate"
}

function handleMonsterEngineDamage(monster: unknown, eventData: unknown): boolean {
  return handleMonsterEngineHit(monster, eventData, "damage")
}

function handleMonsterEngineDeath(monster: unknown, eventData: unknown): boolean {
  return handleMonsterEngineHit(monster, eventData, "death")
}

export function GrantRandomAttackItem(role: Role): Equipment | undefined {
  const index = GameAPI.random_int(1, ATTACK_ITEMS.length)
  return GrantAttackItem(role, ATTACK_ITEMS[index - 1].key)
}

export function GrantAttackItem(role: Role, key: EquipmentKey): Equipment | undefined {
  const character = role.get_ctrl_unit()
  if (character === undefined) {
    return undefined
  }

  const config = itemByKey[key]
  if (config === undefined) {
    print(`[Stage3][ItemAttack] unknown item key=${tostring(key)}`)
    return undefined
  }

  const equipment = character.create_equipment_to_slot(config.key, Enums.EquipmentSlotType.BACKPACK)
  character.swap_equipment_slot(equipment, Enums.EquipmentSlotType.EQUIPPED, 1)
  character.select_equipment_slot(Enums.EquipmentSlotType.EQUIPPED, 1)
  registerEquipment(equipment, role)
  return equipment
}

export function DebugUseLatestAttackItem(role: Role): void {
  const token = latestItemByRoleId[roleIdOf(role)]
  const state = token === undefined ? undefined : trackedItems[token]
  if (state === undefined) {
    print(`[Stage3][Debug] no latest attack item role=${tostring(role.get_roleid())}`)
    return
  }

  noteItemUsed(state)
}

export function Init(): void {
  if (initialized) {
    return
  }
  initialized = true

  configureItemBoxes()
  for (const role of GameAPI.get_all_valid_roles()) {
    registerRole(role)
  }

  for (const config of ATTACK_ITEMS) {
    if (config.abilityKey !== undefined) {
      LuaAPI.ability_register_creation_handler(config.abilityKey, (abilityArg: unknown, ownerArg: unknown, dataArg: unknown) => {
        const ability = abilityFromCreationArgs(abilityArg, ownerArg, dataArg)
        const role = roleForAbility(ability)
        registerAbilityHitEvents(ability, role, "attack_item_ability_create")
      })
    }
  }

  LuaAPI.ability_register_creation_handler(10040, (abilityArg: unknown, ownerArg: unknown, dataArg: unknown) => {
    const ability = abilityFromCreationArgs(abilityArg, ownerArg, dataArg)
    const role = roleForAbility(ability)
    registerAbilityHitEvents(ability, role, "preset_skill_create")
  })

  MonsterManager.SetEngineDamageInterceptor(handleMonsterEngineDamage)
  MonsterManager.SetEngineDeathInterceptor(handleMonsterEngineDeath)
  LuaAPI.global_register_trigger_event([EVENT.SPEC_LIFEENTITY_GET_ITEMBOX], (_: string, __: unknown, eventData: unknown) => {
    const data = eventData as { life_entity?: unknown }
    print(`[Stage3][Probe] get itembox life_entity=${compactDescribe(data.life_entity)}`)
    const role = roleFromAny(data.life_entity)
    if (role !== undefined) {
      print(`[Stage3][ItemAttack] item box picked role=${tostring(role.get_roleid())}`)
      LuaAPI.call_delay_frame(2, () => {
        registerSelectedAttackItem(role, "itembox")
      })
    }
  })
  print("[Stage3][ItemAttack] init end")
}
