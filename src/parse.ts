import path from 'node:path'

import type { ProcessInfo } from './types'

// Handles ps `etime` ([[dd-]hh:]mm:ss) and `time` (mmm:ss.cc or [dd-]hh:mm:ss.cc)
export const parseDuration = (value: string): number => {
  const [daysPart, clockPart] = value.includes('-') ? value.split('-') : ['0', value]
  const clock = (clockPart ?? '').split(':').map(Number).toReversed()
  const [seconds = 0, minutes = 0, hours = 0] = clock

  return Number(daysPart) * 86_400 + hours * 3600 + minutes * 60 + seconds
}

const FIELD_REGEX = /^(\S+)\s*/

export const STAT_FIELDS = ['pid', 'ppid', 'pgid', 'uid', 'user', '%cpu', 'rss', 'etime', 'time', 'stat', 'tty'] as const

const splitFields = (line: string, count: number): [string[], string] => {
  const fields: string[] = []
  let rest = line.trimStart()

  while (fields.length < count) {
    const match = FIELD_REGEX.exec(rest)
    if (!match?.[1]) {
      break
    }
    fields.push(match[1])
    rest = rest.slice(match[0].length)
  }

  return [fields, rest.trimEnd()]
}

export const parseArgsOutput = (output: string): Map<number, string> => {
  const result = new Map<number, string>()

  for (const line of output.split('\n')) {
    const [[pid], args] = splitFields(line, 1)
    if (pid) {
      result.set(Number(pid), args)
    }
  }

  return result
}

export const parsePsOutput = (statOutput: string, argsOutput: string): ProcessInfo[] => {
  const argsByPid = parseArgsOutput(argsOutput)
  const processes: ProcessInfo[] = []

  for (const line of statOutput.split('\n')) {
    const [fields, command] = splitFields(line, STAT_FIELDS.length)
    if (fields.length < STAT_FIELDS.length || !command) {
      continue
    }

    const [pid, ppid, pgid, uid, user, cpu, rss, etime, time, stat, tty] = fields as [
      string, string, string, string, string, string, string, string, string, string, string,
    ]

    processes.push({
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      uid: Number(uid),
      user,
      psCpuPercent: Number(cpu),
      rssKb: Number(rss),
      elapsedSec: parseDuration(etime),
      cpuTimeSec: parseDuration(time),
      stat,
      tty,
      command,
      name: path.basename(command),
      args: argsByPid.get(Number(pid)) ?? command,
    })
  }

  return processes
}

export const parseLaunchctlList = (output: string): Map<number, string> => {
  const jobs = new Map<number, string>()

  for (const line of output.split('\n').slice(1)) {
    const [pidField, , label] = line.split('\t')
    const pid = Number(pidField)
    if (Number.isInteger(pid) && pid > 0 && label) {
      jobs.set(pid, label)
    }
  }

  return jobs
}

// lsof -F output: `p<pid>` starts a process, `n<name>` lines belong to it
const parseLsofNames = (output: string): Map<number, string[]> => {
  const result = new Map<number, string[]>()
  let pid = 0

  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1))
    }
    if (line.startsWith('n') && pid > 0) {
      result.set(pid, [...(result.get(pid) ?? []), line.slice(1)])
    }
  }

  return result
}

export const parseLsofCwd = (output: string): Map<number, string> =>
  new Map([...parseLsofNames(output)].flatMap(([pid, [cwd]]) => (cwd ? [[pid, cwd] as const] : [])))

export const parseLsofPorts = (output: string): Map<number, number[]> =>
  new Map(Array.from(parseLsofNames(output), ([pid, names]) => {
    const ports = names.map(name => Number(name.slice(name.lastIndexOf(':') + 1))).filter(Number.isInteger)
    return [pid, [...new Set(ports)].toSorted((a, b) => a - b)]
  }))

const VM_PAGE_SIZE = /page size of (\d+) bytes/
const VM_STAT_LINE = /^"?([^":]+)"?:\s+(\d+)\.?$/

// Same definition as Activity Monitor's Memory Used: app memory (anonymous minus purgeable) + wired + compressed
export const parseVmStatUsedBytes = (output: string): number | null => {
  const pageSize = Number(VM_PAGE_SIZE.exec(output)?.[1])
  const pages = new Map(output.split('\n').flatMap((line) => {
    const match = VM_STAT_LINE.exec(line.trim())
    return match?.[1] && match[2] ? [[match[1], Number(match[2])] as const] : []
  }))
  const anonymous = pages.get('Anonymous pages')
  const purgeable = pages.get('Pages purgeable')
  const wired = pages.get('Pages wired down')
  const compressed = pages.get('Pages occupied by compressor')

  if (!pageSize || anonymous === undefined || purgeable === undefined || wired === undefined || compressed === undefined) {
    return null
  }
  return (anonymous - purgeable + wired + compressed) * pageSize
}
