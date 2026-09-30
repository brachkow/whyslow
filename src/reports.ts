import type { AnalyzedProcess, FlagKind, StaleEvent } from './types'

const REPORTABLE = new Set<FlagKind>(['stale', 'runaway'])

export type ReportState = Map<number, { command: string, kinds: Set<FlagKind> }>

export const collectNewReports = (state: ReportState, processes: AnalyzedProcess[], now: Date): StaleEvent[] => {
  const alive = new Map(processes.map(process => [process.pid, process]))
  for (const [pid, entry] of state) {
    if (alive.get(pid)?.command !== entry.command) {
      state.delete(pid)
    }
  }

  const events: StaleEvent[] = []

  for (const process of processes) {
    for (const flag of process.flags) {
      if (!REPORTABLE.has(flag.kind)) {
        continue
      }

      const entry = state.get(process.pid) ?? { command: process.command, kinds: new Set<FlagKind>() }
      state.set(process.pid, entry)
      if (entry.kinds.has(flag.kind)) {
        continue
      }

      entry.kinds.add(flag.kind)
      events.push({
        at: now.toISOString(),
        pid: process.pid,
        name: process.name,
        args: process.args,
        kind: flag.kind,
        reason: flag.reason,
        rssKb: process.rssKb,
        cpuPercent: process.cpuPercent,
      })
    }
  }

  return events
}
