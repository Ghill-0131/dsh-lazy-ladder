// 离线自测：用一个假 ctx 跑一遍，验证「没查就动手 -> 下一次进门补一句」这条路径。
// node _selftest.mjs

import { apply, __test } from './lib/index.js'

const handlers = {}
const sections = []
const commands = []

const ctx = {
  logger: { info() {}, warn() {} },
  on(name, fn) {
    handlers[name] = fn
    return () => delete handlers[name]
  },
  get(name) {
    if (name !== 'systemPrompt') return undefined
    return ctx.systemPrompt
  },
  inject(deps, fn) {
    if (deps.includes('commands')) fn({ commands: { register: (def) => (commands.push(def), () => {}) } })
  },
  systemPrompt: {
    section(sec) {
      sections.push(sec)
      return () => {}
    },
  },
}

const dispose = apply(ctx, { logFile: '' })

let failures = 0
const check = (label, ok) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + label)
  if (!ok) failures += 1
}

check('梯子进了提示词', sections.length === 1 && sections[0].text.includes('偷懒梯'))
check('/lazy 注册了', commands.length === 1 && commands[0].name === 'lazy')

const agent = { id: 'session-test' }
const next = async () => ({ kind: 'enter', messages: [{ role: 'user', content: [] }] })

// 1. 没查就用 write：记事，但这一下不出声（还没到下一次进门）。
handlers['tools/result']({ agent, name: 'write' })
let decision = await handlers['agent/pre-step']({ agent, signal: { aborted: false } }, next)
const said = decision.messages.length
check('首次违规后补了一句', said === 2)
check('补的是提醒', decision.messages[1].content[0].text.startsWith(__test.MARK))

// 2. 同一条会话第二次违规：超过 maxAlerts，不再出声。
handlers['tools/result']({ agent, name: 'edit' })
decision = await handlers['agent/pre-step']({ agent, signal: { aborted: false } }, next)
check('第二次违规后出声', decision.messages.length === 2)

handlers['tools/result']({ agent, name: 'edit' })
decision = await handlers['agent/pre-step']({ agent, signal: { aborted: false } }, next)
check('第三次违规后闭嘴', decision.messages.length === 1)

// 3. 先查后写：不算违规。
const other = { id: 'session-clean' }
handlers['tools/result']({ agent: other, name: 'grep' })
handlers['tools/result']({ agent: other, name: 'write' })
decision = await handlers['agent/pre-step']({ agent: other, signal: { aborted: false } }, next)
check('先查后写不出声', decision.messages.length === 1)

// 4. 关掉后不再出声。
await commands[0].handler({ rawInput: 'off' })
handlers['tools/result']({ agent, name: 'write' })
decision = await handlers['agent/pre-step']({ agent, signal: { aborted: false } }, next)
check('关掉后安静', decision.messages.length === 1)

dispose()
console.log(failures === 0 ? '\nall green' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
