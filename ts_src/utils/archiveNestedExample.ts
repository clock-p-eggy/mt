import { Field, to_archive, from_archive } from "@common/archive"

export class ChildSave {
  @Field("number")
  level = 1

  @Field("boolean")
  enabled = false
}

export class ParentSave {
  @Field("string")
  name = "parent"

  @Field(ChildSave)
  child?: ChildSave
}

export function demo_archive_nested(): {
  archivedWithNil: object
  loadedNilChildIsNil: boolean
  archivedWithChild: object
  loadedChildLevel: number | undefined
  loadedChildEnabled: boolean | undefined
} {
  const a = new ParentSave()
  const archivedWithNil = to_archive(a)
  const loadedNil = from_archive(ParentSave, archivedWithNil)

  const b = new ParentSave()
  const child = new ChildSave()
  child.level = 42
  child.enabled = false
  b.child = child

  const archivedWithChild = to_archive(b)
  const loadedChild = from_archive(ParentSave, archivedWithChild).child

  return {
    archivedWithNil,
    loadedNilChildIsNil: loadedNil.child === undefined,
    archivedWithChild,
    loadedChildLevel: loadedChild?.level,
    loadedChildEnabled: loadedChild?.enabled,
  }
}
