import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface RuntimeConfig {
  platform?: NodeJS.Platform
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

export interface ProcessOutcome {
  exitCode: number
  stdout: string
  stderr: string
}

export class SystemRuntime {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly env: NodeJS.ProcessEnv

  constructor(config: RuntimeConfig = {}) {
    this.platform = config.platform ?? process.platform
    this.homeDir = config.homeDir ?? os.homedir()
    this.env = config.env ?? process.env
  }

  get configRoot(): string {
    if (this.env.HUBSEB_HOME) return path.resolve(this.env.HUBSEB_HOME)
    if (this.platform === 'win32') {
      const appData = this.env.APPDATA || path.join(this.homeDir, 'AppData', 'Roaming')
      return path.join(appData, 'hubseb')
    }
    const xdg = this.env.XDG_CONFIG_HOME || path.join(this.homeDir, '.config')
    return path.join(xdg, 'hubseb')
  }

  get stateRoot(): string {
    if (this.env.HUBSEB_HOME) return path.join(path.resolve(this.env.HUBSEB_HOME), 'state')
    if (this.platform === 'win32') {
      const localAppData = this.env.LOCALAPPDATA || path.join(this.homeDir, 'AppData', 'Local')
      return path.join(localAppData, 'hubseb')
    }
    const xdg = this.env.XDG_DATA_HOME || path.join(this.homeDir, '.local', 'share')
    return path.join(xdg, 'hubseb')
  }

  get topologyFile(): string {
    return path.join(this.configRoot, 'topology.json')
  }

  get locksDir(): string {
    return path.join(this.stateRoot, 'locks')
  }

  get stagingDir(): string {
    return path.join(this.stateRoot, 'staging')
  }

  sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
  }

  locateBinary(binaryName: string, extraDirs: readonly string[] = []): string | null {
    const extensions = this.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']

    if (path.isAbsolute(binaryName)) {
      for (const ext of extensions) {
        const candidate = `${binaryName}${ext}`
        if (this.canExecute(candidate)) return candidate
      }
      return null
    }

    const candidates = new Set<string>()
    for (const part of (this.env.PATH ?? '').split(path.delimiter)) {
      if (part.trim()) candidates.add(part.trim())
    }

    if (this.platform === 'win32') {
      if (this.env.APPDATA) candidates.add(path.join(this.env.APPDATA, 'npm'))
      if (this.env.LOCALAPPDATA) {
        candidates.add(path.join(this.env.LOCALAPPDATA, 'Volta', 'bin'))
        candidates.add(path.join(this.env.LOCALAPPDATA, 'pnpm'))
      }
    } else {
      candidates.add(path.join(this.homeDir, '.local', 'bin'))
      candidates.add(path.join(this.homeDir, '.npm-global', 'bin'))
      candidates.add(path.join(this.homeDir, '.local', 'share', 'pnpm'))
      candidates.add('/usr/local/bin')
      candidates.add('/usr/bin')
      candidates.add('/bin')
    }

    const nvmRoot = path.join(this.homeDir, '.nvm', 'versions', 'node')
    if (existsSync(nvmRoot)) {
      try {
        for (const v of readdirSync(nvmRoot).sort().reverse()) {
          candidates.add(path.join(nvmRoot, v, 'bin'))
        }
      } catch {
        // ignore unreadable directory
      }
    }

    for (const extra of extraDirs) {
      candidates.add(extra)
    }

    for (const dir of candidates) {
      for (const ext of extensions) {
        const fullPath = path.join(dir, `${binaryName}${ext}`)
        if (this.canExecute(fullPath)) return fullPath
      }
    }
    return null
  }

  private canExecute(filePath: string): boolean {
    try {
      accessSync(filePath, this.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  async execProcess(
    executable: string,
    args: readonly string[] = [],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
  ): Promise<ProcessOutcome> {
    return new Promise((resolve, reject) => {
      const needsShell = this.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)
      const child = spawn(executable, [...args], {
        cwd: options.cwd,
        env: options.env ?? this.env,
        shell: needsShell,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let timer: NodeJS.Timeout | undefined

      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      child.on('error', (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      })

      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })

      if (options.input !== undefined) {
        child.stdin.write(options.input)
      }
      child.stdin.end()
    })
  }
}
