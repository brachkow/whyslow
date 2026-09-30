import path from 'node:path'

import { describeMacosProcess, isMacosPath } from './macos'
import type { AnalyzedProcess, Flag, LaunchdPlist, ProcessGroup, ProcessInfo, Section } from './types'

export type OriginInput = {
  processes: AnalyzedProcess[]
  myUid: number
  home: string
  launchdJobs: ReadonlyMap<number, string>
  plists: LaunchdPlist[]
  cwds: ReadonlyMap<number, string>
  projectRoots: ReadonlyMap<string, string>
  ports: ReadonlyMap<number, number[]>
}

type Origin = {
  section: Section
  key: string
  title: string
  why: string
  location: string | null
}

const SHELLS = new Set(['fish', 'zsh', 'bash', 'sh', 'dash', 'nu', 'login', 'sudo', 'env'])
const INHERITED_SECTIONS = new Set<Section>(['leftovers', 'apps', 'projects', 'background'])
const APP_REGEX = /\/Applications\/(?:[^/]*\/)*?([^/]+)\.app(?:\/|$)/
const MAX_SHOWN_COMMANDS = 2
const LOGIN_SHELL_PREFIX = /^-/
const MAX_COMMAND_LENGTH = 40
const BUNDLE_REGEX = /\/([^/]+)\.(framework|dext|bundle|xpc)\//

export const appOf = (command: string): string | null => APP_REGEX.exec(command)?.[1] ?? null

export const tildify = (file: string, home: string) =>
  file === home || file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file

// Login shells are reported as `-fish`
const isShell = (process: ProcessInfo) => SHELLS.has(process.name.replace(LOGIN_SHELL_PREFIX, ''))

const isSimulator = (process: ProcessInfo) =>
  process.name === 'launchd_sim' || process.command.includes('.simruntime/') || process.command.includes('/CoreSimulator/')

// Keeps the command recognizable while dropping long absolute paths, which may contain spaces
export const shortCommand = (process: ProcessInfo) => {
  const rest = process.args.startsWith(process.command) ? process.args.slice(process.command.length) : process.args.slice(process.args.indexOf(' ') + 1 || process.args.length)
  const tokens = rest
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const [flag, value] = token.startsWith('--') && token.includes('=') ? token.split('=', 2) : [null, token]
      const short = value?.includes('/') ? path.basename(value) : value
      return flag ? `${flag}=${short}` : short
    })
  const full = [process.name, ...tokens].join(' ')

  return full.length > MAX_COMMAND_LENGTH ? `${full.slice(0, MAX_COMMAND_LENGTH - 1)}…` : full
}

export const ancestorsOf = <T extends ProcessInfo>(process: T, byPid: ReadonlyMap<number, T>): T[] => {
  const result: T[] = []
  const seen = new Set([process.pid])

  for (let parent = byPid.get(process.ppid); parent && !seen.has(parent.pid); parent = byPid.get(parent.ppid)) {
    result.push(parent)
    seen.add(parent.pid)
  }

  return result
}

const isLeftover = (process: AnalyzedProcess) => process.flags.some(flag => flag.kind === 'orphan' || flag.kind === 'stale')

const displayName = (process: ProcessInfo) => appOf(process.command) ?? process.name

// First ancestor outside the group that isn't a shell: the terminal, IDE or tool that started it
const launcherOf = (process: ProcessInfo, groupPids: ReadonlySet<number>, byPid: ReadonlyMap<number, ProcessInfo>) => {
  const launcher = ancestorsOf(process, byPid).find(ancestor => !groupPids.has(ancestor.pid) && !isShell(ancestor))
  return !launcher || launcher.pid === 1 ? 'launchd' : displayName(launcher)
}

export const buildGroups = (input: OriginInput): ProcessGroup[] => {
  const { processes, myUid, home, launchdJobs, plists, cwds, projectRoots, ports } = input
  const byPid = new Map(processes.map(process => [process.pid, process]))
  const plistByProgram = new Map(plists.filter(plist => plist.program).map(plist => [plist.program, plist]))
  const plistByLabel = new Map(plists.map(plist => [plist.label, plist]))
  const origins = new Map<number, Origin>()

  const describePlist = (plist: LaunchdPlist) =>
    `${plist.kind === 'agent' ? 'LaunchAgent' : 'LaunchDaemon'} ${plist.label}${plist.runAtLoad ? ', starts at boot/login' : ''}`

  const leftoverOrigin = (process: AnalyzedProcess): Origin => {
    const cwd = cwds.get(process.pid)
    const root = cwd ? projectRoots.get(cwd) : undefined
    const place = root ? `in project ${path.basename(root)}` : (cwd ? `in ${tildify(cwd, home)}` : null)
    return {
      section: 'leftovers',
      key: `leftover:${process.pid}`,
      title: process.name,
      why: [`\`${shortCommand(process)}\``, place].filter(Boolean).join(' '),
      location: cwd ?? null,
    }
  }

  const ownOrigin = (process: AnalyzedProcess): Origin | null => {
    if (isSimulator(process)) {
      return { section: 'apps', key: 'simulator', title: 'iOS Simulator', why: 'simulated devices booted from Xcode', location: null }
    }

    const app = appOf(process.command)
    if (app) {
      return { section: 'apps', key: `app:${app}`, title: app, why: 'app', location: process.command.slice(0, process.command.indexOf('.app') + 4) }
    }

    const cwd = cwds.get(process.pid)
    const root = cwd ? projectRoots.get(cwd) : undefined
    if (process.uid === myUid && root) {
      return { section: 'projects', key: `project:${root}`, title: path.basename(root), why: '', location: root }
    }

    const label = launchdJobs.get(process.pid)
    const plist = plistByProgram.get(process.command) ?? (label ? plistByLabel.get(label) : undefined)
    if (plist) {
      return { section: 'background', key: `agent:${plist.label}`, title: process.name, why: describePlist(plist), location: plist.path }
    }
    if (label && !label.startsWith('com.apple.') && !label.startsWith('application.')) {
      return { section: 'background', key: `agent:${label}`, title: process.name, why: `launchd job ${label}`, location: process.command }
    }

    const detached = process.uid === myUid && process.ppid === 1 && process.stat.includes('s') && !label
    if (detached && !isMacosPath(process.command)) {
      const started = cwd ? `, started in ${tildify(cwd, home)}` : ''
      return { section: 'background', key: `detached:${process.pid}`, title: process.name, why: `detached from its terminal${started}`, location: process.command }
    }

    return null
  }

  const fallbackOrigin = (process: AnalyzedProcess): Origin => {
    const label = launchdJobs.get(process.pid)

    if (isMacosPath(process.command)) {
      const bundle = BUNDLE_REGEX.exec(process.command)
      const fallback = bundle ? `part of ${bundle[1]} ${bundle[2]}` : `macOS component from ${path.dirname(process.command)}`
      const why = describeMacosProcess(process.name) ?? (label ? `macOS service ${label}` : fallback)
      return { section: 'macos', key: `macos:${process.name}`, title: process.name, why, location: process.command }
    }
    if (process.uid !== myUid) {
      return { section: 'background', key: `system:${process.name}`, title: process.name, why: `system-wide helper, runs as ${process.user}`, location: process.command }
    }

    const parent = byPid.get(process.ppid)
    return { section: 'other', key: `other:${process.name}`, title: process.name, why: `started by ${parent ? displayName(parent) : 'launchd'}`, location: process.command }
  }

  const resolve = (process: AnalyzedProcess): Origin => {
    const cached = origins.get(process.pid)
    if (cached) {
      return cached
    }

    const leftoverRoot = [process, ...ancestorsOf(process, byPid)].find(isLeftover)
    const inherited = (() => {
      const parent = byPid.get(process.ppid)
      if (!parent || parent.pid <= 1) {
        return null
      }
      const parentOrigin = resolve(parent)
      return INHERITED_SECTIONS.has(parentOrigin.section) ? parentOrigin : null
    })()

    const origin = (leftoverRoot && leftoverOrigin(leftoverRoot))
      ?? ownOrigin(process)
      ?? inherited
      ?? fallbackOrigin(process)

    origins.set(process.pid, origin)
    return origin
  }

  const grouped = Map.groupBy(processes, process => resolve(process).key)

  return Array.from(grouped.values(), (members) => {
    const first = members[0]!
    const origin = resolve(first)
    const pids = new Set(members.map(member => member.pid))
    const flags = new Map<Flag['kind'], Flag>()
    for (const flag of members.flatMap(member => member.flags)) {
      flags.set(flag.kind, flags.get(flag.kind) ?? flag)
    }

    const why = (() => {
      if (origin.section === 'projects') {
        const isJob = (member: AnalyzedProcess) => {
          const parent = byPid.get(member.ppid)
          return !isShell(member) && (!parent || !pids.has(parent.pid) || isShell(parent))
        }
        const jobs = members.filter(isJob).toSorted((a, b) => b.cpuPercent - a.cpuPercent)
        const commands = [...new Set(jobs.map(job => `\`${shortCommand(job)}\``))]
        const more = commands.length > MAX_SHOWN_COMMANDS ? ` +${commands.length - MAX_SHOWN_COMMANDS} more` : ''
        const launcher = launcherOf(jobs[0] ?? first, pids, byPid)
        const source = launcher === 'launchd' ? 'detached' : `from ${launcher}`
        return `${commands.slice(0, MAX_SHOWN_COMMANDS).join(', ') || 'idle shells'}${more} ${source}`
      }
      if (origin.key.startsWith('app:') && members.length > 1) {
        const heaviest = members.toSorted((a, b) => b.cpuPercent - a.cpuPercent)[0]
        return heaviest && heaviest.cpuPercent >= 1 ? `app, busiest: ${heaviest.name}` : 'app'
      }
      if (origin.section === 'leftovers' && members.length > 1) {
        return `${origin.why}, with ${members.length - 1} children`
      }
      return origin.why
    })()

    return {
      id: origin.key,
      section: origin.section,
      title: origin.title,
      why,
      location: origin.location ? tildify(origin.location, home) : null,
      processes: members,
      cpuPercent: members.reduce((sum, member) => sum + member.cpuPercent, 0),
      rssKb: members.reduce((sum, member) => sum + member.rssKb, 0),
      elapsedSec: Math.max(...members.map(member => member.elapsedSec)),
      ports: [...new Set(members.flatMap(member => ports.get(member.pid) ?? []))].toSorted((a, b) => a - b),
      flags: [...flags.values()],
    }
  })
}

export const SECTION_ORDER: Section[] = ['leftovers', 'projects', 'apps', 'background', 'macos', 'other']

export const SECTION_TITLES: Record<Section, string> = {
  leftovers: 'Leftovers',
  projects: 'Your projects',
  apps: 'Apps',
  background: 'Background agents',
  macos: 'macOS',
  other: 'Other',
}

const QUIET_CPU_PERCENT = 1
const QUIET_RSS_KB = 100 * 1024
const ALWAYS_SHOWN = new Set<Section>(['leftovers', 'projects'])

export const isQuiet = (group: ProcessGroup) =>
  !ALWAYS_SHOWN.has(group.section)
  && group.flags.length === 0
  && group.cpuPercent < QUIET_CPU_PERCENT
  && group.rssKb < QUIET_RSS_KB

export type SectionView = {
  section: Section
  groups: ProcessGroup[]
  quietCount: number
}

export const arrangeSections = (
  groups: ProcessGroup[],
  compare: (a: ProcessGroup, b: ProcessGroup) => number,
  showQuiet: boolean,
): SectionView[] =>
  SECTION_ORDER
    .map((section) => {
      const inSection = groups.filter(group => group.section === section).toSorted(compare)
      const shown = showQuiet ? inSection : inSection.filter(group => !isQuiet(group))
      return { section, groups: shown, quietCount: inSection.length - shown.length }
    })
    .filter(view => view.groups.length > 0 || view.quietCount > 0)
