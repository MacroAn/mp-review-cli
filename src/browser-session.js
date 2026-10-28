import { failProgress, promptInput } from './progress.js'

function safeMessage(message) {
  return String(message).replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try { const url = new URL(value); return url.origin + url.pathname }
    catch { return '[URL]' }
  })
}

export async function withBrowserSession(browser, projectName, operation, {
  interactive = Boolean(process.stdin.isTTY),
  prompt = promptInput,
  report = failProgress,
} = {}) {
  try {
    return await operation()
  }
  catch (error) {
    report(safeMessage(error.message), { label: error.notice ? '提示' : '失败' })
    error.reported = true
    if (interactive) {
      try {
        await prompt(projectName, '按 Enter 关闭并退出：')
      }
      catch { /* Ctrl+C also closes this session. */ }
    }
    throw error
  }
  finally {
    await browser.close().catch(() => {})
  }
}
