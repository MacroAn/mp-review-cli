#!/usr/bin/env node

import process from 'node:process'
import { runWechatReview } from './wechat-review.js'

const VERSION = '1.2.0'

function printHelp() {
  console.log(`Usage: mp [options]

Submit the latest WeChat Mini Program development version for review.

Options:
  -h, --help      Show help
  -v, --version   Show version

The login QR code is displayed in the current terminal.
The Mini Program code must already be uploaded by HBuilderX or another tool.
Review notices and final confirmation dialogs are accepted automatically.`)
}

const args = new Set(process.argv.slice(2))

if (args.has('-h') || args.has('--help')) {
  printHelp()
  process.exit(0)
}

if (args.has('-v') || args.has('--version')) {
  console.log(VERSION)
  process.exit(0)
}

const supportedArgs = new Set(['-y', '--yes'])
const unknownArgs = [...args].filter(arg => !supportedArgs.has(arg))
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(', ')}`)
  printHelp()
  process.exit(2)
}

runWechatReview()
  .catch((error) => {
    if (process.stdout.isTTY)
      process.stdout.write('\r\x1B[2K')
    console.error(`失败：${error.message}`)
    process.exitCode = 1
  })
