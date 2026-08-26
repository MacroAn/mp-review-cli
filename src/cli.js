#!/usr/bin/env node

import process from 'node:process'
import { getPublishConfig, printPublishConfig, runHBuilderPublish } from './hbuilder-publish.js'
import { runWechatReview } from './wechat-review.js'

const VERSION = '1.4.1'

function printHelp() {
  console.log(`Usage: mp [command] [options]

Commands:
  review            Submit the latest uploaded development version (default)
  config            Validate and display HBuilderX publishing configuration
  full              Build and upload with HBuilderX, then submit that version

Options:
  -h, --help      Show help
  -v, --version   Show version

The login QR code is displayed in the current terminal.
Review mode requires an existing uploaded development version.
Full mode builds and uploads through the configured HBuilderX CLI.
Review notices and final confirmation dialogs are accepted automatically.`)
}

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)

if (args.has('-h') || args.has('--help')) {
  printHelp()
  process.exit(0)
}

if (args.has('-v') || args.has('--version')) {
  console.log(VERSION)
  process.exit(0)
}

const command = rawArgs.find(arg => !arg.startsWith('-')) || 'review'
const supportedCommands = new Set(['review', 'config', 'full'])
const supportedArgs = new Set(['-y', '--yes', command])
const unknownArgs = [...args].filter(arg => !supportedArgs.has(arg))
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(', ')}`)
  printHelp()
  process.exit(2)
}

if (!supportedCommands.has(command)) {
  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exit(2)
}

const operation = async () => {
  if (command === 'review') {
    await runWechatReview()
    return
  }

  const config = getPublishConfig()
  if (command === 'config') {
    printPublishConfig(config)
    return
  }

  printPublishConfig(config)
  await runHBuilderPublish(config)
  await runWechatReview({ expectedVersion: config.version })
}

operation()
  .catch((error) => {
    if (process.stdout.isTTY)
      process.stdout.write('\r\x1B[2K')
    console.error(`失败：${error.message}`)
    process.exitCode = 1
  })
