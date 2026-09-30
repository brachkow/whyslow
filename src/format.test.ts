import { describe, expect, it } from 'vitest'

import { fitPorts, formatDuration, formatMemory, portsLabel, truncate } from './format'

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m'],
    [3661, '1h1m'],
    [90_000, '1d1h'],
  ])('formats %d seconds as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })
})

describe('formatMemory', () => {
  it.each([
    [512, '512K'],
    [2048, '2M'],
    [1024 * 1024 * 1.5, '1.5G'],
  ])('formats %d KB as %s', (input, expected) => {
    expect(formatMemory(input)).toBe(expected)
  })
})

describe('truncate', () => {
  it('keeps short text intact', () => {
    expect(truncate('node', 10)).toBe('node')
  })

  it('adds an ellipsis to overflowing text', () => {
    expect(truncate('Google Chrome Helper', 8)).toBe('Google …')
  })

  it('returns empty string for zero width', () => {
    expect(truncate('node', 0)).toBe('')
  })
})

describe('fitPorts', () => {
  const getLabel = (ports: number[], width: number) => {
    const { shown, hidden } = fitPorts(ports, width)
    return portsLabel(shown, hidden)
  }

  it('shows all ports that fit', () => {
    expect(getLabel([3000, 5173], 20)).toBe(':3000 :5173')
  })

  it('counts ports that do not fit', () => {
    expect(getLabel([5173, 5454, 8787, 9229, 59_779], 20)).toBe(':5173 :5454 :8787 +2')
  })

  it('falls back to only a count when no port fits', () => {
    expect(getLabel([65_105, 65_107], 4)).toBe('+2')
  })

  it('shows nothing without ports', () => {
    expect(getLabel([], 20)).toBe('')
  })
})
