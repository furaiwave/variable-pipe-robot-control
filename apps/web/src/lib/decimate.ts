/**
 * Reduce a series to at most `maxPoints` for plotting. Uses bucketed
 * selection that keeps, per bucket, the samples with the minimum and maximum
 * of `key` (so peaks remain visible) plus the first and last samples.
 * Metrics are always computed by the engine from every step; only plots are
 * decimated.
 */
export function decimate<T>(data: readonly T[], maxPoints: number, key?: (d: T) => number): T[] {
  const n = data.length
  if (n <= maxPoints || maxPoints < 4) return data.slice()
  if (!key) {
    const stride = Math.ceil(n / maxPoints)
    const out: T[] = []
    for (let i = 0; i < n; i += stride) out.push(data[i]!)
    if (out[out.length - 1] !== data[n - 1]) out.push(data[n - 1]!)
    return out
  }
  const buckets = Math.floor((maxPoints - 2) / 2)
  const size = (n - 2) / buckets
  const out: T[] = [data[0]!]
  for (let b = 0; b < buckets; b++) {
    const start = 1 + Math.floor(b * size)
    const end = Math.min(n - 1, 1 + Math.floor((b + 1) * size))
    let iMin = start
    let iMax = start
    for (let i = start; i < end; i++) {
      const v = key(data[i]!)
      if (v < key(data[iMin]!)) iMin = i
      if (v > key(data[iMax]!)) iMax = i
    }
    if (iMin === iMax) out.push(data[iMin]!)
    else if (iMin < iMax) out.push(data[iMin]!, data[iMax]!)
    else out.push(data[iMax]!, data[iMin]!)
  }
  out.push(data[n - 1]!)
  return out
}
