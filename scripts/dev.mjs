#!/usr/bin/env node
/**
 * Start the Rust API server and the Vite dev server together.
 *   node scripts/dev.mjs            (debug build of the API)
 *   node scripts/dev.mjs --release  (optimised API build)
 * Ctrl+C stops both.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const release = process.argv.includes('--release')
const port = process.env.PORT ?? '8080'

const procs = [
  {
    name: 'api',
    color: '\x1b[36m',
    cmd: 'cargo',
    args: ['run', ...(release ? ['--release'] : []), '-p', 'api-server'],
    cwd: root,
    env: { PORT: port },
  },
  {
    name: 'web',
    color: '\x1b[35m',
    cmd: 'npm',
    args: ['run', 'dev'],
    cwd: path.join(root, 'apps', 'web'),
    env: { VITE_API_PROXY: `http://127.0.0.1:${port}` },
  },
]

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, {
    cwd: p.cwd,
    env: { ...process.env, ...p.env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = `${p.color}[${p.name}]\x1b[0m `
  const pipe = (stream, out) =>
    stream.on('data', (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) out.write(prefix + line + '\n')
    })
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`)
    shutdown(code ?? 0)
  })
  return child
})

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const c of children) if (!c.killed) c.kill()
  setTimeout(() => process.exit(code), 300)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
