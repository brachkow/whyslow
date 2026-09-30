import { darwin } from './darwin'
import { linux } from './linux'
import type { Platform } from './types'

const PLATFORMS: Partial<Record<NodeJS.Platform, Platform>> = { darwin, linux }

export const currentPlatform = (): Platform => {
  const platform = PLATFORMS[process.platform]
  if (!platform) {
    throw new Error(`whyslow supports macOS and Linux, not ${process.platform}`)
  }
  return platform
}
