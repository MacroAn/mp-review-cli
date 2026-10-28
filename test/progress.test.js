import assert from 'node:assert/strict'
import test from 'node:test'
import { formatProgress } from '../src/progress.js'

test('formats project and progress as two concise lines', () => {
  assert.equal(
    formatProgress('mp_xiangbu_inner', '正在提交审核版本 2.1.10', '...'),
    '项目：mp_xiangbu_inner\n当前步骤：正在提交审核版本 2.1.10 ...',
  )
})
