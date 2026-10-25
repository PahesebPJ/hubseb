import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  type BundlePayload,
  DriverHub,
  parseSpecialistMarkdown,
  SUPPORTED_HOSTS,
  SystemRuntime,
} from '../src/index.ts'

const SAMPLE_ANALYST_MD = `---
id: analyst
summary: Especialista en descubrimiento funcional y especificación.
tier: balanced
capabilities: [fs:read, shell:run, web:fetch]
maxSteps: 30
---

## Misión Operativa
Eres el analista de la tripulación.
`

describe('hubseb Polymorphic Host Drivers & SHA-256 Lockfile Deployer', () => {
  it('deploys bundle across all 4 host drivers, verifies SHA-256 directives hash, and purges via lockfile', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hubseb-drv-'))
    try {
      const runtime = new SystemRuntime({
        homeDir: tmpDir,
        env: { ...process.env, HUBSEB_HOME: path.join(tmpDir, '.hubseb') },
      })

      const roots = {
        antigravity: path.join(tmpDir, '.gemini', 'config'),
        claude: path.join(tmpDir, '.claude'),
        codex: path.join(tmpDir, '.codex'),
        opencode: path.join(tmpDir, '.config', 'opencode'),
      }

      // Pre-populate CLAUDE.md with user's hand-written notes
      await mkdir(roots.claude, { recursive: true })
      await writeFile(path.join(roots.claude, 'CLAUDE.md'), '# Notas del Usuario\nPreservar siempre.\n', 'utf8')

      const hub = new DriverHub(runtime, roots)
      const specialist = parseSpecialistMarkdown(SAMPLE_ANALYST_MD, 'claude')

      const bundle: BundlePayload = {
        bundleId: 'crewseb',
        version: '0.2.0',
        summary: 'Crewseb specialist subagents',
        globalDirectives: '# Directivas Globales\n::: agent claude\nSolo Claude\n:::\n::: agent !claude\nOtros Hosts\n:::\n',
        alwaysOnRules: '# Regla activa en Antigravity',
        specialists: [specialist],
        skills: [
          {
            id: 'crewseb',
            summary: 'Orquestador de tripulación',
            markdownBody: '# Ejecuta la cadena',
          },
        ],
      }

      const receipts = await hub.deployToHosts(bundle, SUPPORTED_HOSTS)
      assert.equal(receipts.length, 4)

      // Audit SHA-256 integrity across all 4 hosts
      const audits = await hub.auditHosts('crewseb', bundle.globalDirectives!, SUPPORTED_HOSTS)
      for (const report of audits) {
        assert.equal(report.status, 'verified', `Expected verified hash on ${report.hostId}`)
      }

      // Check signed header in CLAUDE.md
      const claudeContent = await readFile(path.join(roots.claude, 'CLAUDE.md'), 'utf8')
      assert.match(claudeContent, /# Notas del Usuario/)
      assert.match(claudeContent, /<!-- \[hubseb:bundle=crewseb sha256=[a-f0-9]{16}\] -->/)
      assert.match(claudeContent, /Solo Claude/)
      assert.doesNotMatch(claudeContent, /Otros Hosts/)

      // Check files written by each driver
      assert.ok(existsSync(path.join(roots.antigravity, 'plugins', 'crewseb', 'plugin.json')))
      assert.ok(existsSync(path.join(roots.antigravity, 'plugins', 'crewseb', 'agents', 'analyst.md')))
      assert.ok(existsSync(path.join(roots.claude, 'agents', 'analyst.md')))
      assert.ok(existsSync(path.join(roots.codex, 'agents', 'analyst.toml')))
      assert.ok(existsSync(path.join(roots.opencode, 'agents', 'analyst.md')))

      // Purge using lockfiles
      await hub.purgeFromHosts('crewseb', SUPPORTED_HOSTS)

      assert.equal(existsSync(path.join(roots.antigravity, 'plugins', 'crewseb')), false)
      assert.equal(existsSync(path.join(roots.claude, 'agents', 'analyst.md')), false)
      assert.equal(existsSync(path.join(roots.codex, 'agents', 'analyst.toml')), false)
      assert.equal(existsSync(path.join(roots.opencode, 'agents', 'analyst.md')), false)

      const claudeAfter = await readFile(path.join(roots.claude, 'CLAUDE.md'), 'utf8')
      assert.match(claudeAfter, /# Notas del Usuario/)
      assert.doesNotMatch(claudeAfter, /hubseb:bundle=crewseb/)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
