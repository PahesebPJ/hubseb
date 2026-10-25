import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SystemRuntime } from '../core/runtime.ts'
import {
  type BundlePayload,
  filterDialectBlocks,
  type HostId,
  type SpecialistBlueprint,
} from './blueprint.ts'

export interface HostProbe {
  hostId: HostId
  displayName: string
  detected: boolean
  executablePath: string | null
  configRoot: string
  directivesFile: string
}

export interface DeploymentReceipt {
  hostId: HostId
  bundleId: string
  version: string
  deployedAt: string
  directivesHash: string | null
  writtenPaths: string[]
}

export type IntegrityStatus = 'verified' | 'drifted' | 'absent'

export interface HostIntegrityReport {
  hostId: HostId
  directivesFile: string
  status: IntegrityStatus
  expectedHash: string
  actualHash: string | null
}

export abstract class BaseHostDriver {
  abstract readonly hostId: HostId
  abstract readonly displayName: string
  abstract readonly binaryName: string

  readonly runtime: SystemRuntime
  readonly customRoot?: string

  constructor(runtime: SystemRuntime, customRoot?: string) {
    this.runtime = runtime
    this.customRoot = customRoot
  }

  abstract get configRoot(): string
  abstract get directivesFile(): string
  abstract formatSpecialist(spec: SpecialistBlueprint): { filename: string; content: string }
  protected abstract deployHostSpecificAssets(bundle: BundlePayload): Promise<string[]>

  protected extraBinarySearchDirs(): string[] {
    return []
  }

  probe(): HostProbe {
    const exe = this.runtime.locateBinary(this.binaryName, this.extraBinarySearchDirs())
    const rootExists = existsSync(this.configRoot)
    return {
      hostId: this.hostId,
      displayName: this.displayName,
      detected: Boolean(exe) || rootExists,
      executablePath: exe,
      configRoot: this.configRoot,
      directivesFile: this.directivesFile,
    }
  }

  private lockfilePath(bundleId: string): string {
    return path.join(this.runtime.locksDir, `${this.hostId}-${bundleId}.lock.json`)
  }

  private openTag(bundleId: string, hash: string): string {
    return `<!-- [hubseb:bundle=${bundleId} sha256=${hash}] -->`
  }

  private closeTag(bundleId: string): string {
    return `<!-- [/hubseb:bundle=${bundleId}] -->`
  }

  private openPattern(bundleId: string): RegExp {
    return new RegExp(`<!-- \\[hubseb:bundle=${bundleId} sha256=([a-f0-9]+)\\] -->`)
  }

  async syncDirectives(bundleId: string, rawDirectives: string): Promise<string> {
    const rendered = filterDialectBlocks(rawDirectives, this.hostId).trim()
    const hash = this.runtime.sha256(rendered)
    const targetFile = this.directivesFile
    await mkdir(path.dirname(targetFile), { recursive: true })

    const existing = existsSync(targetFile) ? await readFile(targetFile, 'utf8') : ''
    const openRegex = this.openPattern(bundleId)
    const closeMarker = this.closeTag(bundleId)
    const blockText = `${this.openTag(bundleId, hash)}\n${rendered}\n${closeMarker}`

    const openMatch = openRegex.exec(existing)
    if (openMatch && openMatch[1] === hash) {
      return hash
    }

    if (existing.trim().length > 0) {
      await copyFile(targetFile, `${targetFile}.backup`)
    }

    let nextContent: string
    const closeIdx = openMatch ? existing.indexOf(closeMarker, openMatch.index) : -1
    if (openMatch && closeIdx !== -1) {
      const prefix = existing.slice(0, openMatch.index)
      const suffix = existing.slice(closeIdx + closeMarker.length)
      nextContent = `${prefix}${blockText}${suffix}`
    } else {
      const base = existing.trimEnd()
      nextContent = base.length > 0 ? `${base}\n\n${blockText}\n` : `${blockText}\n`
    }

    await writeFile(
      targetFile,
      nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`,
      'utf8',
    )
    return hash
  }

  async removeDirectives(bundleId: string): Promise<boolean> {
    const targetFile = this.directivesFile
    if (!existsSync(targetFile)) return false

    const existing = await readFile(targetFile, 'utf8')
    const openMatch = this.openPattern(bundleId).exec(existing)
    if (!openMatch) return false

    const closeMarker = this.closeTag(bundleId)
    const closeIdx = existing.indexOf(closeMarker, openMatch.index)
    if (closeIdx === -1) return false

    const prefix = existing.slice(0, openMatch.index).trimEnd()
    const suffix = existing.slice(closeIdx + closeMarker.length).trimStart()
    const nextContent =
      prefix && suffix ? `${prefix}\n\n${suffix}\n` : prefix ? `${prefix}\n` : suffix ? `${suffix}\n` : ''

    await copyFile(targetFile, `${targetFile}.backup`)
    await writeFile(targetFile, nextContent, 'utf8')
    return true
  }

  async auditDirectives(bundleId: string, rawDirectives: string): Promise<HostIntegrityReport> {
    const rendered = filterDialectBlocks(rawDirectives, this.hostId).trim()
    const expectedHash = this.runtime.sha256(rendered)
    const targetFile = this.directivesFile

    if (!existsSync(targetFile)) {
      return {
        hostId: this.hostId,
        directivesFile: targetFile,
        status: 'absent',
        expectedHash,
        actualHash: null,
      }
    }

    const content = await readFile(targetFile, 'utf8')
    const openMatch = this.openPattern(bundleId).exec(content)
    const closeMarker = this.closeTag(bundleId)
    if (!openMatch) {
      return {
        hostId: this.hostId,
        directivesFile: targetFile,
        status: 'absent',
        expectedHash,
        actualHash: null,
      }
    }

    const closeIdx = content.indexOf(closeMarker, openMatch.index)
    if (closeIdx === -1) {
      return {
        hostId: this.hostId,
        directivesFile: targetFile,
        status: 'drifted',
        expectedHash,
        actualHash: null,
      }
    }

    const innerBody = content.slice(openMatch.index + openMatch[0].length, closeIdx).trim()
    const actualHash = this.runtime.sha256(innerBody)
    return {
      hostId: this.hostId,
      directivesFile: targetFile,
      status: actualHash === expectedHash ? 'verified' : 'drifted',
      expectedHash,
      actualHash,
    }
  }

  async deployBundle(bundle: BundlePayload): Promise<DeploymentReceipt> {
    let directivesHash: string | null = null
    if (bundle.globalDirectives) {
      directivesHash = await this.syncDirectives(bundle.bundleId, bundle.globalDirectives)
    }

    const writtenPaths = await this.deployHostSpecificAssets(bundle)
    const receipt: DeploymentReceipt = {
      hostId: this.hostId,
      bundleId: bundle.bundleId,
      version: bundle.version,
      deployedAt: new Date().toISOString(),
      directivesHash,
      writtenPaths,
    }

    const lockPath = this.lockfilePath(bundle.bundleId)
    await mkdir(path.dirname(lockPath), { recursive: true })
    await writeFile(lockPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    return receipt
  }

  async purgeBundle(bundleId: string): Promise<{ removedPaths: string[]; directivesRemoved: boolean }> {
    const directivesRemoved = await this.removeDirectives(bundleId)
    const lockPath = this.lockfilePath(bundleId)
    const removedPaths: string[] = []

    if (existsSync(lockPath)) {
      try {
        const receipt = JSON.parse(await readFile(lockPath, 'utf8')) as DeploymentReceipt
        for (const p of receipt.writtenPaths ?? []) {
          if (existsSync(p)) {
            await rm(p, { recursive: true, force: true })
            removedPaths.push(p)
          }
        }
      } catch {
        // ignore invalid lockfile
      }
      await rm(lockPath, { force: true })
    }

    return { removedPaths, directivesRemoved }
  }
}
