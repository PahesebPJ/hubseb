import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AntigravityHostDriver,
  ClaudeHostDriver,
  isAgyTier,
  isEffortLevel,
  parseSpecialistMarkdown,
  resolveHostModel,
  SystemRuntime,
} from '../src/index.ts'

const md = (extra: string) => `---
id: developer
summary: Builds features.
tier: deep
capabilities: [fs:read, fs:write]
${extra}
---

Body.
`

const runtime = new SystemRuntime({ homeDir: '/tmp/hubseb-effort-test' })
const frontmatter = (content: string, key: string) => new RegExp(`^${key}: (.+)$`, 'm').exec(content)?.[1]

describe('per-host effort', () => {
  it('parses effort.<host> and a global effort, ignoring invalid levels', () => {
    const spec = parseSpecialistMarkdown(md('effort: high\neffort.claude: max\neffort.antigravity: turbo'), 'claude')
    assert.equal(spec.effort, 'high')
    assert.deepEqual(spec.hostModels?.claude, { effort: 'max' })
    assert.equal(spec.hostModels?.antigravity, undefined)
    assert.equal(resolveHostModel(spec, 'claude').effort, 'max')
    assert.equal(resolveHostModel(spec, 'codex').effort, 'high', 'falls back to the global effort')
  })

  it('claude driver emits the configured effort, else the tier default', () => {
    const drv = new ClaudeHostDriver(runtime)
    const custom = drv.formatSpecialist(parseSpecialistMarkdown(md('model.claude: claude-opus-5-5\neffort.claude: xhigh'), 'claude'))
    assert.equal(frontmatter(custom.content, 'model'), 'claude-opus-5-5')
    assert.equal(frontmatter(custom.content, 'effort'), 'xhigh')
    const tierOnly = drv.formatSpecialist(parseSpecialistMarkdown(md(''), 'claude'))
    assert.equal(frontmatter(tierOnly.content, 'model'), 'opus')
    assert.equal(frontmatter(tierOnly.content, 'effort'), 'high')
  })

  it('agy driver keeps only native tiers so the loader never skips the agent', () => {
    const drv = new AntigravityHostDriver(runtime)
    const concrete = drv.formatSpecialist(parseSpecialistMarkdown(md('model.antigravity: gemini-4-hydrogen\neffort.antigravity: xhigh'), 'antigravity'))
    assert.equal(frontmatter(concrete.content, 'model'), 'inherit')
    assert.doesNotMatch(concrete.content, /^effort:/m)
    const tier = drv.formatSpecialist(parseSpecialistMarkdown(md('model.antigravity: flash_lite'), 'antigravity'))
    assert.equal(frontmatter(tier.content, 'model'), 'flash_lite')
  })

  it('exposes tier and effort guards', () => {
    assert.ok(isAgyTier('pro') && !isAgyTier('gemini-4-hydrogen-high'))
    assert.ok(isEffortLevel('xhigh') && !isEffortLevel('ultra'))
  })
})
