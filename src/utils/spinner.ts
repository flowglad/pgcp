/**
 * Terminal spinner with bouncing dots animation
 */

import { COLORS, SYMBOLS } from './logging.js'

const SPINNER_FRAMES = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
]

const BOUNCING_DOTS = [
  '...',
  '...',
  '...',
  '...',
  '...',
  '...',
  '...',
  '\u00B7..',
  '.\u00B7.',
  '..\u00B7',
]

class Spinner {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private spinnerIndex = 0
  private dotsIndex = 0
  private baseMessage = ''
  private isRunning = false

  start(message: string): void {
    this.baseMessage = message.replace(/\.+\s*$/, '').trim()

    // In non-TTY mode, just print the message once
    if (!process.stdout.isTTY) {
      console.log(`  ${this.baseMessage}...`)
      return
    }

    this.isRunning = true
    this.spinnerIndex = 0
    this.dotsIndex = 0
    this.render()
    this.intervalId = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length
      this.dotsIndex = (this.dotsIndex + 1) % BOUNCING_DOTS.length
      this.render()
    }, 80)
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.spinnerIndex]
    const dots = BOUNCING_DOTS[this.dotsIndex]
    process.stdout.write(`\r\x1b[K${frame} ${this.baseMessage} ${dots}`)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.isRunning) {
      process.stdout.write('\r\x1b[K')
      this.isRunning = false
    }
  }

  success(message: string): void {
    this.stop()
    console.log(`${COLORS.green}${SYMBOLS.check}${COLORS.reset} ${message}`)
  }

  fail(message: string): void {
    this.stop()
    console.log(`${COLORS.red}${SYMBOLS.cross}${COLORS.reset} ${message}`)
  }
}

// Singleton instance
export const spinner = new Spinner()
