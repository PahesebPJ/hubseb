import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SystemRuntime } from './runtime.ts'
import { decodeWire, type WirePacket } from './wire.ts'

export interface SignalTrigger {
  fromNode: string
  signals: string[]
  match?: Record<string, string | string[]>
  handlerCommand: string[]
}

export interface ToolNode {
  id: string
  version: string
  summary: string
  command: string[]
  provides: string[]
  consumes: string[]
  signals: string[]
  triggers: SignalTrigger[]
  registeredAt: string
}

export interface ToolNodeRegistration {
  id: string
  version: string
  summary?: string
  command: string[]
  provides?: string[]
  consumes?: string[]
  signals?: string[]
  triggers?: SignalTrigger[]
}

export interface ServiceLink {
  consumer: string
  provider: string
  capability: string
  status: 'connected' | 'unfulfilled'
}

export interface TopologyGraph {
  schema: 'hubseb-topology/v1'
  updatedAt: string
  nodes: Record<string, ToolNode>
}

export interface SignalDispatchReport {
  listenerId: string
  exitCode: number
  stdout: string
  stderr: string
}

export class TopologyStore {
  readonly runtime: SystemRuntime

  constructor(runtime: SystemRuntime = new SystemRuntime()) {
    this.runtime = runtime
  }

  async loadGraph(): Promise<TopologyGraph> {
    const file = this.runtime.topologyFile
    if (!existsSync(file)) {
      return {
        schema: 'hubseb-topology/v1',
        updatedAt: new Date().toISOString(),
        nodes: {},
      }
    }
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as TopologyGraph
      if (raw && raw.schema === 'hubseb-topology/v1' && typeof raw.nodes === 'object') {
        return raw
      }
    } catch {
      // fallback to empty graph if corrupted
    }
    return {
      schema: 'hubseb-topology/v1',
      updatedAt: new Date().toISOString(),
      nodes: {},
    }
  }

  private async saveGraph(graph: TopologyGraph): Promise<string> {
    const file = this.runtime.topologyFile
    await mkdir(path.dirname(file), { recursive: true })
    graph.updatedAt = new Date().toISOString()
    await writeFile(file, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
    return file
  }

  async attachNode(input: ToolNodeRegistration): Promise<{ file: string; node: ToolNode }> {
    if (!/^[a-z0-9-]+$/.test(input.id)) {
      throw new Error(`Invalid node id "${input.id}"`)
    }
    if (!input.command || input.command.length === 0) {
      throw new Error(`Node "${input.id}" requires a non-empty command array`)
    }

    const graph = await this.loadGraph()
    const node: ToolNode = {
      id: input.id,
      version: input.version,
      summary: input.summary ?? `${input.id} tool`,
      command: [...input.command],
      provides: [...(input.provides ?? [])],
      consumes: [...(input.consumes ?? [])],
      signals: [...(input.signals ?? [])],
      triggers: [...(input.triggers ?? [])],
      registeredAt: new Date().toISOString(),
    }

    graph.nodes[node.id] = node
    const file = await this.saveGraph(graph)
    return { file, node }
  }

  async detachNode(nodeId: string): Promise<boolean> {
    const graph = await this.loadGraph()
    if (!graph.nodes[nodeId]) return false
    delete graph.nodes[nodeId]
    await this.saveGraph(graph)
    return true
  }

  async listNodes(): Promise<ToolNode[]> {
    const graph = await this.loadGraph()
    return Object.values(graph.nodes).sort((a, b) => a.id.localeCompare(b.id))
  }

  async findProvider(capability: string): Promise<ToolNode | null> {
    const nodes = await this.listNodes()
    return nodes.find((n) => n.provides.includes(capability)) ?? null
  }

  async getNode(nodeId: string): Promise<ToolNode | null> {
    const graph = await this.loadGraph()
    return graph.nodes[nodeId] ?? null
  }

  /**
   * Automatically computes service links between all registered *seb tools
   * by matching `consumes` declarations against `provides` capabilities.
   */
  async resolveServiceLinks(): Promise<ServiceLink[]> {
    const nodes = await this.listNodes()
    const links: ServiceLink[] = []

    for (const consumer of nodes) {
      for (const neededCap of consumer.consumes) {
        const providers = nodes.filter(
          (candidate) => candidate.id !== consumer.id && candidate.provides.includes(neededCap),
        )
        if (providers.length > 0) {
          for (const provider of providers) {
            links.push({
              consumer: consumer.id,
              provider: provider.id,
              capability: neededCap,
              status: 'connected',
            })
          }
        } else {
          links.push({
            consumer: consumer.id,
            provider: '(none)',
            capability: neededCap,
            status: 'unfulfilled',
          })
        }
      }
    }

    return links
  }

  async callNode<TPayload = unknown>(
    node: ToolNode,
    args: readonly string[],
  ): Promise<{ exitCode: number; packet: WirePacket<TPayload> }> {
    const [exe, ...baseArgs] = node.command
    if (!exe) throw new Error(`Node "${node.id}" has an empty command`)
    const finalArgs = [...baseArgs, ...args]
    if (!finalArgs.includes('--json')) finalArgs.push('--json')

    const res = await this.runtime.execProcess(exe, finalArgs, { timeoutMs: 10_000 })
    const packet = decodeWire<TPayload>(res.stdout)
    return { exitCode: res.exitCode, packet }
  }

  async broadcastSignal(
    sourceNodeId: string,
    signalName: string,
    data: Record<string, unknown>,
  ): Promise<SignalDispatchReport[]> {
    if (this.runtime.env.HUBSEB_MUTE_SIGNALS === '1') return []

    const nodes = await this.listNodes()
    const reports: SignalDispatchReport[] = []
    const envelope = JSON.stringify({
      origin: sourceNodeId,
      signal: signalName,
      emittedAt: Date.now(),
      data,
    })

    for (const listener of nodes) {
      for (const trigger of listener.triggers) {
        if (trigger.fromNode !== sourceNodeId) continue
        if (!trigger.signals.includes(signalName) && !trigger.signals.includes('*')) continue
        if (!this.matchesCriteria(data, trigger.match)) continue

        const [exe, ...args] = trigger.handlerCommand
        if (!exe) continue
        try {
          const outcome = await this.runtime.execProcess(exe, args, {
            input: `${envelope}\n`,
            env: {
              ...this.runtime.env,
              HUBSEB_SIGNAL: signalName,
              HUBSEB_ORIGIN: sourceNodeId,
              HUBSEB_MUTE_SIGNALS: '1',
            },
            timeoutMs: 15_000,
          })
          reports.push({
            listenerId: listener.id,
            exitCode: outcome.exitCode,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
          })
        } catch (err) {
          reports.push({
            listenerId: listener.id,
            exitCode: 1,
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    return reports
  }

  private matchesCriteria(
    data: Record<string, unknown>,
    match?: Record<string, string | string[]>,
  ): boolean {
    if (!match) return true
    for (const [key, expected] of Object.entries(match)) {
      const val = data[key]
      if (val === undefined || val === null) return false
      const str = String(val)
      if (Array.isArray(expected)) {
        if (!expected.includes(str)) return false
      } else if (str !== expected) {
        return false
      }
    }
    return true
  }
}
