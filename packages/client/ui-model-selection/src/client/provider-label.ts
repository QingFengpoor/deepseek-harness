/**
 * Provider qualifiers for the model seat: only providers whose catalog names
 * collide with another provider's names need to be told apart, because the
 * model rows already sit under one provider heading.
 */

/** One provider as the seat displays it: localized name plus its model names. */
export interface QualifiedProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly { readonly name: string }[]
}

/**
 * Fold a catalog name so `DeepSeek V4` and `deepseek  v4` collide.
 * @param name - the displayed model or provider name.
 * @returns the comparison key.
 */
function fold(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Map each provider that must be told apart to the suffix its rows and the
 * trigger show after the model name. A provider is named only when another
 * provider advertises a model with the same displayed name; when the
 * colliding providers also share one display name, their route ids are used
 * instead so the suffixes themselves stay distinct.
 * @param groups - providers in display order, with localized display names.
 * @returns provider id to suffix; a provider absent from the map keeps its
 * bare model name.
 */
export function providerQualifiers(
  groups: readonly QualifiedProviderGroup[],
): ReadonlyMap<string, string> {
  const owners = new Map<string, Set<string>>()
  for (const group of groups) {
    for (const model of group.models) {
      const key = fold(model.name)
      const holders = owners.get(key)
      if (holders === undefined) owners.set(key, new Set([group.id]))
      else holders.add(group.id)
    }
  }
  const colliding = new Set<string>()
  for (const holders of owners.values()) {
    if (holders.size > 1) for (const id of holders) colliding.add(id)
  }
  const names = new Map(groups.map(group => [group.id, group.name]))
  // Providers sharing one display name would otherwise print an identical
  // suffix on both rows; their route id is the only stable distinction.
  const nameCounts = new Map<string, number>()
  for (const id of colliding) {
    const name = fold(names.get(id) ?? id)
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }
  const qualifiers = new Map<string, string>()
  for (const id of colliding) {
    const name = names.get(id) ?? id
    qualifiers.set(id, (nameCounts.get(fold(name)) ?? 0) > 1 ? id : name)
  }
  return qualifiers
}
