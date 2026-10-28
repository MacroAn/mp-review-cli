import { withBrowserSession } from './browser-session.js'
import { captureBrowserWindow, keepBrowserBehindTerminal } from './browser-window.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import puppeteer from 'puppeteer-core'
import qrcodeTerminal from 'qrcode-terminal'
import { finishProgress, promptInput, showQr, startSpinner, updateProgress } from './progress.js'

const LOGIN_URL = 'https://mp.weixin.qq.com/'
const VERSION_URL = token => `https://mp.weixin.qq.com/wxamp/wacodepage/getcodepage?token=${encodeURIComponent(token)}&lang=zh_CN`
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const RELEASE_TIMEOUT_MS = 5 * 60 * 1000
const PAGE_TIMEOUT_MS = 60 * 1000
const POLL_INTERVAL_MS = 1000
const DEFAULT_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function withSpinner(projectName, step, operation) {
  const stopSpinner = startSpinner(projectName, step)
  try {
    return await operation()
  }
  catch (error) {
    error.step ||= step
    throw error
  }
  finally {
    stopSpinner()
  }
}

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

function parseReleaseField(text, label, nextLabels) {
  const suffix = nextLabels.join('|')
  return text.match(new RegExp(`${label}\\s*(.*?)\\s*(?=${suffix})`))?.[1]?.trim() || '未提供'
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

export async function selectLatestDevelopmentVersion(page) {
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
    throw new Error('未找到可提交审核的开发版本，请先上传小程序代码')

  candidates.sort((left, right) => right.timestamp - left.timestamp)
  return candidates[0]
}

export async function selectApprovedReleaseVersion(page) {
  try {
    await page.waitForFunction(() => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
      }
      return [...document.querySelectorAll('button, a, input[type="submit"], [role="button"], .btn_primary, .weui-desktop-btn')]
        .some((element) => {
          const text = (element.value || element.textContent || element.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim()
          return isVisible(element) && text === '提交发布'
        })
    }, { timeout: PAGE_TIMEOUT_MS })
  }
  catch {
    throw new Error('未找到审核通过待发布的版本')
  }

  const controls = await page.$$('button, a, input[type="submit"], [role="button"], .btn_primary, .weui-desktop-btn')
  const candidates = []

  for (const button of controls) {
    const candidate = await button.evaluate((element) => {
      const style = window.getComputedStyle(element)
      const buttonText = (element.value || element.textContent || element.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (buttonText !== '提交发布'
        || element.disabled === true
        || element.getAttribute('aria-disabled') === 'true'
        || element.classList.contains('weui-desktop-btn_disabled')
        || element.classList.contains('btn_disabled')
        || style.display === 'none'
        || style.visibility === 'hidden'
        || element.getClientRects().length === 0)
        return null

      const container = element.closest('.mod_default_box')
      const text = (container?.textContent || '').replace(/\s+/g, ' ').trim()
      return text.includes('审核版本') && text.includes('审核通过待发布') && text.includes('版本号') ? text : null
    })

    if (!candidate)
      continue

    candidates.push({
      button,
      auditNote: parseReleaseField(candidate, '审核说明', ['提交发布']),
      developer: parseReleaseField(candidate, '开发者', ['提交审核时间', '审核说明', '审核通过待发布', '提交发布']),
      submittedAt: parseReleaseField(candidate, '提交审核时间', ['审核说明', '审核通过待发布', '提交发布']),
      text: candidate,
      timestamp: parseSubmitTime(candidate),
      version: parseVersionNumber(candidate),
    })
  }

  if (candidates.length === 0)
    throw new Error('未找到审核通过待发布的版本')

  candidates.sort((left, right) => right.timestamp - left.timestamp)
  return candidates[0]
}

function formatReleaseSummary(selectedVersion) {
  const lines = [
    '待发布版本信息：',
    `版本号：${selectedVersion.version}`,
    `开发者：${selectedVersion.developer}`,
    `提交审核时间：${selectedVersion.submittedAt}`,
  ]
  if (selectedVersion.auditNote !== '未提供')
    lines.push(`审核说明：${selectedVersion.auditNote}`)
  return lines.join('\n')
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

async function setFormValue(element, value) {
  await element.evaluate((field, fieldValue) => {
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(field, fieldValue)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    field.dispatchEvent(new Event('blur', { bubbles: true }))
  }, value)
}

export async function fillReviewCredentials(page, account, password) {
  await page.waitForFunction(() => [...document.querySelectorAll('label, span, div')]
    .some(element => (element.textContent || '').trim() === '需登录账号才可使用'),
  { timeout: PAGE_TIMEOUT_MS })
  const selected = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('label, span, div')]
      .filter(element => (element.textContent || '').trim() === '需登录账号才可使用')
      .sort((left, right) => left.childElementCount - right.childElementCount)
    const target = candidates[0]
    if (!target)
      return false
    const clickable = target.closest('label') || target
    if (clickable instanceof HTMLElement) {
      clickable.click()
      return true
    }
    return false
  })
  if (!selected)
    throw new Error('未找到“需登录账号才可使用”选项，微信审核页面结构可能已经变化')

  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector('input[placeholder*="审核测试使用的测试账号"]')
      && document.querySelector('input[placeholder*="测试账号的登录密码"]')
      && document.querySelector('textarea[placeholder*="测试流程"]'),
    )
  }, { timeout: PAGE_TIMEOUT_MS })

  const accountInput = await page.$('input[placeholder*="审核测试使用的测试账号"]')
  const passwordInput = await page.$('input[placeholder*="测试账号的登录密码"]')
  const notesInput = await page.$('textarea[placeholder*="测试流程"]')
  if (!accountInput || !passwordInput || !notesInput)
    throw new Error('未找到测试账号、密码或备注输入框')

  const notes = `线上真实生产环境,请手下留情\n测试账号: ${account}\n测试密码: ${password}`
  if (Array.from(notes).length > 200)
    throw new Error('测试备注超过微信限制的 200 字，请缩短测试账号或密码')
  await setFormValue(accountInput, account)
  await setFormValue(passwordInput, password)
  await setFormValue(notesInput, notes)
  await notesInput.evaluate(element => element.scrollIntoView({ behavior: 'auto', block: 'center' }))
  return notes
}

export async function assertReviewAvailable(page, selectedVersion, { timeout = 10000 } = {}) {
  try {
    await page.waitForFunction(element => element.isConnected
      && !element.classList.contains('weui-desktop-btn_disabled')
      && element.disabled !== true && element.getAttribute('aria-disabled') !== 'true',
    { timeout }, selectedVersion.button)
    return
  }
  catch (error) {
    if (error.name !== 'TimeoutError')
      throw error
  }
  const button = await selectedVersion.button.evaluate(element => ({
    disabled: element.classList.contains('weui-desktop-btn_disabled')
      || element.disabled === true || element.getAttribute('aria-disabled') === 'true',
    hint: element.getAttribute('title') || element.getAttribute('data-tooltip') || '',
  }))
  if (!button.disabled)
    return

  const status = await page.evaluate(() => {
    const isVisible = element => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
    const cards = [...document.querySelectorAll('.mod_default_box')]
      .filter(element => !element.classList.contains('code_version_dev')
        && !element.classList.contains('code_version_online') && isVisible(element))
    const audit = cards.find(element => (element.textContent || '').includes('审核版本'))
    const text = audit?.textContent || ''
    return ['审核通过待发布', '审核中', '审核不通过', '审核失败', '已撤回']
      .find(value => text.includes(value)) || ''
  })
  const version = selectedVersion.version || parseVersionNumber(selectedVersion.text)
  const detail = status ? `；后台审核状态：${status}` : '；未识别到明确的审核状态'
  const advice = status === '审核中' ? '。请等待审核结果，无需重复提审'
    : status === '审核通过待发布' ? '。若要上线已通过审核的版本，请退出后选择 2 发布'
      : '。请查看浏览器版本管理页中的限制说明'
  throw new Error(`开发版本 ${version} 的提交审核按钮已禁用${detail}${button.hint ? `；按钮提示：${button.hint}` : ''}${advice}`)
}

async function openAuditForm(browser, page, selectedVersion) {
  await assertReviewAvailable(page, selectedVersion)

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

async function showReleaseQr(page, projectName, selectedVersion) {
  await page.waitForFunction(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    return [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')]
      .some(element => isVisible(element) && (element.textContent || '').includes('请使用微信扫描二维码进行验证'))
  }, { timeout: PAGE_TIMEOUT_MS })

  for (let attempt = 0; attempt < 20; attempt++) {
    const dialogs = await page.$$('.weui-desktop-dialog__wrp, .weui-desktop-dialog')
    for (const dialog of dialogs) {
      const visible = await dialog.evaluate((element) => {
        const style = window.getComputedStyle(element)
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && element.getClientRects().length > 0
          && (element.textContent || '').includes('请使用微信扫描二维码进行验证')
      })
      if (!visible)
        continue

      const qrElements = await dialog.$$('img, canvas')
      for (const element of [...qrElements, dialog]) {
        const screenshot = await element.screenshot({ type: 'png' })
        const png = PNG.sync.read(Buffer.from(screenshot))
        const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
        if (decoded?.data) {
          const terminalQr = await renderTerminalQr(decoded.data)
          const releaseSummary = formatReleaseSummary(selectedVersion)
          showQr(projectName, '请再次使用微信扫描二维码验证发布', `${terminalQr.trimEnd()}\n${releaseSummary}`)
          return
        }
      }
    }
    await sleep(500)
  }

  throw new Error('发布验证二维码识别失败，请重新运行 mp 并选择 2 发布')
}

export async function submitRelease(page, selectedVersion, { onVerificationRequired } = {}) {
  await selectedVersion.button.click()
  await page.waitForFunction(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    return [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')]
      .some((dialog) => {
        if (!isVisible(dialog) || !(dialog.textContent || '').includes('发布线上版本'))
          return false
        return [...dialog.querySelectorAll('button, a, input[type="submit"], [role="button"], .btn_primary')]
          .some((element) => {
            const text = (element.value || element.textContent || element.getAttribute('aria-label') || '')
              .replace(/\s+/g, ' ')
              .trim()
            return isVisible(element) && text === '提交'
          })
      })
  }, { timeout: PAGE_TIMEOUT_MS })

  const submitted = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const dialogs = [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')]
      .filter(element => isVisible(element) && (element.textContent || '').includes('发布线上版本'))
      .sort((left, right) => left.contains(right) ? 1 : right.contains(left) ? -1 : 0)

    for (const dialog of dialogs) {
      const button = [...dialog.querySelectorAll('button, a, input[type="submit"], [role="button"], .btn_primary')]
        .find((element) => {
          const text = (element.value || element.textContent || element.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim()
          return isVisible(element) && text === '提交'
        })
      if (button instanceof HTMLElement) {
        button.click()
        return true
      }
    }
    return false
  })
  if (!submitted)
    throw new Error('未找到“发布线上版本”弹窗中的提交按钮')

  await page.waitForFunction(() => document.body.innerText.includes('请使用微信扫描二维码进行验证'), {
    timeout: PAGE_TIMEOUT_MS,
  })
  await onVerificationRequired?.(page)

  await page.waitForFunction((version) => {
    if (document.body.innerText.includes('发布成功'))
      return true
    const onlineVersion = document.querySelector('.mod_default_box.code_version_online, .code_version_online')
    return Boolean(onlineVersion && (onlineVersion.textContent || '').includes(version))
  }, { timeout: RELEASE_TIMEOUT_MS }, selectedVersion.version)
  return true
}

export async function openAuthenticatedVersionPage(page, token, { retryDelay = 500 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(VERSION_URL(token), { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
      await page.waitForFunction(() => location.pathname.includes('/wxamp/wacodepage/getcodepage')
        && document.readyState !== 'loading', { timeout: PAGE_TIMEOUT_MS })
      return
    }
    catch (error) {
      if (attempt === 2 || !/ERR_ABORTED|Execution context was destroyed|frame was detached|Navigating frame was detached/i.test(error.message))
        throw error
      await sleep(retryDelay)
    }
  }
}

export async function confirmSubmittedReview(page, token, version, { attempts = 3, timeout = 15000 } = {}) {
  try {
    if (!token)
      throw new Error('未能获取版本管理页地址')
    for (let attempt = 0; attempt < attempts; attempt++) {
      await openAuthenticatedVersionPage(page, token)
      try {
        const handle = await page.waitForFunction((expected) => {
          const cards = [...document.querySelectorAll('.mod_default_box')]
            .filter(element => element.getClientRects().length > 0
              && getComputedStyle(element).visibility !== 'hidden'
              && !element.classList.contains('code_version_dev')
              && !element.classList.contains('code_version_online'))
          for (const card of cards) {
            const text = (card.textContent || '').replace(/\s+/g, ' ').trim()
            if (!text.includes('审核版本'))
              continue
            const actual = text.match(/版本号\s*([0-9A-Za-z._-]+)/)?.[1]
            if (actual !== expected)
              continue
            return { version: actual, status: ['审核通过待发布', '审核中', '审核不通过', '审核失败', '已撤回', '审核通过']
              .find(value => text.includes(value)) || '状态未显示' }
          }
          return false
        }, { timeout, polling: 500 }, version)
        try {
          const result = await handle.jsonValue()
          if (['审核不通过', '审核失败', '已撤回'].includes(result.status))
            throw new Error(`已找到版本 ${version}，但后台状态为${result.status}`)
          return result
        }
        finally { await handle.dispose() }
      }
      catch (error) {
        if (error.name !== 'TimeoutError')
          throw error
      }
    }
    throw new Error(`审核版本中未找到本次版本 ${version}`)
  }
  catch (error) {
    throw new Error(`已执行提交，但结果尚未确认：${error.message}。请查看版本管理页，确认后再决定是否重试，避免重复提审`, { cause: error })
  }
}

async function openVersionManagementPage(browser, projectName) {
  const loginPage = await browser.newPage()
  await withSpinner(projectName, '正在打开微信公众平台', () => (
    loginPage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })
  ))
  updateProgress(projectName, '正在获取微信登录二维码')
  await showLoginQr(loginPage, projectName)

  const authenticated = await withSpinner(projectName, '扫码后正在等待登录完成', () => waitForAuthenticatedPage(browser))
  updateProgress(projectName, '登录成功，正在打开版本管理')
  await withSpinner(projectName, '登录成功，正在打开版本管理', () => openAuthenticatedVersionPage(authenticated.page, authenticated.token))
  return authenticated.page
}

async function launchVisibleBrowser() {
  const geometry = captureBrowserWindow()
  const browser = await puppeteer.launch({
    executablePath: findBrowserPath(),
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=' + geometry.width + ',' + geometry.height,
      '--window-position=' + geometry.left + ',' + geometry.top,
    ],
  })
  const stopWindowManager = keepBrowserBehindTerminal(browser, geometry)
  browser.once('disconnected', stopWindowManager)
  return browser
}

export async function runWechatReview() {
  const projectName = path.basename(process.cwd())
  const browser = await withSpinner(projectName, '准备打开微信公众平台', launchVisibleBrowser)

  return withBrowserSession(browser, projectName, async () => {
    const page = await openVersionManagementPage(browser, projectName)
    const selectedVersion = await withSpinner(projectName, '登录成功，正在读取开发版本', async () => {
      return selectLatestDevelopmentVersion(page)
    })
    const version = parseVersionNumber(selectedVersion.text)
    const auditPage = await withSpinner(projectName, `已选择开发版本 ${version}，正在打开审核资料`, () => (
      openAuditForm(browser, page, selectedVersion)
    ))

    const account = (await promptInput(projectName, '请输入审核测试账号：')).trim()
    if (!account)
      throw new Error('测试账号不能为空')
    const password = await promptInput(projectName, '请输入审核测试密码：', { secret: true })
    if (!password)
      throw new Error('测试密码不能为空')
    await withSpinner(projectName, '正在填写审核测试账号和备注', () => (
      fillReviewCredentials(auditPage, account, password)
    ))

    const token = await findToken(page)
    await withSpinner(projectName, `正在自动确认并提交版本 ${version}`, () => submitAudit(auditPage))
    const result = await withSpinner(projectName, `已执行提交，正在返回版本管理核对 ${version}`, () => (
      confirmSubmittedReview(auditPage, token, version)
    ))
    finishProgress(projectName, `版本 ${version} 提交审核成功，已在审核版本中确认（${result.status}）`)
  })
}

export async function runWechatRelease() {
  const projectName = path.basename(process.cwd())
  const browser = await withSpinner(projectName, '准备打开微信公众平台并检查审核版本', launchVisibleBrowser)

  return withBrowserSession(browser, projectName, async () => {
    const page = await openVersionManagementPage(browser, projectName)
    const selectedVersion = await withSpinner(projectName, '登录成功，正在检查审核通过的版本', () => (
      selectApprovedReleaseVersion(page)
    ))


    let stopReleaseSpinner = startSpinner(projectName, `正在自动提交发布版本 ${selectedVersion.version}`)
    try {
      await submitRelease(page, selectedVersion, {
        onVerificationRequired: async (releasePage) => {
          stopReleaseSpinner()
          stopReleaseSpinner = null
          await showReleaseQr(releasePage, projectName, selectedVersion)
        },
      })
    }
    finally {
      stopReleaseSpinner?.()
    }
    finishProgress(projectName, `版本 ${selectedVersion.version} 发布成功`)
  })
}
