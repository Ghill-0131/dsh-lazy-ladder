// 离线自测：假 ctx 跑一遍，验证「这一轮没查就动手 → 下一次进门补一句」。
// 重点回归 v0.1.0 那个 bug：查过一次之后，后面每一轮都要能重新响。
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

const dispose = apply(ctx, { logFile: '', maxAlerts: 10 })

let failures = 0
const check = (label, ok) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + label)
  if (!ok) failures += 1
}

check('梯子进了提示词', sections.length === 1 && sections[0].text.includes('偷懒梯'))
check('/lazy 注册了', commands.length === 1 && commands[0].name === 'lazy')

const next = async () => ({ kind: 'enter', messages: [{ role: 'user', content: [] }] })
const stepOf = (agent, n = 5) =>
  handlers['agent/pre-step']({ agent, step: n, signal: { aborted: false } }, next)
const toolOf = (agent, name) => handlers['tools/result']({ agent, name })

// 1. 没查就用 write：下一次进门补一句。
{
  const a = { id: 'A' }
  toolOf(a, 'write')
  const d = await stepOf(a)
  check('首次违规后补了一句', d.messages.length === 2)
  check('补的是提醒', d.messages[1].content[0].text.startsWith(__test.MARK))
}

// 2. 补过之后不重复念同一条（pending 已清）。
{
  const a = { id: 'A2' }
  toolOf(a, 'write')
  await stepOf(a)
  const d = await stepOf(a)
  check('同一次违规只念一次', d.messages.length === 1)
}

// 3. 回归 v0.1.0 bug：先查后写不响，但下一轮没查就写必须重新响。
{
  const b = { id: 'B' }
  toolOf(b, 'grep')      // 第 1 轮：查过
  toolOf(b, 'write')     // 本轮不算违规
  let d = await stepOf(b, 2)
  check('先查后写不出声', d.messages.length === 1)

  // 用户发新消息，新回合
  d = await stepOf(b, 1)
  check('新回合开头安静', d.messages.length === 1)

  toolOf(b, 'write')     // 第 2 轮：一次都没查
  d = await stepOf(b, 2)
  check('新回合没查就写 必须重新响（v0.1.0 在这里哑了）', d.messages.length === 2)
}

// 4. 新回合里先查再写，不该响。
{
  const c = { id: 'C' }
  await stepOf(c, 1)
  toolOf(c, 'read')
  toolOf(c, 'write')
  const d = await stepOf(c, 2)
  check('新回合先查后写不出声', d.messages.length === 1)
}

// 5. 预算上限。
{
  const d0 = { id: 'D' }
  await commands[0].handler({ rawInput: 'off' })
  await commands[0].handler({ rawInput: 'on' })
  let fired = 0
  for (let round = 0; round < 15; round += 1) {
    await stepOf(d0, 1)
    toolOf(d0, 'write')
    const d = await stepOf(d0, 2)
    if (d.messages.length === 2) fired += 1
  }
  check('预算 maxAlerts=10 生效', fired === 10)
}

// 6. 关掉后安静。
{
  await commands[0].handler({ rawInput: 'off' })
  const z = { id: 'Z' }
  toolOf(z, 'write')
  const d = await stepOf(z)
  check('关掉后安静', d.messages.length === 1)
  await commands[0].handler({ rawInput: 'on' })
}

// 7. reject 原样透传 + 会话销毁不炸。
{
  const w = { id: 'W' }
  const rejected = await handlers['agent/pre-step'](
    { agent: w, step: 1, signal: { aborted: false } },
    async () => ({ kind: 'reject' }),
  )
  check('reject 原样透传', rejected.kind === 'reject')
  handlers['agent/disposed']?.({ agent: w })
  check('会话销毁不炸', true)
}

dispose()
console.log(failures === 0 ? '\nall green' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
