import { describe, expect, it } from 'vitest'

import { byCpu } from './analyze'
import { appOf, arrangeSections, buildGroups, shortCommand } from './origin'
import type { OriginInput } from './origin'
import { makeAnalyzed, MY_UID } from './test-factories'
import type { AnalyzedProcess, LaunchdPlist, ProcessGroup } from './types'

const HOME = '/Users/me'

const launchd = makeAnalyzed({ pid: 1, ppid: 0, uid: 0, command: '/sbin/launchd', name: 'launchd', stat: 'Ss' })

const makeInput = (processes: AnalyzedProcess[], overrides: Partial<OriginInput> = {}): OriginInput => ({
  processes: [launchd, ...processes],
  myUid: MY_UID,
  home: HOME,
  launchdJobs: new Map(),
  plists: [],
  cwds: new Map(),
  projectRoots: new Map(),
  ports: new Map(),
  ...overrides,
})

const groupOf = (groups: ProcessGroup[], pid: number) =>
  groups.find(group => group.processes.some(process => process.pid === pid))

const getGroup = (processes: AnalyzedProcess[], pid: number, overrides?: Partial<OriginInput>) =>
  groupOf(buildGroups(makeInput(processes, overrides)), pid)

const makeGroup = (overrides: Partial<ProcessGroup>): ProcessGroup => ({
  id: 'id',
  section: 'macos',
  title: 'title',
  why: '',
  location: null,
  processes: [],
  cpuPercent: 0,
  rssKb: 0,
  elapsedSec: 0,
  ports: [],
  flags: [],
  ...overrides,
})

describe('appOf', () => {
  it.each([
    ['/Applications/Firefox.app/Contents/MacOS/firefox', 'Firefox'],
    ['/Applications/Google Chrome.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper', 'Google Chrome'],
    ['/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal', 'Terminal'],
    ['/System/Applications/Mail.app/Contents/MacOS/Mail', 'Mail'],
  ])('finds the outermost app in %s', (command, expected) => {
    expect(appOf(command)).toBe(expected)
  })

  it('ignores bundles outside Applications folders', () => {
    expect(appOf('/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock')).toBeNull()
  })
})

describe('shortCommand', () => {
  it('drops the directory of an executable path with spaces', () => {
    const process = makeAnalyzed({ command: '/Library/Application Support/Tool/node', name: 'node', args: '/Library/Application Support/Tool/node plugin.js' })

    expect(shortCommand(process)).toBe('node plugin.js')
  })

  it('shortens paths inside flags', () => {
    const process = makeAnalyzed({ command: 'node', name: 'node', args: 'node --env-file=/Users/me/app/.env run.mts' })

    expect(shortCommand(process)).toBe('node --env-file=.env run.mts')
  })

  it('truncates long commands', () => {
    const process = makeAnalyzed({ command: 'grep', name: 'grep', args: `grep ${'x'.repeat(100)}` })

    expect(shortCommand(process)).toHaveLength(40)
  })
})

describe('apps', () => {
  it('puts all helpers of an app into one group', () => {
    const main = makeAnalyzed({ pid: 10, ppid: 1, command: '/Applications/Firefox.app/Contents/MacOS/firefox' })
    const helper = makeAnalyzed({ pid: 11, ppid: 10, command: '/Applications/Firefox.app/Contents/MacOS/plugin-container.app/Contents/MacOS/plugin-container' })
    const groups = buildGroups(makeInput([main, helper]))

    expect(groupOf(groups, 11)).toBe(groupOf(groups, 10))
  })

  it('reports how long the oldest process has been running', () => {
    const main = makeAnalyzed({ pid: 10, ppid: 1, command: '/Applications/Firefox.app/Contents/MacOS/firefox', elapsedSec: 7200 })
    const helper = makeAnalyzed({ pid: 11, ppid: 10, command: '/Applications/Firefox.app/Contents/MacOS/helper', elapsedSec: 60 })

    expect(getGroup([main, helper], 10)?.elapsedSec).toBe(7200)
  })

  it('names the busiest helper', () => {
    const main = makeAnalyzed({ pid: 10, ppid: 1, command: '/Applications/Firefox.app/Contents/MacOS/firefox', cpuPercent: 2 })
    const helper = makeAnalyzed({ pid: 11, ppid: 10, name: 'plugin-container', command: '/Applications/Firefox.app/Contents/MacOS/plugin-container', cpuPercent: 40 })

    expect(getGroup([main, helper], 10)?.why).toBe('app, busiest: plugin-container')
  })

  it('adopts children started by an app from outside its bundle', () => {
    const app = makeAnalyzed({ pid: 10, ppid: 1, command: '/Applications/Ghostty.app/Contents/MacOS/ghostty' })
    const shell = makeAnalyzed({ pid: 11, ppid: 10, name: 'fish', command: '/opt/homebrew/bin/fish' })

    expect(getGroup([app, shell], 11)?.id).toBe('app:Ghostty')
  })

  it('groups iOS Simulator processes together', () => {
    const sim = makeAnalyzed({ pid: 10, ppid: 1, name: 'launchd_sim', command: 'launchd_sim' })
    const springboard = makeAnalyzed({ pid: 11, ppid: 10, command: '/Library/Developer/CoreSimulator/Volumes/iOS/RuntimeRoot/Applications/MobileSafari.app/MobileSafari' })

    expect(getGroup([sim, springboard], 11)?.id).toBe('simulator')
  })
})

describe('projects', () => {
  const terminal = makeAnalyzed({ pid: 10, ppid: 1, command: '/Applications/Ghostty.app/Contents/MacOS/ghostty' })
  const shell = makeAnalyzed({ pid: 11, ppid: 10, name: '-fish', command: '-fish', args: '-fish' })
  const pnpm = makeAnalyzed({ pid: 12, ppid: 11, name: 'pnpm', command: 'pnpm', args: 'pnpm dev' })
  const vite = makeAnalyzed({ pid: 13, ppid: 12, name: 'node', command: 'node', args: 'node /Users/me/Projects/site/node_modules/.bin/vite' })
  const cwd = `${HOME}/Projects/site/packages/web`
  const context = {
    cwds: new Map([[11, cwd], [12, cwd], [13, cwd]]),
    projectRoots: new Map([[cwd, `${HOME}/Projects/site`]]),
    ports: new Map([[13, [5173]]]),
  }

  const getProject = () => getGroup([terminal, shell, pnpm, vite], 13, context)

  it('groups processes by the repository they run in', () => {
    expect(getProject()?.processes.map(process => process.pid)).toEqual([11, 12, 13])
  })

  it('names the project after its root folder', () => {
    expect(getProject()?.title).toBe('site')
  })

  it('explains which command runs and which app started it', () => {
    expect(getProject()?.why).toBe('`pnpm dev` from Ghostty')
  })

  it('collects listening ports', () => {
    expect(getProject()?.ports).toEqual([5173])
  })

  it('says a project has only idle shells', () => {
    expect(getGroup([terminal, shell], 11, context)?.why).toBe('idle shells from Ghostty')
  })

  it('marks project processes whose launcher is gone as detached', () => {
    const server = makeAnalyzed({ pid: 20, ppid: 1, stat: 'Ss', name: 'server', command: 'server', args: 'server' })

    expect(getGroup([server], 20, { ...context, cwds: new Map([[20, cwd]]) })?.why).toBe('`server` detached')
  })

  it('ignores projects for processes of other users', () => {
    const rootProcess = makeAnalyzed({ pid: 20, ppid: 1, uid: 0, command: '/opt/tool' })

    expect(getGroup([rootProcess], 20, { ...context, cwds: new Map([[20, cwd]]) })?.section).not.toBe('projects')
  })
})

describe('leftovers', () => {
  const orphan = makeAnalyzed({ pid: 20, ppid: 1, name: 'node', command: 'node', args: 'node watch.js', flags: [{ kind: 'orphan', reason: 'parent exited' }] })
  const child = makeAnalyzed({ pid: 21, ppid: 20, name: 'esbuild', command: '/Applications/Tool.app/esbuild' })

  it('keeps the whole leftover tree together, even app binaries', () => {
    expect(getGroup([orphan, child], 21)?.id).toBe('leftover:20')
  })

  it('describes what the leftover was and where it ran', () => {
    const cwd = `${HOME}/Projects/site`
    const context = { cwds: new Map([[20, cwd]]), projectRoots: new Map([[cwd, cwd]]) }

    expect(getGroup([orphan], 20, context)?.why).toBe('`node watch.js` in project site')
  })

  it('counts children', () => {
    expect(getGroup([orphan, child], 20)?.why).toBe('`node watch.js`, with 1 children')
  })
})

describe('background', () => {
  const plist: LaunchdPlist = { label: 'com.vendor.sync', program: '/opt/vendor/syncd', path: '/Library/LaunchDaemons/com.vendor.sync.plist', kind: 'daemon', runAtLoad: true }

  it('explains root helpers by their LaunchDaemon plist', () => {
    const daemon = makeAnalyzed({ pid: 30, ppid: 1, uid: 0, command: '/opt/vendor/syncd', name: 'syncd' })

    expect(getGroup([daemon], 30, { plists: [plist] })?.why).toBe('LaunchDaemon com.vendor.sync, starts at boot/login')
  })

  it('names third-party launchd jobs without a plist', () => {
    const agent = makeAnalyzed({ pid: 30, ppid: 1, stat: 'Ss', command: '/opt/tool/agent' })

    expect(getGroup([agent], 30, { launchdJobs: new Map([[30, 'dev.tool.agent']]) })?.why).toBe('launchd job dev.tool.agent')
  })

  it('recognizes processes that daemonized themselves', () => {
    const daemon = makeAnalyzed({ pid: 30, ppid: 1, stat: 'Ss', command: '/opt/tool/muxd' })

    expect(getGroup([daemon], 30, { cwds: new Map([[30, HOME]]) })?.why).toBe('detached from its terminal, started in ~')
  })

  it('labels other root processes as system-wide helpers', () => {
    const helper = makeAnalyzed({ pid: 30, ppid: 1, uid: 0, user: 'root', command: '/Library/PrivilegedHelperTools/helper' })

    expect(getGroup([helper], 30)?.why).toBe('system-wide helper, runs as root')
  })
})

describe('macOS', () => {
  it('uses the built-in description', () => {
    const spotlight = makeAnalyzed({ pid: 40, ppid: 1, uid: 0, name: 'mds_stores', command: '/System/Library/Frameworks/CoreServices.framework/mds_stores' })

    expect(getGroup([spotlight], 40)?.why).toBe('Spotlight is indexing files')
  })

  it('falls back to the launchd label', () => {
    const service = makeAnalyzed({ pid: 40, ppid: 1, name: 'biomed', command: '/usr/libexec/biomed' })

    expect(getGroup([service], 40, { launchdJobs: new Map([[40, 'com.apple.biomed']]) })?.why).toBe('macOS service com.apple.biomed')
  })

  it('falls back to the framework the binary belongs to', () => {
    const service = makeAnalyzed({ pid: 40, ppid: 1, uid: 0, name: 'adid', command: '/System/Library/PrivateFrameworks/CoreADI.framework/adid' })

    expect(getGroup([service], 40)?.why).toBe('part of CoreADI framework')
  })

  it('merges same-named system processes', () => {
    const workers = [41, 42, 43].map(pid => makeAnalyzed({ pid, ppid: 1, uid: 0, name: 'mdworker_shared', command: '/System/Library/mdworker_shared' }))

    expect(getGroup(workers, 41)?.processes).toHaveLength(3)
  })
})

describe('other', () => {
  it('explains a process by its parent', () => {
    const parent = makeAnalyzed({ pid: 50, ppid: 1, name: 'toolhost', command: '/opt/toolhost' })
    const child = makeAnalyzed({ pid: 51, ppid: 50, name: 'worker', command: '/opt/worker' })

    expect(getGroup([parent, child], 51)?.why).toBe('started by toolhost')
  })

  it('keeps children of background helpers in the helper group', () => {
    const helper = makeAnalyzed({ pid: 50, ppid: 1, uid: 0, user: 'root', command: '/opt/helper' })
    const child = makeAnalyzed({ pid: 51, ppid: 50, command: '/opt/worker' })

    expect(getGroup([helper, child], 51)?.id).toBe(getGroup([helper, child], 50)?.id)
  })
})

describe('arrangeSections', () => {
  it('orders sections from leftovers to other', () => {
    const groups = [makeGroup({ section: 'other', cpuPercent: 5 }), makeGroup({ section: 'leftovers' }), makeGroup({ section: 'apps', cpuPercent: 5 })]

    expect(arrangeSections(groups, byCpu, false).map(view => view.section)).toEqual(['leftovers', 'apps', 'other'])
  })

  it('hides quiet groups and counts them', () => {
    const groups = [makeGroup({ id: 'busy', cpuPercent: 30 }), makeGroup({ id: 'idle', cpuPercent: 0.1, rssKb: 1000 })]
    const [macos] = arrangeSections(groups, byCpu, false)

    expect(macos).toMatchObject({ groups: [{ id: 'busy' }], quietCount: 1 })
  })

  it('keeps quiet projects visible', () => {
    const [projects] = arrangeSections([makeGroup({ section: 'projects' })], byCpu, false)

    expect(projects?.groups).toHaveLength(1)
  })

  it('shows quiet groups on request', () => {
    const [macos] = arrangeSections([makeGroup({ cpuPercent: 0 })], byCpu, true)

    expect(macos?.quietCount).toBe(0)
  })
})
