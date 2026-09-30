import os from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { createTracker } from './analyze'
import { buildGroups } from './origin'
import { readCwds, readLaunchdJobs, readLaunchdPlists, readListeningPorts, readMemoryUsage, readProcesses, readProjectRoots } from './system'
import type { AnalyzedProcess, Config, ProcessGroup } from './types'

// CPU is measured as cputime delta between two samples taken this far apart
const SAMPLE_GAP_MS = 1000

export type Snapshot = {
  processes: AnalyzedProcess[]
  groups: ProcessGroup[]
  cwds: ReadonlyMap<number, string>
  ports: ReadonlyMap<number, number[]>
  memory: { usedBytes: number | null, totalBytes: number }
}

export const takeSnapshot = async (config: Config): Promise<Snapshot> => {
  const tracker = createTracker(config)
  const myUid = process.getuid?.() ?? 0
  const sample = async () => {
    const [processes, launchdJobs] = await Promise.all([readProcesses(), readLaunchdJobs()])
    return { launchdJobs, processes: tracker.update(processes, { myUid, launchdJobs, now: Date.now() }) }
  }

  await Promise.all([sample(), sleep(SAMPLE_GAP_MS)])
  const [{ processes, launchdJobs }, memory] = await Promise.all([sample(), readMemoryUsage()])

  return { processes, memory, ...(await groupProcesses(processes, launchdJobs)) }
}

export const groupProcesses = async (processes: AnalyzedProcess[], launchdJobs: ReadonlyMap<number, string>) => {
  const [cwds, ports, plists] = await Promise.all([readCwds(), readListeningPorts(), readLaunchdPlists()])
  const projectRoots = await readProjectRoots(cwds.values())
  const myUid = process.getuid?.() ?? 0
  const groups = buildGroups({ processes, myUid, home: os.homedir(), launchdJobs, plists, cwds, projectRoots, ports })

  return { groups, cwds, ports }
}
