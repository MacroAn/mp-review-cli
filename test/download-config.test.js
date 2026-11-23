import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { getDownloadDirectory, saveDownloadDirectory } from '../src/download-config.js'

test('installer preserves the saved directory on Enter and accepts a changed directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-config-test-'))
  try {
    const config = path.join(temp, 'mp-review-cli', 'config.json')
    const first = path.join(temp, '下载 空格')
    const second = path.join(temp, 'changed')
    assert.equal(getDownloadDirectory(config), 'D:\\zdownload')
    saveDownloadDirectory(first, config)
    const script = fileURLToPath(new URL('../configure-download.js', import.meta.url))
    const options = { env: { ...process.env, APPDATA: temp }, encoding: 'utf8' }
    execFileSync(process.execPath, [script], { ...options, input: '\n' })
    assert.equal(getDownloadDirectory(config), first)
    execFileSync(process.execPath, [script], { ...options, input: second + '\n' })
    assert.equal(getDownloadDirectory(config), second)
    assert.ok(fs.statSync(second).isDirectory())
    assert.throws(() => saveDownloadDirectory('relative-folder', config), /完整路径/)
    assert.equal(getDownloadDirectory(config), second)
    const file = path.join(temp, 'file.txt')
    fs.writeFileSync(file, 'not a directory')
    assert.throws(() => saveDownloadDirectory(file, config))
    assert.equal(getDownloadDirectory(config), second)
  }
  finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
