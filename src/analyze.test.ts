import { describe, expect, it } from 'vitest'

import { collectDescendants, createTracker } from './analyze'
import { DEFAULT_CONFIG } from './config'
import { makeProcess, MY_UID } from './test-factories'
import type { ProcessInfo } from './types'

const NOW = 1_800_000_000_000
const MINUTE = 60

const analyzeOnce = (process: ProcessInfo, launchdJobs = new Map<number, string>()) =>
  createTracker(DEFAULT_CONFIG).update([process], { myUid: MY_UID, launchdJobs, now: NOW })[0]

const getKinds = (process: ProcessInfo, launchdJobs?: Map<number, string>) =>
  analyzeOnce(process, launchdJobs)?.flags.map(flag => flag.kind)

const makeOrphan = (overrides: Partial<ProcessInfo> = {}) =>
  makeProcess({ pid: 5000, ppid: 1, pgid: 4990, stat: 'S', ...overrides })

describe('orphan detection', () => {
  it('flags a job whose group leader died', () => {
    expect(getKinds(makeOrphan())).toContain('orphan')
  })

  it('flags a group leader that still holds a terminal', () => {
    expect(getKinds(makeOrphan({ pgid: 5000, tty: 'ttys003' }))).toContain('orphan')
  })

  it('ignores a detached group leader, like app helpers', () => {
    expect(getKinds(makeOrphan({ pgid: 5000, tty: '??' }))).not.toContain('orphan')
  })

  it('ignores session leaders that daemonized on purpose', () => {
    expect(getKinds(makeOrphan({ stat: 'Ss' }))).not.toContain('orphan')
  })

  it('ignores launchd jobs', () => {
    expect(getKinds(makeOrphan(), new Map([[5000, 'com.example.job']]))).not.toContain('orphan')
  })

  it('ignores processes of other users', () => {
    expect(getKinds(makeOrphan({ uid: 0 }))).not.toContain('orphan')
  })

  it('ignores processes with a living parent', () => {
    expect(getKinds(makeOrphan({ ppid: 777 }))).not.toContain('orphan')
  })

  it('ignores configured names', () => {
    expect(getKinds(makeOrphan({ name: 'crashpad_handler' }))).not.toContain('orphan')
  })
})

describe('stale detection', () => {
  it('does not mark a fresh orphan stale', () => {
    expect(getKinds(makeOrphan({ elapsedSec: 29 * MINUTE }))).not.toContain('stale')
  })

  it('marks an orphan stale after the threshold', () => {
    expect(getKinds(makeOrphan({ elapsedSec: 30 * MINUTE }))).toContain('stale')
  })

  it('marks a long-lived zombie stale and names its parent', () => {
    const parent = makeProcess({ pid: 42, name: 'node' })
    const zombie = makeProcess({ ppid: 42, stat: 'Z+', elapsedSec: 11 * MINUTE })
    const [, analyzed] = createTracker(DEFAULT_CONFIG).update([parent, zombie], { myUid: MY_UID, launchdJobs: new Map(), now: NOW })

    expect(analyzed?.flags).toEqual([{ kind: 'stale', reason: 'zombie, parent node (42) never reaped it' }])
  })

  it('does not mark a zombie that is about to be reaped', () => {
    expect(getKinds(makeProcess({ stat: 'Z', elapsedSec: 5 }))).toEqual([])
  })

  it('marks a long-suspended job stale', () => {
    expect(getKinds(makeProcess({ stat: 'T', elapsedSec: 10 * MINUTE }))).toContain('stale')
  })
})

describe('runaway detection', () => {
  it('flags a process that burned CPU for its whole long life', () => {
    expect(getKinds(makeProcess({ elapsedSec: 20 * MINUTE, cpuTimeSec: 19 * MINUTE }))).toContain('runaway')
  })

  it('does not flag a short burst', () => {
    expect(getKinds(makeProcess({ elapsedSec: 5 * MINUTE, cpuTimeSec: 5 * MINUTE }))).not.toContain('runaway')
  })

  it('flags sustained load observed across samples', () => {
    const tracker = createTracker(DEFAULT_CONFIG)
    const base = makeProcess({ elapsedSec: 60 * MINUTE, cpuTimeSec: 0 })
    const context = { myUid: MY_UID, launchdJobs: new Map<number, string>() }

    tracker.update([base], { ...context, now: NOW })
    tracker.update([{ ...base, elapsedSec: base.elapsedSec + 60, cpuTimeSec: 60 }], { ...context, now: NOW + 60_000 })
    const [result] = tracker.update(
      [{ ...base, elapsedSec: base.elapsedSec + 11 * MINUTE, cpuTimeSec: 11 * MINUTE }],
      { ...context, now: NOW + 11 * MINUTE * 1000 },
    )

    expect(result?.flags.map(flag => flag.kind)).toContain('runaway')
  })

  it('measures CPU from cputime delta between samples', () => {
    const tracker = createTracker(DEFAULT_CONFIG)
    const base = makeProcess({ cpuTimeSec: 10, psCpuPercent: 3 })
    const context = { myUid: MY_UID, launchdJobs: new Map<number, string>() }

    tracker.update([base], { ...context, now: NOW })
    const [result] = tracker.update([{ ...base, elapsedSec: base.elapsedSec + 2, cpuTimeSec: 11 }], { ...context, now: NOW + 2000 })

    expect(result?.cpuPercent).toBeCloseTo(50)
  })

  it('resets history when a pid is reused by another program', () => {
    const tracker = createTracker(DEFAULT_CONFIG)
    const base = makeProcess({ cpuTimeSec: 1000, psCpuPercent: 7 })
    const context = { myUid: MY_UID, launchdJobs: new Map<number, string>() }

    tracker.update([base], { ...context, now: NOW })
    const [result] = tracker.update([{ ...base, command: '/bin/other', elapsedSec: 1, cpuTimeSec: 0 }], { ...context, now: NOW + 2000 })

    expect(result?.cpuPercent).toBe(7)
  })
})

describe('collectDescendants', () => {
  it('walks the whole subtree', () => {
    const processes = [
      makeProcess({ pid: 10, ppid: 1 }),
      makeProcess({ pid: 11, ppid: 10 }),
      makeProcess({ pid: 12, ppid: 11 }),
      makeProcess({ pid: 20, ppid: 1 }),
    ]

    expect(collectDescendants(processes, 10)).toEqual([11, 12])
  })

  it('returns nothing for a leaf', () => {
    expect(collectDescendants([makeProcess({ pid: 10 })], 10)).toEqual([])
  })
})
