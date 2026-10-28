import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('./browser-window.cs', import.meta.url))
const fallbackGeometry = { width: 1200, height: 800, left: 0, top: 0, terminalHandle: '0', managed: false }
let helper

function getHelper() {
  if (helper)
    return helper
  const hash = createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 16)
  const directory = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'mp-review-cli', 'window-helper')
  const executable = path.join(directory, `window-${hash}.exe`)
  if (!fs.existsSync(executable)) {
    const compiler = ['Framework64', 'Framework']
      .map(folder => path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'))
      .find(candidate => fs.existsSync(candidate))
    if (!compiler)
      throw new Error('未找到 Windows .NET 编译器')
    fs.mkdirSync(directory, { recursive: true })
    const temporary = path.join(directory, `window-${hash}-${process.pid}.exe`)
    try {
      execFileSync(compiler, ['/nologo', '/target:exe', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', `/out:${temporary}`, source], {
        windowsHide: true, timeout: 15000, stdio: 'pipe',
      })
      if (!fs.existsSync(executable))
        fs.renameSync(temporary, executable)
    }
    finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  helper = executable
  return helper
}

export function captureBrowserWindow({ platform = process.platform, execute = execFileSync, resolveHelper = getHelper, warn = message => process.stderr.write(message) } = {}) {
  if (platform !== 'win32')
    return { ...fallbackGeometry }
  try {
    const geometry = JSON.parse(execute(resolveHelper(), ['capture'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: 'pipe',
    }))
    if (!Number.isInteger(geometry.width) || geometry.width <= 0
      || !Number.isInteger(geometry.height) || geometry.height <= 0
      || !Number.isInteger(geometry.left) || !Number.isInteger(geometry.top)
      || !/^\d+$/.test(geometry.terminalHandle))
      throw new Error('窗口信息无效')
    return { ...geometry, managed: true }
  }
  catch {
    warn('\n窗口布局暂不可用，继续使用可见浏览器。\n')
    return { ...fallbackGeometry }
  }
}

export function keepBrowserBehindTerminal(browser, geometry) {
  if (process.platform !== 'win32' || !geometry.managed)
    return () => {}
  let watcher
  try {
    watcher = spawn(getHelper(), [
      'watch', geometry.terminalHandle, String(browser.process().pid), String(process.pid),
      String(geometry.left), String(geometry.top), String(geometry.width), String(geometry.height),
    ], { windowsHide: true, stdio: 'ignore' })
  }
  catch {
    process.stderr.write('\n窗口层级管理暂不可用，继续执行。\n')
    return () => {}
  }
  let stopped = false
  watcher.on('error', () => process.stderr.write('\n窗口层级管理暂不可用，继续执行。\n'))
  watcher.on('exit', code => {
    if (code && !stopped)
      process.stderr.write('\n窗口层级管理已停止，提审和发布流程继续执行。\n')
  })
  return () => {
    stopped = true
    watcher.kill()
  }
}
