import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import puppeteer from 'puppeteer-core'
import qrcodeTerminal from 'qrcode-terminal'
import { finishProgress, showQr, updateProgress } from './progress.js'

const LOGIN_URL = 'https://mp.weixin.qq.com/'
const VERSION_URL = token => `https://mp.weixin.qq.com/wxamp/wacodepage/getcodepage?token=${encodeURIComponent(token)}&lang=zh_CN`
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const PAGE_TIMEOUT_MS = 60 * 1000
const POLL_INTERVAL_MS = 1000
const DEFAULT_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function renderTerminalQr(content) {
  return new Promise((resolve) => {
    qrcodeTerminal.generate(content, { small: true }, resolve)
  })
}

async function showLoginQr(page, projectName) {
  const selector = '.login__type__container__scan__qrcode'
  const qrImage = await page.waitForSelector(selector, { visible: true, timeout: PAGE_TIMEOUT_MS })
  await page.waitForFunction((imageSelector) => {
    const image = document.querySelector(imageSelector)
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  }, { timeout: PAGE_TIMEOUT_MS }, selector)

  for (let attempt = 0; attempt < 20; attempt++) {
    const screenshot = await qrImage.screenshot({ type: 'png' })
    const png = PNG.sync.read(Buffer.from(screenshot))
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    if (decoded?.data) {
      const terminalQr = await renderTerminalQr(decoded.data)
      showQr(projectName, '请使用微信扫描二维码并选择目标小程序', terminalQr)
      return
    }
    await sleep(500)
  }

  throw new Error('登录二维码识别失败，请重新运行 mp 获取新二维码')
}

function findBrowserPath() {
  const candidates = [process.env.MP_BROWSER_PATH, ...DEFAULT_BROWSER_PATHS].filter(Boolean)
  const browserPath = candidates.find(candidate => fs.existsSync(candidate))
  if (!browserPath)
    throw new Error('未找到 Chrome 或 Edge，可通过 MP_BROWSER_PATH 指定浏览器 executable 路径')
  return browserPath
}

function parseSubmitTime(text) {
  const match = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?\s+(\d{1,2}):(\d{2}):(\d{2})/)
  if (!match)
    return 0

  const [, year, month, day, hour, minute, second] = match
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime()
}

function compactText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function parseVersionNumber(text) {
  return text.match(/版本号\s*([0-9A-Za-z._-]+)/)?.[1] || '未知版本'
}

async function findToken(page) {
  const urlToken = new URL(page.url()).searchParams.get('token')
  if (urlToken)
    return urlToken

  return page.evaluate(() => {
    for (const link of document.querySelectorAll('a[href*="token="]')) {
      const token = new URL(link.href).searchParams.get('token')
      if (token)
        return token
    }
    return null
  }).catch(() => null)
}

async function waitForAuthenticatedPage(browser) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS

  while (Date.now() < deadline) {
    for (const candidate of await browser.pages()) {
      if (!candidate.url().startsWith('https://mp.weixin.qq.com/'))
        continue

      const token = await findToken(candidate)
      if (token)
        return { page: candidate, token }
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error('登录等待超时，请重新运行 mp 后在 5 分钟内扫码登录')
}

export async function selectLatestDevelopmentVersion(page, expectedVersion) {
  const cardSelector = '.mod_default_box.code_version_dev .code_version_log'
  await page.waitForSelector(cardSelector, { timeout: PAGE_TIMEOUT_MS })
  const cards = await page.$$(cardSelector)
  const candidates = []

  for (const card of cards) {
    const text = compactText(await card.evaluate(element => element.textContent || ''))
    const button = await card.$('.weui-desktop-btn.weui-desktop-btn_primary')
    if (!button)
      continue

    candidates.push({
      button,
      text,
      timestamp: parseSubmitTime(text),
      version: parseVersionNumber(text),
    })
  }

  if (candidates.length === 0)
    throw new Error('未找到可提交审核的开发版本，请先在 HBuilderX 中上传代码')

  const eligibleCandidates = expectedVersion
    ? candidates.filter(candidate => candidate.version === expectedVersion)
    : candidates
  if (eligibleCandidates.length === 0)
    throw new Error(`微信公众平台未找到本次上传的版本 ${expectedVersion}`)

  eligibleCandidates.sort((left, right) => right.timestamp - left.timestamp)
  return eligibleCandidates[0]
}

async function clickVisibleButton(page, acceptedTexts, rootSelector = 'body') {
  const controlSelector = [
    `${rootSelector} button`,
    `${rootSelector} a`,
    `${rootSelector} input[type="submit"]`,
    `${rootSelector} [role="button"]`,
    `${rootSelector} .btn_primary`,
  ].join(', ')
  const buttons = await page.$$(controlSelector)
  for (const button of buttons) {
    const state = await button.evaluate((element) => {
      const style = window.getComputedStyle(element)
      return {
        disabled: element.disabled === true
          || element.getAttribute('aria-disabled') === 'true'
          || element.classList.contains('weui-desktop-btn_disabled')
          || element.classList.contains('btn_disabled'),
        text: (element.value || element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        visible: style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0,
      }
    })

    if (state.visible && !state.disabled && acceptedTexts.some(text => state.text.includes(text))) {
      await button.click()
      return true
    }
  }
  return false
}

export async function waitAndClickVisibleButton(page, acceptedTexts, rootSelector = 'body', timeout = PAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await clickVisibleButton(page, acceptedTexts, rootSelector))
      return true
    await sleep(250)
  }
  return false
}

export async function acceptReviewRules(page) {
  await page.waitForFunction(() => {
    const text = document.body.innerText
    return text.includes('确认提交审核') && text.includes('已阅读并了解平台审核规则')
  }, { timeout: PAGE_TIMEOUT_MS })

  const accepted = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const dialogs = [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')]
    const dialog = dialogs.find((element) => {
      const text = element.textContent || ''
      return isVisible(element) && text.includes('确认提交审核') && text.includes('已阅读并了解平台审核规则')
    })
    if (!dialog)
      return false

    const checkbox = dialog.querySelector('input[type="checkbox"], [role="checkbox"], .weui-desktop-icon-checkbox')
    if (checkbox instanceof HTMLElement) {
      checkbox.click()
      return true
    }

    const label = [...dialog.querySelectorAll('label, span, div')]
      .find(element => (element.textContent || '').trim().includes('已阅读并了解平台审核规则'))
    if (label instanceof HTMLElement) {
      label.click()
      return true
    }
    return false
  })

  if (!accepted)
    throw new Error('未找到审核规则确认框，微信后台页面结构可能已经变化')
}

async function waitForAuditPage(browser) {
  const deadline = Date.now() + PAGE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const auditPage = (await browser.pages()).find(page => page.url().includes('/wxamp/wadevelopcode/get_class'))
    if (auditPage)
      return auditPage
    await sleep(500)
  }
  throw new Error('未能打开审核资料页面，微信后台页面结构可能已经变化')
}

async function openAuditForm(browser, page, selectedVersion) {
  const disabled = await selectedVersion.button.evaluate(element => element.classList.contains('weui-desktop-btn_disabled'))
  if (disabled)
    throw new Error('最新开发版本的提交审核按钮不可用，请先处理当前审核中的版本')

  await selectedVersion.button.click()
  await acceptReviewRules(page)

  if (!await waitAndClickVisibleButton(page, ['下一步', '继续'], '.weui-desktop-dialog__wrp'))
    throw new Error('未找到审核流程的下一步按钮')

  await sleep(800)
  await page.evaluate(() => {
    for (const dialog of [...document.querySelectorAll('.weui-desktop-dialog')].reverse()) {
      if (!(dialog.textContent || '').includes('安全测试提醒'))
        continue
      const button = dialog.querySelector('.weui-desktop-btn_primary')
      if (button instanceof HTMLElement)
        button.click()
      break
    }
  })

  return waitForAuditPage(browser)
}

async function getVisibleSubmitWarning(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const dialogs = [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')]
    const dialog = dialogs.find((element) => {
      const text = element.textContent || ''
      return isVisible(element) && text.includes('确认提交审核') && text.includes('继续提交')
    })
    return dialog ? (dialog.textContent || '').replace(/\s+/g, ' ').trim() : null
  })
}

export async function submitAudit(page) {
  const clicked = await waitAndClickVisibleButton(page, ['提交审核', '提交'])
  if (!clicked)
    throw new Error('未找到最终提交审核按钮，请检查审核资料是否完整')

  await page.waitForFunction(() => {
    if (document.body.innerText.includes('已提交审核'))
      return true

    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    return [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')]
      .some(element => isVisible(element) && (element.textContent || '').includes('继续提交'))
  }, { timeout: PAGE_TIMEOUT_MS })

  const warning = await getVisibleSubmitWarning(page)
  if (warning) {
    if (!await waitAndClickVisibleButton(page, ['确定，继续提交', '继续提交'], '.weui-desktop-dialog__wrp'))
      throw new Error('未找到二次确认的“继续提交”按钮')
  }

  await page.waitForFunction(() => document.body.innerText.includes('已提交审核'), { timeout: PAGE_TIMEOUT_MS })
  return true
}

export async function runWechatReview({ expectedVersion, projectName = path.basename(process.cwd()) } = {}) {
  const startMessage = expectedVersion
    ? `准备提审 HBuilderX 已上传版本 ${expectedVersion}`
    : '准备打开微信公众平台（不会上传代码）'
  updateProgress(projectName, startMessage)

  const browser = await puppeteer.launch({
    executablePath: findBrowserPath(),
    headless: true,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 3 },
  })

  try {
    const loginPage = await browser.newPage()
    await loginPage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
    updateProgress(projectName, '正在获取微信登录二维码')
    await showLoginQr(loginPage, projectName)

    const authenticated = await waitForAuthenticatedPage(browser)
    const page = authenticated.page
    updateProgress(projectName, '登录成功，正在读取开发版本')
    await page.goto(VERSION_URL(authenticated.token), { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })

    const selectedVersion = await selectLatestDevelopmentVersion(page, expectedVersion)
    const version = parseVersionNumber(selectedVersion.text)
    updateProgress(projectName, `已选择开发版本 ${version}，正在打开审核资料`)

    const auditPage = await openAuditForm(browser, page, selectedVersion)
    await auditPage.bringToFront()

    updateProgress(projectName, `正在自动确认并提交版本 ${version}`)
    await submitAudit(auditPage)
    finishProgress(projectName, `版本 ${version} 提交审核成功`)
  }
  finally {
    await browser.close()
  }
}
