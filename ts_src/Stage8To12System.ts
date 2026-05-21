import { safeCall, safeVoid } from "@common/engine_safe"
import * as MonsterManager from "./MonsterManager"

interface StageUnitTarget {
  id: UnitID
  name: string
  pos: Vector3
}

interface PasswordUi {
  label: ELabel
  buttons: EButton[]
  clearButton: EButton
}

const WALL32: StageUnitTarget = {
  id: 1523845553 as UnitID,
  name: "方墙32",
  pos: math.Vector3(math.tofixed(-18.5), math.tofixed(2.316), math.tofixed(9.0)),
}
const TRAMPOLINE1: StageUnitTarget = {
  id: 1873217301 as UnitID,
  name: "蹦床1",
  pos: math.Vector3(math.tofixed(3.117), math.tofixed(2.315), math.tofixed(9.37)),
}
const BUTTON1: StageUnitTarget = {
  id: 1855557960 as UnitID,
  name: "按钮开关1",
  pos: math.Vector3(math.tofixed(-83.765), math.tofixed(2.316), math.tofixed(7.693)),
}
const MECH_WALL5: StageUnitTarget = {
  id: 1732139556 as UnitID,
  name: "机械墙5",
  pos: math.Vector3(math.tofixed(-51.0), math.tofixed(2.316), math.tofixed(-12.75)),
}
const TILE1: StageUnitTarget = {
  id: 1041548108 as UnitID,
  name: "中式花纹砖1",
  pos: math.Vector3(math.tofixed(7.0), math.tofixed(2.316), math.tofixed(-19.0)),
}
const BOX1: StageUnitTarget = {
  id: 1192156288 as UnitID,
  name: "箱子1",
  pos: math.Vector3(math.tofixed(10.921), math.tofixed(2.316), math.tofixed(-19.205)),
}
const BOX1_REVEAL_ENTITY: StageUnitTarget = {
  id: 1147395932 as UnitID,
  name: "实体1147395932",
  pos: math.Vector3(0, 0, 0),
}
const BOX2: StageUnitTarget = {
  id: 1218997392 as UnitID,
  name: "箱子2",
  pos: math.Vector3(math.tofixed(-54.5), math.tofixed(2.316), math.tofixed(0.0)),
}
const BOX2_REVEAL_ENTITY: StageUnitTarget = {
  id: 1712673236 as UnitID,
  name: "实体1712673236",
  pos: math.Vector3(0, 0, 0),
}
const PASSWORD_LOCK1: StageUnitTarget = {
  id: 1965974982 as UnitID,
  name: "密码锁1",
  pos: math.Vector3(math.tofixed(-81.36), math.tofixed(6.5), math.tofixed(-4.31)),
}
const MECH_WALL3: StageUnitTarget = {
  id: 1156059701 as UnitID,
  name: "机械墙3",
  pos: math.Vector3(math.tofixed(-81.75), math.tofixed(2.316), math.tofixed(0.469)),
}
const VICTORY_ZONE1: StageUnitTarget = {
  id: 1146983526 as UnitID,
  name: "胜利区域1",
  pos: math.Vector3(math.tofixed(-95.5), math.tofixed(5.0), math.tofixed(-10.1)),
}
const TRAIL_CURRENT1: StageUnitTarget = {
  id: 1994453219 as UnitID,
  name: "拖尾电流",
  pos: math.Vector3(0, 0, 0),
}
const VISUAL_ONLY_HIDDEN_TARGETS: StageUnitTarget[] = [
  TRAIL_CURRENT1,
  { id: 1570439517 as UnitID, name: "隐身功能组件1570439517", pos: math.Vector3(0, 0, 0) },
  { id: 2034104046 as UnitID, name: "隐身功能组件2034104046", pos: math.Vector3(0, 0, 0) },
  { id: 1706126085 as UnitID, name: "隐身功能组件1706126085", pos: math.Vector3(0, 0, 0) },
  { id: 1850114966 as UnitID, name: "隐身功能组件1850114966", pos: math.Vector3(0, 0, 0) },
  { id: 1085615249 as UnitID, name: "隐身功能组件1085615249", pos: math.Vector3(0, 0, 0) },
  { id: 1887047585 as UnitID, name: "隐身功能组件1887047585", pos: math.Vector3(0, 0, 0) },
  { id: 1430735542 as UnitID, name: "隐身功能组件1430735542", pos: math.Vector3(0, 0, 0) },
  { id: 1422072101 as UnitID, name: "隐身功能组件1422072101", pos: math.Vector3(0, 0, 0) },
]

const TARGET_A_MONSTER_IDS: Record<number, string> = {
  [1303708057]: "变异蛋A7",
  [1997721046]: "变异蛋A14",
  [1327462744]: "变异蛋A8",
  [1731296382]: "变异蛋A13",
}
const TARGET_A_MONSTER_ID_LIST = [1303708057, 1997721046, 1327462744, 1731296382]

const TRAMPOLINE_MONSTER_IDS: Record<number, string> = {
  [1135616291]: "变异蛋A10",
  [1549045028]: "变异蛋A11",
  [1062383567]: "变异蛋C9",
  [1512540079]: "变异蛋C10",
}
const TRAMPOLINE_MONSTER_ID_LIST = [1135616291, 1549045028, 1062383567, 1512540079]

const HUD_CANVAS_NAME = "画布0"
const HUD_LABEL_STYLE: LabelStyleKey = 10003
const HUD_BUTTON_STYLE: BtnStyleKey = 11005
const TOUCH_CLICK = 1
const UPDATE_SECONDS = math.tofixed(0.2)
const STAND_SECONDS_TO_OPEN = math.tofixed(3)
const TILE_MOVE_RESET_SQ = math.tofixed(0.12) * math.tofixed(0.12)
const TILE_KNOCK_SPEED_RESET_SQ = math.tofixed(4)
const BUTTON_RADIUS_SQ = math.tofixed(2.8) * math.tofixed(2.8)
const TILE_RADIUS_SQ = math.tofixed(2.4) * math.tofixed(2.4)
const PASSWORD_RADIUS_SQ = math.tofixed(4.2) * math.tofixed(4.2)
const VICTORY_RADIUS_SQ = math.tofixed(4.0) * math.tofixed(4.0)
const PASSWORD_CODE = "2026"
const WALL32_HINT_TEXT = ""
const WALL32_HINT_FONT_SIZE = 30

let initialized = false
let updateEventId: integer | undefined
let buttonOpened = false
let box1Opened = false
let box2Opened = false
let trampolineShown = false
let passwordSolved = false
let victoryDone = false
let passwordUi: PasswordUi | undefined
const tileStandSecondsByRoleId: Record<number, Fixed> = {}
const tileLastPositionByRoleId: Record<number, Vector3> = {}
const passwordInputByRoleId: Record<number, string> = {}
const killedTargetMonsters: Record<number, boolean> = {}
const killedTrampolineMonsters: Record<number, boolean> = {}

function queryUnit(target: StageUnitTarget): Unit | undefined {
  const unitById = safeCall(
    () => GameAPI.get_unit(target.id),
    { tag: `Stage8To12 get_unit ${target.name}`, fallback: undefined, logger: (msg: string) => print(msg) }
  ) as Unit | undefined

  if (unitById !== undefined) {
    return unitById
  }

  const unit = LuaAPI.query_unit(target.name) as unknown as Unit | undefined
  if (unit === undefined) {
    print(`[Stage8To12] unit missing name=${target.name} id=${tostring(target.id)}`)
    return undefined
  }
  return unit
}

function roleIdOf(role: Role): RoleID {
  return role.get_roleid()
}

function getCharacter(role: Role | undefined): Character | undefined {
  if (role === undefined) {
    return undefined
  }
  return role.get_ctrl_unit()
}

function roleFromUnit(unit: Unit | undefined): Role | undefined {
  if (unit === undefined) {
    return undefined
  }

  const unitId = unit.get_id()
  for (const role of GameAPI.get_all_valid_roles()) {
    const character = getCharacter(role)
    if (character !== undefined && character.get_id() === unitId) {
      return role
    }
  }
  return undefined
}

function rolePosition(role: Role): Vector3 | undefined {
  const character = getCharacter(role)
  if (character === undefined) {
    return undefined
  }
  return character.get_position()
}

function distSqXZ(a: Vector3, b: Vector3): Fixed {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function distSq3(a: Vector3, b: Vector3): Fixed {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function vectorLengthSq(vector: Vector3): Fixed {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
}

function isRoleNear(role: Role, target: StageUnitTarget, radiusSq: Fixed): boolean {
  const pos = rolePosition(role)
  if (pos === undefined) {
    return false
  }
  return distSqXZ(pos, target.pos) <= radiusSq
}

function setUnitVisibleForAll(unit: Unit, visible: boolean, affectChildren: boolean = false): void {
  safeVoid(() => {
    unit.set_model_visible(visible)
    unit.set_physics_active(visible)
    for (const role of GameAPI.get_all_valid_roles()) {
      role.set_unit_visible(unit, visible, affectChildren)
    }
  }, { tag: `Stage8To12 visible ${unit.get_name()}`, logger: (msg: string) => print(msg) })
}

function setUnitVisualOnlyVisibleForAll(unit: Unit, visible: boolean, affectChildren: boolean = true): void {
  safeVoid(() => {
    unit.set_model_visible(visible)
    for (const role of GameAPI.get_all_valid_roles()) {
      role.set_unit_visible(unit, visible, affectChildren)
    }
  }, { tag: `Stage8To12 visual only ${unit.get_name()}`, logger: (msg: string) => print(msg) })
}

function hideVisualOnlyTarget(target: StageUnitTarget, reason: string): boolean {
  const unit = queryUnit(target)
  if (unit === undefined) {
    return false
  }

  setUnitVisualOnlyVisibleForAll(unit, false, true)
  print(`[Stage8To12] visual hide ${target.name} id=${tostring(target.id)} reason=${reason} physics=keep`)
  return true
}

function hideTarget(target: StageUnitTarget, reason: string): boolean {
  const unit = queryUnit(target)
  if (unit === undefined) {
    return false
  }

  setUnitVisibleForAll(unit, false, false)
  print(`[Stage8To12] hide ${target.name} id=${tostring(target.id)} reason=${reason}`)
  return true
}

function showTarget(target: StageUnitTarget, reason: string): boolean {
  const unit = queryUnit(target)
  if (unit === undefined) {
    return false
  }

  setUnitVisibleForAll(unit, true, false)
  print(`[Stage8To12] show ${target.name} id=${tostring(target.id)} reason=${reason}`)
  return true
}

function openTarget(target: StageUnitTarget, role: Role | undefined, tip: string): boolean {
  const opened = hideTarget(target, "open")
  if (opened && role !== undefined) {
    role.show_tips(tip, math.tofixed(1.5))
  }
  return opened
}

function setupWall32Hint(): void {
  const wall = queryUnit(WALL32) as Obstacle | undefined
  if (wall === undefined) {
    return
  }

  safeVoid(() => {
    wall.set_billboard_text(WALL32_HINT_TEXT)
    wall.set_billboard_font_size(WALL32_HINT_FONT_SIZE)
    wall.set_billboard_text_color(0xffffff)
  }, { tag: "Stage7 wall32 billboard", logger: (msg: string) => print(msg) })

  print(
    `[Stage7][Wall32Hint] billboard name=${WALL32.name}` +
      ` id=${tostring(WALL32.id)}` +
      ` text=${WALL32_HINT_TEXT}` +
      ` font=宋体(default/billboard)` +
      ` size=${tostring(WALL32_HINT_FONT_SIZE)}`
  )
}

function updateButton(role: Role): void {
  if (buttonOpened || !isRoleNear(role, BUTTON1, BUTTON_RADIUS_SQ)) {
    return
  }

  buttonOpened = openTarget(MECH_WALL5, role, "按钮已触发，机械墙5打开")
  print(`[Stage9] button triggered role=${tostring(roleIdOf(role))} opened=${tostring(buttonOpened)}`)
}

function updateTile(role: Role): void {
  if (box1Opened) {
    return
  }

  const roleId = roleIdOf(role)
  const pos = rolePosition(role)
  if (pos === undefined || distSqXZ(pos, TILE1.pos) > TILE_RADIUS_SQ) {
    if (tileStandSecondsByRoleId[roleId] !== undefined && tileStandSecondsByRoleId[roleId] > 0) {
      print(`[Stage10] tile leave role=${tostring(roleId)} reset`)
    }
    tileStandSecondsByRoleId[roleId] = math.tofixed(0)
    delete tileLastPositionByRoleId[roleId]
    return
  }

  const character = getCharacter(role)
  const lastPos = tileLastPositionByRoleId[roleId]
  if (lastPos !== undefined) {
    const movedSq = distSq3(pos, lastPos)
    const velocity = character === undefined ? undefined : character.get_linear_velocity()
    const speedSq = velocity === undefined ? math.tofixed(0) : vectorLengthSq(velocity)
    if (movedSq > TILE_MOVE_RESET_SQ || speedSq > TILE_KNOCK_SPEED_RESET_SQ) {
      tileStandSecondsByRoleId[roleId] = math.tofixed(0)
      tileLastPositionByRoleId[roleId] = pos
      print(
        `[Stage10] tile movement reset role=${tostring(roleId)}` +
          ` movedSq=${tostring(movedSq)}` +
          ` speedSq=${tostring(speedSq)}`
      )
      return
    }
  }

  const current = tileStandSecondsByRoleId[roleId] === undefined ? math.tofixed(0) : tileStandSecondsByRoleId[roleId]
  const next = current + UPDATE_SECONDS
  tileStandSecondsByRoleId[roleId] = next
  tileLastPositionByRoleId[roleId] = pos

  if (next < STAND_SECONDS_TO_OPEN) {
    return
  }

  box1Opened = hideTarget(BOX1, "stage10 open")
  if (box1Opened) {
    showTarget(BOX1_REVEAL_ENTITY, "stage10 box1 open")
    print(`[Stage10] box1 open role=${tostring(roleId)} reveal=${tostring(BOX1_REVEAL_ENTITY.id)}`)
  }
}

function handleTargetMonsterKilled(name: string, unitId: UnitID, role: Role | undefined): void {
  const trampolineName = TRAMPOLINE_MONSTER_IDS[unitId]
  if (trampolineName !== undefined && !trampolineShown) {
    killedTrampolineMonsters[unitId] = true
    print(`[Stage8] trampoline target killed name=${name} id=${tostring(unitId)}`)
    let complete = true
    for (const id of TRAMPOLINE_MONSTER_ID_LIST) {
      if (killedTrampolineMonsters[id] !== true) {
        complete = false
        break
      }
    }
    if (complete) {
      trampolineShown = showTarget(TRAMPOLINE1, "stage8 target monsters killed")
      print(`[Stage8] trampoline show=${tostring(trampolineShown)}`)
    }
  }

  const expectedName = TARGET_A_MONSTER_IDS[unitId]
  if (expectedName !== undefined && !box2Opened) {
    killedTargetMonsters[unitId] = true
    if (role !== undefined) {
      role.show_tips(`${expectedName} 已击杀`, math.tofixed(1.2))
    }
    print(`[Stage11] target killed name=${name} id=${tostring(unitId)}`)

    for (const id of TARGET_A_MONSTER_ID_LIST) {
      if (killedTargetMonsters[id] !== true) {
        return
      }
    }

    box2Opened = hideTarget(BOX2, "stage11 target monsters killed")
    if (box2Opened) {
      showTarget(BOX2_REVEAL_ENTITY, "stage11 box2 open")
    }
    print(`[Stage11] box2 open=${tostring(box2Opened)} reveal=${tostring(BOX2_REVEAL_ENTITY.id)}`)
  }
}

function getHudCanvas(): ENode | undefined {
  const canvas = LuaAPI.query_ui_node(HUD_CANVAS_NAME) as unknown as ENode | undefined
  if (canvas === undefined) {
    print(`[Stage12] hud canvas missing name=${HUD_CANVAS_NAME}`)
    return undefined
  }
  return canvas
}

function createPasswordButton(canvas: ENode, index: number, text: string): EButton {
  const row = math.floor(index / 3)
  const col = index - row * 3
  const button = GameAPI.create_eui_button_at_position(
    HUD_BUTTON_STYLE,
    canvas,
    math.tofixed(820 + col * 76),
    math.tofixed(520 - row * 68),
    math.tofixed(68),
    math.tofixed(56),
    `stage12_pwd_${text}`
  ) as EButton
  GameAPI.set_eui_node_horizontal_auto_center(button, true, false, math.tofixed(-80 + col * 76))
  GameAPI.set_eui_node_vertical_auto_center(button, true, false, math.tofixed(-70 + row * 68))
  return button
}

function ensurePasswordUi(): PasswordUi | undefined {
  if (passwordUi !== undefined) {
    return passwordUi
  }

  const canvas = getHudCanvas()
  if (canvas === undefined) {
    return undefined
  }

  const label = GameAPI.create_eui_label_at_position(
    HUD_LABEL_STYLE,
    canvas,
    math.tofixed(900),
    math.tofixed(610),
    math.tofixed(320),
    math.tofixed(64),
    "stage12_pwd_label",
    "密码："
  ) as ELabel
  GameAPI.set_eui_node_horizontal_auto_center(label, true, false, math.tofixed(0))
  GameAPI.set_eui_node_vertical_auto_center(label, true, false, math.tofixed(-150))

  const buttons: EButton[] = []
  const texts = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
  for (let i = 0; i < texts.length; i = i + 1) {
    const button = createPasswordButton(canvas, i, texts[i])
    buttons[i] = button
    const digit = texts[i]
    LuaAPI.global_register_trigger_event([EVENT.EUI_NODE_TOUCH_EVENT, button, TOUCH_CLICK], (_: string, __: unknown, eventData: unknown) => {
      const role = (eventData as { role?: Role }).role
      if (role !== undefined) {
        appendPasswordDigit(role, digit)
      }
    })
  }

  const clearButton = GameAPI.create_eui_button_at_position(
    HUD_BUTTON_STYLE,
    canvas,
    math.tofixed(900),
    math.tofixed(248),
    math.tofixed(220),
    math.tofixed(56),
    "stage12_pwd_clear"
  ) as EButton
  GameAPI.set_eui_node_horizontal_auto_center(clearButton, true, false, math.tofixed(0))
  GameAPI.set_eui_node_vertical_auto_center(clearButton, true, false, math.tofixed(230))
  LuaAPI.global_register_trigger_event([EVENT.EUI_NODE_TOUCH_EVENT, clearButton, TOUCH_CLICK], (_: string, __: unknown, eventData: unknown) => {
    const role = (eventData as { role?: Role }).role
    if (role !== undefined) {
      passwordInputByRoleId[roleIdOf(role)] = ""
      role.show_tips("密码已清空", math.tofixed(1))
      refreshPasswordUiForRole(role, true)
    }
  })

  passwordUi = { label, buttons, clearButton }
  for (const role of GameAPI.get_all_valid_roles()) {
    refreshPasswordUiForRole(role, false)
  }

  print("[Stage12] password ui created")
  return passwordUi
}

function maskPassword(input: string): string {
  let out = ""
  for (let i = 0; i < input.length; i = i + 1) {
    out = `${out}*`
  }
  return out
}

function refreshPasswordUiForRole(role: Role, visible: boolean): void {
  const ui = ensurePasswordUi()
  if (ui === undefined) {
    return
  }

  const roleId = roleIdOf(role)
  const input = passwordInputByRoleId[roleId] === undefined ? "" : passwordInputByRoleId[roleId]
  role.set_node_visible(ui.label, visible)
  role.set_node_touch_enabled(ui.label, false)
  role.set_label_font_size(ui.label, 28, math.tofixed(0))
  role.set_label_text(ui.label, `密码：${maskPassword(input)}`)

  for (let i = 0; i < ui.buttons.length; i = i + 1) {
    const button = ui.buttons[i]
    role.set_node_visible(button, visible)
    role.set_button_enabled(button, visible)
    role.set_button_font_size(button, math.tofixed(24))
    role.set_button_text(button, i === 9 ? "0" : tostring(i + 1))
  }

  role.set_node_visible(ui.clearButton, visible)
  role.set_button_enabled(ui.clearButton, visible)
  role.set_button_font_size(ui.clearButton, math.tofixed(22))
  role.set_button_text(ui.clearButton, "清空")
}

function openPasswordWall(role: Role): void {
  if (passwordSolved) {
    return
  }

  passwordSolved = openTarget(MECH_WALL3, role, "密码正确，机械墙3打开")
  if (passwordSolved) {
    role.show_tips("密码正确：2026", math.tofixed(1.6))
    refreshPasswordUiForRole(role, false)
    print(`[Stage12] password solved role=${tostring(roleIdOf(role))}`)
  }
}

function appendPasswordDigit(role: Role, digit: string): void {
  if (passwordSolved || !isRoleNear(role, PASSWORD_LOCK1, PASSWORD_RADIUS_SQ)) {
    return
  }

  const roleId = roleIdOf(role)
  let input = passwordInputByRoleId[roleId] === undefined ? "" : passwordInputByRoleId[roleId]
  if (input.length >= 4) {
    input = ""
  }

  input = `${input}${digit}`
  passwordInputByRoleId[roleId] = input
  refreshPasswordUiForRole(role, true)

  if (input.length < 4) {
    return
  }

  if (input === PASSWORD_CODE) {
    openPasswordWall(role)
  } else {
    role.show_tips("密码错误", math.tofixed(1.2))
    passwordInputByRoleId[roleId] = ""
    refreshPasswordUiForRole(role, true)
    print(`[Stage12] password wrong role=${tostring(roleId)} input=${input}`)
  }
}

function updatePassword(role: Role): void {
  if (passwordSolved) {
    refreshPasswordUiForRole(role, false)
    return
  }

  const near = isRoleNear(role, PASSWORD_LOCK1, PASSWORD_RADIUS_SQ)
  refreshPasswordUiForRole(role, near)
  if (near) {
    role.show_tips("输入密码", math.tofixed(0.4))
  } else {
    passwordInputByRoleId[roleIdOf(role)] = ""
  }
}

function updateVictory(role: Role): void {
  if (victoryDone || !passwordSolved || !isRoleNear(role, VICTORY_ZONE1, VICTORY_RADIUS_SQ)) {
    return
  }

  victoryDone = true
  role.show_tips("通关成功", math.tofixed(1.5))
  role.game_win_and_show_result_panel()
  print(`[Stage12] victory role=${tostring(roleIdOf(role))}`)
}

function updateRole(role: Role): void {
  updateButton(role)
  updateTile(role)
  updatePassword(role)
  updateVictory(role)
}

function updateAll(): void {
  for (const role of GameAPI.get_all_valid_roles()) {
    updateRole(role)
  }
}

function initInitialVisibility(): void {
  setupWall32Hint()
  hideTarget(TRAMPOLINE1, "stage8 init hidden")
  showTarget(BUTTON1, "stage9 init")
  showTarget(TILE1, "stage10 init")
  hideTarget(BOX1_REVEAL_ENTITY, "stage10 init hidden")
  hideTarget(BOX2_REVEAL_ENTITY, "stage11 init hidden")
  showTarget(PASSWORD_LOCK1, "stage12 init")
  for (const target of VISUAL_ONLY_HIDDEN_TARGETS) {
    hideVisualOnlyTarget(target, "init keep function")
  }
  print(`[Stage12] victory zone ready name=${VICTORY_ZONE1.name} id=${tostring(VICTORY_ZONE1.id)}`)
}

export function Init(): void {
  if (initialized) {
    return
  }
  initialized = true

  initInitialVisibility()
  MonsterManager.OnMonsterKilled(handleTargetMonsterKilled)
  ensurePasswordUi()
  updateEventId = LuaAPI.global_register_trigger_event([EVENT.REPEAT_TIMEOUT, UPDATE_SECONDS], () => {
    updateAll()
  })
  updateAll()

  print(`[Stage8To12] init end tick=${tostring(updateEventId)}`)
}
