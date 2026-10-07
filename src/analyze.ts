import { formatDuration } from './format'
import type { AnalyzedProcess, Flag, ProcessInfo, Thresholds } from './types'

type Sample = {
  command: string
  elapsedSec: number
  cpuTimeSec: number
  at: number
}

export type TrackerContext = {
  myUid: number
  // Started and supervised by launchd or systemd
  managedPids: ReadonlySet<number>
  // pid 1, plus per-user subreapers like systemd --user
  adopterPids: ReadonlySet<number>
  // whyslow itself, which a container may run as a direct child of init
  selfPid: number
  now: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  staleOrphanAfterMin: 30,
  stuckAfterMin: 10,
  runawayCpuPercent: 80,
  runawayAfterMin: 10,
  // Crash reporters intentionally detach from their app, they are not real orphans
  ignore: ['crashpad_handler', 'chrome_crashpad_handler', 'crashhelper'],
}

// Dropping below this share of the threshold ends a runaway streak, so short dips don't reset it
const RUNAWAY_HYSTERESIS = 0.75

const isSameProcess = (sample: Sample, process: ProcessInfo) =>
  sample.command === process.command && sample.elapsedSec <= process.elapsedSec

export const isOrphan = (process: ProcessInfo, context: TrackerContext, config: Thresholds) =>
  process.pid !== context.selfPid
  && !context.adopterPids.has(process.pid)
  && context.adopterPids.has(process.ppid)
  && process.uid === context.myUid
  // Processes started by the service manager or ones that daemonized on purpose lead their own session
  && !process.stat.includes('s')
  // Helpers launched by apps lead their own group without a terminal; a job whose group leader died or that still holds a tty was left behind
  && (process.pgid !== process.pid || process.tty !== '??')
  && !context.managedPids.has(process.pid)
  && !config.ignore.includes(process.name)

const staleReason = (process: ProcessInfo, orphan: boolean, parent: ProcessInfo | undefined, config: Thresholds): string | null => {
  const stuck = process.elapsedSec >= config.stuckAfterMin * 60
  if (process.stat.startsWith('Z') && stuck) {
    return `zombie, parent ${parent?.name ?? '?'} (${process.ppid}) never reaped it`
  }
  if (process.stat.startsWith('T') && stuck) {
    return `suspended job, alive for ${formatDuration(process.elapsedSec)}`
  }
  if (orphan && process.elapsedSec >= config.staleOrphanAfterMin * 60) {
    return `orphaned, alive for ${formatDuration(process.elapsedSec)}`
  }
  return null
}

export const createTracker = (config: Thresholds = DEFAULT_THRESHOLDS) => {
  const samples = new Map<number, Sample>()
  const highCpuSince = new Map<number, number>()

  const measureCpu = (process: ProcessInfo, now: number): number => {
    const previous = samples.get(process.pid)
    if (!previous || !isSameProcess(previous, process) || now <= previous.at) {
      return process.psCpuPercent
    }

    return Math.max(0, ((process.cpuTimeSec - previous.cpuTimeSec) / ((now - previous.at) / 1000)) * 100)
  }

  const trackRunaway = (process: ProcessInfo, cpuPercent: number, now: number, isNew: boolean) => {
    const threshold = config.runawayCpuPercent

    if (isNew) {
      // Without history, lifetime average CPU tells whether it has been burning since start
      const lifetimeCpu = process.elapsedSec > 0 ? (process.cpuTimeSec / process.elapsedSec) * 100 : 0
      if (lifetimeCpu >= threshold) {
        highCpuSince.set(process.pid, now - process.elapsedSec * 1000)
      } else if (cpuPercent >= threshold) {
        highCpuSince.set(process.pid, now)
      }
      return
    }

    const since = highCpuSince.get(process.pid)
    if (since === undefined && cpuPercent >= threshold) {
      highCpuSince.set(process.pid, now)
    }
    if (since !== undefined && cpuPercent < threshold * RUNAWAY_HYSTERESIS) {
      highCpuSince.delete(process.pid)
    }
  }

  const runawayReason = (process: ProcessInfo, now: number): string | null => {
    const since = highCpuSince.get(process.pid)
    if (since === undefined) {
      return null
    }

    const durationSec = (now - since) / 1000
    if (durationSec < config.runawayAfterMin * 60) {
      return null
    }

    return `≥${config.runawayCpuPercent}% CPU for ${formatDuration(durationSec)}`
  }

  const update = (processes: ProcessInfo[], context: TrackerContext): AnalyzedProcess[] => {
    const byPid = new Map(processes.map(process => [process.pid, process]))
    for (const pid of samples.keys()) {
      if (!byPid.has(pid)) {
        samples.delete(pid)
        highCpuSince.delete(pid)
      }
    }

    return processes.map((process) => {
      const previous = samples.get(process.pid)
      const isNew = !previous || !isSameProcess(previous, process)
      if (isNew) {
        highCpuSince.delete(process.pid)
      }

      const cpuPercent = measureCpu(process, context.now)
      trackRunaway(process, cpuPercent, context.now, isNew)
      samples.set(process.pid, {
        command: process.command,
        elapsedSec: process.elapsedSec,
        cpuTimeSec: process.cpuTimeSec,
        at: context.now,
      })

      const orphan = isOrphan(process, context, config)
      const stale = staleReason(process, orphan, byPid.get(process.ppid), config)
      const runaway = runawayReason(process, context.now)

      const flags: Flag[] = [
        ...(orphan ? [{ kind: 'orphan' as const, reason: 'its parent exited' }] : []),
        ...(stale ? [{ kind: 'stale' as const, reason: stale }] : []),
        ...(runaway ? [{ kind: 'runaway' as const, reason: runaway }] : []),
      ]

      return { ...process, cpuPercent, flags }
    })
  }

  return { update }
}

export const collectDescendants = (processes: ProcessInfo[], rootPid: number): number[] => {
  const childrenByParent = Map.groupBy(processes, process => process.ppid)
  const result = new Set<number>()
  const queue = [rootPid]

  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of childrenByParent.get(pid) ?? []) {
      if (child.pid === rootPid || result.has(child.pid)) {
        continue
      }
      result.add(child.pid)
      queue.push(child.pid)
    }
  }

  return [...result]
}

type Weighted = { cpuPercent: number, rssKb: number, elapsedSec: number }

export const byCpu = (a: Weighted, b: Weighted) => b.cpuPercent - a.cpuPercent
export const byMemory = (a: Weighted, b: Weighted) => b.rssKb - a.rssKb
export const byRuntime = (a: Weighted, b: Weighted) => b.elapsedSec - a.elapsedSec
