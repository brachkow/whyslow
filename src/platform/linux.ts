import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ProcessInfo } from '../types'
import { describeLinuxProcess, isLinuxHelperPath, isLinuxSystemPath } from './linux-descriptions'
import {
  parseAppUnit,
  parseCgroupUnit,
  parseCmdline,
  parseDesktopName,
  parseListeningSockets,
  parseMeminfo,
  parsePasswd,
  parseProcStat,
  parseProcStatus,
  socketInode,
  unitFileName,
} from './linux-parse'
import type { CgroupUnit } from './linux-parse'
import type { Platform, PlatformRules, ServiceInfo } from './types'

// USER_HZ: /proc reports times in these ticks, fixed at 100 by the kernel ABI on mainstream architectures
const CLOCK_TICKS = 100
const PID_DIRECTORY = /^\d+$/
const DELETED_SUFFIX = / \(deleted\)$/
const KTHREADD_PID = 2

const read = (file: string) => fs.readFile(file, 'utf8')
const readOrNull = (file: string) => read(file).catch(() => null)
const readLinkOrNull = (file: string) => fs.readlink(file).catch(() => null)

const listPids = async () => {
  const entries = await fs.readdir('/proc')
  return entries.filter(entry => PID_DIRECTORY.test(entry)).map(Number)
}

const readProcess = async (pid: number, uptimeSec: number, users: ReadonlyMap<number, string>): Promise<ProcessInfo | null> => {
  const [statRaw, statusRaw, cmdlineRaw, exe] = await Promise.all([
    readOrNull(`/proc/${pid}/stat`),
    readOrNull(`/proc/${pid}/status`),
    readOrNull(`/proc/${pid}/cmdline`),
    // Only readable for our own processes
    readLinkOrNull(`/proc/${pid}/exe`),
  ])
  const stat = statRaw ? parseProcStat(statRaw) : null
  const status = statusRaw ? parseProcStatus(statusRaw) : null
  if (!stat || !status) {
    return null
  }

  const kernelThread = pid === KTHREADD_PID || stat.ppid === KTHREADD_PID
  const cmdline = cmdlineRaw ? parseCmdline(cmdlineRaw) : ''
  const args = cmdline || (kernelThread ? `[${stat.comm}]` : stat.comm)
  const firstArg = cmdline.split(' ')[0] ?? ''
  const command = exe?.replace(DELETED_SUFFIX, '') ?? (firstArg.startsWith('/') ? firstArg : stat.comm)
  const elapsedSec = Math.max(0, uptimeSec - stat.starttime / CLOCK_TICKS)
  const cpuTimeSec = (stat.utime + stat.stime) / CLOCK_TICKS

  return {
    pid,
    ppid: stat.ppid,
    pgid: stat.pgrp,
    uid: status.uid,
    user: users.get(status.uid) ?? String(status.uid),
    psCpuPercent: elapsedSec > 0 ? (cpuTimeSec / elapsedSec) * 100 : 0,
    rssKb: status.rssKb,
    elapsedSec,
    cpuTimeSec,
    // Same letters ps uses: `s` for a session leader, `+` for the terminal's foreground group
    stat: `${stat.state}${stat.session === pid ? 's' : ''}${stat.ttyNr !== 0 && stat.tpgid === stat.pgrp ? '+' : ''}`,
    tty: stat.ttyNr === 0 ? '??' : String(stat.ttyNr),
    command,
    name: exe ? path.basename(command) : stat.comm,
    args,
  }
}

const readProcesses = async (): Promise<ProcessInfo[]> => {
  const [pids, uptime, passwd] = await Promise.all([listPids(), read('/proc/uptime'), readOrNull('/etc/passwd')])
  const uptimeSec = Number(uptime.split(' ')[0])
  const users = parsePasswd(passwd ?? '')
  const processes = await Promise.all(pids.map(pid => readProcess(pid, uptimeSec, users)))

  return processes.filter(process => process !== null)
}

const own = (processes: ProcessInfo[]) => {
  const myUid = process.getuid?.() ?? 0
  return processes.filter(candidate => candidate.uid === myUid)
}

const readCwds = async (processes: ProcessInfo[]) => {
  const entries = await Promise.all(own(processes).map(async candidate => [candidate.pid, await readLinkOrNull(`/proc/${candidate.pid}/cwd`)] as const))
  return new Map(entries.filter((entry): entry is readonly [number, string] => entry[1] !== null))
}

const readSocketInodes = async (pid: number) => {
  const fds = await fs.readdir(`/proc/${pid}/fd`).catch(() => [])
  const links = await Promise.all(fds.map(fd => readLinkOrNull(`/proc/${pid}/fd/${fd}`)))
  return links.flatMap(link => (link ? [socketInode(link)] : [])).filter(inode => inode !== null)
}

// Listening sockets come from /proc/net, their owners from the socket links in each process's fd table
const readListeningPorts = async (processes: ProcessInfo[]) => {
  const tables = await Promise.all(['/proc/net/tcp', '/proc/net/tcp6'].map(readOrNull))
  const portByInode = new Map(tables.flatMap(table => [...parseListeningSockets(table ?? '')]))
  if (portByInode.size === 0) {
    return new Map<number, number[]>()
  }

  const entries = await Promise.all(own(processes).map(async (candidate) => {
    const inodes = await readSocketInodes(candidate.pid)
    const ports = [...new Set(inodes.flatMap(inode => portByInode.get(inode) ?? []))].toSorted((a, b) => a - b)
    return [candidate.pid, ports] as const
  }))
  return new Map(entries.filter(([, ports]) => ports.length > 0))
}

const readMemoryUsage = async () => {
  const meminfo = await readOrNull('/proc/meminfo')
  return (meminfo ? parseMeminfo(meminfo) : null) ?? { usedBytes: null, totalBytes: os.totalmem() }
}

const configHome = () => process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')

// Unit files shipped by the distribution live under /usr or /lib; /etc and home hold the admin's and user's own
const unitDirectories = (userManager: boolean) => (userManager
  ? [{ directory: path.join(configHome(), 'systemd', 'user'), vendor: false }, { directory: '/etc/systemd/user', vendor: false }, { directory: '/usr/lib/systemd/user', vendor: true }, { directory: '/usr/share/systemd/user', vendor: true }]
  : [{ directory: '/etc/systemd/system', vendor: false }, { directory: '/run/systemd/system', vendor: false }, { directory: '/usr/lib/systemd/system', vendor: true }, { directory: '/lib/systemd/system', vendor: true }])

const findUnitFile = async (unit: CgroupUnit) => {
  for (const { directory, vendor } of unitDirectories(unit.userManager)) {
    const file = path.join(directory, unitFileName(unit.unit))
    if (await fs.access(file).then(() => true, () => false)) {
      return { file, vendor }
    }
  }
  return null
}

const DESKTOP_DIRECTORIES = [
  path.join(os.homedir(), '.local', 'share', 'applications'),
  path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
  '/var/lib/flatpak/exports/share/applications',
  '/usr/local/share/applications',
  '/usr/share/applications',
  '/var/lib/snapd/desktop/applications',
]

const findDesktopName = async (applicationId: string) => {
  for (const directory of DESKTOP_DIRECTORIES) {
    const content = await readOrNull(path.join(directory, `${applicationId}.desktop`))
    const name = content ? parseDesktopName(content) : null
    if (name) {
      return name
    }
  }
  return null
}

const DOCKER_SCOPE = /^docker-([\da-f]+)\.scope$/

type ServiceContext = {
  unit: CgroupUnit
  command: string
  unitFile: { file: string, vendor: boolean } | null
  appName: string | null
}

export const linuxService = ({ unit, command, unitFile, appName }: ServiceContext): ServiceInfo | null => {
  const applicationId = parseAppUnit(unit.unit)
  if (applicationId) {
    return { label: unit.unit, kind: 'app', system: false, why: `app ${applicationId}`, location: null, appName: appName ?? applicationId }
  }

  const container = DOCKER_SCOPE.exec(unit.unit)?.[1]
  if (container) {
    return { label: unit.unit, kind: 'daemon', system: false, why: `Docker container ${container.slice(0, 12)}`, location: null }
  }

  if (!unit.unit.endsWith('.service')) {
    return null
  }
  return {
    label: unit.unit,
    kind: unit.userManager ? 'agent' : 'daemon',
    system: unitFile ? unitFile.vendor : isLinuxSystemPath(command),
    why: `${unit.userManager ? 'systemd user service' : 'systemd service'} ${unit.unit}`,
    location: unitFile?.file ?? null,
  }
}

const readServices = async (processes: ProcessInfo[], { detailed }: { detailed: boolean }) => {
  const units = await Promise.all(processes.map(async (candidate) => {
    const cgroup = await readOrNull(`/proc/${candidate.pid}/cgroup`)
    return { candidate, unit: cgroup ? parseCgroupUnit(cgroup) : null }
  }))

  const unitFiles = new Map<string, Promise<{ file: string, vendor: boolean } | null>>()
  const appNames = new Map<string, Promise<string | null>>()
  const lookupUnitFile = (unit: CgroupUnit) => {
    const key = `${unit.userManager}:${unit.unit}`
    unitFiles.set(key, unitFiles.get(key) ?? findUnitFile(unit))
    return unitFiles.get(key)
  }
  const lookupAppName = (applicationId: string) => {
    appNames.set(applicationId, appNames.get(applicationId) ?? findDesktopName(applicationId))
    return appNames.get(applicationId)
  }

  const services = await Promise.all(units.map(async ({ candidate, unit }) => {
    if (!unit) {
      return null
    }
    const applicationId = parseAppUnit(unit.unit)
    const [unitFile, appName] = detailed
      ? await Promise.all([lookupUnitFile(unit), applicationId ? lookupAppName(applicationId) : null])
      : [null, null]
    const service = linuxService({ unit, command: candidate.command, unitFile: unitFile ?? null, appName: appName ?? null })
    return service ? [candidate.pid, service] as const : null
  }))

  return new Map(services.filter(entry => entry !== null))
}

// Besides pid 1, each user's systemd instance adopts orphans from its session as a subreaper
const adopterPids = (processes: ProcessInfo[]) =>
  new Set([1, ...processes.filter(candidate => candidate.name === 'systemd' && candidate.uid !== 0).map(candidate => candidate.pid)])

const SNAP_PATH = /^\/snap\/([^/]+)\//

export const createLinuxRules = (myUid: number): PlatformRules => ({
  adopterName: 'systemd',

  appOf: (process, service) => {
    if (service?.kind === 'app') {
      const name = service.appName ?? service.label
      return { key: `app:${name}`, name, why: null, location: null }
    }
    const snap = SNAP_PATH.exec(process.command)?.[1]
    return snap ? { key: `app:${snap}`, name: snap, why: 'Snap app', location: `/snap/${snap}` } : null
  },

  systemGroupOf: (process, service) => {
    if (process.pid === KTHREADD_PID || process.ppid === KTHREADD_PID) {
      return { key: 'system:kernel', title: 'kernel threads', why: 'Linux kernel workers' }
    }

    const description = describeLinuxProcess(process.name)
    const systemBinary = isLinuxSystemPath(process.command) && (process.uid !== myUid || isLinuxHelperPath(process.command))
    const isSystem = service?.system === true || systemBinary || (description !== null && process.uid !== myUid)
    if (!isSystem) {
      return null
    }

    const why = description ?? (service ? service.why : `system component from ${path.dirname(process.command)}`)
    return { key: `system:${process.name}`, title: process.name, why }
  },
})

export const linux: Platform = {
  rules: createLinuxRules(process.getuid?.() ?? 0),
  readProcesses,
  readServices,
  adopterPids,
  readCwds,
  readListeningPorts,
  readMemoryUsage,
}
