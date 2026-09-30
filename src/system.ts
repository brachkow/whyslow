import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { exec, execOrThrow } from './exec'
import { parseLaunchctlList, parseLsofCwd, parseLsofPorts, parsePsOutput, parseVmStatUsedBytes, STAT_FIELDS } from './parse'
import type { LaunchdPlist, ProcessInfo } from './types'

// C locale keeps `%cpu` decimal separator a dot
const env = { ...process.env, LC_ALL: 'C' }

const statFormat = [...STAT_FIELDS, 'comm'].map(field => `${field}=`).join(',')

export const readProcesses = async (): Promise<ProcessInfo[]> => {
  const [stat, args] = await Promise.all([
    execOrThrow('ps', ['-axo', statFormat], env),
    execOrThrow('ps', ['-axo', 'pid=,args='], env),
  ])

  return parsePsOutput(stat, args)
}

export const readMemoryUsage = async () => {
  const { stdout } = await exec('vm_stat', [], env)
  return { usedBytes: parseVmStatUsedBytes(stdout), totalBytes: os.totalmem() }
}

export const readLaunchdJobs = async (): Promise<Map<number, string>> => {
  const { stdout } = await exec('launchctl', ['list'])
  return parseLaunchctlList(stdout)
}

// Other users' processes are not readable without root, so only ask for ours
export const readCwds = async (): Promise<Map<number, string>> => {
  const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-u', String(process.getuid?.() ?? 0), '-Fpn'], env)
  return parseLsofCwd(stdout)
}

export const readListeningPorts = async (): Promise<Map<number, number[]>> => {
  const { stdout } = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], env)
  return parseLsofPorts(stdout)
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

export const readLaunchdPlists = async (): Promise<LaunchdPlist[]> => {
  const perDirectory = await Promise.all(PLIST_DIRS.map(async ({ dir, kind }) => {
    const names = await fs.readdir(dir).catch(() => [])
    return Promise.all(names.filter(name => name.endsWith('.plist')).map(name => readPlist(path.join(dir, name), kind)))
  }))

  return perDirectory.flat().filter(plist => plist !== null)
}

const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'deno.json']

const exists = (file: string) => fs.access(file).then(() => true, () => false)

const hasMarker = async (directory: string, markers: string[]) => {
  const found = await Promise.all(markers.map(marker => exists(path.join(directory, marker))))
  return found.some(Boolean)
}

const findUp = async (start: string, markers: string[]): Promise<string | null> => {
  const home = os.homedir()
  // Home itself is never a project, even when it is a dotfiles repo
  for (let directory = start; directory !== home && directory !== path.dirname(directory); directory = path.dirname(directory)) {
    if (await hasMarker(directory, markers)) {
      return directory
    }
  }
  return null
}

// Repository root wins over nested package manifests, so a monorepo stays one project
const findProjectRoot = async (cwd: string) =>
  (await findUp(cwd, ['.git'])) ?? findUp(cwd, PROJECT_MARKERS)

export const readProjectRoots = async (cwds: Iterable<string>): Promise<Map<string, string>> => {
  const unique = [...new Set(cwds)]
  const roots = await Promise.all(unique.map(findProjectRoot))

  return new Map(unique.flatMap((cwd, index) => {
    const root = roots[index]
    return root ? [[cwd, root] as const] : []
  }))
}
