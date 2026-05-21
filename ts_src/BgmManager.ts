import { safeCall } from "@common/engine_safe"

interface AudioGameApi {
  get_unit(this: void, unitId: UnitID): Unit | undefined
  get_all_valid_roles(this: void): Role[]
  play_2d_sound?(this: void, soundKey: SoundKey, loop?: boolean, volume?: Fixed): SoundID
  play_3d_sound?(this: void, position: Vector3, soundKey: SoundKey, duration?: Fixed, volume?: Fixed): SoundID
}

const START_MUSIC_TRIGGER_ID = 1648649203 as UnitID
const DANZAI_WALTZ_SOUND_KEY = 2001 as SoundKey
const START_MUSIC_VOLUME = math.tofixed(0.55)
const START_MUSIC_DURATION = math.tofixed(3600)

let started = false
let soundId: SoundID | undefined

function audioApi(): AudioGameApi {
  return GameAPI as unknown as AudioGameApi
}

function triggerUnit(): Unit | undefined {
  return safeCall(
    () => audioApi().get_unit(START_MUSIC_TRIGGER_ID),
    { tag: "BGM get start trigger", fallback: undefined, logger: (msg: string) => print(msg) }
  )
}

function playMusicNow(): boolean {
  const api = audioApi()
  const trigger = triggerUnit()
  const triggerName = trigger === undefined ? "nil" : trigger.get_name()
  const triggerPos = trigger === undefined ? undefined : trigger.get_position()

  const play2d = api.play_2d_sound
  if (play2d !== undefined) {
    const id = safeCall(
      () => play2d(DANZAI_WALTZ_SOUND_KEY, true, START_MUSIC_VOLUME),
      { tag: "BGM play_2d_sound", fallback: undefined, logger: (msg: string) => print(msg) }
    )
    if (id !== undefined) {
      soundId = id
      print(
        `[Stage0][BGM] play 蛋仔圆舞曲` +
          ` soundKey=${tostring(DANZAI_WALTZ_SOUND_KEY)}` +
          ` soundId=${tostring(id)}` +
          ` triggerId=${tostring(START_MUSIC_TRIGGER_ID)}` +
          ` trigger=${triggerName}` +
          " mode=2d_loop"
      )
      return true
    }
  }

  const roles = safeCall(
    () => api.get_all_valid_roles(),
    { tag: "BGM get roles", fallback: [], logger: (msg: string) => print(msg) }
  )
  let roleSoundCount = 0
  let firstRoleSoundId: SoundID | undefined
  for (const role of roles === undefined ? [] : roles) {
    if (role.is_lost()) {
      continue
    }

    const id = safeCall(
      () => role.play_2d_sound_with_params(
        DANZAI_WALTZ_SOUND_KEY as unknown as SoundID,
        START_MUSIC_DURATION,
        START_MUSIC_VOLUME,
        math.tofixed(1)
      ),
      { tag: "BGM role play_2d_sound_with_params", fallback: undefined, logger: (msg: string) => print(msg) }
    )
    if (id !== undefined) {
      roleSoundCount = roleSoundCount + 1
      if (firstRoleSoundId === undefined) {
        firstRoleSoundId = id
      }
    }
  }
  if (roleSoundCount > 0 && firstRoleSoundId !== undefined) {
    soundId = firstRoleSoundId
    print(
      `[Stage0][BGM] play 蛋仔圆舞曲` +
        ` soundKey=${tostring(DANZAI_WALTZ_SOUND_KEY)}` +
        ` soundId=${tostring(firstRoleSoundId)}` +
        ` triggerId=${tostring(START_MUSIC_TRIGGER_ID)}` +
        ` trigger=${triggerName}` +
        ` roles=${tostring(roleSoundCount)}` +
        " mode=role_2d"
    )
    return true
  }

  const play3d = api.play_3d_sound
  if (play3d !== undefined && triggerPos !== undefined) {
    const id = safeCall(
      () => play3d(triggerPos, DANZAI_WALTZ_SOUND_KEY, START_MUSIC_DURATION, START_MUSIC_VOLUME),
      { tag: "BGM play_3d_sound", fallback: undefined, logger: (msg: string) => print(msg) }
    )
    if (id !== undefined) {
      soundId = id
      print(
        `[Stage0][BGM] play 蛋仔圆舞曲` +
          ` soundKey=${tostring(DANZAI_WALTZ_SOUND_KEY)}` +
          ` soundId=${tostring(id)}` +
          ` triggerId=${tostring(START_MUSIC_TRIGGER_ID)}` +
          ` trigger=${triggerName}` +
          " mode=3d_trigger"
      )
      return true
    }
  }

  print(
    `[Stage0][BGM] play failed 蛋仔圆舞曲` +
      ` soundKey=${tostring(DANZAI_WALTZ_SOUND_KEY)}` +
      ` triggerId=${tostring(START_MUSIC_TRIGGER_ID)}` +
      ` trigger=${triggerName}`
  )
  return false
}

export function Init(): void {
  if (started) {
    return
  }

  started = true
  LuaAPI.call_delay_frame(2, () => {
    playMusicNow()
  })
}

export function GetSoundId(): SoundID | undefined {
  return soundId
}
