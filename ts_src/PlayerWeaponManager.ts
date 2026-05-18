const STARTING_WEAPON_KEY: EquipmentKey = 6000035
const RIGHT_HAND_EQUIPPED_SLOT: EquipmentSlot = 1

const weaponByRoleId: Record<number, Equipment> = {}

function roleIdOf(role: Role): RoleID {
  return role.get_roleid()
}

export function EquipStartingWeapon(role: Role | undefined): Equipment | undefined {
  if (role === undefined) {
    return undefined
  }

  const character = role.get_ctrl_unit()
  if (character === undefined) {
    print("[Stage6][PlayerWeapon] equip failed: missing character")
    return undefined
  }

  const roleId = roleIdOf(role)
  const existing = weaponByRoleId[roleId]
  if (existing !== undefined) {
    return existing
  }

  const weapon = character.create_equipment_to_slot(STARTING_WEAPON_KEY, Enums.EquipmentSlotType.BACKPACK)
  character.swap_equipment_slot(weapon, Enums.EquipmentSlotType.EQUIPPED, RIGHT_HAND_EQUIPPED_SLOT)
  character.clear_selected_equipment_slot()
  weaponByRoleId[roleId] = weapon

  print(
    `[Stage6][PlayerWeapon] equipped starting weapon role=${tostring(roleId)}` +
      ` key=${tostring(STARTING_WEAPON_KEY)}` +
      ` slot=${tostring(RIGHT_HAND_EQUIPPED_SLOT)}` +
      " selected=false"
  )
  return weapon
}

export function EquipStartingWeaponForAllPlayers(): void {
  for (const role of GameAPI.get_all_valid_roles()) {
    EquipStartingWeapon(role)
  }
}

export function HasStartingWeapon(role: Role | undefined): boolean {
  if (role === undefined) {
    return false
  }

  return weaponByRoleId[roleIdOf(role)] !== undefined
}
