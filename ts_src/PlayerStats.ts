interface PlayerStatsData {
  roleId: RoleID
  level: number
  exp: number
  maxHp: Fixed
  hp: Fixed
  attack: number
  moveSpeed: Fixed
  freePoints: number
  isLose: boolean
  damageEventId?: integer
}

type AttributeTarget = "hp" | "attack" | "moveSpeed"

interface StatsPanelUI {
  expButton: EButton
  hpButton: EButton
  attackButton: EButton
  moveSpeedButton: EButton
  expLabel: ELabel
  hpLabel: ELabel
  attackLabel: ELabel
  moveSpeedLabel: ELabel
  registered: boolean
}

const DEFAULTS = {
  level: 0,
  exp: 0,
  maxHp: 10.0,
  hp: 10.0,
  attack: 4,
  moveSpeed: 4.0,
  freePoints: 0,
}

const playerDataMap: Record<number, PlayerStatsData> = {}
const roleById: Record<number, Role> = {}
let screenHpLabel: ELabel | undefined
let screenExpLabel: ELabel | undefined
let statsPanel: StatsPanelUI | undefined

const HUD_CANVAS_NAME = "画布0"
const HUD_HP_LABEL_STYLE: LabelStyleKey = 10003
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
const TOUCH_CLICK = 1

function roleIdOf(role: Role): RoleID {
  return role.get_roleid()
}

function hpText(data: PlayerStatsData): string {
  return `${tostring(math.tointeger(data.hp))}/${tostring(math.tointeger(data.maxHp))}`
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

function clamp(value: Fixed, minValue: Fixed, maxValue: Fixed): Fixed {
  if (value < minValue) {
    return minValue
  }
  if (value > maxValue) {
    return maxValue
  }
  return value
}

function getCharacter(role: Role | undefined): Character | undefined {
  if (role === undefined) {
    return undefined
  }
  return role.get_ctrl_unit()
}

function syncEngineHp(character: Character | undefined, data: PlayerStatsData): void {
  if (character === undefined) {
    return
  }

  character.set_attr_by_type(Enums.ValueType.Fixed, "hp_max", data.maxHp)
  character.set_attr_ratio_fixed("move_speed", data.moveSpeed - math.tofixed(1))
  character.set_mass_bar_visible(false)
  character.set_attr_by_type(
    Enums.ValueType.HpBarDisplayMode,
    "HpBarDisplayMode",
    Enums.HpBarDisplayMode.NONE
  )
}

function loseRole(role: Role, data: PlayerStatsData): void {
  role.lose()
  print(`[Stage1][PlayerStats] role lose role=${tostring(data.roleId)}`)
}

function getHudCanvas(): ENode | undefined {
  const canvas = LuaAPI.query_ui_node(HUD_CANVAS_NAME) as unknown as ENode | undefined
  if (canvas === undefined) {
    print(`[Stage1][PlayerStats] hud canvas missing name=${HUD_CANVAS_NAME}`)
    return undefined
  }
  return canvas
}

function ensureScreenHpLabel(): ELabel | undefined {
  if (screenHpLabel !== undefined) {
    return screenHpLabel
  }

  const canvas = getHudCanvas()
  if (canvas === undefined) {
    return undefined
  }

  screenHpLabel = GameAPI.create_eui_label_at_position(
    HUD_HP_LABEL_STYLE,
    canvas,
    math.tofixed(1600),
    math.tofixed(1000),
    math.tofixed(280),
    math.tofixed(56),
    "stage1_hp_text",
    ""
  ) as ELabel
  GameAPI.set_eui_node_right_auto_adaption(screenHpLabel, true, false, math.tofixed(40))
  GameAPI.set_eui_node_top_auto_adaption(screenHpLabel, true, false, math.tofixed(40))

  return screenHpLabel
}

function ensureScreenExpLabel(): ELabel | undefined {
  if (screenExpLabel !== undefined) {
    return screenExpLabel
  }

  const canvas = getHudCanvas()
  if (canvas === undefined) {
    return undefined
  }

  screenExpLabel = GameAPI.create_eui_label_at_position(
    HUD_HP_LABEL_STYLE,
    canvas,
    math.tofixed(1600),
    math.tofixed(944),
    math.tofixed(280),
    math.tofixed(48),
    "stage1_exp_text",
    ""
  ) as ELabel
  GameAPI.set_eui_node_right_auto_adaption(screenExpLabel, true, false, math.tofixed(40))
  GameAPI.set_eui_node_top_auto_adaption(screenExpLabel, true, false, math.tofixed(96))

  return screenExpLabel
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
  const label = GameAPI.create_eui_label_at_position(
    HUD_HP_LABEL_STYLE,
    parent,
    math.tofixed(ATTR_TEXT_LOCAL_X),
    math.tofixed(ATTR_TEXT_LOCAL_Y),
    math.tofixed(ATTR_PANEL_WIDTH),
    math.tofixed(ATTR_PANEL_HEIGHT),
    name,
    ""
  ) as ELabel
  return label
}

function registerPanelButton(button: EButton, target: AttributeTarget): void {
  LuaAPI.global_register_trigger_event([EVENT.EUI_NODE_TOUCH_EVENT, button, TOUCH_CLICK], (_: string, __: unknown, eventData: unknown) => {
    const data = eventData as { role?: Role }
    if (data.role !== undefined) {
      AddAttributePoint(data.role, target)
    }
  })
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
  const expButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET, "stage5_exp_panel")
  const hpButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET + panelStep, "stage5_add_hp")
  const attackButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET + panelStep * 2, "stage5_add_attack")
  const moveSpeedButton = createPanelButton(canvas, ATTR_PANEL_TOP_OFFSET + panelStep * 3, "stage5_add_speed")

  statsPanel = {
    expButton,
    hpButton,
    attackButton,
    moveSpeedButton,
    expLabel: createPanelText(expButton, "stage5_exp_text"),
    hpLabel: createPanelText(hpButton, "stage5_hp_text"),
    attackLabel: createPanelText(attackButton, "stage5_attack_text"),
    moveSpeedLabel: createPanelText(moveSpeedButton, "stage5_speed_text"),
    registered: false,
  }

  registerPanelButton(statsPanel.hpButton, "hp")
  registerPanelButton(statsPanel.attackButton, "attack")
  registerPanelButton(statsPanel.moveSpeedButton, "moveSpeed")
  statsPanel.registered = true

  print("[Stage5][PlayerStats] stats panel created")
  return statsPanel
}

function refreshScreenHp(role: Role, data: PlayerStatsData): void {
  const label = ensureScreenHpLabel()
  if (label === undefined) {
    return
  }

  role.set_node_visible(label, false)
  role.set_label_text(label, "")
}

function refreshScreenExp(role: Role, data: PlayerStatsData): void {
  const label = ensureScreenExpLabel()
  if (label === undefined) {
    return
  }

  role.set_node_visible(label, false)
  role.set_label_text(label, "")
}

function refreshPanelButton(role: Role, button: EButton, text: string, enabled: boolean): void {
  role.set_node_visible(button, true)
  role.set_button_text(button, "")
  role.set_button_font_size(button, math.tofixed(1))
  role.set_button_enabled(button, true)
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

  const hasPoints = data.freePoints > 0
  refreshPanelButton(role, panel.expButton, "", false)
  refreshPanelButton(role, panel.hpButton, "", hasPoints)
  refreshPanelButton(role, panel.attackButton, "", hasPoints)
  refreshPanelButton(role, panel.moveSpeedButton, "", hasPoints)
  refreshPanelText(role, panel.expLabel, `EXP ${expText(data)}`)
  refreshPanelText(role, panel.hpLabel, `HP ${hpText(data)}`)
  refreshPanelText(role, panel.attackLabel, `ATK ${tostring(data.attack)}`)
  refreshPanelText(role, panel.moveSpeedLabel, `SPD ${tostring(math.tointeger(data.moveSpeed))}`)
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
  const character = getCharacter(role)
  if (data === undefined || character === undefined) {
    return
  }

  syncEngineHp(character, data)
  refreshScreenHp(role, data)
  refreshScreenExp(role, data)
  refreshStatsPanel(role, data)
}

export function InitPlayer(role: Role | undefined): PlayerStatsData | undefined {
  if (role === undefined) {
    return undefined
  }

  const roleId = roleIdOf(role)
  roleById[roleId] = role

  const data: PlayerStatsData = {
    roleId,
    level: DEFAULTS.level,
    exp: DEFAULTS.exp,
    maxHp: DEFAULTS.maxHp,
    hp: DEFAULTS.hp,
    attack: DEFAULTS.attack,
    moveSpeed: DEFAULTS.moveSpeed,
    freePoints: DEFAULTS.freePoints,
    isLose: false,
  }

  playerDataMap[roleId] = data

  const character = getCharacter(role)
  syncEngineHp(character, data)

  if (character !== undefined) {
    data.damageEventId = LuaAPI.unit_register_trigger_event(character, [EVENT.SPEC_LIFEENTITY_DMGED_AFTER], () => {
      SyncFromEngine(role)
    })
  }

  RefreshDisplay(role)
  print(
    `[Stage1][PlayerStats] init role=${tostring(roleId)}` +
      ` hp=${hpText(data)}` +
      ` attack=${tostring(data.attack)}` +
      ` moveSpeed=${tostring(data.moveSpeed)}` +
      ` level=${tostring(data.level)}` +
      ` exp=${tostring(data.exp)}` +
      ` freePoints=${tostring(data.freePoints)}`
  )

  return data
}

export function InitAllPlayers(): void {
  const roles = GameAPI.get_all_valid_roles()
  if (roles === undefined) {
    print("[Stage1][PlayerStats] no valid roles")
    return
  }

  for (const role of roles) {
    InitPlayer(role)
  }
}

export function SyncFromEngine(role: Role): void {
  const data = GetData(role)
  const character = getCharacter(role)
  if (data === undefined || character === undefined) {
    return
  }

  data.hp = clamp(character.get_hp(), 0, data.maxHp)
  RefreshDisplay(role)

  if (data.hp <= 0) {
    data.isLose = true
    loseRole(role, data)
  }
}

export function ApplyDamage(role: Role, damage: Fixed): void {
  const data = GetData(role)
  if (data === undefined || data.isLose === true) {
    return
  }

  data.hp = clamp(data.hp - damage, 0, data.maxHp)
  RefreshDisplay(role)

  if (data.hp <= 0) {
    data.isLose = true
    loseRole(role, data)
  }
}

export function Heal(role: Role, value: Fixed): void {
  const data = GetData(role)
  if (data === undefined || data.isLose === true) {
    return
  }

  data.hp = clamp(data.hp + value, 0, data.maxHp)
  RefreshDisplay(role)
}

export function AddExp(role: Role, exp: number): void {
  const data = GetData(role)
  if (data === undefined) {
    return
  }

  if (exp <= 0) {
    return
  }

  const oldLevel = data.level
  const oldExp = data.exp
  data.exp = data.exp + exp
  let leveledCount = 0
  let nextExp = nextLevelExp(data)

  while (nextExp !== undefined && data.exp >= nextExp) {
    data.exp = data.exp - nextExp
    data.level = data.level + 1
    data.freePoints = data.freePoints + 2
    leveledCount = leveledCount + 1
    nextExp = nextLevelExp(data)
  }

  if (data.level >= MAX_LEVEL) {
    data.level = MAX_LEVEL
    data.exp = 0
  }

  RefreshDisplay(role)
  role.show_tips(`获得 ${tostring(exp)} 经验`, math.tofixed(1.2))
  if (leveledCount > 0) {
    role.show_tips(`升级到 ${tostring(data.level)} 级，属性点 +${tostring(leveledCount * 2)}`, math.tofixed(1.8))
  }

  print(
    `[Stage4][PlayerStats] add exp role=${tostring(data.roleId)}` +
      ` gain=${tostring(exp)}` +
      ` exp=${tostring(oldExp)}->${tostring(data.exp)}` +
      ` level=${tostring(oldLevel)}->${tostring(data.level)}` +
      ` freePoints=${tostring(data.freePoints)}`
  )
}

export function AddAttributePoint(role: Role, target: AttributeTarget): boolean {
  const data = GetData(role)
  if (data === undefined || data.isLose === true) {
    return false
  }

  if (target !== "hp" && target !== "attack" && target !== "moveSpeed") {
    print(`[Stage5][PlayerStats] unknown point target role=${tostring(data.roleId)} target=${target}`)
    return false
  }

  if (data.freePoints <= 0) {
    role.show_tips("No attribute points", math.tofixed(1.2))
    print(`[Stage5][PlayerStats] add point rejected role=${tostring(data.roleId)} target=${target}`)
    return false
  }

  data.freePoints = data.freePoints - 1
  if (target === "hp") {
    data.maxHp = data.maxHp + math.tofixed(1)
    data.hp = clamp(data.hp + math.tofixed(1), 0, data.maxHp)
  } else if (target === "attack") {
    data.attack = data.attack + 1
  } else if (target === "moveSpeed") {
    data.moveSpeed = data.moveSpeed + math.tofixed(1)
  }

  RefreshDisplay(role)
  role.show_tips(`Point added: ${target}`, math.tofixed(1.2))
  print(
    `[Stage5][PlayerStats] add point role=${tostring(data.roleId)}` +
      ` target=${target}` +
      ` hp=${hpText(data)}` +
      ` attack=${tostring(data.attack)}` +
      ` moveSpeed=${tostring(data.moveSpeed)}` +
      ` freePoints=${tostring(data.freePoints)}`
  )
  return true
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
