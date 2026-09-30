import os from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { createTracker } from './analyze'
import type { TrackerContext } from './analyze'
import { buildGroups } from './origin'
import { currentPlatform } from './platform'
import type { MemoryUsage, ServiceInfo } from './platform/types'
import { readProjectRoots } from './projects'
import type { AnalyzedProcess, Config, ProcessGroup, ProcessInfo } from './types'

// CPU is measured as cputime delta between two samples taken this far apart
const SAMPLE_GAP_MS = 1000

export type Snapshot = {
  processes: AnalyzedProcess[]
  groups: ProcessGroup[]
  cwds: ReadonlyMap<number, string>
  ports: ReadonlyMap<number, number[]>
  memory: MemoryUsage
}

const managedPids = (services: ReadonlyMap<number, ServiceInfo>) =>
  new Set([...services].filter(([, service]) => service.kind !== 'app').map(([pid]) => pid))

// Everything the tracker needs to judge one sample; service definitions are skipped because they are slow
export const readTrackerInput = async (): Promise<{ processes: ProcessInfo[], context: Omit<TrackerContext, 'now'> }> => {
  const platform = currentPlatform()
  const processes = await platform.readProcesses()
  const services = await platform.readServices(processes, { detailed: false })
  return {
    processes,
    context: { myUid: process.getuid?.() ?? 0, managedPids: managedPids(services), adopterPids: platform.adopterPids(processes), selfPid: process.pid },
  }
}

export const groupProcesses = async (processes: AnalyzedProcess[]) => {
  const platform = currentPlatform()
  const [cwds, ports, services] = await Promise.all([
    platform.readCwds(processes),
    platform.readListeningPorts(processes),
    platform.readServices(processes, { detailed: true }),
  ])
  const projectRoots = await readProjectRoots(cwds.values())
  const groups = buildGroups({
    processes,
    myUid: process.getuid?.() ?? 0,
    home: os.homedir(),
    services,
    adopterPids: platform.adopterPids(processes),
    cwds,
    projectRoots,
    ports,
    rules: platform.rules,
  })

  return { groups, cwds, ports }
}

export const takeSnapshot = async (config: Config): Promise<Snapshot> => {
  const tracker = createTracker(config)
  const sample = async () => {
    const { processes, context } = await readTrackerInput()
    return tracker.update(processes, { ...context, now: Date.now() })
  }

  await Promise.all([sample(), sleep(SAMPLE_GAP_MS)])
  const [processes, memory] = await Promise.all([sample(), currentPlatform().readMemoryUsage()])

  return { processes, memory, ...(await groupProcesses(processes)) }
}
