import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BaseHostDriver } from '../base-driver.ts'
import {
  type BundlePayload,
  filterDialectBlocks,
  type HostId,
  type ReasoningTier,
  type SpecialistBlueprint,
} from '../blueprint.ts'

const CODEX_EFFORT: Record<ReasoningTier, string> = {
  fast: 'low',
  balanced: 'medium',
  deep: 'high',
}

export class CodexHostDriver extends BaseHostDriver {
  readonly hostId: HostId = 'codex'
  readonly displayName = 'OpenAI Codex CLI'
  readonly binaryName = 'codex'

  get configRoot(): string {
    return this.customRoot ?? path.join(this.runtime.homeDir, '.codex')
  }

  get directivesFile(): string {
    return path.join(this.configRoot, 'AGENTS.md')
  }

  formatSpecialist(spec: SpecialistBlueprint): { filename: string; content: string } {
    const hasShell = spec.capabilities.includes('shell:run')
    const safeInstructions = spec.instructions.replace(/"""/g, '\\"\\"\\"')

    const lines = [
      `name = ${JSON.stringify(spec.id)}`,
      `description = ${JSON.stringify(spec.summary)}`,
      `model_reasoning_effort = ${JSON.stringify(CODEX_EFFORT[spec.tier])}`,
      `developer_instructions = """\n${safeInstructions}\n"""`,
      '',
      '[features]',
      `shell_tool = ${hasShell ? 'true' : 'false'}`,
      '',
    ]

    return {
      filename: `${spec.id}.toml`,
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
        const body = filterDialectBlocks(skill.markdownBody, 'codex').trim()
        const content = `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.summary)}\n---\n\n${body}\n`
        const dest = path.join(skillDir, 'SKILL.md')
        await writeFile(dest, content, 'utf8')
        written.push(skillDir)
      }
    }

    return written
  }
}
