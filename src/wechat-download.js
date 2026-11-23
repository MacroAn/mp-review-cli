const TIMEOUT = 60000

// Executed inside the page; keep each action scoped to its account row or dialog.
function findControl(action) {
  const visible = element => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
  const text = element => (element.textContent || '').replace(/\s+/g, '').trim()
  const exact = (root, value) => [...root.querySelectorAll('*')]
    .filter(element => visible(element) && text(element) === value)
    .sort((a, b) => a.childElementCount - b.childElementCount)[0]
  const clickable = element => element?.closest('a, button, label, [role="button"], [role="option"]') || element

  if (action === 'account' || action === 'manage')
    return clickable(exact(document, action === 'account' ? '账号设置' : '管理')) || null
  if (action === 'entry')
    return clickable(exact(document, '账号设置') || exact(document, '管理')) || null
  if (action === 'open') {
    let row = exact(document, '小程序码及线下物料下载')
    while (row && row !== document.body) {
      const button = exact(row, '下载')
      if (button) return clickable(button)
      row = row.parentElement
    }
    return null
  }

  const dialog = [...document.querySelectorAll('.weui-desktop-dialog, .weui-desktop-dialog__wrp, [role="dialog"]')]
    .filter(element => visible(element) && text(element).includes('小程序码及线下物料下载'))
    .sort((a, b) => a.contains(b) ? 1 : b.contains(a) ? -1 : 0)[0]
  if (!dialog) return null
  if (action === 'color' || action === 'selected') {
    const control = [...dialog.querySelectorAll('select, [role="combobox"], .weui-desktop-dropdown__switch')].find(visible)
      || clickable(exact(dialog, '智能取色') || exact(dialog, '默认')) || null
    if (action === 'color') return control
    const value = control?.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent : control?.textContent
    return value?.trim() === '智能取色' ? control : null
  }
  if (action === 'smart')
    return clickable(exact(dialog, '智能取色')) || null
  if (action === 'download') {
    for (const table of dialog.querySelectorAll('table, [role="table"]')) {
      const rows = [...table.querySelectorAll('tr, [role="row"]')]
      const header = rows.find(row => text(row).includes('普通二维码') && text(row).includes('小程序码'))
      if (!header) continue
      const headers = [...header.querySelectorAll('th, td, [role="columnheader"], [role="cell"]')]
      const column = headers.findIndex(cell => text(cell).startsWith('小程序码'))
      if (column < 0) continue
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td, [role="cell"]')]
        if (!cells.some(cell => /^50(?:cm|厘米)?$/i.test(text(cell)))) continue
        const cell = cells[column]
        if (!cell) continue
        return [...cell.querySelectorAll('a, button, [role="button"], [download], i, svg')]
          .find(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true') || null
      }
    }
  }
  return null
}

async function waitControl(page, action, label) {
  try {
    const handle = await page.waitForFunction(findControl, { timeout: TIMEOUT }, action)
    return handle.asElement()
  }
  catch (error) {
    throw new Error(`未找到${label}，请查看微信后台页面`, { cause: error })
  }
}

async function clickControl(page, action, label) {
  const control = await waitControl(page, action, label)
  try { await control.click() }
  finally { await control.dispose() }
}

export async function openAccountSettings(page, token) {
  const url = `https://mp.weixin.qq.com/wxamp/basicprofile/index?token=${encodeURIComponent(token)}&lang=zh_CN`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
      const ready = await waitControl(page, 'open', '账号设置中的小程序码下载入口')
      await ready.dispose()
      return
    }
    catch (error) {
      if (attempt === 2 || !/ERR_ABORTED|Execution context was destroyed|frame was detached/i.test(error.message))
        throw error
    }
  }
}

export async function prepareCodeDownload(page, { token, onStep = () => {} } = {}) {
  onStep('登录成功，正在打开账号设置')
  if (token) {
    // Login can finish before the home sidebar has rendered. Navigate using the
    // authenticated token instead of toggling a menu whose state is still changing.
    await openAccountSettings(page, token)
  }
  else {
    const entry = await waitControl(page, 'entry', '账号设置或管理菜单')
    try {
      const isAccount = await entry.evaluate(element => (element.textContent || '').replace(/\s+/g, '') === '账号设置')
      await entry.click()
      if (!isAccount) await clickControl(page, 'account', '“账号设置”菜单')
    }
    finally { await entry.dispose() }
  }
  onStep('账号设置已打开，正在打开小程序码下载弹窗')
  await clickControl(page, 'open', '“小程序码及线下物料下载”的下载入口')
  onStep('下载弹窗已打开，正在选择智能取色')
  const color = await waitControl(page, 'color', '小程序码颜色选项')
  try {
    const state = await color.evaluate(element => ({
      native: element.tagName === 'SELECT',
      value: [...(element.options || [])].find(option => option.textContent.trim() === '智能取色')?.value,
      selected: (element.textContent || '').trim() === '智能取色',
    }))
    if (state.native) {
      if (state.value === undefined) throw new Error('颜色选项中未找到“智能取色”')
      await color.select(state.value)
    }
    else if (!state.selected) {
      await color.click()
      await clickControl(page, 'smart', '“智能取色”选项')
    }
  }
  finally { await color.dispose() }
  // Wait for the selected value before using the newly rendered download link.
  const selected = await waitControl(page, 'selected', '已选中的“智能取色”')
  await selected.dispose()
  onStep('已选择智能取色，正在定位 50cm 小程序码下载按钮')
  return waitControl(page, 'download', '50cm 行“小程序码”列的下载按钮')
}

export async function downloadWithBrowser(browser, click, { timeout = 5 * 60 * 1000, downloadPath } = {}) {
  const session = await browser.target().createCDPSession()
  let timer
  let guid
  let filename
  let onBegin
  let onProgress
  try {
    await session.send('Browser.setDownloadBehavior', downloadPath
      ? { behavior: 'allow', downloadPath, eventsEnabled: true }
      : { behavior: 'default', eventsEnabled: true })
    const completed = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('下载尚未确认完成，请检查浏览器下载列表或保存对话框')), timeout)
      onBegin = event => {
        if (guid) return
        guid = event.guid
        filename = event.suggestedFilename
      }
      onProgress = event => {
        if (!guid || event.guid !== guid) return
        if (event.state === 'completed') resolve(filename)
        if (event.state === 'canceled') reject(new Error('浏览器下载已取消或被阻止，请检查下载列表'))
      }
      session.on('Browser.downloadWillBegin', onBegin)
      session.on('Browser.downloadProgress', onProgress)
    })
    completed.catch(() => {})
    await click()
    return await completed
  }
  finally {
    clearTimeout(timer)
    if (onBegin) session.off('Browser.downloadWillBegin', onBegin)
    if (onProgress) session.off('Browser.downloadProgress', onProgress)
    await session.detach().catch(() => {})
  }
}
