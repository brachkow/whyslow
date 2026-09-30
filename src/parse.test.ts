import { describe, expect, it } from 'vitest'

import { parseDuration, parseLaunchctlList, parseLsofCwd, parseLsofPorts, parsePsOutput, parseVmStatUsedBytes } from './parse'

describe('parseDuration', () => {
  it.each([
    ['00:07', 7],
    ['12:34', 754],
    ['01:00:00', 3600],
    ['06-08:30:34', 6 * 86_400 + 8 * 3600 + 30 * 60 + 34],
    ['725:15.84', 725 * 60 + 15.84],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBeCloseTo(expected)
  })
})

describe('parsePsOutput', () => {
  const statLine = '  3609     1  3609   501 brachkow   2.5 175792 15-01:29:18   1:02.50 Ss   ??       /Applications/OrbStack.app/Contents/MacOS/OrbStack Helper'
  const argsLine = ' 3609 /Applications/OrbStack.app/Contents/MacOS/OrbStack Helper --flag value'

  const getParsed = () => parsePsOutput(statLine, argsLine)[0]

  it('keeps spaces in the executable path', () => {
    expect(getParsed()?.command).toBe('/Applications/OrbStack.app/Contents/MacOS/OrbStack Helper')
  })

  it('uses executable basename as name', () => {
    expect(getParsed()?.name).toBe('OrbStack Helper')
  })

  it('joins full arguments by pid', () => {
    expect(getParsed()?.args).toBe('/Applications/OrbStack.app/Contents/MacOS/OrbStack Helper --flag value')
  })

  it('parses numeric fields', () => {
    expect(getParsed()).toMatchObject({ pid: 3609, ppid: 1, pgid: 3609, uid: 501, user: 'brachkow', psCpuPercent: 2.5, rssKb: 175_792, cpuTimeSec: 62.5 })
  })

  it('falls back to command when args are missing', () => {
    const [process] = parsePsOutput(statLine, '')

    expect(process?.args).toBe(process?.command)
  })

  it('skips blank lines', () => {
    expect(parsePsOutput(`\n${statLine}\n\n`, argsLine)).toHaveLength(1)
  })
})

describe('parseLaunchctlList', () => {
  it('maps running job pids to labels and skips stopped ones', () => {
    const output = 'PID\tStatus\tLabel\n-\t0\tcom.apple.idle\n3334\t0\tcom.apple.Finder\n1171\t-9\tcom.apple.mediaremoteagent\n'

    expect(parseLaunchctlList(output)).toEqual(new Map([[3334, 'com.apple.Finder'], [1171, 'com.apple.mediaremoteagent']]))
  })
})

describe('parseLsofCwd', () => {
  it('maps pids to working directories, including paths with spaces', () => {
    const output = 'p150\nfcwd\nn/Users/me/Projects/site\np271\nfcwd\nn/Users/me/My Files\n'

    expect(parseLsofCwd(output)).toEqual(new Map([[150, '/Users/me/Projects/site'], [271, '/Users/me/My Files']]))
  })
})

describe('parseLsofPorts', () => {
  it('collects unique sorted ports for ipv4, ipv6 and wildcard listeners', () => {
    const output = 'p1534\nf9\nn*:7000\nf10\nn[::1]:7000\nf11\nn127.0.0.1:5000\n'

    expect(parseLsofPorts(output)).toEqual(new Map([[1534, [5000, 7000]]]))
  })
})

describe('parseVmStatUsedBytes', () => {
  const output = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                                     3809.',
    'Pages wired down:                             200.',
    'Pages purgeable:                                   20.',
    '"Translation faults":                    69882547244.',
    'File-backed pages:                            110114.',
    'Anonymous pages:                              1000.',
    'Pages occupied by compressor:                 300.',
  ].join('\n')

  it('adds app memory without purgeable pages, wired and compressed', () => {
    expect(parseVmStatUsedBytes(output)).toBe((1000 - 20 + 200 + 300) * 16_384)
  })

  it('returns null when a field is missing', () => {
    expect(parseVmStatUsedBytes(output.replace('Anonymous pages', 'Something else'))).toBeNull()
  })
})
