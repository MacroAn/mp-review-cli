import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { formatProgress } from '../src/progress.js'

test('formats project and progress as two concise lines', () => {
  assert.equal(
    formatProgress('mp_xiangbu_inner', '正在提交审核版本 2.1.10', '...'),
    '项目：mp_xiangbu_inner\n当前步骤：正在提交审核版本 2.1.10 ...',
  )
})

test('waiting spinner preserves the terminal QR until login succeeds', () => {
  const moduleUrl = new URL('../src/progress.js', import.meta.url).href
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { showQr, startSpinner, updateProgress, finishProgress } from ${JSON.stringify(moduleUrl)};
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    showQr('test', '请扫码登录', 'QR-ROW-1\\nQR-ROW-2');
    const stop = startSpinner('test', '等待扫码登录');
    process.stdout.write('|WAIT|');
    stop();
    process.stdout.write('|AUTHENTICATED|');
    updateProgress('test', '登录成功');
    finishProgress('test', '完成');
  `], { encoding: 'utf8' })
  const [waiting, authenticated] = output.split('|AUTHENTICATED|')
  assert.match(waiting, /QR-ROW-1\nQR-ROW-2\|WAIT\|/)
  assert.doesNotMatch(waiting, /\x1B\[/)
  assert.match(authenticated, /\x1B\[2A/)
  assert.match(authenticated, /登录成功/)
})
