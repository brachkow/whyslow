import { describe, expect, it } from 'vitest'

import { buildGroups } from '../origin'
import { makeAnalyzed, MY_UID } from '../test-factories'
import type { AnalyzedProcess } from '../types'
import { createLinuxRules, linuxService } from './linux'
import type { ServiceInfo } from './types'

const rules = createLinuxRules(MY_UID)

const serviceOf = (unit: string, { userManager = false, command = '/usr/bin/tool', unitFile = null as { file: string, vendor: boolean } | null, appName = null as string | null } = {}) =>
  linuxService({ unit: { unit, userManager }, command, unitFile, appName })

describe('linuxService', () => {
  it('turns desktop app scopes into apps named after their .desktop entry', () => {
    expect(serviceOf('app-flatpak-org.telegram.desktop-123.scope', { userManager: true, appName: 'Telegram Desktop' })).toMatchObject({ kind: 'app', appName: 'Telegram Desktop' })
  })

  it('falls back to the application id without a .desktop entry', () => {
    expect(serviceOf('app-gnome-firefox-3421.scope', { userManager: true })?.appName).toBe('firefox')
  })

  it('treats user services as agents', () => {
    expect(serviceOf('syncthing.service', { userManager: true, command: '/home/me/bin/syncthing' })).toMatchObject({ kind: 'agent', system: false, why: 'systemd user service syncthing.service' })
  })

  it('treats units shipped by the distribution as part of the system', () => {
    const vendorUnit = { file: '/usr/lib/systemd/system/ssh.service', vendor: true }

    expect(serviceOf('ssh.service', { unitFile: vendorUnit })).toMatchObject({ kind: 'daemon', system: true, location: '/usr/lib/systemd/system/ssh.service' })
  })

  it('treats units the admin installed as third-party', () => {
    expect(serviceOf('myapp.service', { unitFile: { file: '/etc/systemd/system/myapp.service', vendor: false } })?.system).toBe(false)
  })

  it('names Docker containers', () => {
    expect(serviceOf('docker-4f3a9b2c1d0e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a.scope')?.why).toBe('Docker container 4f3a9b2c1d0e')
  })

  it('ignores login session scopes', () => {
    expect(serviceOf('session-2.scope')).toBeNull()
  })
})

describe('createLinuxRules', () => {
  it('groups all kernel threads together', () => {
    const worker = makeAnalyzed({ pid: 55, ppid: 2, uid: 0, name: 'kworker/0:1', command: 'kworker/0:1' })

    expect(rules.systemGroupOf(worker, undefined)?.key).toBe('system:kernel')
  })

  it('describes well-known system daemons', () => {
    const journald = makeAnalyzed({ uid: 0, name: 'systemd-journald', command: '/usr/lib/systemd/systemd-journald' })

    expect(rules.systemGroupOf(journald, undefined)?.why).toBe('system log')
  })

  it('keeps the user\'s own tools from /usr/bin out of the system section', () => {
    const vim = makeAnalyzed({ name: 'vim', command: '/usr/bin/vim' })

    expect(rules.systemGroupOf(vim, undefined)).toBeNull()
  })

  it('counts desktop helpers the user runs from /usr/libexec as system', () => {
    const gvfs = makeAnalyzed({ name: 'gvfsd', command: '/usr/libexec/gvfsd' })

    expect(rules.systemGroupOf(gvfs, undefined)?.why).toBe('virtual file systems for apps (network shares, trash)')
  })

  it('recognizes Snap apps by their path', () => {
    expect(rules.appOf(makeAnalyzed({ command: '/snap/spotify/80/usr/share/spotify/spotify' }), undefined)?.name).toBe('spotify')
  })
})

describe('buildGroups on Linux', () => {
  const init = makeAnalyzed({ pid: 1, ppid: 0, uid: 0, name: 'systemd', command: '/usr/lib/systemd/systemd', stat: 'Ss' })
  const userManager = makeAnalyzed({ pid: 900, ppid: 1, name: 'systemd', command: '/usr/lib/systemd/systemd', stat: 'Ss' })

  const getGroup = (processes: AnalyzedProcess[], pid: number, services = new Map<number, ServiceInfo>()) =>
    buildGroups({
      processes: [init, userManager, ...processes],
      myUid: MY_UID,
      home: '/home/me',
      services,
      adopterPids: new Set([1, 900]),
      cwds: new Map(),
      projectRoots: new Map(),
      ports: new Map(),
      rules,
    }).find(group => group.processes.some(process => process.pid === pid))

  it('groups every process of a desktop app scope into the app', () => {
    const firefox = makeAnalyzed({ pid: 10, ppid: 900, command: '/usr/lib/firefox/firefox' })
    const content = makeAnalyzed({ pid: 11, ppid: 10, command: '/usr/lib/firefox/firefox' })
    const scope = serviceOf('app-gnome-firefox-10.scope', { userManager: true, appName: 'Firefox' })!
    const group = getGroup([firefox, content], 11, new Map([[10, scope], [11, scope]]))

    expect(group).toMatchObject({ section: 'apps', title: 'Firefox', processes: [{ pid: 10 }, { pid: 11 }] })
  })

  it('does not treat children of systemd --user as part of the user manager', () => {
    const tool = makeAnalyzed({ pid: 20, ppid: 900, name: 'tool', command: '/home/me/bin/tool' })

    expect(getGroup([tool], 20)?.why).toBe('started by systemd')
  })

  it('shows third-party user services as background agents', () => {
    const syncthing = makeAnalyzed({ pid: 30, ppid: 900, stat: 'Ss', command: '/home/me/bin/syncthing' })
    const service = serviceOf('syncthing.service', { userManager: true, command: syncthing.command })!

    expect(getGroup([syncthing], 30, new Map([[30, service]]))).toMatchObject({ section: 'background', why: 'systemd user service syncthing.service' })
  })

  it('keeps vendor services in the system section', () => {
    const pipewire = makeAnalyzed({ pid: 40, ppid: 900, name: 'pipewire', command: '/usr/bin/pipewire' })
    const service = serviceOf('pipewire.service', { userManager: true, unitFile: { file: '/usr/lib/systemd/user/pipewire.service', vendor: true } })!

    expect(getGroup([pipewire], 40, new Map([[40, service]]))).toMatchObject({ section: 'system', why: 'audio and video streams' })
  })
})
