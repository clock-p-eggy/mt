import { safeCall, safeVoid } from "@common/engine_safe"

const ROTATING_UNIT_IDS: UnitID[] = [
  1077691945,
  1275660450,
  1453043027,
]
const TARGET_ANGULAR_SPEED = math.tofixed(2.5)
const MEDIUM_ANGULAR_SPEED = math.tofixed(10)
const FAST_ANGULAR_SPEED = math.tofixed(20)
const ROTATING_UNIT_SPEEDS: Record<number, Fixed> = {
  [1077691945]: MEDIUM_ANGULAR_SPEED,
  [1453043027]: FAST_ANGULAR_SPEED,
}
const MIN_DIRECTION_LENGTH_SQ = math.tofixed(0.0001)
const REAPPLY_SECONDS = math.tofixed(1)
const REAPPLY_COUNT = 5

let initialized = false
let appliedCount = 0

function vectorLengthSq(vector: Vector3): Fixed {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
}

function targetSpeed(unitId: UnitID): Fixed {
  const speed = ROTATING_UNIT_SPEEDS[unitId]
  if (speed !== undefined) {
    return speed
  }
  return TARGET_ANGULAR_SPEED
}

function targetAngularVelocity(unit: Unit, unitId: UnitID, speed: Fixed): Vector3 {
  const current = safeCall(
    () => unit.get_angular_velocity(),
    {
      tag: `RotatingUnit get angular velocity id=${tostring(unitId)}`,
      fallback: undefined,
      logger: (msg: string) => print(msg),
    }
  )

  if (current === undefined || vectorLengthSq(current) <= MIN_DIRECTION_LENGTH_SQ) {
    return math.Vector3(0, speed, 0)
  }

  const length = math.sqrt(vectorLengthSq(current))
  return math.Vector3(
    current.x / length * speed,
    current.y / length * speed,
    current.z / length * speed
  )
}

function applyRotationSpeedForUnit(unitId: UnitID, reason: string): void {
  const unit = safeCall(
    () => GameAPI.get_unit(unitId),
    {
      tag: `RotatingUnit get unit id=${tostring(unitId)}`,
      fallback: undefined,
      logger: (msg: string) => print(msg),
    }
  )
  if (unit === undefined) {
    print(`[Stage8To12][RotatingUnit] missing id=${tostring(unitId)} reason=${reason}`)
    return
  }

  const speed = targetSpeed(unitId)
  const velocity = targetAngularVelocity(unit, unitId, speed)
  safeVoid(
    () => {
      unit.set_angular_velocity(velocity)
    },
    {
      tag: `RotatingUnit set angular velocity id=${tostring(unitId)}`,
      logger: (msg: string) => print(msg),
    }
  )

  print(
    `[Stage8To12][RotatingUnit] angular speed set` +
      ` id=${tostring(unitId)}` +
      ` speed=${tostring(speed)}` +
      ` velocity=(${tostring(velocity.x)},${tostring(velocity.y)},${tostring(velocity.z)})` +
      ` reason=${reason}`
  )
}

function applyRotationSpeed(reason: string): void {
  for (const unitId of ROTATING_UNIT_IDS) {
    applyRotationSpeedForUnit(unitId, reason)
  }
}

function scheduleReapply(): void {
  if (appliedCount >= REAPPLY_COUNT) {
    return
  }

  appliedCount = appliedCount + 1
  LuaAPI.call_delay_time(REAPPLY_SECONDS, () => {
    applyRotationSpeed(`reapply_${tostring(appliedCount)}`)
    scheduleReapply()
  })
}

export function Init(): void {
  if (initialized) {
    return
  }
  initialized = true

  applyRotationSpeed("init")
  scheduleReapply()
}
