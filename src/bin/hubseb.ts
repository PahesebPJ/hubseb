#!/usr/bin/env node
import { SystemRuntime } from '../core/runtime.ts'
import { TopologyStore } from '../core/topology.ts'
import { serializeWire, wireFailure, wireSuccess } from '../core/wire.ts'
import { DriverHub } from '../drivers/hub.ts'

export const VERSION = '0.4.0'

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function executeHubCli(
  argv: readonly string[],
  runtime: SystemRuntime = new SystemRuntime(),
): Promise<CliResult> {
  const jsonMode = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')
  const action = args[0] ?? 'help'

  const store = new TopologyStore(runtime)
  const driverHub = new DriverHub(runtime)

  if (action === 'capabilities' || action === 'ping') {
    const info = {
      id: 'hubseb',
      version: VERSION,
      provides: ['hub.topology', 'hub.signals', 'hub.drivers'],
    }
    if (jsonMode) {
      return { exitCode: 0, stdout: serializeWire(wireSuccess(action, info)), stderr: '' }
    }
    return {
      exitCode: 0,
      stdout: `hubseb v${VERSION} [provides: ${info.provides.join(', ')}]\n`,
      stderr: '',
    }
  }

  if (action === 'ls' || action === 'nodes') {
    const nodes = await store.listNodes()
    if (jsonMode) {
      return {
        exitCode: 0,
        stdout: serializeWire(
          wireSuccess('nodes', { topologyFile: runtime.topologyFile, nodes }),
        ),
        stderr: '',
      }
    }
    if (nodes.length === 0) {
      return {
        exitCode: 0,
        stdout: `No *seb nodes registered in ${runtime.topologyFile}\n`,
        stderr: '',
      }
    }
    const lines = [`Registered *seb nodes (${runtime.topologyFile}):`]
    for (const n of nodes) {
      lines.push(
        `  ◆ ${n.id} v${n.version} — provides: [${n.provides.join(', ')}] | consumes: [${n.consumes.join(', ') || 'none'}]`,
      )
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  }

  if (action === 'graph' || action === 'links') {
    const nodes = await store.listNodes()
    const links = await store.resolveServiceLinks()
    if (jsonMode) {
      return {
        exitCode: 0,
        stdout: serializeWire(wireSuccess('graph', { nodes, links })),
        stderr: '',
      }
    }
    if (nodes.length === 0) {
      return { exitCode: 0, stdout: 'Topology graph is empty.\n', stderr: '' }
    }
    const lines = ['*seb Ecosystem Topology Graph:']
    for (const n of nodes) {
      lines.push(`  Node [${n.id} v${n.version}]:`)
      lines.push(`    ├─ Provides : ${n.provides.join(', ') || '(none)'}`)
      lines.push(`    └─ Signals  : ${n.signals.join(', ') || '(none)'}`)
    }
    if (links.length > 0) {
      lines.push('', '  Service Bridges:')
      for (const l of links) {
        const arrow =
          l.status === 'connected'
            ? `● ${l.consumer} ──(${l.capability})──▶ ${l.provider}`
            : `○ ${l.consumer} ──(${l.capability})──▶ [unfulfilled]`
        lines.push(`    ${arrow}`)
      }
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  }

  if (action === 'agents' || action === 'hosts') {
    const probes = driverHub.probeHosts()
    if (jsonMode) {
      return {
        exitCode: 0,
        stdout: serializeWire(wireSuccess('hosts', { hosts: probes })),
        stderr: '',
      }
    }
    const lines = ['Coding Agent Host Drivers:']
    for (const p of probes) {
      const badge = p.detected ? '● READY  ' : '○ ABSENT '
      const bin = p.executablePath ?? '(no binary)'
      lines.push(
        `  ${badge} ${p.hostId.padEnd(13)} ${p.displayName.padEnd(23)} bin: ${bin} | directives: ${p.directivesFile}`,
      )
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  }

  if (action === 'doctor') {
    const nodes = await store.listNodes()
    const diagnostics: Array<{ id: string; healthy: boolean; detail: string }> = []
    for (const n of nodes) {
      try {
        const res = await store.callNode(n, ['capabilities'])
        diagnostics.push({
          id: n.id,
          healthy: res.exitCode === 0 && res.packet.status === 'success',
          detail: res.packet.status === 'success' ? 'wire protocol hubseb/v1 verified' : 'fault response',
        })
      } catch (err) {
        diagnostics.push({
          id: n.id,
          healthy: false,
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const allHealthy = diagnostics.every((d) => d.healthy)
    if (jsonMode) {
      return {
        exitCode: allHealthy ? 0 : 1,
        stdout: serializeWire(wireSuccess('doctor', { allHealthy, diagnostics })),
        stderr: '',
      }
    }
    if (diagnostics.length === 0) {
      return { exitCode: 0, stdout: 'No registered nodes to diagnose.\n', stderr: '' }
    }
    const lines = ['hubseb doctor:']
    for (const d of diagnostics) {
      lines.push(`  ${d.healthy ? '✓' : '✗'} ${d.id} — ${d.detail}`)
    }
    return { exitCode: allHealthy ? 0 : 1, stdout: `${lines.join('\n')}\n`, stderr: '' }
  }

  if (action === 'help' || action === '--help' || action === '-h') {
    const text = [
      `hubseb v${VERSION} — Topology Graph, Signal Bus & Polymorphic Host Drivers`,
      '',
      'Commands:',
      '  hubseb agents [--json]         Probe all 4 host drivers (Antigravity, Claude, Codex, OpenCode)',
      '  hubseb ls [--json]             List registered *seb nodes in topology.json',
      '  hubseb graph [--json]          Visualize the service connection graph between *seb tools',
      '  hubseb doctor [--json]         Verify wire protocol health across all registered nodes',
      '  hubseb capabilities [--json]   Print hubseb/v1 wire capabilities packet',
      '',
    ].join('\n')
    if (jsonMode) {
      return {
        exitCode: 0,
        stdout: serializeWire(
          wireSuccess('help', { commands: ['agents', 'ls', 'graph', 'doctor', 'capabilities'] }),
        ),
        stderr: '',
      }
    }
    return { exitCode: 0, stdout: text, stderr: '' }
  }

  if (jsonMode) {
    return {
      exitCode: 2,
      stdout: serializeWire(
        wireFailure(action, 'UNKNOWN_ACTION', `Unrecognized action "${action}"`, 'Run "hubseb help"'),
      ),
      stderr: '',
    }
  }
  return {
    exitCode: 2,
    stdout: '',
    stderr: `Unrecognized action "${action}". Run "hubseb help".\n`,
  }
}

const isEntry =
  process.argv[1] &&
  (process.argv[1].endsWith('hubseb.ts') ||
    process.argv[1].endsWith('hubseb.js') ||
    process.argv[1].endsWith('/hubseb'))

if (isEntry) {
  executeHubCli(process.argv.slice(2)).then((res) => {
    if (res.stdout) process.stdout.write(res.stdout)
    if (res.stderr) process.stderr.write(res.stderr)
    process.exitCode = res.exitCode
  })
}
