// dsh-lazy-ladder —— 先试最便宜的那一档，再考虑写东西。
//
// 病：碰到活直接开写。写文件、派子进程、装新包，本来都是最后一档的招，
// 却常常第一档就用了。真正的第一档是「有没有现成的」——已经装好的插件、
// 已经写过的脚本、一条命令、一次搜索。
//
// 药分两半：
//   1. 梯子本身（每步都在上下文里，所以它必须短）。走 systemPrompt.section，
//      静态字符串，进缓存前缀，不改就几乎不花钱。
//   2. 违规时才出声：一轮里先动了「产出型」工具（write/edit/subagent/workflow/
//      plugin_manager），而这一轮此前一次探查（read/grep/glob/pwsh/web_search...）
//      都没有，下一次进门补一句提醒。同一会话最多念 maxAlerts 次，念完闭嘴。
//
// v0.2.0 修的真 bug：v0.1.0 的 probes 计数器从不清零，一条会话里只要早早
// read 过一次，之后无论重复多少遍「先动手再查」都不会再响——插件看起来是
// active 的，实际早废了。现在改成按轮计数，每轮第一步归零。
//
// 记账落 logFile，一行一次，供以后数「偷懒率」。任何一步出错都静默跳过——
// 提醒插件不许把会话搞挂。

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'lazy-ladder'
export const inject = ['systemPrompt']

const DEFAULTS = {
  enabled: true,
  /** 同一会话最多念几次。念多了是噪音。 */
  maxAlerts: 2,
  /** 产出型工具：一上来就用它们，说明跳过了找现成的那一档。 */
  heavyTools: ['write', 'edit', 'subagent', 'subagent_fork', 'workflow', 'plugin_manager'],
  /** 探查型工具：这一轮用过任何一个，就不算「没查就动手」。 */
  probeTools: [
    'read',
    'grep',
    'glob',
    'pwsh',
    'web_search',
    'web_fetch',
    'journal',
    'skill',
    'cordis_inspect_list',
    'cordis_inspect_query',
    'list_agents',
    'job_list',
    'working_directory',
    'get_goal',
    'schedule_list',
    'quicksight_ocr',
    'modlens_read_image',
  ],
  logFile: 'D:/dsh-data/ops/lazy-ladder.log',
  /** 梯子正文，一行。它每一步都在请求里。 */
  ladder:
    '【偷懒梯】先试最便宜的，不行再升级：①有没有现成的——已装的插件、写过的脚本、一条命令、一次搜索；②已经在跑的服务直接调，别新起；③一条命令能完事就别建文件；④才写代码，写完先跑最小验证。别一上来就新建、派子进程、装东西。',
  /** 违规时补的那一句。 */
  reminder:
    '【偷懒梯】刚才是先动手再查的。换档：有没有现成的？已装的插件、写过的脚本、一条命令、一次搜索，比新写便宜十倍。真没有，再写。',
}

const MARK = '【偷懒梯】'

export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config ?? {}) }
  const heavy = new Set(options.heavyTools)
  const probe = new Set(options.probeTools)
  let enabled = options.enabled !== false

  /**
   * sessionId -> { turnProbes, pending, alerted }
   *
   * turnProbes 是**本轮**的探查次数，每轮第一步归零（v0.2.0 修的 bug）。
   * pending 表示本轮已经发现一次「没查就动手」，等下次进门补话。
   */
  const state = new Map()
  const stateOf = (id) => {
    let s = state.get(id)
    if (!s) {
      s = { turnProbes: 0, pending: false, alerted: 0 }
      state.set(id, s)
    }
    return s
  }

  const record = (row) => {
    if (!options.logFile) return
    try {
      mkdirSync(dirname(options.logFile), { recursive: true })
      appendFileSync(options.logFile, JSON.stringify(row) + '\n', 'utf8')
    } catch {
      // 记账失败不影响任何事
    }
  }

  // 梯子进提示词：短、静态、进缓存前缀。
  try {
    ctx.systemPrompt.section({ name: 'lazy-ladder', order: 120, text: options.ladder })
  } catch (error) {
    ctx.logger?.warn?.('lazy-ladder: 提示词段没挂上 ' + String(error?.message ?? error))
  }

  // 只观察工具结果，不改它。
  const offResult = ctx.on?.('tools/result', (exec) => {
    try {
      if (!enabled) return
      const session = exec?.agent?.id
      const tool = String(exec?.name ?? '')
      if (!session || !tool) return
      const s = stateOf(session)
      if (probe.has(tool)) {
        s.turnProbes += 1
        // 补过探查了，之前攒的那一条作废。
        s.pending = false
        return
      }
      if (heavy.has(tool) && s.turnProbes === 0 && !s.pending) {
        s.pending = true
        record({ t: Date.now(), session, tool, turnProbes: 0 })
        ctx.logger?.info?.(`lazy-ladder: ${tool} 之前这一轮没查`)
      }
    } catch {
      // 观察者出错绝不外溢
    }
  })

  // 违规后的下一次进门，补一句。
  const offStep = ctx.on?.('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (!enabled || decision?.kind !== 'enter') return decision
      if (payload?.signal?.aborted) return decision
      const session = payload?.agent?.id
      if (!session) return decision
      const s = stateOf(session)

      const step = Number(payload?.step)
      const isNewTurn = !Number.isFinite(step) || step <= 1

      // 新的一轮：探查计数归零，让人有重新做对的机会。
      // pending 不清 —— 上一轮末尾攒下的违规，仍要在这一轮第一次进门前补出来。
      if (isNewTurn) s.turnProbes = 0

      if (!s.pending) return decision
      if (s.alerted >= options.maxAlerts) {
        s.pending = false
        return decision
      }

      s.pending = false
      s.alerted += 1
      const extra = {
        role: 'user',
        content: [{ type: 'text', text: String(options.reminder) }],
        source: { kind: 'lazy-ladder', form: 'notice', summary: '偷懒梯：没查就动手' },
      }
      return { ...decision, messages: [...decision.messages, extra] }
    } catch {
      return decision
    }
  })

  // 会话离开内存时清状态，Map 不随会话数无限长。
  const offDisposed = ctx.on?.('agent/disposed', (payload) => {
    try {
      const session = payload?.agent?.id
      if (session) state.delete(session)
    } catch {
      // 清不掉也无所谓
    }
  })

  // /lazy 看账 + 开关。commands 是可选服务：用 ctx.inject 问一声，
  // 没装就压根不进来，也不会像 ctx.get 那样报「without inject」。
  ctx.inject?.(['commands'], (scoped) => {
    try {
      scoped.commands.register({
        name: 'lazy',
        description: '偷懒梯：不带参数看状态，on/off 开关',
        async handler(invocation) {
          const arg = String(invocation?.rawInput ?? '').trim().toLowerCase()
          if (arg === 'on' || arg === '开') enabled = true
          else if (arg === 'off' || arg === '关') enabled = false
          const alerted = [...state.values()].reduce((a, s) => a + s.alerted, 0)
          return { kind: 'success', text: `偷懒梯：${enabled ? '开' : '关'}；本进程已提醒 ${alerted} 次` }
        },
      })
    } catch (error) {
      ctx.logger?.warn?.('lazy-ladder: /lazy 没挂上 ' + String(error?.message ?? error))
    }
  })

  return () => {
    try {
      offResult?.()
      offStep?.()
      offDisposed?.()
    } catch {
      // 卸载尽力而为
    }
  }
}

export const __test = { DEFAULTS, MARK }
