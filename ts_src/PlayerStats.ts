interface PlayerStatsData {
  roleId: RoleID
  level: number
  exp: number
  attack: number
}

type LevelChangeListener = (role: Role, level: number, oldLevel: number) => void

interface StatsPanelUI {
  levelButton: EButton
  expButton: EButton
  attackButton: EButton
  levelLabel: ELabel
  expLabel: ELabel
  attackLabel: ELabel
}

const DEFAULTS = {
  level: 0,
  exp: 0,
  attack: 4,
}

const playerDataMap: Record<number, PlayerStatsData> = {}
const roleById: Record<number, Role> = {}
const levelListeners: LevelChangeListener[] = []
let statsPanel: StatsPanelUI | undefined

const HUD_CANVAS_NAME = "画布0"
const HUD_LABEL_STYLE: LabelStyleKey = 10003
const HUD_BUTTON_STYLE: BtnStyleKey = 11005
const ATTR_TEXT_COLOR: Color = 0xff3366
const ATTR_PANEL_LEFT_OFFSET = 260
const ATTR_PANEL_TOP_OFFSET = 40
const ATTR_PANEL_WIDTH = 220
const ATTR_PANEL_HEIGHT = 64
const ATTR_PANEL_GAP = 10
const ATTR_TEXT_LOCAL_X = ATTR_PANEL_WIDTH / 2
const ATTR_TEXT_LOCAL_Y = 18
const ATTR_TEXT_FONT_SIZE = 24
const MAX_LEVEL = 15

function roleIdOf(role: Role): RoleID {
  return role.get_roleid()
}

function nextLevelExp(data: PlayerStatsData): number | undefined {
  if (data.level >= MAX_LEVEL) {
    return undefined
  }
  return (data.level + 1) * 10
}

function expText(data: PlayerStatsData): string {
  const nextExp = nextLevelExp(data)
  if (nextExp === undefined) {
    return `${tostring(data.exp)}/MAX`
  }
  return `${tostring(data.exp)}/${tostring(nextExp)}`
}

function getCharacter(role: Role | undefined): Character | undefined {
  if (role === undefined) {
    return undefined
  }
  return role.get_ctrl_unit()
}

function syncEngineStats(character: Character | undefined): void {
  if (character === undefined) {
    return
  }

  character.set_mass_bar_visible(false)
  character.set_attr_by_type(
    Enums.ValueType.HpBarDisplayMode,
    "HpBarDisplayMode",
    Enums.HpBarDisplayMode.NONE
  )
}

function getHudCanvas(): ENode | undefined {
  const canvas = LuaAPI.query_ui_node(HUD_CANVAS_NAME) as unknown as ENode | undefined
  if (canvas === undefined) {
    print(`[Stage1][PlayerStats] hud canvas missing name=${HUD_CANVAS_NAME}`)
    return undefined
  }
  return canvas
}

function createPanelButton(canvas: ENode, topOffset: number, name: string): EButton {
  const button = GameAPI.create_eui_button_at_position(
    HUD_BUTTON_STYLE,
    canvas,
    math.tofixed(ATTR_PANEL_LEFT_OFFSET),
    math.tofixed(1000 - topOffset),
    math.tofixed(ATTR_PANEL_WIDTH),
    math.tofixed(ATTR_PANEL_HEIGHT),
    name
  ) as EButton
  GameAPI.set_eui_node_left_auto_adaption(button, true, false, math.tofixed(ATTR_PANEL_LEFT_OFFSET))
  GameAPI.set_eui_node_top_auto_adaption(button, true, false, math.tofixed(topOffset))
  return button
}

function createPanelText(parent: ENode, name: string): ELabel {
  return GameAPI.create_eui_label_at_position(
    HUD_LABEL_STYLE,
    parent,
    math.tofixed(ATTR_TEXT_LOCAL_X),
    math.tofixed(ATTR_TEXT_LOCAL_Y),
    math.tofixed(ATTR_PANEL_WIDTH),
    math.tofixed(ATTR_PANEL_HEIGHT),
    name,
    ""
  ) as ELabel
}

function ensureStatsPanel(): StatsPanelUI | undefined {
  if (statsPanel !== undefined) {
    return statsPanel
  }

  const canvas = getHudCanvas()
  if (canvas === undefined) {
    return undefined
  }

  const panelStep = ATTR_PANEL_HEIGHT + ATTR_PANEL_GAP
  const levelButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET, "stage5_level_panel")
  const expButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET + panelStep, "stage5_exp_panel")
  const attackButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET + panelStep * 2, "stage5_attack_panel")

  statsPanel = {
    levelButton,
    expButton,
    attackButton,
    levelLabel: createPanelText(levelButton, "stage5_level_text"),
    expLabel: createPanelText(expButton, "stage5_exp_text"),
    attackLabel: createPanelText(attackButton, "stage5_attack_text"),
  }

  print("[Stage5][PlayerStats] stats panel created mode=no_hp_no_spd")
  return statsPanel
}

function refreshPanelButton(role: Role, button: EButton, enabled: boolean): void {
  role.set_node_visible(button, true)
  role.set_button_text(button, "")
  role.set_button_font_size(button, math.tofixed(1))
  role.set_button_enabled(button, enabled)
}

function refreshPanelText(role: Role, label: ELabel, text: string): void {
  role.set_node_visible(label, true)
  role.set_node_touch_enabled(label, false)
  role.set_label_font_size(label, ATTR_TEXT_FONT_SIZE, math.tofixed(0))
  role.set_label_outline_enabled(label, false)
  role.set_label_color(label, ATTR_TEXT_COLOR, math.tofixed(0))
  role.set_label_text(label, text)
}

function refreshStatsPanel(role: Role, data: PlayerStatsData): void {
  const panel = ensureStatsPanel()
  if (panel === undefined) {
    return
  }

  refreshPanelButton(role, panel.levelButton, false)
  refreshPanelButton(role, panel.expButton, false)
  refreshPanelButton(role, panel.attackButton, false)
  refreshPanelText(role, panel.levelLabel, `LV ${tostring(data.level)}`)
  refreshPanelText(role, panel.expLabel, `EXP ${expText(data)}`)
  refreshPanelText(role, panel.attackLabel, `ATK ${tostring(data.attack)}`)
}

function emitLevelChanged(role: Role, level: number, oldLevel: number): void {
  for (const listener of levelListeners) {
    listener(role, level, oldLevel)
  }
}

export function GetData(role: Role | undefined): PlayerStatsData | undefined {
  if (role === undefined) {
    return undefined
  }
  return playerDataMap[roleIdOf(role)]
}

export function GetDataByRoleId(roleId: RoleID): PlayerStatsData | undefined {
  return playerDataMap[roleId]
}

export function RefreshDisplay(role: Role): void {
  const data = GetData(role)
  if (data === undefined) {
    return
  }

  syncEngineStats(getCharacter(role))
  refreshStatsPanel(role, data)
}

export function InitPlayer(role: Role | undefined): PlayerStatsData | undefined {
  if (role === undefined) {
    return undefined
  }

  const roleId = roleIdOf(role)
  roleById[roleId] = role

  const existing = playerDataMap[roleId]
  if (existing !== undefined) {
    RefreshDisplay(role)
    return existing
  }

  const data: PlayerStatsData = {
    roleId,
    level: DEFAULTS.level,
    exp: DEFAULTS.exp,
    attack: DEFAULTS.attack,
  }

  playerDataMap[roleId] = data
  RefreshDisplay(role)

  print(
    `[Stage1][PlayerStats] init role=${tostring(roleId)}` +
      " hpControl=disabled" +
      ` attack=${tostring(data.attack)}` +
      " spdPanel=disabled" +
      ` level=${tostring(data.level)}` +
      ` exp=${tostring(data.exp)}`
  )

  return data
}

export function InitAllPlayers(): void {
  print("[Stage1][PlayerStats] InitAllPlayers build=20260519_auto_atk_upgrade_v1")

  const roles = GameAPI.get_all_valid_roles()
  if (roles === undefined) {
    print("[Stage1][PlayerStats] no valid roles")
    return
  }

  for (const role of roles) {
    InitPlayer(role)
  }
}

export function RefreshAllPlayers(): void {
  const roles = GameAPI.get_all_valid_roles()
  if (roles === undefined) {
    return
  }

  for (const role of roles) {
    roleById[roleIdOf(role)] = role
    if (GetData(role) === undefined) {
      InitPlayer(role)
    } else {
      RefreshDisplay(role)
    }
  }
}

export function SyncFromEngine(role: Role): void {
  RefreshDisplay(role)
}

export function ApplyDamage(role: Role, damage: Fixed): void {
  print(
    `[Stage1][PlayerStats] ignore player damage` +
      ` role=${tostring(role.get_roleid())}` +
      ` damage=${tostring(damage)}`
  )
}

export function Heal(role: Role, value: Fixed): void {
  print(
    `[Stage1][PlayerStats] ignore player heal` +
      ` role=${tostring(role.get_roleid())}` +
      ` value=${tostring(value)}`
  )
}

export function AddExp(role: Role, exp: number): void {
  let data = GetData(role)
  if (data === undefined) {
    data = InitPlayer(role)
  }
  if (data === undefined || exp <= 0) {
    return
  }

  const oldLevel = data.level
  const oldExp = data.exp
  const oldAttack = data.attack
  data.exp = data.exp + exp
  let leveledCount = 0
  let nextExp = nextLevelExp(data)

  while (nextExp !== undefined && data.exp >= nextExp) {
    data.exp = data.exp - nextExp
    data.level = data.level + 1
    leveledCount = leveledCount + 1
    nextExp = nextLevelExp(data)
  }

  if (leveledCount > 0) {
    data.attack = data.attack + leveledCount * 2
  }

  if (data.level >= MAX_LEVEL) {
    data.level = MAX_LEVEL
    data.exp = 0
  }

  RefreshDisplay(role)
  role.show_tips(`获得 ${tostring(exp)} 经验`, math.tofixed(1.2))
  if (leveledCount > 0) {
    role.show_tips(`升级到 ${tostring(data.level)} 级，攻击 +${tostring(leveledCount * 2)}`, math.tofixed(1.8))
    emitLevelChanged(role, data.level, oldLevel)
  }

  print(
    `[Stage4][PlayerStats] add exp role=${tostring(data.roleId)}` +
      ` gain=${tostring(exp)}` +
      ` exp=${tostring(oldExp)}->${tostring(data.exp)}` +
      ` level=${tostring(oldLevel)}->${tostring(data.level)}` +
      ` attack=${tostring(oldAttack)}->${tostring(data.attack)}`
  )
}

export function GetAttack(role: Role): number {
  const data = GetData(role)
  if (data === undefined) {
    return DEFAULTS.attack
  }

  return data.attack
}

export function GetRoleById(roleId: RoleID): Role | undefined {
  return roleById[roleId]
}

export function OnLevelChanged(listener: LevelChangeListener): void {
  levelListeners[levelListeners.length] = listener
  const roles = GameAPI.get_all_valid_roles()
  if (roles === undefined) {
    return
  }

  for (const role of roles) {
    const data = GetData(role)
    if (data !== undefined) {
      listener(role, data.level, data.level)
    }
  }
}
