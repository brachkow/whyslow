import { useCallback, useEffect, useState } from 'react'

import { takeSnapshot } from '../snapshot'
import type { Snapshot } from '../snapshot'
import type { Config } from '../types'

const EMPTY: Snapshot = { processes: [], groups: [], cwds: new Map(), ports: new Map(), memory: { usedBytes: null, totalBytes: 0 } }

export const useSnapshot = (config: Config) => {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await takeSnapshot(config))
      setError(null)
    } catch (error_) {
      setError(String(error_))
    }
    setLoading(false)
  }, [config])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, error, refresh }
}
