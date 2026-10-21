import type { ReactNode } from 'react'

/**
 * Minimal renderer for the Markdown subset produced by the engine reports
 * (headings, paragraphs, bullet lists, pipe tables, **bold**, _italic_,
 * `code`). Text is rendered as React nodes — never as raw HTML.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyPrefix}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-muted px-1 text-[0.9em]">{tok.slice(1, -1)}</code>)
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1]!.length
      const cls = level <= 2 ? 'text-base font-semibold mt-2' : 'text-sm font-semibold mt-3'
      blocks.push(
        <div key={key++} role="heading" aria-level={level} className={cls}>
          {inline(h[2]!, `h${key}`)}
        </div>,
      )
      i++
      continue
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(cells(lines[i]!))
        i++
      }
      const [head, , ...body] = rows
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {(head ?? []).map((c, j) => (
                  <th key={j} className="border-b px-2 py-1 text-left font-medium text-muted-foreground">
                    {inline(c, `th${key}-${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50">
                  {r.map((c, j) => (
                    <td key={j} className="tabular px-2 py-1">
                      {inline(c, `td${key}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*-\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*-\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-0.5 pl-5 text-xs">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${key}-${j}`)}</li>
          ))}
        </ul>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#|\||\s*-\s)/.test(lines[i]!)) {
      para.push(lines[i]!)
      i++
    }
    blocks.push(
      <p key={key++} className="text-xs leading-relaxed">
        {inline(para.join(' '), `p${key}`)}
      </p>,
    )
  }
  return <div className="space-y-2">{blocks}</div>
}
