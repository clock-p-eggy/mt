import { ArrayOf, Field, FieldArray, FieldMap, MapOf, from_archive, to_archive } from "@common/archive"
import { json_parse, json_stringify } from "@common/json"

export class ItemSave {
  @Field("string")
  id = ""

  @Field("number")
  count = 0
}

export class ContainerSave {
  @FieldArray("number")
  numbers: number[] = [1, 2, 3]

  @FieldArray(ItemSave)
  items?: ItemSave[]

  @FieldMap("string", "boolean")
  flags?: Record<string, boolean>

  @FieldMap("string", ItemSave)
  itemById?: Record<string, ItemSave>
}

export function demo_archive_containers(): {
  archived: object
  loadedNumbersLen: number
  loadedFlagsA: boolean | undefined
  loadedItemCount: number | undefined
} {
  const c = new ContainerSave()

  const it = new ItemSave()
  it.id = "apple"
  it.count = 7

  c.items = [it]
  c.flags = { a: false }
  c.itemById = { apple: it }

  const archived = to_archive(c)
  const loaded = from_archive(ContainerSave, archived)

  return {
    archived,
    loadedNumbersLen: loaded.numbers.length,
    loadedFlagsA: loaded.flags?.a,
    loadedItemCount: loaded.itemById?.apple?.count,
  }
}

export class NestedContainerSave {
  // Number-key map: encoded as a tagged map so it survives JSON.
  @FieldMap("number", "boolean")
  discovered?: Record<number, boolean>

  // Nested containers: map<number, array<number>>.
  @Field(MapOf("number", ArrayOf("number")))
  scoresByAnimalTypeId?: Record<number, number[]>

  // Nested containers: map<number, map<string, ItemSave>>.
  @Field(MapOf("number", MapOf("string", ItemSave)))
  itemsByAnimalTypeId?: Record<number, Record<string, ItemSave>>
}

export function demo_archive_nested_containers_json(): {
  json: string
  loadedHasAnimal12: boolean
  loadedScoreLen12: number
  loadedAppleCount: number | undefined
} {
  const c = new NestedContainerSave()

  const discovered: Record<number, boolean> = {} as Record<number, boolean>
  discovered[12] = true
  discovered[7] = true
  c.discovered = discovered

  const scores: Record<number, number[]> = {} as Record<number, number[]>
  scores[12] = [1, 2, 3]
  c.scoresByAnimalTypeId = scores

  const it = new ItemSave()
  it.id = "apple"
  it.count = 7

  const itemsById: Record<string, ItemSave> = { apple: it }
  const itemsByAnimal: Record<number, Record<string, ItemSave>> = {} as Record<number, Record<string, ItemSave>>
  itemsByAnimal[12] = itemsById
  c.itemsByAnimalTypeId = itemsByAnimal

  const archived = to_archive(c)
  const json = json_stringify(archived)
  const parsed = json_parse(json)
  const loaded = from_archive(NestedContainerSave, parsed)

  const loadedHasAnimal12 = loaded.discovered !== undefined && loaded.discovered[12] === true
  const loadedScoreLen12 = loaded.scoresByAnimalTypeId !== undefined ? loaded.scoresByAnimalTypeId[12].length : 0
  const loadedAppleCount = loaded.itemsByAnimalTypeId?.[12]?.apple?.count

  return { json, loadedHasAnimal12, loadedScoreLen12, loadedAppleCount }
}
