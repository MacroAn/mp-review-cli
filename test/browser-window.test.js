import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { captureBrowserWindow, keepBrowserBehindTerminal } from '../src/browser-window.js'

test('native window management excludes link bubbles, tool windows and owned save dialogs', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-window-test-'))
  try {
    const compiler = ['Framework64', 'Framework'].map(folder => path.join(process.env.SystemRoot, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe')).find(p => fs.existsSync(p))
    const executable = path.join(directory, 'window-test.exe')
    execFileSync(compiler, ['/nologo', '/target:exe', '/main:WindowFrameTest', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', `/out:${executable}`,
      fileURLToPath(new URL('../src/browser-window.cs', import.meta.url)), fileURLToPath(new URL('./window-frame.cs', import.meta.url)),
    ], { windowsHide: true, timeout: 15000 })
    assert.match(execFileSync(executable, { windowsHide: true, timeout: 10000, encoding: 'utf8' }), /window classification passed/)
  }
  finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('window capture starts the native helper directly', () => {
  const geometry = { width: 1200, height: 800, left: -1200, top: 40, terminalHandle: '123' }
  const result = captureBrowserWindow({
    platform: 'win32',
    resolveHelper: () => 'window-helper.exe',
    execute: (file, args, options) => {
      assert.equal(file, 'window-helper.exe')
      assert.deepEqual(args, ['capture'])
      assert.equal(options.windowsHide, true)
      assert.equal(options.stdio, 'pipe')
      return JSON.stringify(geometry)
    },
  })
  assert.deepEqual(result, { ...geometry, managed: true })
})

test('helper failures and malformed output do not block the browser workflow', () => {
  for (const execute of [
    () => { throw new Error('native process failed') },
    () => 'invalid JSON',
    () => '{"width":0}',
  ]) {
    const warnings = []
    const geometry = captureBrowserWindow({
      platform: 'win32', resolveHelper: () => 'helper.exe', execute,
      warn: message => warnings.push(message),
    })
    assert.equal(geometry.managed, false)
    assert.equal(geometry.width, 1200)
    assert.equal(warnings.length, 1)
    // A failed capture must not access the browser or start another helper.
    const stop = keepBrowserBehindTerminal(null, geometry)
    assert.doesNotThrow(stop)
  }
})

test('missing compiler degrades to visible browser defaults', () => {
  const geometry = captureBrowserWindow({
    platform: 'win32',
    resolveHelper: () => { throw new Error('compiler unavailable') },
    warn: () => {},
  })
  assert.equal(geometry.managed, false)
})

test('Windows native helper compiles and captures screen geometry', { skip: process.platform !== 'win32' }, () => {
  const geometry = captureBrowserWindow({ warn: message => assert.fail(message) })
  assert.equal(geometry.managed, true)
  assert.ok(geometry.width > 0)
  assert.ok(geometry.height > 0)
})
