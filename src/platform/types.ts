import type { ProcessInfo } from '../types'

// What the OS service manager (launchd, systemd) knows about a process
export type ServiceInfo = {
  label: string
  // app: a desktop app launch (systemd app-*.scope, launchd application.*)
  kind: 'agent' | 'daemon' | 'app'
  // Shipped with the OS rather than installed by the user
  system: boolean
  why: string
  location: string | null
  // Display name of a desktop app, from its .desktop file
  appName?: string
}

export type AppInfo = {
  key: string
  name: string
  why: string | null
  location: string | null
}

export type SystemGroup = {
  key: string
  title: string
  why: string
}

// Pure classification rules, so origins can be computed and tested without the OS
export type PlatformRules = {
  adopterName: string
  appOf: (process: ProcessInfo, service: ServiceInfo | undefined) => AppInfo | null
  systemGroupOf: (process: ProcessInfo, service: ServiceInfo | undefined) => SystemGroup | null
}

export type MemoryUsage = {
  usedBytes: number | null
  totalBytes: number
}

export type DaemonControl = {
  install: () => Promise<void>
  uninstall: () => Promise<void>
  pid: () => Promise<number | null>
  isInstalled: () => Promise<boolean>
  logHint: string
}

export type Platform = {
  rules: PlatformRules
  readProcesses: () => Promise<ProcessInfo[]>
  // `detailed` also resolves definitions (plists, unit files), which is slower
  readServices: (processes: ProcessInfo[], options: { detailed: boolean }) => Promise<Map<number, ServiceInfo>>
  // Processes that adopt orphans: pid 1, and per-user service managers on Linux
  adopterPids: (processes: ProcessInfo[]) => Set<number>
  readCwds: (processes: ProcessInfo[]) => Promise<Map<number, string>>
  readListeningPorts: (processes: ProcessInfo[]) => Promise<Map<number, number[]>>
  readMemoryUsage: () => Promise<MemoryUsage>
  notify: (title: string, message: string) => Promise<void>
  daemon: DaemonControl
}
