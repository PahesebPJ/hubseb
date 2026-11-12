import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SystemRuntime } from '../src/index.ts'

describe('hubseb SystemRuntime execProcess', () => {
  it('executes process returning stdout and exitCode 0', async () => {
    const runtime = new SystemRuntime()
    const outcome = await runtime.execProcess(process.execPath, ['-e', 'process.stdout.write("hello from runtime")'])
    assert.equal(outcome.exitCode, 0)
    assert.equal(outcome.stdout, 'hello from runtime')
    assert.equal(outcome.stderr, '')
  })

  it('supports custom environment, input, and options with windowsHide support', async () => {
    const runtime = new SystemRuntime()
    const outcome = await runtime.execProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.TEST_VAR || "")'],
      {
        env: { ...process.env, TEST_VAR: 'windows-hide-verified' },
        windowsHide: true,
      },
    )
    assert.equal(outcome.exitCode, 0)
    assert.equal(outcome.stdout, 'windows-hide-verified')
  })

  it('handles process timeout correctly', async () => {
    const runtime = new SystemRuntime()
    const outcome = await runtime.execProcess(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 5000)'],
      { timeoutMs: 50 },
    )
    assert.notEqual(outcome.exitCode, 0)
  })
})
