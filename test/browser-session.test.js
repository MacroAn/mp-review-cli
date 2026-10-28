import assert from 'node:assert/strict'
import test from 'node:test'
import { withBrowserSession } from '../src/browser-session.js'
import { openAuthenticatedVersionPage } from '../src/wechat-review.js'

test('failure preserves the browser until the user acknowledges the error', async () => {
  const events = []
  let acknowledge
  const acknowledgement = new Promise(resolve => { acknowledge = resolve })
  const error = new Error('review page failed')
  error.step = '打开审核资料'
  const result = withBrowserSession({ close: async () => events.push('close') }, 'test', async () => { throw error }, {
    interactive: true,
    report: message => events.push(message),
    prompt: async () => { events.push('pause'); await acknowledgement },
  })
  const rejected = assert.rejects(result, error)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, ['review page failed', 'pause'])
  acknowledge()
  await rejected
  assert.equal(events.at(-1), 'close')
  assert.equal(error.reported, true)
})

test('successful operation closes automatically without asking for confirmation', async () => {
  let closed = false
  const value = await withBrowserSession({ close: async () => { closed = true } }, 'test', async () => 42, {
    interactive: true, prompt: async () => assert.fail('success must not wait for confirmation'),
  })
  assert.equal(value, 42)
  assert.equal(closed, true)
})

test('login redirect interruption retries navigation before reading version cards', async () => {
  let calls = 0
  let ready = false
  await openAuthenticatedVersionPage({
    goto: async () => { if (++calls === 1) throw new Error('net::ERR_ABORTED') },
    waitForFunction: async () => { ready = true },
  }, 'test', { retryDelay: 0 })
  assert.equal(calls, 2)
  assert.equal(ready, true)
})

test('non-transient navigation errors are reported without retrying', async () => {
  let calls = 0
  await assert.rejects(openAuthenticatedVersionPage({
    goto: async () => { calls++; throw new Error('net::ERR_NAME_NOT_RESOLVED') },
  }, 'test', { retryDelay: 0 }), /ERR_NAME_NOT_RESOLVED/)
  assert.equal(calls, 1)
})
