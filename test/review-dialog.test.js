import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import puppeteer from 'puppeteer-core'
import {
  acceptReviewRules,
  assertReviewAvailable,
  confirmSubmittedReview,
  fillReviewCredentials,
  selectApprovedReleaseVersion,
  selectLatestDevelopmentVersion,
  submitAudit,
  submitRelease,
  waitAndClickVisibleButton,
} from '../src/wechat-review.js'

const browserPaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

test('accepts the current review notice dialog and clicks next', async () => {
  const executablePath = browserPaths.find(browserPath => fs.existsSync(browserPath))
  assert.ok(executablePath, 'Chrome or Edge is required for this test')

  const browser = await puppeteer.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <div class="mod_default_box code_version_dev">
        <div class="code_version_log">版本号 1.0.0 提交时间 2026-08-26 10:00:00 <button class="weui-desktop-btn weui-desktop-btn_primary">提交审核</button></div>
        <div class="code_version_log">版本号 2.0.0 提交时间 2026-08-26 11:00:00 <button class="weui-desktop-btn weui-desktop-btn_primary">提交审核</button></div>
      </div>
    `)
    const selectedVersion = await selectLatestDevelopmentVersion(page)
    assert.equal(selectedVersion.version, '2.0.0')

    await page.setContent(`
      <div class="weui-desktop-dialog__wrp">
        <h4>提交审核的相关须知</h4>
        <p>确认提交审核？</p>
        <div class="weui-desktop-icon-checkbox" id="review-checkbox"></div>
        <span>已阅读并了解平台审核规则</span>
        <button disabled>下一步</button>
      </div>
      <script>
        document.querySelector('#review-checkbox').addEventListener('click', () => {
          document.querySelector('button').disabled = false
        })
        document.querySelector('button').addEventListener('click', () => {
          document.body.dataset.nextClicked = 'true'
        })
      </script>
    `)

    await acceptReviewRules(page)
    const clicked = await waitAndClickVisibleButton(page, ['下一步'], '.weui-desktop-dialog__wrp', 2000)

    assert.equal(clicked, true)
    assert.equal(await page.evaluate(() => document.body.dataset.nextClicked), 'true')

    await page.setContent(`
      <div id="loading">正在加载审核资料</div>
      <label id="login-required"><input type="radio" name="login">加载中</label>
      <div id="credentials" style="display: none">
        <input placeholder="请填写提供用于审核测试使用的测试账号">
        <input placeholder="请填写测试账号的登录密码">
        <textarea placeholder="若测试流程特殊，请描述测试流程以便审核人员进行审核"></textarea>
      </div>
      <script>
        setTimeout(() => { document.querySelector('#login-required').lastChild.textContent = '需登录账号才可使用' }, 300)
        document.querySelector('#login-required').addEventListener('click', () => {
          document.querySelector('#credentials').style.display = 'block'
        })
      </script>
    `)
    const notes = await fillReviewCredentials(page, 'review-user', 'review-password')
    const credentialValues = await page.evaluate(() => ({
      account: document.querySelector('input[placeholder*="审核测试使用的测试账号"]').value,
      password: document.querySelector('input[placeholder*="测试账号的登录密码"]').value,
      notes: document.querySelector('textarea').value,
    }))
    assert.equal(credentialValues.account, 'review-user')
    assert.equal(credentialValues.password, 'review-password')
    assert.equal(notes, '线上真实生产环境,请手下留情\n测试账号: review-user\n测试密码: review-password')
    assert.equal(credentialValues.notes, notes)

    await page.setContent(`
      <a class="btn_primary" id="final-submit" href="javascript:void(0)" style="display: none">提交审核</a>
      <div class="weui-desktop-dialog__wrp" id="privacy-dialog" style="display: none">
        <h4>确认提交审核</h4>
        <p>当前选择未采集用户隐私，请确认是否继续提交？</p>
        <button>取消</button>
        <button class="btn_primary">确定，继续提交</button>
      </div>
      <script>
        setTimeout(() => {
          document.querySelector('#final-submit').style.display = 'inline-block'
        }, 300)
        document.querySelector('#final-submit').addEventListener('click', () => {
          document.querySelector('#privacy-dialog').style.display = 'block'
        })
        document.querySelector('#privacy-dialog .btn_primary').addEventListener('click', () => {
          document.body.textContent = '已提交审核'
        })
      </script>
    `)

    assert.equal(await submitAudit(page), true)
    assert.match(await page.evaluate(() => document.body.innerText), /已提交审核/)
  }
  finally {
    await browser.close()
  }
})

test('releases only a reviewed version marked ready for release', async () => {
  const executablePath = browserPaths.find(browserPath => fs.existsSync(browserPath))
  assert.ok(executablePath, 'Chrome or Edge is required for this test')

  const browser = await puppeteer.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <div class="mod_default_box code_version_online">
        <h2>线上版本</h2>
        <span>版本号 1.0.0</span>
      </div>
      <div class="mod_default_box">
        <h2>审核版本</h2>
        <div class="code_version_log">
          <span>版本号 1.1.0</span>
          <span>开发者 Macro2</span>
          <span>提交审核时间 2026-08-29 10:25:38</span>
          <span>审核通过待发布</span>
          <span>审核说明 审核通过待发布</span>
          <button id="release">提交发布</button>
        </div>
      </div>
      <div class="weui-desktop-dialog__wrp" id="release-dialog" style="display: none">
        <div class="weui-desktop-dialog">
          <h4>发布线上版本</h4>
          <label>发布模式 <select><option>全量发布</option></select></label>
          <button>取消</button>
          <button id="confirm-release">提交</button>
        </div>
      </div>
      <div class="weui-desktop-dialog__wrp" id="verification-dialog" style="display: none">
        <div class="weui-desktop-dialog">
          <h4>发布版本</h4>
          <div>请使用微信扫描二维码进行验证</div>
        </div>
      </div>
      <script>
        document.querySelector('#release').addEventListener('click', () => {
          document.querySelector('#release-dialog').style.display = 'block'
        })
        document.querySelector('#confirm-release').addEventListener('click', () => {
          document.querySelector('#release-dialog').style.display = 'none'
          document.querySelector('#verification-dialog').style.display = 'block'
        })
      </script>
    `)

    const selectedVersion = await selectApprovedReleaseVersion(page)
    assert.equal(selectedVersion.version, '1.1.0')
    assert.equal(selectedVersion.developer, 'Macro2')
    assert.equal(selectedVersion.submittedAt, '2026-08-29 10:25:38')
    assert.equal(selectedVersion.auditNote, '审核通过待发布')
    let verificationRequested = false
    assert.equal(await submitRelease(page, selectedVersion, {
      onVerificationRequired: async (releasePage) => {
        verificationRequested = await releasePage.evaluate(() => (
          document.body.innerText.includes('请使用微信扫描二维码进行验证')
        ))
        await releasePage.evaluate(() => {
          document.querySelector('.code_version_online span').textContent = '版本号 1.1.0'
          document.querySelector('#verification-dialog').style.display = 'none'
          const result = document.createElement('div')
          result.textContent = '发布成功'
          document.body.appendChild(result)
        })
      },
    }), true)
    assert.equal(verificationRequested, true)
    assert.match(await page.evaluate(() => document.body.innerText), /发布成功/)

    await page.setContent(`
      <div class="mod_default_box">
        <h2>审核版本</h2>
        <span>版本号 1.2.0 审核中</span>
        <button>提交发布</button>
      </div>
    `)
    await assert.rejects(selectApprovedReleaseVersion(page), /未找到审核通过待发布的版本/)
  }
  finally {
    await browser.close()
  }
})


test('disabled review buttons report observed status without assuming an audit is in progress', async () => {
  const executablePath = browserPaths.find(p => fs.existsSync(p))
  const browser = await puppeteer.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    for (const [status, expected] of [
      ['审核中', /当前已有版本审核中，请等待审核结果/],
      ['审核通过待发布', /当前版本已审核通过，请选择 2 发布/],
      ['', /当前暂不可提审/],
    ]) {
      await page.setContent('<div class="mod_default_box"><h2>审核版本</h2>' + status + '</div><button class="weui-desktop-btn_disabled" title="平台暂不允许提交">提交审核</button>')
      const button = await page.$('button')
      await assert.rejects(assertReviewAvailable(page, { button, version: '1.0.5' }, { timeout: 100 }), expected)
    }
    await page.setContent('<button>提交审核</button>')
    await assert.doesNotReject(assertReviewAvailable(page, { button: await page.$('button'), version: '1.0.5' }))
  }
  finally { await browser.close() }
})


test('review verification matches the audit card exactly and refreshes before reporting success', async () => {
  const executablePath = browserPaths.find(p => fs.existsSync(p))
  const browser = await puppeteer.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    let visits = 0
    let audit = ''
    let nextAudit = ''
    page.on('request', request => {
      if (!request.isNavigationRequest()) {
        request.respond({ status: 204, body: '' })
        return
      }
      visits++
      const currentAudit = visits === 1 ? audit : nextAudit
      request.respond({ contentType: 'text/html; charset=utf-8', body:
        '<div class="mod_default_box code_version_online">线上版本 版本号 1.0.5</div>' +
        '<div class="mod_default_box"><h2>审核版本</h2>' + currentAudit + '</div>' +
        '<div class="mod_default_box code_version_dev">开发版本 版本号 1.0.5</div>' })
    })
    // An identical development/online version and a prefix match in the audit card are insufficient.
    audit = '版本号 1.0.50 审核中'
    nextAudit = '版本号 1.0.5 审核中'
    const result = await confirmSubmittedReview(page, 'test', '1.0.5', { attempts: 2, timeout: 200 })
    assert.deepEqual(result, { version: '1.0.5', status: '审核中' })
    assert.equal(visits, 2)
    assert.match(page.url(), /getcodepage/)

    visits = 0
    audit = nextAudit = '你暂无提交审核的版本或版本已发布上线'
    await assert.rejects(confirmSubmittedReview(page, 'test', '1.0.5', { attempts: 2, timeout: 100 }), /结果尚未确认.*未找到本次版本 1.0.5/)
    assert.equal(visits, 2)

    visits = 0
    audit = nextAudit = '版本号 1.0.5 审核失败'
    await assert.rejects(confirmSubmittedReview(page, 'test', '1.0.5', { attempts: 1, timeout: 100 }), /后台状态为审核失败/)

    await page.setRequestInterception(false)
    await page.setContent('<button class="weui-desktop-btn_disabled">提交审核</button><script>setTimeout(() => document.querySelector("button").className = "", 200)</script>')
    await assert.doesNotReject(assertReviewAvailable(page, { button: await page.$('button'), version: '1.0.5' }, { timeout: 2000 }))
  }
  finally { await browser.close() }
})
