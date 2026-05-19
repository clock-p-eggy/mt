import * as MonsterManager from "./MonsterManager"
import * as PlayerStats from "./PlayerStats"

type AttackItemKind = "fish" | "rifle" | "bomb"

interface AttackItemConfig {
  key: EquipmentKey
  abilityKey?: AbilityKey
  kind: AttackItemKind
  name: string
  maxEffectiveHits?: number
  range?: Fixed
}

interface AttackItemState {
  key: EquipmentKey
  kind: AttackItemKind
  roleId: RoleID
  role: Role
  equipment: Equipment
  effectiveHits: number
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
const lastSwordAttackTimeByRoleId: Record<number, Fixed> = {}
let initialized = false
let attackClockEventId: integer | undefined
let attackClock: Fixed = math.tofixed(0)

const ATTACK_CLOCK_TICK = math.tofixed(0.02)
const SWORD_ATTACK_INTERVAL = math.tofixed(0.2)

for (const config of ATTACK_ITEMS) {
  itemByKey[config.key] = config
}

function equipmentToken(equipment: Equipment): string {
  return tostring(equipment)
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

function ensureAttackClock(): void {
  if (attackClockEventId !== undefined) {
    return
  }

  attackClockEventId = LuaAPI.global_register_trigger_event([EVENT.REPEAT_TIMEOUT, ATTACK_CLOCK_TICK], () => {
    attackClock = attackClock + ATTACK_CLOCK_TICK
  })
}

function canApplySwordAttack(role: Role): boolean {
  const roleId = roleIdOf(role)
  const lastAttackTime = lastSwordAttackTimeByRoleId[roleId]
  if (lastAttackTime !== undefined && attackClock - lastAttackTime < SWORD_ATTACK_INTERVAL) {
    return false
  }

  lastSwordAttackTimeByRoleId[roleId] = attackClock
  return true
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
  })
  LuaAPI.unit_register_trigger_event(equipmentUnit, [EVENT.SPEC_EQUIPMENT_DESTROY], () => {
    delete trackedItems[token]
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
      registerEquipment(data.equipment, role)
    }
  })
}

function configureItemBoxes(): void {
  for (const name of ITEM_BOX_NAMES) {
    const itemBox = LuaAPI.query_unit(name) as unknown as ItemBox | undefined
    if (itemBox === undefined) {
      print(`[Stage3][ItemAttack] item box missing name=${name}`)
      continue
    }

    print(`[Stage3][ItemAttack] item box ready name=${name}`)
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

function applyRoleAttackToMonster(typedMonster: { name: string; unit: Creature }, role: Role, sourceName: string): void {
  const attack = PlayerStats.GetAttack(role)
  MonsterManager.ApplyDamageFromRoleByUnit(typedMonster.unit, role, math.tofixed(attack))
  print(
    `[Stage3][ItemAttack] scripted ${sourceName} damage` +
      ` monster=${typedMonster.name}` +
      ` role=${tostring(role.get_roleid())}` +
      ` attack=${tostring(attack)}`
  )
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
    if (!canApplySwordAttack(role)) {
      print(
        `[Stage3][ItemAttack] weapon hit interval blocked` +
          ` role=${tostring(role.get_roleid())}` +
          ` interval=${tostring(SWORD_ATTACK_INTERVAL)}`
      )
      return true
    }

    applyRoleAttackToMonster(typedMonster, role, "weapon")
    return true
  }

  print(
    `[Stage3][Probe] item hit accepted item=${attackItemName(state.key)}` +
      ` key=${tostring(state.key)}` +
      ` kind=${state.kind}` +
      ` monster=${typedMonster.name}`
  )
  applyRoleAttackToMonster(typedMonster, role, attackItemName(state.key))
  consumeEffectiveHit(state)
  return true
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

  ensureAttackClock()
  configureItemBoxes()
  for (const role of GameAPI.get_all_valid_roles()) {
    registerRole(role)
  }

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
