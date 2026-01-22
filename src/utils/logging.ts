/**
 * Logging utilities with ANSI colors
 */

export const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
}

export const SYMBOLS = {
  check: '\u2714',
  cross: '\u2716',
  info: '\u2139',
  warning: '\u26A0',
}

export function logError(message: string): void {
  console.error(
    `${COLORS.red}${SYMBOLS.cross}${COLORS.reset} ${message}`
  )
}

export function logSuccess(message: string): void {
  console.log(
    `${COLORS.green}${SYMBOLS.check}${COLORS.reset} ${message}`
  )
}

export function logWarn(message: string): void {
  console.log(
    `${COLORS.yellow}${SYMBOLS.warning}${COLORS.reset} ${message}`
  )
}

export function logInfo(message: string): void {
  console.log(
    `${COLORS.cyan}${SYMBOLS.info}${COLORS.reset} ${message}`
  )
}

export function logDim(message: string): void {
  console.log(`${COLORS.dim}${message}${COLORS.reset}`)
}

export function getMaskedUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const port = parsed.port || '5432'
    return `${parsed.protocol}//*****@${parsed.hostname}:${port}${parsed.pathname}`
  } catch {
    return '(invalid URL)'
  }
}
