// Parsers for /proc files and systemd unit names, kept pure so they are testable on any OS

export type ProcStat = {
  comm: string
  state: string
  ppid: number
  pgrp: number
  session: number
  ttyNr: number
  tpgid: number
  // In clock ticks
  utime: number
  stime: number
  starttime: number
}

// Fields after the command name, which is wrapped in parentheses and may itself contain spaces or parentheses
const STAT_INDEX = { state: 0, ppid: 1, pgrp: 2, session: 3, ttyNr: 4, tpgid: 5, utime: 11, stime: 12, starttime: 19 }

export const parseProcStat = (content: string): ProcStat | null => {
  const open = content.indexOf('(')
  const close = content.lastIndexOf(')')
  if (open === -1 || close < open) {
    return null
  }

  const fields = content.slice(close + 2).trim().split(' ')
  const field = (index: number) => Number(fields[index])
  if (fields.length <= STAT_INDEX.starttime) {
    return null
  }

  return {
    comm: content.slice(open + 1, close),
    state: fields[STAT_INDEX.state] ?? '?',
    ppid: field(STAT_INDEX.ppid),
    pgrp: field(STAT_INDEX.pgrp),
    session: field(STAT_INDEX.session),
    ttyNr: field(STAT_INDEX.ttyNr),
    tpgid: field(STAT_INDEX.tpgid),
    utime: field(STAT_INDEX.utime),
    stime: field(STAT_INDEX.stime),
    starttime: field(STAT_INDEX.starttime),
  }
}

const STATUS_LINE = /^(\w+):\s+(.*)$/
const WHITESPACE = /\s+/

const parseKeyValues = (content: string) =>
  new Map(content.split('\n').flatMap((line) => {
    const match = STATUS_LINE.exec(line)
    return match?.[1] && match[2] !== undefined ? [[match[1], match[2]] as const] : []
  }))

export const parseProcStatus = (content: string): { uid: number, rssKb: number } | null => {
  const values = parseKeyValues(content)
  const uid = Number(values.get('Uid')?.split(WHITESPACE)[0])
  if (!Number.isInteger(uid)) {
    return null
  }
  // Kernel threads have no VmRSS line
  return { uid, rssKb: Number.parseInt(values.get('VmRSS') ?? '0', 10) }
}

// Arguments are NUL-separated, with a trailing NUL
export const parseCmdline = (content: string) =>
  content.split('\0').filter(Boolean).join(' ')

export const parsePasswd = (content: string): Map<number, string> =>
  new Map(content.split('\n').flatMap((line) => {
    const [name, , uid] = line.split(':')
    return name && uid && !line.startsWith('#') ? [[Number(uid), name] as const] : []
  }))

// Same idea as `free`: memory that can't be handed to new work without swapping
export const parseMeminfo = (content: string): { usedBytes: number, totalBytes: number } | null => {
  const values = parseKeyValues(content)
  const totalKb = Number.parseInt(values.get('MemTotal') ?? '', 10)
  const availableKb = Number.parseInt(values.get('MemAvailable') ?? '', 10)
  if (Number.isNaN(totalKb) || Number.isNaN(availableKb)) {
    return null
  }
  return { usedBytes: (totalKb - availableKb) * 1024, totalBytes: totalKb * 1024 }
}

const TCP_LISTEN = '0A'

// /proc/net/tcp and tcp6 rows: local address as HEX_IP:HEX_PORT, state in hex, socket inode
export const parseListeningSockets = (content: string): Map<number, number> =>
  new Map(content.split('\n').slice(1).flatMap((line) => {
    const columns = line.trim().split(WHITESPACE)
    const [, local, , state] = columns
    const inode = Number(columns[9])
    const port = Number.parseInt(local?.split(':').at(-1) ?? '', 16)
    return state === TCP_LISTEN && inode > 0 && port > 0 ? [[inode, port] as const] : []
  }))

const SOCKET_LINK = /^socket:\[(\d+)]$/

export const socketInode = (link: string): number | null => {
  const inode = SOCKET_LINK.exec(link)?.[1]
  return inode ? Number(inode) : null
}

export type CgroupUnit = {
  unit: string
  // Inside a user's service manager (user@UID.service) rather than the system one
  userManager: boolean
}

const UNIT_SUFFIX = /\.(?:service|scope)$/

// cgroup v2 has a single `0::/path` line; on v1 the systemd hierarchy is `N:name=systemd:/path`
export const parseCgroupUnit = (content: string): CgroupUnit | null => {
  const lines = content.split('\n')
  const cgroupPath = (lines.find(line => line.startsWith('0::')) ?? lines.find(line => line.includes(':name=systemd:')))
    ?.split(':')
    .slice(2)
    .join(':')
  const segments = cgroupPath?.split('/').filter(Boolean) ?? []
  const unit = segments.findLast(segment => UNIT_SUFFIX.test(segment))
  if (!unit) {
    return null
  }

  const managerIndex = segments.findIndex(segment => segment.startsWith('user@') && segment.endsWith('.service'))
  return { unit, userManager: managerIndex !== -1 && unit !== segments[managerIndex] }
}

const unescapeUnit = (value: string) => value.replaceAll(/\\x([\da-f]{2})/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))

const SCOPE_RANDOM = /-[^-]+\.scope$/
const SERVICE_INSTANCE = /(?:@[^.]*)?\.service$/

// systemd XDG naming: app[-<launcher>]-<ApplicationID>[@<RANDOM>].service or app[-<launcher>]-<ApplicationID>-<RANDOM>.scope,
// with `-` inside the ID escaped as \x2d, so an unescaped `-` left over separates the launcher. Returns the ApplicationID
export const parseAppUnit = (unit: string): string | null => {
  if (!unit.startsWith('app-')) {
    return null
  }

  const body = unit.slice('app-'.length).replace(unit.endsWith('.scope') ? SCOPE_RANDOM : SERVICE_INSTANCE, '')
  const parts = body.split('-')
  // D-Bus activated apps carry the bus name after the launcher: app-dbus-:1.2-org.example.App
  const id = parts.slice(1).find(part => !part.startsWith(':')) ?? parts[0] ?? ''
  const applicationId = unescapeUnit(parts.length > 1 ? parts.slice(parts.indexOf(id)).join('-') : id)

  return applicationId || null
}

const DESKTOP_NAME = /^Name=(.+)$/m
const OTHER_DESKTOP_GROUP = /^\[(?!Desktop Entry])/m
const TEMPLATE_INSTANCE = /@[^.]*\./

// The untranslated Name= of the [Desktop Entry] group, which comes first in .desktop files
export const parseDesktopName = (content: string): string | null => {
  const entry = content.split(OTHER_DESKTOP_GROUP)[0] ?? ''
  return DESKTOP_NAME.exec(entry)?.[1]?.trim() ?? null
}

// Template instances like getty@tty1.service are defined in getty@.service
export const unitFileName = (unit: string) => unit.replace(TEMPLATE_INSTANCE, '@.')
