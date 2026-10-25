import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BaseHostDriver } from '../base-driver.ts'
import {
  type BundlePayload,
  filterDialectBlocks,
  type HostId,
  type ReasoningTier,
  resolveHostModel,
  type SpecialistBlueprint,
  type UnitCapability,
} from '../blueprint.ts'

const CLAUDE_TOOL_MAP: Record<UnitCapability, readonly string[]> = {
  'fs:read': ['Read', 'Grep', 'Glob'],
  'fs:write': ['Edit', 'MultiEdit', 'Write'],
  'shell:run': ['Bash'],
  'web:fetch': ['WebFetch'],
  'web:search': ['WebSearch'],
}

const CLAUDE_MODELS: Record<ReasoningTier, string> = {
  fast: 'haiku',
  balanced: 'sonnet',
  deep: 'opus',
}

const CLAUDE_EFFORT: Record<ReasoningTier, string> = {
  fast: 'low',
  balanced: 'medium',
  deep: 'high',
}

export class ClaudeHostDriver extends BaseHostDriver {
  readonly hostId: HostId = 'claude'
  readonly displayName = 'Claude Code'
  readonly binaryName = 'claude'

  get configRoot(): string {
    return this.customRoot ?? path.join(this.runtime.homeDir, '.claude')
  }

  get directivesFile(): string {
    return path.join(this.configRoot, 'CLAUDE.md')
  }

  protected override extraBinarySearchDirs(): string[] {
    return [path.join(this.runtime.homeDir, '.claude', 'local')]
  }

  formatSpecialist(spec: SpecialistBlueprint): { filename: string; content: string } {
    const tools: string[] = []
    for (const cap of spec.capabilities) {
      for (const t of CLAUDE_TOOL_MAP[cap] ?? []) {
        if (!tools.includes(t)) tools.push(t)
      }
    }

    const { model } = resolveHostModel(spec, 'claude')
    const resolvedModel =
      model && model !== 'default'
        ? model.replace(/^(?:ollama|lmstudio)\//, '')
        : CLAUDE_MODELS[spec.tier]

    const lines = [
      '---',
      `name: ${spec.id}`,
      `description: ${JSON.stringify(spec.summary)}`,
      `tools: ${tools.join(', ')}`,
      `model: ${resolvedModel}`,
      `effort: ${CLAUDE_EFFORT[spec.tier]}`,
      `maxTurns: ${spec.maxSteps}`,
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
        const body = filterDialectBlocks(skill.markdownBody, 'claude').trim()
        const content = `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.summary)}\n---\n\n${body}\n`
        const dest = path.join(skillDir, 'SKILL.md')
        await writeFile(dest, content, 'utf8')
        written.push(skillDir)
      }
    }

    return written
  }
}
