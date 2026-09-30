import { describe, expect, it } from 'vitest'

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

describe('parseProcStat', () => {
  // Real /proc/1/stat from a container, with the command name changed to one containing spaces and parentheses
  const stat = '1 (my (weird) app) S 0 1 1 34816 1 4194560 1049 33 0 0 250 50 0 0 20 0 1 0 130240990 2396160 310 18446744073709551615'

  it('keeps spaces and parentheses in the command name', () => {
    expect(parseProcStat(stat)?.comm).toBe('my (weird) app')
  })

  it('reads the process tree and terminal fields', () => {
    expect(parseProcStat(stat)).toMatchObject({ state: 'S', ppid: 0, pgrp: 1, session: 1, ttyNr: 34_816, tpgid: 1 })
  })

  it('reads cpu and start times in clock ticks', () => {
    expect(parseProcStat(stat)).toMatchObject({ utime: 250, stime: 50, starttime: 130_240_990 })
  })

  it('rejects truncated content', () => {
    expect(parseProcStat('1 (sh) S 0 1')).toBeNull()
  })
})

describe('parseProcStatus', () => {
  it('reads the real uid and resident memory', () => {
    const status = 'Name:\tnode\nPid:\t7\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t   51200 kB\n'

    expect(parseProcStatus(status)).toEqual({ uid: 1000, rssKb: 51_200 })
  })

  it('treats kernel threads without VmRSS as using no memory', () => {
    expect(parseProcStatus('Name:\tkworker/0:1\nUid:\t0\t0\t0\t0\n')).toEqual({ uid: 0, rssKb: 0 })
  })
})

describe('parseCmdline', () => {
  it('joins NUL-separated arguments', () => {
    expect(parseCmdline('node\0server.js\0--port\u00005173\0')).toBe('node server.js --port 5173')
  })
})

describe('parsePasswd', () => {
  it('maps uids to user names', () => {
    expect(parsePasswd('root:x:0:0:root:/root:/bin/bash\n# comment\nme:x:1000:1000::/home/me:/bin/zsh\n')).toEqual(new Map([[0, 'root'], [1000, 'me']]))
  })
})

describe('parseMeminfo', () => {
  it('counts everything that is not available as used', () => {
    expect(parseMeminfo('MemTotal:        8196876 kB\nMemFree:         5439256 kB\nMemAvailable:    7070168 kB\n')).toEqual({
      usedBytes: (8_196_876 - 7_070_168) * 1024,
      totalBytes: 8_196_876 * 1024,
    })
  })

  it('returns null on kernels without MemAvailable', () => {
    expect(parseMeminfo('MemTotal:        8196876 kB\n')).toBeNull()
  })
})

describe('parseListeningSockets', () => {
  const header = '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'
  // Real tcp6 row of a server listening on 5173, plus an established connection
  const listening = '   0: 00000000000000000000000000000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 20625040 1 00000000322524ba 100 0 0 10 0'
  const established = '   1: 0100007F:1F90 0100007F:D2A4 01 00000000:00000000 00:00000000 00000000  1000        0 555 1 0000000000000000 20 4 30 10 -1'

  it('maps listening socket inodes to ports', () => {
    expect(parseListeningSockets([header, listening, established].join('\n'))).toEqual(new Map([[20_625_040, 5173]]))
  })
})

describe('socketInode', () => {
  it('reads the inode of a socket fd link', () => {
    expect([socketInode('socket:[20625040]'), socketInode('/dev/null')]).toEqual([20_625_040, null])
  })
})

describe('parseCgroupUnit', () => {
  it('finds the system service on cgroup v2', () => {
    expect(parseCgroupUnit('0::/system.slice/docker.service\n')).toEqual({ unit: 'docker.service', userManager: false })
  })

  it('finds a user service inside the user manager', () => {
    expect(parseCgroupUnit('0::/user.slice/user-1000.slice/user@1000.service/session.slice/pipewire.service\n')).toEqual({ unit: 'pipewire.service', userManager: true })
  })

  it('finds the app scope of a desktop app', () => {
    expect(parseCgroupUnit('0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-gnome-firefox-3421.scope\n')?.unit).toBe('app-gnome-firefox-3421.scope')
  })

  it('treats the user manager process itself as a system unit', () => {
    expect(parseCgroupUnit('0::/user.slice/user-1000.slice/user@1000.service/init.scope\n')).toEqual({ unit: 'init.scope', userManager: true })
  })

  it('reads the systemd hierarchy on cgroup v1', () => {
    expect(parseCgroupUnit('12:pids:/system.slice/ssh.service\n1:name=systemd:/system.slice/ssh.service\n')?.unit).toBe('ssh.service')
  })

  it('returns null inside a container without systemd', () => {
    expect(parseCgroupUnit('0::/\n')).toBeNull()
  })
})

describe('parseAppUnit', () => {
  // Examples from https://systemd.io/DESKTOP_ENVIRONMENTS/
  it.each([
    ['app-gnome-org.gnome.Evince@12345.service', 'org.gnome.Evince'],
    ['app-flatpak-org.telegram.desktop@12345.service', 'org.telegram.desktop'],
    ['app-KDE-org.kde.okular@12345.service', 'org.kde.okular'],
    ['app-org.kde.amarok.service', 'org.kde.amarok'],
    ['app-org.gnome.Evince-12345.scope', 'org.gnome.Evince'],
    ['app-gnome-firefox-3421.scope', 'firefox'],
    ['app-dbus-:1.2-org.freedesktop.Tracker@0.service', 'org.freedesktop.Tracker'],
    [String.raw`app-gnome-my\x2dapp-99.scope`, 'my-app'],
  ])('reads the application id of %s', (unit, expected) => {
    expect(parseAppUnit(unit)).toBe(expected)
  })

  it('ignores units that are not app launches', () => {
    expect(parseAppUnit('session-2.scope')).toBeNull()
  })
})

describe('parseDesktopName', () => {
  it('reads the untranslated name of the desktop entry', () => {
    const desktop = '[Desktop Entry]\nName[de]=Telegramm\nName=Telegram Desktop\nExec=telegram\n\n[Desktop Action quit]\nName=Quit\n'

    expect(parseDesktopName(desktop)).toBe('Telegram Desktop')
  })

  it('ignores names of other groups', () => {
    expect(parseDesktopName('[Desktop Entry]\nExec=x\n[Desktop Action new]\nName=New Window\n')).toBeNull()
  })
})

describe('unitFileName', () => {
  it('maps template instances to their template', () => {
    expect([unitFileName('getty@tty1.service'), unitFileName('ssh.service')]).toEqual(['getty@.service', 'ssh.service'])
  })
})
