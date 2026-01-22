/**
 * Environment variable loading utilities
 */

import fs from 'fs/promises'
import path from 'path'

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_, char) => {
    switch (char) {
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'r':
        return '\r'
      case '"':
        return '"'
      case '\\':
        return '\\'
      default:
        return char
    }
  })
}

function parseEnvContent(
  content: string,
  env: Record<string, string>
): void {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim()
        let value = trimmed.slice(eqIndex + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) {
          value = unescapeDoubleQuoted(value.slice(1, -1))
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1)
        }
        env[key] = value
      }
    }
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

/**
 * Load environment variables from .env and .env.local files.
 */
export async function loadEnvFiles(): Promise<Record<string, string>> {
  const cwd = process.cwd()
  const env: Record<string, string> = {}

  const envFile = path.join(cwd, '.env')
  try {
    const content = await fs.readFile(envFile, 'utf-8')
    parseEnvContent(content, env)
  } catch (err) {
    if (!isNodeError(err) || err.code !== 'ENOENT') {
      throw err
    }
    // .env doesn't exist, which is fine
  }

  const envLocalFile = path.join(cwd, '.env.local')
  try {
    const content = await fs.readFile(envLocalFile, 'utf-8')
    parseEnvContent(content, env)
  } catch (err) {
    if (!isNodeError(err) || err.code !== 'ENOENT') {
      throw err
    }
    // .env.local doesn't exist, which is fine
  }

  return env
}

/**
 * Resolve an argument that might be an env: reference.
 */
export function resolveEnvVar(
  arg: string,
  loadedEnv: Record<string, string>
): string | null {
  if (arg.startsWith('env:')) {
    const varName = arg.slice(4)
    return loadedEnv[varName] || process.env[varName] || null
  }
  return arg
}
