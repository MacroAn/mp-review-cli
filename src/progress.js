import process from 'node:process'
import readline from 'node:readline/promises'

let activeProject = null
let initialized = false
let qrLineCount = 0

function compactText(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

export function formatProgress(projectName, step, suffix = '') {
  const animation = suffix ? ` ${suffix}` : ''
  return `项目：${compactText(projectName)}\n当前步骤：${compactText(step)}${animation}`
}

export function updateProgress(projectName, step, suffix = '') {
  const normalizedProject = compactText(projectName)
  const animation = suffix ? ` ${suffix}` : ''
  const stepLine = `当前步骤：${compactText(step)}${animation}`

  if (!initialized || activeProject !== normalizedProject) {
    if (initialized)
      process.stdout.write('\n')
    activeProject = normalizedProject
    initialized = true
    qrLineCount = 0
    process.stdout.write(`项目：${activeProject}\n${stepLine}`)
    return
  }

  clearQr()
  if (process.stdout.isTTY)
    process.stdout.write(`\r\x1B[2K${stepLine}`)
  else
    process.stdout.write(`\r${stepLine}`)
}

export function finishProgress(projectName, step) {
  updateProgress(projectName, step)
  process.stdout.write('\n')
  activeProject = null
  initialized = false
  qrLineCount = 0
}

export function failProgress(message) {
  if (initialized) {
    updateProgress(activeProject, `失败：${message}`)
    process.stdout.write('\n')
    activeProject = null
    initialized = false
    qrLineCount = 0
    return
  }
  process.stderr.write(`失败：${compactText(message)}\n`)
}

export function showQr(projectName, step, terminalQr) {
  updateProgress(projectName, step)
  const qrLines = String(terminalQr).trimEnd().split(/\r?\n/)
  process.stdout.write(`\n${qrLines.join('\n')}`)
  qrLineCount = qrLines.length
}

function clearQr() {
  if (qrLineCount === 0)
    return

  if (process.stdout.isTTY)
    process.stdout.write(`\x1B[${qrLineCount}A\r\x1B[2K\x1B[J`)
  else
    process.stdout.write('\n')
  qrLineCount = 0
}

export function startSpinner(projectName, step) {
  // QR codes must remain on screen until an explicit progress update after scanning.
  if (qrLineCount > 0)
    return () => {}

  const frames = ['.', '..', '...']
  let frameIndex = 0
  updateProgress(projectName, step, frames[frameIndex])

  if (!process.stdout.isTTY)
    return () => {}

  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length
    updateProgress(projectName, step, frames[frameIndex])
  }, 500)

  return () => {
    clearInterval(timer)
    updateProgress(projectName, step)
  }
}

export function promptInput(projectName, label, { secret = false } = {}) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
    return terminal.question(`${label}`).finally(() => terminal.close())
  }

  return new Promise((resolve, reject) => {
    let value = ''
    const wasRaw = process.stdin.isRaw
    const render = () => {
      const displayedValue = secret ? '*'.repeat(Array.from(value).length) : value
      updateProgress(projectName, `${label}${displayedValue}`)
    }
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(Boolean(wasRaw))
      process.stdin.pause()
    }
    const onData = (chunk) => {
      const text = chunk.toString('utf8')
      if (text.includes('\u001B'))
        return

      for (const character of Array.from(text)) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('用户取消输入'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u0008' || character === '\u007F')
          value = Array.from(value).slice(0, -1).join('')
        else if (character >= ' ')
          value += character
      }
      render()
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
    render()
  })
}
