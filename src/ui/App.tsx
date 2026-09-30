import { getBoundingClientRect, useOnClick, useOnWheel } from '@ink-tools/ink-mouse'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import type { Key } from 'ink'
import os from 'node:os'
import { useEffect, useMemo, useRef, useState } from 'react'

import { byCpu, byMemory, byRuntime, collectDescendants } from '../analyze'
import { formatCpu, formatMemory } from '../format'
import { killProcesses } from '../kill'
import type { KillSignal } from '../kill'
import { arrangeSections } from '../origin'
import { currentPlatform } from '../platform'
import { searchGroups } from '../search'
import type { Config, ProcessGroup } from '../types'
import { GroupDetail, ProcessDetail } from './Detail'
import { isSelectable, rowAtLine, visibleWindow } from './layout'
import type { Row } from './layout'
import { GroupRow, ProcessRow, QuietRow, SectionRow } from './Rows'
import { useSnapshot } from './use-snapshot'

type Sort = 'cpu' | 'memory' | 'runtime'

type KillTarget = { label: string, pids: number[] }

const SORTERS = { cpu: byCpu, memory: byMemory, runtime: byRuntime }
const NEXT_SORT: Record<Sort, Sort> = { cpu: 'memory', memory: 'runtime', runtime: 'cpu' }
const KILL_KEYS: Record<string, KillSignal> = { y: 'SIGTERM', f: 'SIGKILL' }

const WHEEL_STEPS: Record<string, number> = { 'wheel-up': -1, 'wheel-down': 1 }

// Mouse tracking feeds SGR reports like `[<35;12;7M` through the same input as keys
const MOUSE_REPORT = /^\[<\d+;\d+;\d+[Mm]$/

const isTypedText = (input: string, key: Key) =>
  input.length > 0 && !key.ctrl && !key.meta && !key.return && !key.escape && !MOUSE_REPORT.test(input)

const CORES = os.availableParallelism()
const SELF_PID = process.pid

const DETAIL_ROWS = 7
// Status line, detail pane and key hints
const CHROME_ROWS = 2 + DETAIL_ROWS

type Props = { config: Config }

export const App = ({ config }: Props) => {
  const { exit } = useApp()
  const { columns, rows: terminalRows } = useWindowSize()
  const { snapshot, loading, error, refresh } = useSnapshot(config)
  const [sort, setSort] = useState<Sort>('cpu')
  const [showQuiet, setShowQuiet] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<KillTarget | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [daemonPid, setDaemonPid] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    void currentPlatform().daemon.pid().then(setDaemonPid)
  }, [])

  const byPid = useMemo(() => new Map(snapshot.processes.map(process => [process.pid, process])), [snapshot])

  const matches = useMemo(() => searchGroups(snapshot.groups, query, snapshot.ports), [snapshot, query])

  // Groups matched through some of their processes open by default; toggling flips that
  const isExpanded = (group: ProcessGroup) => {
    const autoExpanded = matches?.get(group.id) instanceof Set
    return expanded.has(group.id) !== autoExpanded
  }

  const rows = useMemo(() => {
    const groups = matches ? snapshot.groups.filter(group => matches.has(group.id)) : snapshot.groups
    // Search looks through quiet groups too, otherwise matches would hide behind the counter
    return arrangeSections(groups, SORTERS[sort], showQuiet || matches !== null).flatMap((view): Row[] => [
      { kind: 'section', key: `section:${view.section}`, section: view.section, count: view.groups.length + view.quietCount },
      ...view.groups.flatMap((group): Row[] => {
        const matched = matches?.get(group.id)
        const processes = matched instanceof Set ? group.processes.filter(process => matched.has(process.pid)) : group.processes
        return [
          { kind: 'group', key: group.id, group },
          ...(isExpanded(group)
            ? processes.toSorted(SORTERS[sort]).map((process): Row => ({ kind: 'process', key: `${group.id}/${process.pid}`, group, process }))
            : []),
        ]
      }),
      ...(view.quietCount > 0 ? [{ kind: 'quiet' as const, key: `quiet:${view.section}`, count: view.quietCount }] : []),
    ])
  }, [snapshot, sort, showQuiet, expanded, matches])

  const selectableIndexes = rows.flatMap((row, index) => (isSelectable(row) ? [index] : []))
  const selectedIndex = rows.findIndex(row => row.key === selectedKey && isSelectable(row))
  const currentIndex = selectedIndex === -1 ? (selectableIndexes[0] ?? 0) : selectedIndex
  const selected = rows[currentIndex]
  const listHeight = Math.max(3, terminalRows - CHROME_ROWS - (error ? 1 : 0))

  const moveSelection = (delta: number) => {
    const position = selectableIndexes.indexOf(currentIndex)
    const next = selectableIndexes[Math.min(selectableIndexes.length - 1, Math.max(0, position + delta))]
    const row = next === undefined ? undefined : rows[next]
    if (row) {
      setSelectedKey(row.key)
    }
  }

  const toggleGroup = (group: ProcessGroup) => {
    const next = new Set(expanded)
    if (next.has(group.id)) {
      next.delete(group.id)
    } else {
      next.add(group.id)
    }
    setExpanded(next)
    setSelectedKey(group.id)
  }

  // whyslow never offers to kill itself, even when it sits inside the selected group
  const killTargetOf = (row: Row | undefined): KillTarget | null => {
    if (row?.kind === 'group') {
      const pids = new Set(row.group.processes.flatMap(process => [process.pid, ...collectDescendants(snapshot.processes, process.pid)]))
      pids.delete(SELF_PID)
      return pids.size > 0 ? { label: `${row.group.title}: ${pids.size} processes`, pids: [...pids] } : null
    }
    if (row?.kind === 'process' && row.process.pid !== SELF_PID) {
      const pids = [row.process.pid, ...collectDescendants(snapshot.processes, row.process.pid)]
      return { label: `${row.process.name} (${row.process.pid})${pids.length > 1 ? ` and ${pids.length - 1} children` : ''}`, pids }
    }
    return null
  }

  const kill = (target: KillTarget, signal: KillSignal) => {
    const result = killProcesses(target.pids, signal)
    const failures = result.failed.length > 0 ? `, ${result.failed.length} failed: ${result.failed[0]?.error}` : ''
    setMessage(`Sent ${signal} to ${result.killed.length} processes${failures}`)
    void refresh()
  }

  useInput((input, key) => {
    if (searching) {
      if (key.escape) {
        setQuery('')
        setSearching(false)
      }
      if (key.return) {
        setSearching(false)
      }
      if (key.backspace || key.delete) {
        setQuery(query.slice(0, -1))
      }
      if (key.upArrow) {
        moveSelection(-1)
      }
      if (key.downArrow) {
        moveSelection(1)
      }
      if (isTypedText(input, key)) {
        setQuery(query + input)
      }
      return
    }

    if (confirming) {
      const signal = KILL_KEYS[input]
      if (signal) {
        kill(confirming, signal)
      }
      setConfirming(null)
      return
    }

    if (key.escape && query) {
      setQuery('')
      return
    }
    if (input === 'q' || key.escape) {
      exit()
    }
    if (input === '/') {
      setSearching(true)
    }
    if (key.upArrow || input === 'k') {
      moveSelection(-1)
    }
    if (key.downArrow || input === 'j') {
      moveSelection(1)
    }
    if (key.return && (selected?.kind === 'group' || selected?.kind === 'process')) {
      toggleGroup(selected.group)
    }
    if (input === 's') {
      setSort(NEXT_SORT[sort])
    }
    if (input === 'a') {
      setShowQuiet(!showQuiet)
    }
    if (input === 'r') {
      void refresh()
    }
    if (input === 'x') {
      const target = killTargetOf(selected)
      setMessage(target ? null : 'Nothing to kill: that is whyslow itself')
      setConfirming(target)
    }
  })

  const footerMode = (confirming && 'confirm') || (searching && 'search') || 'hints'

  // Per-process CPU is per core like in Activity Monitor, the machine total is shared across all cores
  const machineCpu = snapshot.processes.reduce((sum, process) => sum + process.cpuPercent, 0) / CORES
  const totalRssKb = snapshot.processes.reduce((sum, process) => sum + process.rssKb, 0)
  const visibleRows = visibleWindow(rows, currentIndex, listHeight)

  const listRef = useRef(null)
  // Mouse tracking takes the wheel away from the terminal, so it moves the selection instead
  useOnWheel(listRef, (event) => {
    if (!confirming) {
      moveSelection(WHEEL_STEPS[event.button] ?? 0)
    }
  })
  useOnClick(listRef, (event) => {
    const bounds = getBoundingClientRect(listRef.current)
    if (event.button !== 'left' || confirming || !bounds) {
      return
    }
    const row = rowAtLine(visibleRows, event.y - bounds.top)
    if (row?.kind === 'group') {
      toggleGroup(row.group)
    }
    if (row?.kind === 'process') {
      setSelectedKey(row.key)
    }
  })

  const renderRow = (row: Row) => ({
    section: () => row.kind === 'section' && <SectionRow key={row.key} section={row.section} count={row.count} />,
    quiet: () => row.kind === 'quiet' && <QuietRow key={row.key} count={row.count} />,
    group: () => row.kind === 'group' && <GroupRow key={row.key} group={row.group} expanded={isExpanded(row.group)} selected={row === selected} width={columns} />,
    process: () => row.kind === 'process' && <ProcessRow key={row.key} process={row.process} ports={snapshot.ports.get(row.process.pid) ?? []} selected={row === selected} width={columns} />,
  }[row.kind]())

  return (
    <Box flexDirection="column" width={columns}>
      <Box gap={2}>
        <Text bold color="cyan">whyslow</Text>
        <Text>{`${snapshot.processes.length} processes`}</Text>
        <Text>{`CPU ${formatCpu(machineCpu)} of ${CORES} cores`}</Text>
        {snapshot.memory.usedBytes !== null && (
          <Text>{`Memory ${formatMemory(snapshot.memory.usedBytes / 1024)} of ${formatMemory(snapshot.memory.totalBytes / 1024)}`}</Text>
        )}
        <Text dimColor>{`RSS ${formatMemory(totalRssKb)}`}</Text>
        <Text dimColor>{`sort: ${sort}`}</Text>
        {daemonPid === null
          ? <Text dimColor>daemon: off</Text>
          : <Text color="green">{`daemon: on (${daemonPid})`}</Text>}
        {loading && <Text color="yellow">refreshing…</Text>}
      </Box>
      {error && <Text color="red">{error}</Text>}

      <Box ref={listRef} flexDirection="column" height={listHeight} overflow="hidden">
        {visibleRows.map(renderRow)}
      </Box>

      <Box flexDirection="column" height={DETAIL_ROWS} flexShrink={0} overflow="hidden" borderStyle="round" borderDimColor paddingX={1}>
        {selected?.kind === 'group' && <GroupDetail group={selected.group} byPid={byPid} width={columns - 4} />}
        {selected?.kind === 'process' && <ProcessDetail process={selected.process} byPid={byPid} cwd={snapshot.cwds.get(selected.process.pid)} ports={snapshot.ports.get(selected.process.pid) ?? []} width={columns - 4} />}
      </Box>

      {{
        confirm: () => confirming && (
          <Text>
            <Text bold color="red">{`Kill ${confirming.label}? `}</Text>
            <Text bold>y</Text>
            {' SIGTERM · '}
            <Text bold>f</Text>
            {' SIGKILL · any other key cancels'}
          </Text>
        ),
        search: () => (
          <Text wrap="truncate">
            <Text bold color="cyan">/</Text>
            {query}
            <Text inverse> </Text>
            <Text dimColor>{`  ${matches?.size ?? 0} groups · enter apply · esc clear`}</Text>
          </Text>
        ),
        hints: () => (
          <Text wrap="truncate">
            {query && <Text color="cyan">{`/${query} `}</Text>}
            {query && <Text dimColor>{`${matches?.size ?? 0} groups, esc clears · `}</Text>}
            <Text dimColor>{`${message ? `${message} · ` : ''}↑↓ move · enter/click expand · / search · x kill · a quiet · s sort · r refresh · q quit`}</Text>
          </Text>
        ),
      }[footerMode]()}
    </Box>
  )
}
