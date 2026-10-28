import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { failProgress, promptInput } from './progress.js'

function safeMessage(message) {
  return String(message).replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try { const url = new URL(value); return url.origin + url.pathname }
    catch { return '[URL]' }
  })
}

export async function saveFailure(error, browser) {
  const directory = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'mp-review-cli', 'logs')
  fs.mkdirSync(directory, { recursive: true })
  const pages = await browser.pages().catch(() => [])
  const file = path.join(directory, `failure-${Date.now()}.log`)
  fs.writeFileSync(file, [
    new Date().toISOString(),
    `步骤：${error.step || '执行流程'}`,
    safeMessage(error.stack || error.message),
    ...pages.map(page => `页面：${safeMessage(page.url())}`),
  ].join('\n'), 'utf8')
  return file
}

export async function withBrowserSession(browser, projectName, operation, {
  interactive = Boolean(process.stdin.isTTY),
  prompt = promptInput,
  report = failProgress,
  save = saveFailure,
  write = message => process.stderr.write(message),
} = {}) {
  try {
    return await operation()
  }
  catch (error) {
    report(`${error.step ? `${error.step}：` : ''}${safeMessage(error.message)}`)
    error.reported = true
    try {
      write(`错误记录：${await save(error, browser)}\n`)
    }
    catch {
      write('错误记录写入失败，请保留终端中的报错。\n')
    }
    if (interactive) {
      try {
        await prompt(projectName, '执行失败，浏览器已保留。查看错误后按 Enter 关闭并退出：')
      }
      catch { /* Ctrl+C also closes this session. */ }
    }
    throw error
  }
  finally {
    await browser.close().catch(() => {})
  }
}
