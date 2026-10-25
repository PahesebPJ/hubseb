import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BaseHostDriver } from '../base-driver.ts'
import {
  type BundlePayload,
  filterDialectBlocks,
  type HostId,
  type SpecialistBlueprint,
} from '../blueprint.ts'

export class OpenCodeHostDriver extends BaseHostDriver {
  readonly hostId: HostId = 'opencode'
  readonly displayName = 'OpenCode CLI'
  readonly binaryName = 'opencode'

  get configRoot(): string {
    if (this.customRoot) return this.customRoot
    const xdg = this.runtime.env.XDG_CONFIG_HOME || path.join(this.runtime.homeDir, '.config')
    return path.join(xdg, 'opencode')
  }

  get directivesFile(): string {
    return path.join(this.configRoot, 'AGENTS.md')
  }

  protected override extraBinarySearchDirs(): string[] {
    return [path.join(this.runtime.homeDir, '.opencode', 'bin')]
  }

  formatSpecialist(spec: SpecialistBlueprint): { filename: string; content: string } {
    const canWrite = spec.capabilities.includes('fs:write')
    const canShell = spec.capabilities.includes('shell:run')
    const canFetch = spec.capabilities.includes('web:fetch')
    const canSearch = spec.capabilities.includes('web:search')

    const lines = [
      '---',
      `description: ${JSON.stringify(spec.summary)}`,
      'mode: subagent',
      `steps: ${spec.maxSteps}`,
      'permission:',
      `  edit: ${canWrite ? 'allow' : 'deny'}`,
      `  bash: ${canShell ? 'allow' : 'deny'}`,
      `  webfetch: ${canFetch ? 'allow' : 'deny'}`,
      `  websearch: ${canSearch ? 'allow' : 'deny'}`,
      '---',
      '',
      spec.instructions,
      '',
    ]

    return {
      filename: `${spec.id}.md`,
      content: lines.join('\n'),
    }
  }

  protected async deployHostSpecificAssets(bundle: BundlePayload): Promise<string[]> {
    const written: string[] = []

    if (bundle.specialists.length > 0) {
      const agentsDir = path.join(this.configRoot, 'agents')
      await mkdir(agentsDir, { recursive: true })
      for (const spec of bundle.specialists) {
        const formatted = this.formatSpecialist(spec)
        const dest = path.join(agentsDir, formatted.filename)
        await writeFile(dest, formatted.content, 'utf8')
        written.push(dest)
      }
    }

    if (bundle.skills && bundle.skills.length > 0) {
      for (const skill of bundle.skills) {
        const skillDir = path.join(this.configRoot, 'skills', skill.id)
        await mkdir(skillDir, { recursive: true })
        const body = filterDialectBlocks(skill.markdownBody, 'opencode').trim()
        const content = `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.summary)}\n---\n\n${body}\n`
        const dest = path.join(skillDir, 'SKILL.md')
        await writeFile(dest, content, 'utf8')
        written.push(skillDir)
      }
    }

    return written
  }
}
