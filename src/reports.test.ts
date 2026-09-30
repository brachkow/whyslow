import { describe, expect, it } from 'vitest'

import { collectNewReports } from './reports'
import type { ReportState } from './reports'
import { makeAnalyzed } from './test-factories'

const NOW = new Date('2026-09-30T10:00:00Z')

const makeStale = () => makeAnalyzed({ flags: [{ kind: 'stale', reason: 'orphaned, alive for 1h0m' }] })

describe('collectNewReports', () => {
  it('reports a newly stale process', () => {
    const state: ReportState = new Map()

    expect(collectNewReports(state, [makeStale()], NOW)).toHaveLength(1)
  })

  it('reports each process only once', () => {
    const state: ReportState = new Map()
    const process = makeStale()
    collectNewReports(state, [process], NOW)

    expect(collectNewReports(state, [process], NOW)).toEqual([])
  })

  it('does not report plain orphans', () => {
    const process = makeAnalyzed({ flags: [{ kind: 'orphan', reason: 'parent died' }] })

    expect(collectNewReports(new Map(), [process], NOW)).toEqual([])
  })

  it('reports again when a pid is reused by another program', () => {
    const state: ReportState = new Map()
    const process = makeStale()
    collectNewReports(state, [process], NOW)

    expect(collectNewReports(state, [{ ...process, command: '/bin/other' }], NOW)).toHaveLength(1)
  })

  it('reports runaway separately from stale for the same process', () => {
    const state: ReportState = new Map()
    const process = makeStale()
    collectNewReports(state, [process], NOW)
    const runaway = { ...process, flags: [...process.flags, { kind: 'runaway' as const, reason: '≥80% CPU for 10m' }] }

    expect(collectNewReports(state, [runaway], NOW).map(event => event.kind)).toEqual(['runaway'])
  })
})
