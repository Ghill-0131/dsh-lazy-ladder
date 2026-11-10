# dsh-lazy-ladder

先试最便宜的那一档，不行再升级。

## 治什么

碰到活直接开写：新建文件、派子进程、装新东西——本该是最后一档的招，常常第一档就用了。
真正的第一档是「有没有现成的」：已装的插件、写过的脚本、一条命令、一次搜索。

## 怎么做

**一、梯子进提示词。** 通过 `systemPrompt.section` 注册一行静态文本，每一步的请求里都有：

> ①有没有现成的 ②已经在跑的服务直接调 ③一条命令能完事就别建文件 ④才写代码，写完先跑最小验证

短、静态，进缓存前缀，不改就几乎不花钱。

**二、没查就动手才出声。** 听 `tools/result`：**这一轮**里先动了产出型工具（`write`/`edit`/
`subagent`/`workflow`/`plugin_manager`），而这一轮此前一次探查（`read`/`grep`/`glob`/`pwsh`/
`web_search`/`journal`/`skill`/`cordis_inspect_*`…）都没有——下一次 `agent/pre-step`
追加一句提醒。同一会话最多念 `maxAlerts` 次，念完闭嘴。

**三、记账。** 每次违规往 `logFile` 写一行（时间、会话、工具），以后能数「偷懒率」。
写日志失败一律静默：提醒插件不许把会话搞挂。

## 0.2.0 修了什么

v0.1.0 的探查计数 `probes` 从不清零。一条会话里只要早早 `read` 过一次，
之后无论重复多少遍「先动手再查」都不再响——插件看着是 active 的，实际早废了。

实测对比（同一场景，先查一次，之后连续 5 个回合都是「没查就写」）：

| 版本 | 实际提醒次数 |
|---|---|
| 0.1.0 | 0 |
| 0.2.0 | 2（受默认 `maxAlerts: 2` 限） |

现在改成按**轮**计数，每轮第一步（`step <= 1`）归零。上一轮末尾攒下的违规仍然保留，
在新一轮第一次进门前补出来，不会因为跨轮丢掉。

顺带的两处：

- 补过探查（这一轮中途 `read` 了）会取消已经攒下的那条提醒——听见了就别再念。
- 加 `agent/disposed` 清理会话状态，`Map` 不再随会话数无限长。

## 配置

```yaml
- insert:
    - id: lazy-ladder
      name: 'dsh-lazy-ladder'
      config:
        enabled: true
        maxAlerts: 2
        logFile: 'D:/dsh-data/ops/lazy-ladder.log'
        ladder: '……'
        reminder: '……'
```

`heavyTools` / `probeTools` 两组名单也可在 config 里整体替换，默认就是上面列的。

## 命令

`/lazy` 看状态，`/lazy off` 关，`/lazy on` 开。

## 自测

```bash
node _selftest.mjs
```

13 条，离线跑，不需要 DSH 在运行。其中一条专盯 0.2.0 修的 bug。

## 边界

- 只加提示词、只补一句旁白，不改请求参数、不拦工具、不动任何会话事件。
- 记的是「这一轮前面查过没有」，不是「答得对不对」。它管顺序，不管内容。
- 参数都放在 patch 里，升级插件不会冲掉你的值。

## License

MIT
