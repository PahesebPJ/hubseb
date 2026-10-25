export const SUPPORTED_HOSTS = ['antigravity', 'claude', 'codex', 'opencode'] as const
export type HostId = (typeof SUPPORTED_HOSTS)[number]

export type ReasoningTier = 'fast' | 'balanced' | 'deep'
export type UnitCapability = 'fs:read' | 'fs:write' | 'shell:run' | 'web:fetch' | 'web:search'

export interface SpecialistBlueprint {
  id: string
  summary: string
  tier: ReasoningTier
  capabilities: UnitCapability[]
  maxSteps: number
  instructions: string
}

export interface SkillBlueprint {
  id: string
  summary: string
  markdownBody: string
}

export interface BundlePayload {
  bundleId: string
  version: string
  summary: string
  globalDirectives?: string
  alwaysOnRules?: string
  specialists: SpecialistBlueprint[]
  skills?: SkillBlueprint[]
}

const DIALECT_OPEN_RE = /^:::\s*agent\s+(.+?)\s*$/
const DIALECT_CLOSE_RE = /^:::\s*$/

export function evaluateHostRule(ruleExpr: string, hostId: HostId): boolean {
  const tokens = ruleExpr
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return true

  const aliases = hostId === 'antigravity' ? ['antigravity', 'gemini'] : [hostId]
  const exclusions = tokens.filter((t) => t.startsWith('!')).map((t) => t.slice(1))
  const inclusions = tokens.filter((t) => !t.startsWith('!'))

  if (exclusions.some((ex) => aliases.includes(ex))) return false
  if (inclusions.length > 0) return inclusions.some((inc) => aliases.includes(inc))
  return true
}

export function filterDialectBlocks(markdown: string, hostId: HostId): string {
  const lines = markdown.split(/\r?\n/)
  const output: string[] = []
  let insideConditional = false
  let includeActive = true

  for (const line of lines) {
    if (!insideConditional) {
      const openMatch = DIALECT_OPEN_RE.exec(line)
      if (openMatch) {
        insideConditional = true
        includeActive = evaluateHostRule(openMatch[1] ?? '', hostId)
        continue
      }
      output.push(line)
    } else {
      if (DIALECT_CLOSE_RE.test(line)) {
        insideConditional = false
        includeActive = true
        continue
      }
      if (includeActive) {
        output.push(line)
      }
    }
  }

  return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

const ALL_CAPS: readonly UnitCapability[] = [
  'fs:read',
  'fs:write',
  'shell:run',
  'web:fetch',
  'web:search',
]

export function parseSpecialistMarkdown(rawMarkdown: string, hostId: HostId): SpecialistBlueprint {
  const filtered = filterDialectBlocks(rawMarkdown, hostId)
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(filtered)
  if (!fmMatch) {
    throw new Error('Specialist markdown is missing YAML frontmatter header (---)')
  }

  const headerLines = (fmMatch[1] ?? '').split(/\r?\n/)
  const instructions = (fmMatch[2] ?? '').trim()
  const fields: Record<string, string> = {}

  for (const rawLine of headerLines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    let val = line.slice(sep + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    fields[key] = val
  }

  const id = fields.id ?? fields.name
  const summary = fields.summary ?? fields.description
  if (!id || !summary) {
    throw new Error('Specialist frontmatter must declare "id" and "summary"')
  }

  const tierRaw = (fields.tier ?? 'balanced') as ReasoningTier
  const tier: ReasoningTier =
    tierRaw === 'fast' || tierRaw === 'balanced' || tierRaw === 'deep' ? tierRaw : 'balanced'

  let capabilities: UnitCapability[] = [...ALL_CAPS]
  if (fields.capabilities) {
    const list = fields.capabilities
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!list.includes('*') && !list.includes('all')) {
      capabilities = list.filter((c): c is UnitCapability =>
        (ALL_CAPS as readonly string[]).includes(c),
      )
    }
  }

  const stepsNum = Number(fields.maxSteps ?? fields.maxTurns ?? 40)
  return {
    id,
    summary,
    tier,
    capabilities,
    maxSteps: Number.isNaN(stepsNum) ? 40 : stepsNum,
    instructions,
  }
}
