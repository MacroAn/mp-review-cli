import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import puppeteer from 'puppeteer-core'
import { prepareCodeDownload, downloadWithBrowser, openAccountSettings } from '../src/wechat-download.js'

test('downloads the smart-color 50cm mini program code using browser download preferences', { timeout: 20000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-download-test-'))
  const downloads = path.join(temp, 'browser-chosen-folder')
  const configured = path.join(temp, '配置 下载目录')
  const profile = path.join(temp, 'profile')
  fs.mkdirSync(downloads)
  fs.mkdirSync(configured)
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true })
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }))
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="mini-smart-50.png"' })
    res.end('test-mini-program-code')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    const executablePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
    browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile })
    const page = await browser.newPage()
    const base = `http://127.0.0.1:${server.address().port}`
    // A just-authenticated home page may have no sidebar yet. Account settings
    // must be navigated to directly, and its async content must be ready first.
    await page.setRequestInterception(true)
    let settingsVisits = 0
    const intercept = request => {
      if (!request.isNavigationRequest()) {
        request.respond({ status: 204, body: '' })
        return
      }
      assert.equal(new URL(request.url()).pathname, '/wxamp/basicprofile/index')
      assert.equal(new URL(request.url()).searchParams.get('token'), 'test-token')
      settingsVisits++
      request.respond({ contentType: 'text/html; charset=utf-8', body: `
        <div>正在加载账号设置</div>
        <script>setTimeout(() => { document.body.innerHTML = '<section><span>小程序码及线下物料下载</span><a>下载</a></section>' }, 200)</script>
      ` })
    }
    page.on('request', intercept)
    await page.setContent('<div>登录成功，首页菜单尚未加载</div>')
    await openAccountSettings(page, 'test-token')
    assert.equal(settingsVisits, 1)
    assert.match(await page.evaluate(() => document.body.innerText), /小程序码及线下物料下载/)
    await page.goto('about:blank')
    page.off('request', intercept)
    await page.setRequestInterception(false)
    for (const native of [false, true]) {
      await page.setContent(`
        <button id="manage">管理</button><a id="account" style="display:none">账号设置</a>
        <section id="settings" style="display:none">
          <div>其他资料<a onclick="document.body.dataset.wrong='true'">下载</a></div>
          <div><span>小程序码及线下物料下载</span><a id="open">下载</a></div>
        </section>
        <div role="dialog" style="display:none" id="dialog">
          <h4>小程序码及线下物料下载</h4>
          ${native ? '<select id="color"><option value="default">默认</option><option value="smart">智能取色</option></select>' : '<button role="combobox" id="color">默认</button><div id="options" style="display:none"><a id="smart">智能取色</a></div>'}
          <table><tr><th>边长(cm)</th><th>建议扫描距离(m)</th><th>普通二维码</th><th>小程序码</th></tr>
            ${[8, 12, 15, 30, 50].map(size => `<tr><td>${size}cm</td><td>2.5m</td><td><a href="${base}/ordinary-${size}">↓</a></td><td><a data-size="${size}" href="${base}/mini-default-${size}"><i>↓</i></a></td></tr>`).join('')}
          </table>
        </div>
        <script>
        (() => {
          manage.onclick = () => account.style.display = 'inline'
          account.onclick = () => settings.style.display = 'block'
          document.querySelector('#open').onclick = () => dialog.style.display = 'block'
          const change = () => {
            document.querySelectorAll('[data-size]').forEach(a => a.href = '${base}/mini-smart-' + a.dataset.size)
          }
          ${native ? 'color.onchange = change' : "color.onclick = () => options.style.display = 'block'; smart.onclick = () => { color.textContent = '智能取色'; options.style.display = 'none'; change() }"}
        })()
        </script>
      `)
      const button = await prepareCodeDownload(page)
      assert.equal(await button.evaluate(el => el.getAttribute('href')), `${base}/mini-smart-50`)
      const filename = await downloadWithBrowser(browser, () => button.click(), { timeout: 5000, downloadPath: native ? configured : undefined })
      assert.equal(filename, 'mini-smart-50.png')
      assert.equal(await page.evaluate(() => document.body.dataset.wrong), undefined)
      await button.dispose()
    }
    assert.deepEqual(requests, ['/mini-smart-50', '/mini-smart-50'])
    assert.equal(fs.readFileSync(path.join(downloads, 'mini-smart-50.png'), 'utf8'), 'test-mini-program-code')
    assert.equal(fs.readFileSync(path.join(configured, 'mini-smart-50.png'), 'utf8'), 'test-mini-program-code')
  }
  finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('download cancellation and timeout do not report success or change the download directory', async () => {
  for (const canceled of [true, false]) {
    const session = new EventEmitter()
    session.send = async (method, params) => {
      assert.equal(method, 'Browser.setDownloadBehavior')
      assert.deepEqual(params, { behavior: 'default', eventsEnabled: true })
    }
    let detached = false
    session.detach = async () => { detached = true }
    const browser = { target: () => ({ createCDPSession: async () => session }) }
    await assert.rejects(downloadWithBrowser(browser, async () => {
      if (canceled) {
        session.emit('Browser.downloadWillBegin', { guid: 'test', suggestedFilename: 'code.png' })
        session.emit('Browser.downloadProgress', { guid: 'test', state: 'canceled' })
      }
    }, { timeout: 20 }), canceled ? /已取消/ : /尚未确认完成/)
    assert.equal(detached, true)
    assert.equal(session.listenerCount('Browser.downloadProgress'), 0)
  }
})
