import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { SystemRuntime, TopologyStore } from '../src/index.ts'

describe('hubseb TopologyGraph & Automatic Service Bridge Resolution', () => {
  it('attaches nodes, resolves provides/consumes service links, and dispatches signals', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hubseb-topo-'))
    try {
      const runtime = new SystemRuntime({
        homeDir: tmpDir,
        env: { ...process.env, HUBSEB_HOME: tmpDir },
      })
      const store = new TopologyStore(runtime)

      const signalLog = path.join(tmpDir, 'signal.json')
      const receiverScript = path.join(tmpDir, 'receiver.mjs')
      await writeFile(
        receiverScript,
        [
          'import { readFileSync, writeFileSync } from "node:fs";',
          'const raw = readFileSync(0, "utf8");',
          `writeFileSync(${JSON.stringify(signalLog)}, JSON.stringify({ signal: process.env.HUBSEB_SIGNAL, origin: process.env.HUBSEB_ORIGIN, body: JSON.parse(raw) }));`,
        ].join('\n'),
        'utf8',
      )

      await store.attachNode({
        id: 'crewseb',
        version: '0.2.0',
        summary: 'Specialist crew',
        command: [process.execPath, receiverScript],
        provides: ['crew.specialists', 'crew.personas'],
        consumes: ['memory.vault', 'docs.engine'],
        signals: ['personas.rerolled'],
      })

      await store.attachNode({
        id: 'memseb',
        version: '0.1.0',
        summary: 'Local memory vault',
        command: [process.execPath, receiverScript],
        provides: ['memory.vault'],
        consumes: ['crew.personas'],
        triggers: [
          {
            fromNode: 'crewseb',
            signals: ['personas.rerolled'],
            match: { scope: 'full' },
            handlerCommand: [process.execPath, receiverScript],
          },
        ],
      })

      const links = await store.resolveServiceLinks()
      const connectedVault = links.find(
        (l) => l.consumer === 'crewseb' && l.capability === 'memory.vault',
      )
      assert.ok(connectedVault)
      assert.equal(connectedVault.provider, 'memseb')
      assert.equal(connectedVault.status, 'connected')

      const unfulfilledDocs = links.find(
        (l) => l.consumer === 'crewseb' && l.capability === 'docs.engine',
      )
      assert.ok(unfulfilledDocs)
      assert.equal(unfulfilledDocs.status, 'unfulfilled')

      // Broadcast signal from crewseb -> memseb
      const dispatched = await store.broadcastSignal('crewseb', 'personas.rerolled', {
        scope: 'full',
        count: 10,
      })
      assert.equal(dispatched.length, 1)
      assert.equal(dispatched[0]?.listenerId, 'memseb')
      assert.equal(dispatched[0]?.exitCode, 0)

      const logged = JSON.parse(await readFile(signalLog, 'utf8'))
      assert.equal(logged.signal, 'personas.rerolled')
      assert.equal(logged.origin, 'crewseb')
      assert.equal(logged.body.data.count, 10)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
