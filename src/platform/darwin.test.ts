import { describe, expect, it } from 'vitest'

import { makeProcess } from '../test-factories'
import { buildDarwinServices, darwinRules } from './darwin'

const getAppName = (command: string) => darwinRules.appOf(makeProcess({ command }), undefined)?.name ?? null

describe('darwinRules.appOf', () => {
  it.each([
    ['/Applications/Firefox.app/Contents/MacOS/firefox', 'Firefox'],
    ['/Applications/Google Chrome.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper', 'Google Chrome'],
    ['/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal', 'Terminal'],
    ['/System/Applications/Mail.app/Contents/MacOS/Mail', 'Mail'],
  ])('finds the outermost app in %s', (command, expected) => {
    expect(getAppName(command)).toBe(expected)
  })

  it('ignores bundles outside Applications folders', () => {
    expect(getAppName('/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock')).toBeNull()
  })

  it('recognizes iOS Simulator runtimes', () => {
    expect(getAppName('/Library/Developer/CoreSimulator/Volumes/iOS/x.simruntime/Contents/Resources/RuntimeRoot/usr/libexec/foo')).toBe('iOS Simulator')
  })
})

describe('buildDarwinServices', () => {
  const plist = { label: 'com.vendor.sync', program: '/opt/vendor/syncd', path: '/Library/LaunchDaemons/com.vendor.sync.plist', kind: 'daemon' as const, runAtLoad: false }

  it('matches root daemons to their plist by program path', () => {
    const daemon = makeProcess({ pid: 30, command: '/opt/vendor/syncd' })

    expect(buildDarwinServices([daemon], new Map(), [plist]).get(30)).toMatchObject({ label: 'com.vendor.sync', kind: 'daemon', system: false })
  })

  it('treats application.* jobs as app launches', () => {
    const app = makeProcess({ pid: 31 })

    expect(buildDarwinServices([app], new Map([[31, 'application.org.mozilla.firefox.1.2']]), []).get(31)?.kind).toBe('app')
  })

  it('marks com.apple jobs as part of the system', () => {
    const agent = makeProcess({ pid: 32 })

    expect(buildDarwinServices([agent], new Map([[32, 'com.apple.Finder']]), []).get(32)?.system).toBe(true)
  })

  it('ignores processes launchd does not know', () => {
    expect(buildDarwinServices([makeProcess({ pid: 33 })], new Map(), []).size).toBe(0)
  })
})
