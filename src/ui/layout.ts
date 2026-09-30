import type { AnalyzedProcess, ProcessGroup, Section } from '../types'

export type Row
  = | { kind: 'section', key: string, section: Section, count: number }
    | { kind: 'quiet', key: string, count: number }
    | { kind: 'group', key: string, group: ProcessGroup }
    | { kind: 'process', key: string, group: ProcessGroup, process: AnalyzedProcess }

// Section titles have a blank line above them
export const rowHeight = (row: Row) => (row.kind === 'section' ? 2 : 1)

export const isSelectable = (row: Row) => row.kind === 'group' || row.kind === 'process'

// Window of rows around the selection that fits into the available height
export const visibleWindow = (rows: Row[], selectedIndex: number, height: number): Row[] => {
  const heights = rows.map(rowHeight)
  let start = selectedIndex
  let end = selectedIndex + 1
  let used = heights[selectedIndex] ?? 0

  while (start > 0 && used + (heights[start - 1] ?? 0) <= height / 2) {
    start -= 1
    used += heights[start] ?? 0
  }
  while (end < rows.length && used + (heights[end] ?? 0) <= height) {
    used += heights[end] ?? 0
    end += 1
  }
  while (start > 0 && used + (heights[start - 1] ?? 0) <= height) {
    start -= 1
    used += heights[start] ?? 0
  }

  return rows.slice(start, end)
}

// Maps a 0-based line inside the rendered list back to the row drawn there
export const rowAtLine = (rows: Row[], line: number): Row | undefined => {
  let top = 0
  for (const row of rows) {
    const height = rowHeight(row)
    if (line >= top && line < top + height) {
      return row
    }
    top += height
  }
  return undefined
}
