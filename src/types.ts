export type ProcessInfo = {
  pid: number
  ppid: number
  pgid: number
  uid: number
  user: string
  psCpuPercent: number
  rssKb: number
  elapsedSec: number
  cpuTimeSec: number
  stat: string
  tty: string
  command: string
  name: string
  args: string
}

export type FlagKind = 'orphan' | 'stale' | 'runaway'

export type Flag = {
  kind: FlagKind
  reason: string
}

export type AnalyzedProcess = ProcessInfo & {
  cpuPercent: number
  flags: Flag[]
}

export type Thresholds = {
  staleOrphanAfterMin: number
  stuckAfterMin: number
  runawayCpuPercent: number
  runawayAfterMin: number
  ignore: string[]
}

export type Section = 'leftovers' | 'projects' | 'apps' | 'background' | 'system' | 'other'

export type ProcessGroup = {
  id: string
  section: Section
  title: string
  why: string
  location: string | null
  processes: AnalyzedProcess[]
  cpuPercent: number
  rssKb: number
  // Of the oldest process, so it tells how long the group has been up
  elapsedSec: number
  ports: number[]
  flags: Flag[]
}
