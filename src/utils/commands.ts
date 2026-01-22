/**
 * Command execution utilities
 */

import { spawn } from 'child_process'

export interface CommandResult {
  stdout: string
  stderr: string
  code: number
}

export interface CommandOptions {
  silent?: boolean
  cwd?: string
}

/**
 * Run a command asynchronously without shell interpolation.
 */
export function runCommandAsync(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      stdio: options.silent ? 'pipe' : ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (err) => {
      reject(err)
    })

    child.on('close', (code) => {
      const exitCode = code ?? 1
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: exitCode,
      })
    })
  })
}

/**
 * Run a command that we expect to succeed, throw if it fails.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<string> {
  const result = await runCommandAsync(command, args, options)
  if (result.code !== 0) {
    throw new Error(
      result.stderr || `Command failed with code ${result.code}`
    )
  }
  return result.stdout
}

/**
 * Check if a command succeeds without throwing.
 */
export async function commandSucceeds(
  command: string,
  args: string[]
): Promise<boolean> {
  try {
    const result = await runCommandAsync(command, args, { silent: true })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if a tool exists in PATH.
 */
export async function toolExists(tool: string): Promise<boolean> {
  return commandSucceeds('which', [tool])
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
