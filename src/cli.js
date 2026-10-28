#!/usr/bin/env node

import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { failProgress, finishProgress, promptInput } from './progress.js'
import { runWechatRelease, runWechatReview } from './wechat-review.js'

const VERSION = '2.0.6'

export async function main(args = process.argv.slice(2), {
  prompt = promptInput,
  review = runWechatReview,
  release = runWechatRelease,
  finish = finishProgress,
} = {}) {
  if (args.length === 1 && ['-v', '--version'].includes(args[0])) {
    console.log(VERSION)
    return
  }
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    console.log('使用：mp\n启动后输入 1 提审、2 发布、0 退出。\n浏览器全程可见，操作和输入在终端完成。')
    return
  }
  if (args.length)
    throw new Error('不支持此命令，请直接运行 mp，在菜单中选择提审或发布')

  let choice
  do {
    choice = (await prompt('微信小程序', '1 提审 / 2 发布 / 0 退出，请输入：')).trim()
  } while (!['0', '1', '2'].includes(choice))

  if (choice === '0') {
    finish('微信小程序', '已退出')
    return
  }
  await (choice === '1' ? review() : release())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    if (!error.reported) {
      failProgress(error.message)
      if (process.stdin.isTTY) {
        try { await promptInput('微信小程序', '查看错误后按 Enter 退出：') }
        catch { /* User cancelled. */ }
      }
    }
    process.exitCode = 1
  })
}
