const PLAYER_SKILL_KEY: AbilityKey = 10040
const PLAYER_SKILL_SLOT: AbilitySlot = 1

const skillReadyByRoleId: Record<number, boolean> = {}

function roleIdOf(role: Role): RoleID {
  return role.get_roleid()
}

export function EquipPlayerPresetSkill(role: Role | undefined): Ability | undefined {
  if (role === undefined) {
    return undefined
  }

  const character = role.get_ctrl_unit()
  if (character === undefined) {
    print("[Stage7][PlayerSkill] equip failed: missing character")
    return undefined
  }

  const roleId = roleIdOf(role)
  if (skillReadyByRoleId[roleId] === true) {
    return character.get_ability_by_slot(PLAYER_SKILL_SLOT)
  }

  character.remove_ability(PLAYER_SKILL_SLOT)
  const ability = character.add_ability_to_slot(PLAYER_SKILL_SLOT, PLAYER_SKILL_KEY)
  character.clear_selected_equipment_slot()
  skillReadyByRoleId[roleId] = true

  print(
    `[Stage7][PlayerSkill] equipped preset skill role=${tostring(roleId)}` +
      ` key=${tostring(PLAYER_SKILL_KEY)}` +
      ` slot=${tostring(PLAYER_SKILL_SLOT)}` +
      ` actualKey=${tostring(ability.get_key())}` +
      ` actualSlot=${tostring(ability.get_ability_slot())}` +
      " selectedEquipment=false"
  )
  return ability
}

export function EquipPlayerPresetSkillForAllPlayers(): void {
  for (const role of GameAPI.get_all_valid_roles()) {
    EquipPlayerPresetSkill(role)
  }
}
