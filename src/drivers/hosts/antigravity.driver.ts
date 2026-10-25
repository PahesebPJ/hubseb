import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BaseHostDriver } from '../base-driver.ts'
import {
  type BundlePayload,
  filterDialectBlocks,
  type HostId,
  type SpecialistBlueprint,
  type UnitCapability,
} from '../blueprint.ts'

const AGY_TOOL_MAP: Record<UnitCapability, readonly string[]> = {
  'fs:read': ['view_file', 'list_dir', 'grep_search', 'find_by_name'],
  'fs:write': ['replace_file_content', 'multi_replace_file_content', 'write_to_file'],
  'shell:run': ['run_command'],
  'web:fetch': ['read_url_content'],
  'web:search': ['search_web'],
}

export class AntigravityHostDriver extends BaseHostDriver {
  readonly hostId: HostId = 'antigravity'
  readonly displayName = 'Antigravity CLI (agy)'
  readonly binaryName = 'agy'

  get configRoot(): string {
    return this.customRoot ?? path.join(this.runtime.homeDir, '.gemini', 'config')
  }

  get directivesFile(): string {
    return path.join(path.dirname(this.configRoot), 'GEMINI.md')
  }

  protected override extraBinarySearchDirs(): string[] {
    return [path.join(this.runtime.homeDir, '.gemini', 'antigravity-cli', 'bin')]
  }

  formatSpecialist(spec: SpecialistBlueprint): { filename: string; content: string } {
    const tools: string[] = []
    for (const cap of spec.capabilities) {
      for (const t of AGY_TOOL_MAP[cap] ?? []) {
        if (!tools.includes(t)) tools.push(t)
      }
    }

    const lines = [
      '---',
      `name: ${spec.id}`,
      `description: ${JSON.stringify(spec.summary)}`,
      'model: inherit',
      `tools: [${tools.join(', ')}]`,
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

  async buildPluginTree(bundle: BundlePayload, targetDir: string): Promise<string[]> {
    await mkdir(targetDir, { recursive: true })
    const written: string[] = [targetDir]

    const manifest = {
      name: bundle.bundleId,
      version: bundle.version,
      description: bundle.summary,
    }
    const manifestFile = path.join(targetDir, 'plugin.json')
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    written.push(manifestFile)

    if (bundle.specialists.length > 0) {
      const agentsDir = path.join(targetDir, 'agents')
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
        const skillDir = path.join(targetDir, 'skills', skill.id)
        await mkdir(skillDir, { recursive: true })
        const body = filterDialectBlocks(skill.markdownBody, 'antigravity').trim()
        const content = `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.summary)}\n---\n\n${body}\n`
        const dest = path.join(skillDir, 'SKILL.md')
        await writeFile(dest, content, 'utf8')
        written.push(dest)
      }
    }

    if (bundle.alwaysOnRules) {
      const rulesDir = path.join(targetDir, 'rules')
      await mkdir(rulesDir, { recursive: true })
      const rendered = filterDialectBlocks(bundle.alwaysOnRules, 'antigravity').trim()
      const ruleBody = rendered.startsWith('---')
        ? `${rendered}\n`
        : `---\ntrigger: always_on\n---\n\n${rendered}\n`
      const dest = path.join(rulesDir, `${bundle.bundleId}.md`)
      await writeFile(dest, ruleBody, 'utf8')
      written.push(dest)
    }

    return written
  }

  protected async deployHostSpecificAssets(bundle: BundlePayload): Promise<string[]> {
    const pluginRoot = path.join(this.configRoot, 'plugins', bundle.bundleId)
    return this.buildPluginTree(bundle, pluginRoot)
  }
}
