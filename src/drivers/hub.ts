import { SystemRuntime } from '../core/runtime.ts'
import {
  BaseHostDriver,
  type DeploymentReceipt,
  type HostIntegrityReport,
  type HostProbe,
} from './base-driver.ts'
import {
  type BundlePayload,
  type HostId,
  parseSpecialistMarkdown,
  SUPPORTED_HOSTS,
} from './blueprint.ts'
import { AntigravityHostDriver } from './hosts/antigravity.driver.ts'
import { ClaudeHostDriver } from './hosts/claude.driver.ts'
import { CodexHostDriver } from './hosts/codex.driver.ts'
import { OpenCodeHostDriver } from './hosts/opencode.driver.ts'

export * from './base-driver.ts'
export * from './blueprint.ts'
export {
  AntigravityHostDriver,
  ClaudeHostDriver,
  CodexHostDriver,
  OpenCodeHostDriver,
}

export type HostRootOverrides = Partial<Record<HostId, string>>

export class DriverHub {
  readonly runtime: SystemRuntime
  private readonly drivers: Map<HostId, BaseHostDriver>

  constructor(
    runtime: SystemRuntime = new SystemRuntime(),
    rootOverrides: HostRootOverrides = {},
  ) {
    this.runtime = runtime
    this.drivers = new Map<HostId, BaseHostDriver>([
      ['antigravity', new AntigravityHostDriver(runtime, rootOverrides.antigravity)],
      ['claude', new ClaudeHostDriver(runtime, rootOverrides.claude)],
      ['codex', new CodexHostDriver(runtime, rootOverrides.codex)],
      ['opencode', new OpenCodeHostDriver(runtime, rootOverrides.opencode)],
    ])
  }

  getDriver(hostId: HostId): BaseHostDriver {
    const drv = this.drivers.get(hostId)
    if (!drv) throw new Error(`Unsupported host driver: "${hostId}"`)
    return drv
  }

  probeHosts(): HostProbe[] {
    return SUPPORTED_HOSTS.map((id) => this.getDriver(id).probe())
  }

  detectedHostIds(): HostId[] {
    return this.probeHosts()
      .filter((p) => p.detected)
      .map((p) => p.hostId)
  }

  compileSpecialistForHost(
    rawMarkdown: string,
    hostId: HostId,
  ): { filename: string; content: string } {
    const spec = parseSpecialistMarkdown(rawMarkdown, hostId)
    return this.getDriver(hostId).formatSpecialist(spec)
  }

  async deployToHosts(
    bundle: BundlePayload,
    targetHosts?: readonly HostId[],
  ): Promise<DeploymentReceipt[]> {
    const hosts = targetHosts ?? this.detectedHostIds()
    const receipts: DeploymentReceipt[] = []
    for (const hostId of hosts) {
      receipts.push(await this.getDriver(hostId).deployBundle(bundle))
    }
    return receipts
  }

  async purgeFromHosts(
    bundleId: string,
    targetHosts?: readonly HostId[],
  ): Promise<Array<{ hostId: HostId; removedPaths: string[]; directivesRemoved: boolean }>> {
    const hosts = targetHosts ?? SUPPORTED_HOSTS
    const results: Array<{ hostId: HostId; removedPaths: string[]; directivesRemoved: boolean }> = []
    for (const hostId of hosts) {
      const res = await this.getDriver(hostId).purgeBundle(bundleId)
      results.push({ hostId, ...res })
    }
    return results
  }

  async auditHosts(
    bundleId: string,
    rawDirectives: string,
    targetHosts?: readonly HostId[],
  ): Promise<HostIntegrityReport[]> {
    const hosts = targetHosts ?? this.detectedHostIds()
    const reports: HostIntegrityReport[] = []
    for (const hostId of hosts) {
      reports.push(await this.getDriver(hostId).auditDirectives(bundleId, rawDirectives))
    }
    return reports
  }
}
