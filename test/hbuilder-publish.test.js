import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertPublishSucceeded,
  buildPublishArgs,
  getPublishConfig,
  hasRunAsAdminFlag,
  parseHBuilderProcessIds,
} from '../src/hbuilder-publish.js'

test('resolves JSON5 project configuration and builds HBuilderX publish arguments', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-review-cli-'))
  try {
    const cliPath = path.join(projectRoot, 'cli.exe')
    const keyPath = path.join(projectRoot, 'upload.key')
    fs.writeFileSync(cliPath, '')
    fs.writeFileSync(keyPath, '')
    fs.writeFileSync(path.join(projectRoot, 'manifest.json'), `{
      // DCloud manifest files allow comments.
      "versionName": "3.2.1",
      "mp-weixin": { "appid": "wx-test-appid" }
    }`)
    fs.writeFileSync(path.join(projectRoot, '.mp-review.json'), JSON.stringify({
      description: 'release description',
      hbuilderCli: './cli.exe',
      privateKey: './upload.key',
      project: 'sample-project',
      robot: 2,
      sourceMap: true,
      subPackage: 'hybrid-package',
    }))

    const config = getPublishConfig(projectRoot)
    assert.equal(config.appid, 'wx-test-appid')
    assert.equal(config.version, '3.2.1')
    assert.equal(config.hbuilderCli, cliPath)
    assert.equal(config.privateKey, keyPath)
    assert.deepEqual(buildPublishArgs(config), [
      'publish',
      '--platform', 'mp-weixin',
      '--project', 'sample-project',
      '--upload', 'true',
      '--appid', 'wx-test-appid',
      '--description', 'release description',
      '--version', '3.2.1',
      '--privatekey', keyPath,
      '--robot', '2',
      '--sourceMap', 'true',
      '--subPackage', 'hybrid-package',
    ])
  }
  finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('treats HBuilderX error output as failure even with exit code zero', () => {
  assert.throws(
    () => assertPublishSucceeded(0, '未检测到已打开的HBuilderX，请先执行cli open启动HBuilderX后再重试'),
    /HBuilderX 发行上传失败/,
  )
  assert.doesNotThrow(() => assertPublishSucceeded(0, '上传成功'))
})

test('parses HBuilderX process ids from Windows tasklist output', () => {
  assert.deepEqual(
    parseHBuilderProcessIds('"HBuilderX.exe","7560","Console","1","120,000 K"\r\n'),
    ['7560'],
  )
  assert.deepEqual(parseHBuilderProcessIds('INFO: No tasks are running'), [])
})

test('detects Windows RUNASADMIN compatibility flags', () => {
  assert.equal(hasRunAsAdminFlag('C:\\Program Files\\HBuilderX\\HBuilderX.exe    REG_SZ    ~ RUNASADMIN'), true)
  assert.equal(hasRunAsAdminFlag('C:\\Program Files\\HBuilderX\\HBuilderX.exe    REG_SZ    IgnoreFreeLibrary'), false)
})

test('elevated PowerShell helper preserves UTF-8 arguments and output', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-review-cli-encoding-'))
  try {
    const fakeCliScript = path.join(temporaryDirectory, 'fake-cli.js')
    const fakeCliCommand = path.join(temporaryDirectory, 'fake-cli.cmd')
    const requestPath = path.join(temporaryDirectory, 'request.json')
    const resultPath = path.join(temporaryDirectory, 'result.json')
    fs.writeFileSync(fakeCliScript, `
      const args = process.argv.slice(2)
      console.log(args[0] === 'help' ? 'HBuilderX CLI ready' : JSON.stringify(args))
    `)
    fs.writeFileSync(fakeCliCommand, '@echo off\r\nnode "%~dp0fake-cli.js" %*\r\n')
    fs.writeFileSync(requestPath, JSON.stringify({
      arguments: ['publish', '--description', '点色配桶增加参数'],
      cliPath: fakeCliCommand,
      cwd: temporaryDirectory,
      resultPath,
    }))

    const helperPath = path.resolve('elevated-hbuilder.ps1')
    const result = spawnSync('powershell.exe', [
      '-NoLogo',
      '-NonInteractive',
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', helperPath,
      '-RequestPath', requestPath,
    ], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)

    const helperResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    assert.match(helperResult.output, /点色配桶增加参数/)
  }
  finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})
