import { describe, expect, it } from 'vitest'

import { searchGroups } from './search'
import { makeAnalyzed } from './test-factories'
import type { ProcessGroup } from './types'

const makeGroup = (overrides: Partial<ProcessGroup>): ProcessGroup => ({
  id: 'id',
  section: 'projects',
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

const vite = makeAnalyzed({ pid: 101, name: 'node', args: 'node vite --port 5173' })
const lazygit = makeAnalyzed({ pid: 102, name: 'lazygit', args: 'lazygit' })
const site = makeGroup({ id: 'project:site', title: 'site', why: '`pnpm dev` from Ghostty', location: '~/Projects/site', processes: [vite, lazygit], ports: [5173] })
const firefox = makeGroup({ id: 'app:Firefox', section: 'apps', title: 'Firefox', why: 'app' })

const search = (query: string, ports = new Map<number, number[]>()) => searchGroups([site, firefox], query, ports)

describe('searchGroups', () => {
  it('does not filter on an empty query', () => {
    expect(search('   ')).toBeNull()
  })

  it('matches group titles case-insensitively', () => {
    expect(search('FIREFOX')).toEqual(new Map([['app:Firefox', 'all']]))
  })

  it('matches the why line and location', () => {
    expect([...(search('ghostty') ?? new Map()).keys(), ...(search('projects/site') ?? new Map()).keys()]).toEqual(['project:site', 'project:site'])
  })

  it('matches group ports', () => {
    expect(search(':5173')?.get('project:site')).toBe('all')
  })

  it('narrows a group to the processes that matched', () => {
    expect(search('lazygit')?.get('project:site')).toEqual(new Set([102]))
  })

  it('matches a process by pid', () => {
    expect(search('101')?.get('project:site')).toEqual(new Set([101]))
  })

  it('matches a process by its own ports', () => {
    expect(search(':9229', new Map([[102, [9229]]]))?.get('project:site')).toEqual(new Set([102]))
  })

  it('requires every term to match', () => {
    expect(search('node lazygit')?.size).toBe(0)
  })

  it('hides groups without matches', () => {
    expect(search('telegram')?.size).toBe(0)
  })
})
