import { useCallback, useEffect, useState } from 'react'

import { takeSnapshot } from '../snapshot'
import type { Snapshot } from '../snapshot'

const EMPTY: Snapshot = { processes: [], groups: [], cwds: new Map(), ports: new Map(), memory: { usedBytes: null, totalBytes: 0 } }

export const useSnapshot = () => {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await takeSnapshot())
      setError(null)
    } catch (error_) {
      setError(String(error_))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, error, refresh }
}
