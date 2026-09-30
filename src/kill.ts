export type KillSignal = 'SIGTERM' | 'SIGKILL'

export type KillResult = {
  killed: number[]
  failed: Array<{ pid: number, error: string }>
}

export const killProcesses = (pids: number[], signal: KillSignal): KillResult => {
  const result: KillResult = { killed: [], failed: [] }

  for (const pid of pids) {
    try {
      process.kill(pid, signal)
      result.killed.push(pid)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH') {
        continue
      }
      result.failed.push({ pid, error: code === 'EPERM' ? 'permission denied' : String(error) })
    }
  }

  return result
}

export const isAlive = (pid: number) => {
  try {
    return process.kill(pid, 0)
  } catch {
    return false
  }
}
