import assert from 'node:assert/strict'
import test from 'node:test'
import { formatProgress } from '../src/progress.js'

test('formats project and progress as two concise lines', () => {
  assert.equal(
    formatProgress('mp_xiangbu_inner', 'HBuilderX 正在编译并上传版本 2.1.10', '/'),
    '项目：mp_xiangbu_inner\n当前步骤：HBuilderX 正在编译并上传版本 2.1.10 /',
  )
})
