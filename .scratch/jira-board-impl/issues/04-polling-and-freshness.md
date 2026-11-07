# 04: 轮询与新鲜度

**What to build:** 看板自己能保持新鲜：定时重拉，但数据没变时画面不闪；网络出问题时告诉你「看到的是什么时候的数据」，而不是假装一切正常。

**Blocked by:** 03

**Status:** resolved

- [x] 每隔设定的秒数自动刷新一次，刷新期间界面可交互
- [x] 刷新回来的数据与上一次完全一致时，界面不发生重绘（不闪、不丢滚动位置、不丢选中状态）
- [x] 上一轮请求还没返回时，不发下一轮（不叠加请求）
- [x] 请求超时或失败时，保留上一次成功的数据，并标注「数据可能过期 · 时间」
- [x] 网络恢复后无需手动操作即可回到正常态，过期标注消失
- [x] tab 不在前台时暂停或降频轮询，回到前台立即刷新一次

## Comments

- 轮询用 `setTimeout` 递归排下一轮而不是 `setInterval`：上一轮 `await` 完才排下一轮，天然不会重叠；再加 `inFlight` 布尔闸门挡住手动刷新与轮询撞车。
- 间隔读 `todoPanel.pollIntervalSec`（钳在 30～60s），每轮都重读配置，改完设置不用重载窗口。
- 无变化不重绘：`revision` = 列 + 卡片 + 范围 + notices + stale/error 的指纹（不含 `lastSuccessAt`），相同则扩展不 post、WebView 收到相同 revision 也直接丢弃。Preact 是 keyed diff，不卸载 DOM，所以滚动位置与选中态不会丢。
- 失败：`lastSuccessAt` 保留，`stale=true`，`error` 进横幅；顶栏时间戳显示的是**上次成功**的时间，并带「数据可能过期」。下一次轮询成功后 `stale` 自动回落，不需要手动操作。
- 前台/后台：`BoardPanel.onDidChangeViewState` → `BoardState.setVisible()`；隐藏时清定时器，可见时立刻刷一次再重新排表。关闭 tab 时 `onDisposed` 同样停表。
- `fingerprint` / `revisionOf` 抽到 `src/board/fingerprint.ts`（无 vscode 依赖），有 3 条单测钉住「同数据同指纹、不同数据不同指纹、stale 变化也算变化」。
