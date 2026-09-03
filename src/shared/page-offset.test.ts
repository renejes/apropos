import { describe, expect, it } from 'vitest'
import { pageForOffset } from './page-offset'

describe('pageForOffset', () => {
  it('liefert 1-basierte Seiten aus bekannten page_starts', () => {
    expect(pageForOffset([0, 100, 250], 0)).toBe(1)
    expect(pageForOffset([0, 100, 250], 99)).toBe(1)
    expect(pageForOffset([0, 100, 250], 100)).toBe(2)
    expect(pageForOffset([0, 100, 250], 249)).toBe(2)
    expect(pageForOffset([0, 100, 250], 250)).toBe(3)
    expect(pageForOffset(null, 0)).toBeNull()
    expect(pageForOffset([], 0)).toBeNull()
  })
})
