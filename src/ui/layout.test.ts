import { describe, expect, it } from 'vitest'

import { makeAnalyzed } from '../test-factories'
import type { ProcessGroup } from '../types'
import { rowAtLine, visibleWindow } from './layout'
import type { Row } from './layout'

const group: ProcessGroup = {
  id: 'app:Firefox',
  section: 'apps',
  title: 'Firefox',
  why: 'app',
  location: null,
  processes: [],
  cpuPercent: 0,
  rssKb: 0,
  elapsedSec: 0,
  ports: [],
  flags: [],
}

const section = (key: string): Row => ({ kind: 'section', key, section: 'apps', count: 1 })
const groupRow = (key: string): Row => ({ kind: 'group', key, group })
const processRow = (key: string): Row => ({ kind: 'process', key, group, process: makeAnalyzed() })

describe('rowAtLine', () => {
  // Lines: 0 blank, 1 "Apps", 2 group, 3 process, 4 blank, 5 "macOS", 6 group
  const rows = [section('apps'), groupRow('firefox'), processRow('firefox/1'), section('macos'), groupRow('backupd')]

  it.each([
    [2, 'firefox'],
    [3, 'firefox/1'],
    [6, 'backupd'],
  ])('finds the row drawn on line %d', (line, key) => {
    expect(rowAtLine(rows, line)?.key).toBe(key)
  })

  it('maps both lines of a section title to the section', () => {
    expect([rowAtLine(rows, 4)?.key, rowAtLine(rows, 5)?.key]).toEqual(['macos', 'macos'])
  })

  it('returns nothing below the last row', () => {
    expect(rowAtLine(rows, 7)).toBeUndefined()
  })

  it('returns nothing above the list', () => {
    expect(rowAtLine(rows, -1)).toBeUndefined()
  })
})

describe('visibleWindow', () => {
  const rows = Array.from({ length: 20 }, (_, index) => groupRow(String(index)))

  it('fills the height starting from the top', () => {
    expect(visibleWindow(rows, 0, 5).map(row => row.key)).toEqual(['0', '1', '2', '3', '4'])
  })

  it('keeps the selection near the middle', () => {
    expect(visibleWindow(rows, 10, 5).map(row => row.key)).toEqual(['9', '10', '11', '12', '13'])
  })

  it('fills the height at the bottom', () => {
    expect(visibleWindow(rows, 19, 5).map(row => row.key)).toEqual(['15', '16', '17', '18', '19'])
  })

  it('counts section titles as two lines', () => {
    const withSection = [section('a'), groupRow('1'), groupRow('2')]

    expect([visibleWindow(withSection, 1, 3), visibleWindow(withSection, 1, 4)].map(window => window.map(row => row.key))).toEqual([['1', '2'], ['a', '1', '2']])
  })
})
