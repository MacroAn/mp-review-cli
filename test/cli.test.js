import assert from 'node:assert/strict'
import test from 'node:test'
import { main } from '../src/cli.js'

for (const [choice, expected] of [['1', 'review'], ['2', 'release'], ['0', 'exit']]) {
  test('menu choice ' + choice + ' runs only ' + expected, async () => {
    const calls = []
    await main([], {
      prompt: async () => choice,
      review: async () => calls.push('review'),
      release: async () => calls.push('release'),
      finish: () => calls.push('exit'),
    })
    assert.deepEqual(calls, [expected])
  })
}

test('invalid menu choice retries before starting the selected operation', async () => {
  const answers = ['wrong', '', ' 1 ']
  let reviews = 0
  await main([], {
    prompt: async () => answers.shift(),
    review: async () => { reviews++ },
  })
  assert.equal(reviews, 1)
  assert.equal(answers.length, 0)
})

test('removed commands fail before opening a browser', async () => {
  for (const command of ['f', 'full', 'c', 'config', 'review', 'release', 'r', '--visible', '--yes']) {
    await assert.rejects(main([command]), /请直接运行 mp/)
  }
})
