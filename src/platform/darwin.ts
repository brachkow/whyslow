import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { exec, execOrThrow } from '../exec'
import type { ProcessInfo } from '../types'
import { describeMacosProcess, isMacosPath } from './darwin-descriptions'
import { parseLaunchctlList, parseLsofCwd, parseLsofPorts, parsePsOutput, parseVmStatUsedBytes, STAT_FIELDS } from './darwin-parse'
import type { AppInfo, Platform, PlatformRules, ServiceInfo } from './types'

// C locale keeps `%cpu` decimal separator a dot
const env = { ...process.env, LC_ALL: 'C' }

const statFormat = [...STAT_FIELDS, 'comm'].map(field => `${field}=`).join(',')

const readProcesses = async (): Promise<ProcessInfo[]> => {
  const [stat, args] = await Promise.all([
    execOrThrow('ps', ['-axo', statFormat], env),
    execOrThrow('ps', ['-axo', 'pid=,args='], env),
  ])

  return parsePsOutput(stat, args)
}

const readMemoryUsage = async () => {
  const { stdout } = await exec('vm_stat', [], env)
  return { usedBytes: parseVmStatUsedBytes(stdout), totalBytes: os.totalmem() }
}

// Other users' processes are not readable without root, so only ask for ours
const readCwds = async (): Promise<Map<number, string>> => {
  const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-u', String(process.getuid?.() ?? 0), '-Fpn'], env)
  return parseLsofCwd(stdout)
}

const readListeningPorts = async (): Promise<Map<number, number[]>> => {
  const { stdout } = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], env)
  return parseLsofPorts(stdout)
}

export type LaunchdPlist = {
  label: string
  program: string | null
  path: string
  kind: 'agent' | 'daemon'
  runAtLoad: boolean
}

const PLIST_DIRS: Array<{ dir: string, kind: LaunchdPlist['kind'] }> = [
  { dir: path.join(os.homedir(), 'Library', 'LaunchAgents'), kind: 'agent' },
  { dir: '/Library/LaunchAgents', kind: 'agent' },
  { dir: '/Library/LaunchDaemons', kind: 'daemon' },
]

type PlistJson = {
  Label?: string
  Program?: string
  ProgramArguments?: string[]
  RunAtLoad?: boolean
}

const readPlist = async (file: string, kind: LaunchdPlist['kind']): Promise<LaunchdPlist | null> => {
  const { stdout, exitCode } = await exec('plutil', ['-convert', 'json', '-o', '-', file])
  if (exitCode !== 0) {
    return null
  }

  const json = JSON.parse(stdout) as PlistJson
  if (!json.Label) {
    return null
  }

  return {
    label: json.Label,
    program: json.Program ?? json.ProgramArguments?.[0] ?? null,
    path: file,
    kind,
    runAtLoad: json.RunAtLoad === true,
  }
}

const readLaunchdPlists = async (): Promise<LaunchdPlist[]> => {
  const perDirectory = await Promise.all(PLIST_DIRS.map(async ({ dir, kind }) => {
    const names = await fs.readdir(dir).catch(() => [])
    return Promise.all(names.filter(name => name.endsWith('.plist')).map(name => readPlist(path.join(dir, name), kind)))
  }))

  return perDirectory.flat().filter(plist => plist !== null)
}

const describePlist = (plist: LaunchdPlist) =>
  `${plist.kind === 'agent' ? 'LaunchAgent' : 'LaunchDaemon'} ${plist.label}${plist.runAtLoad ? ', starts at boot/login' : ''}`

const plistService = (plist: LaunchdPlist): ServiceInfo => ({
  label: plist.label,
  kind: plist.kind,
  system: plist.label.startsWith('com.apple.'),
  why: describePlist(plist),
  location: plist.path,
})

const labelService = (label: string): ServiceInfo => ({
  label,
  kind: label.startsWith('application.') ? 'app' : 'agent',
  system: label.startsWith('com.apple.'),
  why: label.startsWith('com.apple.') ? `macOS service ${label}` : `launchd job ${label}`,
  location: null,
})

// The user's launchd domain lists its own jobs; system daemons are matched to their plists by program path
export const buildDarwinServices = (processes: ProcessInfo[], jobs: ReadonlyMap<number, string>, plists: LaunchdPlist[]) => {
  const plistByLabel = new Map(plists.map(plist => [plist.label, plist]))
  const plistByProgram = new Map(plists.filter(plist => plist.program).map(plist => [plist.program, plist]))

  return new Map(processes.flatMap((process): Array<[number, ServiceInfo]> => {
    const label = jobs.get(process.pid)
    const plist = (label ? plistByLabel.get(label) : undefined) ?? plistByProgram.get(process.command)
    if (plist) {
      return [[process.pid, plistService(plist)]]
    }
    return label ? [[process.pid, labelService(label)]] : []
  }))
}

const readServices = async (processes: ProcessInfo[], { detailed }: { detailed: boolean }) => {
  const [{ stdout }, plists] = await Promise.all([exec('launchctl', ['list']), detailed ? readLaunchdPlists() : []])
  return buildDarwinServices(processes, parseLaunchctlList(stdout), plists)
}

const APP_REGEX = /\/Applications\/(?:[^/]*\/)*?([^/]+)\.app(?:\/|$)/
const BUNDLE_REGEX = /\/([^/]+)\.(framework|dext|bundle|xpc)\//

const isSimulator = (process: ProcessInfo) =>
  process.name === 'launchd_sim' || process.command.includes('.simruntime/') || process.command.includes('/CoreSimulator/')

const SIMULATOR: AppInfo = { key: 'app:iOS Simulator', name: 'iOS Simulator', why: 'simulated devices booted from Xcode', location: null }

export const darwinRules: PlatformRules = {
  adopterName: 'launchd',

  appOf: (process) => {
    if (isSimulator(process)) {
      return SIMULATOR
    }
    const name = APP_REGEX.exec(process.command)?.[1]
    return name ? { key: `app:${name}`, name, why: null, location: process.command.slice(0, process.command.indexOf('.app') + 4) } : null
  },

  systemGroupOf: (process, service) => {
    if (!isMacosPath(process.command)) {
      return null
    }
    const bundle = BUNDLE_REGEX.exec(process.command)
    const fallback = bundle ? `part of ${bundle[1]} ${bundle[2]}` : `macOS component from ${path.dirname(process.command)}`
    const why = describeMacosProcess(process.name) ?? (service ? `macOS service ${service.label}` : fallback)
    return { key: `system:${process.name}`, title: process.name, why }
  },
}

export const darwin: Platform = {
  rules: darwinRules,
  readProcesses,
  readServices,
  adopterPids: () => new Set([1]),
  readCwds,
  readListeningPorts,
  readMemoryUsage,
}
