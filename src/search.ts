import type { AnalyzedProcess, ProcessGroup } from './types'

// A group that matched as a whole shows all its processes
export type SearchMatches = ReadonlyMap<string, ReadonlySet<number> | 'all'>

const WHITESPACE = /\s+/

const includesAll = (text: string, terms: string[]) => {
  const haystack = text.toLowerCase()
  return terms.every(term => haystack.includes(term))
}

const portsText = (ports: readonly number[]) => ports.map(port => `:${port}`).join(' ')

const groupText = (group: ProcessGroup) =>
  [group.title, group.why, group.location ?? '', portsText(group.ports)].join(' ')

const processText = (process: AnalyzedProcess, ports: readonly number[]) =>
  [process.name, process.args, String(process.pid), portsText(ports)].join(' ')

// Every whitespace-separated term has to match, case-insensitively; null means no search
export const searchGroups = (
  groups: ProcessGroup[],
  query: string,
  portsByPid: ReadonlyMap<number, number[]>,
): SearchMatches | null => {
  const terms = query.toLowerCase().split(WHITESPACE).filter(Boolean)
  if (terms.length === 0) {
    return null
  }

  return new Map(groups.flatMap((group): Array<[string, ReadonlySet<number> | 'all']> => {
    if (includesAll(groupText(group), terms)) {
      return [[group.id, 'all']]
    }
    const pids = group.processes
      .filter(process => includesAll(processText(process, portsByPid.get(process.pid) ?? []), terms))
      .map(process => process.pid)
    return pids.length > 0 ? [[group.id, new Set(pids)]] : []
  }))
}
