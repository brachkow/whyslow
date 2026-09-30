export const formatDuration = (totalSec: number): string => {
  const sec = Math.floor(totalSec)
  const days = Math.floor(sec / 86_400)
  const hours = Math.floor((sec % 86_400) / 3600)
  const minutes = Math.floor((sec % 3600) / 60)

  if (days > 0) {
    return `${days}d${hours}h`
  }
  if (hours > 0) {
    return `${hours}h${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }
  return `${sec}s`
}

export const formatMemory = (kb: number): string => {
  if (kb >= 1024 * 1024) {
    return `${(kb / 1024 / 1024).toFixed(1)}G`
  }
  if (kb >= 1024) {
    return `${Math.round(kb / 1024)}M`
  }
  return `${kb}K`
}

export const formatCpu = (percent: number): string => `${percent.toFixed(1)}%`

export const truncate = (text: string, width: number): string => {
  if (width <= 0) {
    return ''
  }
  if (text.length <= width) {
    return text
  }
  return `${text.slice(0, Math.max(0, width - 1))}…`
}

export const portsLabel = (shown: number[], hidden: number) =>
  [...shown.map(port => `:${port}`), ...(hidden > 0 ? [`+${hidden}`] : [])].join(' ')

// As many ports as fit into the width, with a `+N` for the rest
export const fitPorts = (ports: number[], width: number) => {
  let count = ports.length
  while (count > 0 && portsLabel(ports.slice(0, count), ports.length - count).length > width) {
    count -= 1
  }
  return { shown: ports.slice(0, count), hidden: ports.length - count }
}
