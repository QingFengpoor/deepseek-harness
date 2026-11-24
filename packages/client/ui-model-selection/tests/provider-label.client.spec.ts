import { describe, expect, it } from 'vitest'
import { providerQualifiers, type QualifiedProviderGroup } from '../src/client/provider-label.ts'

/** One provider whose rows advertise the given displayed model names. */
function group(id: string, name: string, models: readonly string[]): QualifiedProviderGroup {
  return { id, name, models: models.map(model => ({ name: model })) }
}

describe('providerQualifiers', () => {
  it('names no provider while every displayed model name stays unique', () => {
    const qualifiers = providerQualifiers([
      group('open-code-go', 'OpenCode Go', ['hy4-flash-free', 'kimi']),
      group('hy4', 'hy4', ['longcat-2.5-free']),
    ])
    expect([...qualifiers]).toEqual([])
  })

  it('names each side of a cross-provider collision with its display name', () => {
    const qualifiers = providerQualifiers([
      group('open-code-go', 'OpenCode Go', ['hy4-flash-free']),
      group('hy4', 'hy4', ['hy4-flash-free', 'longcat-2.5-free']),
    ])
    expect(qualifiers.get('open-code-go')).toBe('OpenCode Go')
    expect(qualifiers.get('hy4')).toBe('hy4')
    // A provider without a colliding model never reaches the trigger or a row.
    expect(qualifiers.size).toBe(2)
  })

  it('ignores a repeated name inside one provider', () => {
    const qualifiers = providerQualifiers([
      group('open-code-go', 'OpenCode Go', ['hy4-flash-free', 'hy4-flash-free']),
      group('hy4', 'hy4', ['longcat-2.5-free']),
    ])
    expect(qualifiers.size).toBe(0)
  })

  it('compares names case-insensitively and without surrounding blanks', () => {
    const qualifiers = providerQualifiers([
      group('a', 'A', ['Hy4-Flash-Free']),
      group('b', 'B', ['  hy4-flash-free  ']),
    ])
    expect(qualifiers.get('a')).toBe('A')
    expect(qualifiers.get('b')).toBe('B')
  })

  it('still reports a collision when one provider repeats the name internally', () => {
    const qualifiers = providerQualifiers([
      group('a', 'A', ['dup', 'dup']),
      group('b', 'B', ['dup']),
    ])
    // The repeated catalog entry does not hide the cross-provider collision:
    // both providers name themselves, and both `a` rows inherit the suffix.
    expect(qualifiers.get('a')).toBe('A')
    expect(qualifiers.get('b')).toBe('B')
    expect(qualifiers.size).toBe(2)
  })

  it('falls back to route ids when the colliding providers share a display name', () => {
    const qualifiers = providerQualifiers([
      group('acme', 'Acme', ['shared-model']),
      group('acme-2', 'Acme', ['shared-model', 'solo-model']),
      group('other', 'Other', ['solo-model', 'other-model']),
    ])
    expect(qualifiers.get('acme')).toBe('acme')
    expect(qualifiers.get('acme-2')).toBe('acme-2')
    // `other` collides too, but its own display name is unique.
    expect(qualifiers.get('other')).toBe('Other')
    expect(qualifiers.size).toBe(3)
  })

  it('treats a provider with no models as non-colliding', () => {
    const qualifiers = providerQualifiers([
      group('empty', 'Empty', []),
      group('a', 'A', ['same']),
      group('b', 'B', ['same']),
    ])
    expect([...qualifiers.keys()].sort()).toEqual(['a', 'b'])
  })
})
