/**
 * Starts the real Rust API server for the integration tests.
 * Builds it with cargo if the binary is missing; set API_URL to use an
 * already running server instead.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

const root = path.resolve(import.meta.dirname, '../../../..')
const exe = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'api-server.exe' : 'api-server')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function waitForHealth(url: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/health`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`API server at ${url} did not become healthy within ${timeoutMs} ms`)
}

let child: ChildProcess | null = null

export default async function setup(project: TestProject) {
  if (process.env.API_URL) {
    await waitForHealth(process.env.API_URL, 10_000)
    project.provide('apiUrl', process.env.API_URL)
    return
  }
  if (!existsSync(exe)) {
    execFileSync('cargo', ['build', '-p', 'api-server'], { cwd: root, stdio: 'inherit' })
  }
  const port = await freePort()
  child = spawn(exe, [], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RUST_LOG: 'warn' }, stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  await waitForHealth(url, 30_000)
  project.provide('apiUrl', url)
  return () => {
    child?.kill()
    child = null
  }
}
