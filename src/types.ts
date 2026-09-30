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

export type Config = {
  staleOrphanAfterMin: number
  stuckAfterMin: number
  runawayCpuPercent: number
  runawayAfterMin: number
  daemonIntervalSec: number
  ignore: string[]
}

export type StaleEvent = {
  at: string
  pid: number
  name: string
  args: string
  kind: FlagKind
  reason: string
  rssKb: number
  cpuPercent: number
  // Missing in events written before origins existed
  why?: string
}

export type LaunchdPlist = {
  label: string
  program: string | null
  path: string
  kind: 'agent' | 'daemon'
  runAtLoad: boolean
}

export type Section = 'leftovers' | 'projects' | 'apps' | 'background' | 'macos' | 'other'

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
