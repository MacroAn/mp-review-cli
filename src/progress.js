import process from 'node:process'

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
  const frames = ['|', '/', '-', '\\']
  let frameIndex = 0
  updateProgress(projectName, step, frames[frameIndex])

  if (!process.stdout.isTTY)
    return () => {}

  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length
    updateProgress(projectName, step, frames[frameIndex])
  }, 120)

  return () => {
    clearInterval(timer)
    updateProgress(projectName, step)
  }
}
