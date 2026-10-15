# cc-dashboard

Claude Code mod：在 transcript 旁（或輸入框上方）畫一個即時的任務控制台。只顯示真實的 session 事件與讀數，不做假數字。

以 [Flightdeck](https://github.com/scasella/claude-flightdeck)（Stephen Casella，MIT）為基礎修改：版面、面板、互動與英文標籤沿用 Flightdeck，另外加上：**Codex 額度**與**分支**（多少檔案未審、多少檔案更新）兩個面板、主模型框裡的 **Fable 週額度**、**其他 session 等你回應**的紅字提醒，以及把 **`codex exec` 執行當成子代理**顯示。

## 面板

| 面板 | 顯示 | 來源 |
| :- | :- | :- |
| **等你回應**（標頭下一行紅字） | 只在「另一個仍在執行的 Claude Code session 正在等你」時出現：`! waiting on you: <session 名稱> <permission／question> <等待時間，如 3m ago>`，多個時加 ` · +<n> more`（等最久的在前）。沒人在等就整行不存在 | 見下方「等你回應」 |
| **主模型** | 模型、強度、權限模式、請求數；前兩個額度視窗（`5h`、`7d`）與 **Fable 週額度**各占一行：撐開的 `━─` 長條、已用 %、距重設的時間（⏱），過了重設時間就視為已重設，顯示 `~0%` 與 `stale`（等新讀數到來），Fable 上次讀取失敗時標籤為 `Fable~`；同一框內的長條等長、對齊；上次主迴圈請求的首字時間與 tok/s（`last req  ttft 0.8s · 42 tok/s`）；最下方單獨一行上下文量表 `ctx` 與壓縮次數（⟲） | `turn.step`、`session.measure`、`session.compact`、`$.session.usage()`；Fable 見下方 |
| **Codex** | `Codex · <模型> · <強度>`，`5h`、`weekly` 兩個視窗各占一行：已用 % 長條與距重設時間。重設時間過了就視為已重設（Codex 在重設後第一個請求才開新視窗），顯示 `~0%` 並標 `stale`，等新讀數到來；讀不到數字時顯示原因（例如 `no usage recorded yet`） | 見下方「Codex 額度」 |
| **分支** | `branch · <分支名>`、`↔ <upstream> ↑ahead ↓behind`（沒有 upstream 顯示 `no upstream`）；**`unreviewed N files · changed M files`**。全部審過顯示 `✓ unreviewed 0`，無法判斷時顯示 `unreviewed ?`（絕不顯示成 0）。有未審檔案時 `u` 展開清單（最多 8 行，其餘以 `… N more` 計） | 見下方「分支」 |
| **顧問** | 諮詢時間軸、是否正在諮詢、上次耗時；推測的時機（`before a plan`／`error repeats`／`before done`，標 `(inferred)`）；子代理顧問建議的第一行 | 符合樣式的 agent 類型，或 assistant 列中的 server tool |
| **權限** | 每次權限檢查一格：綠＝規則允許、藍＝分類器或你允許後執行、黃＝待決、紅 ✗＝拒絕，子代理內的較暗。總計，與依工具類別（`f` file／`s` shell／`o` other）展開最近 5 筆（憑證遮蔽） | `tool.check`，由其後的 `tool.call` 結算 |
| **子代理** | 放得下時並排卡片：任務、類型、ctx 與輸出 tokens、步數、計時、紅色 `max_tokens`；放不下時改為同一時間軸的泳道。`1`–`6` 展開：完整任務、最近 3 個工具呼叫、回答開頭。**`codex exec` 也是一張卡片**：類型 `Codex`、任務為用途（`Codex plan draft`／`Codex review`／`Codex resume`／`Codex`，加上呼叫的 description），計入 running，不顯示 Codex session id | `agent.spawn`、`turn.step`、`tool.call`、`turn.complete`；Codex 見下方 |
| **其他迴圈** | 沒有卡片認領的模型迴圈：workflow agent、壓縮、記憶分支 | 沒有卡片的 `turn.step` id |
| **回合收據** | 進行中的回合或上一回合：耗時、子代理數、編輯數、錯誤數 | `turn.start`、`turn.complete` |
| **工作紀錄** | 提示、啟動、完成、諮詢、編輯、錯誤與拒絕；檢視某子代理 transcript 時只列它的 | 以上全部 |

沒東西可顯示的面板不占空間：沒有子代理就沒有子代理面板，不在 git repository 裡就沒有分支面板，讀不到 Codex 就沒有 Codex 面板。寬版（dock 且 110 欄以上）左欄為主模型、Codex、顧問、權限，右欄為分支、子代理、其他迴圈、回合收據，工作紀錄在最下方全寬。在輸入框上方（非全螢幕）時是最多 8 列的摘要：第一列是模型、上下文與 Claude 的 `5h 2% · 7d 3%`（來自 API 回應，session 的第一次回應之後才有），紅字提醒在第二行，Fable、Codex 與分支合成一行：`Fable 31%   Codex 5h 13% · weekly 40%   ⎇ main unreviewed 2 files · changed 5 files`（這兩行出現時子代理少列幾個，總數不超過 8）。

## 側欄（全螢幕）

`/tui fullscreen`（或 `settings.json` 的 `"tui": "fullscreen"`，下次啟動生效）後，面板停靠在 transcript 右側，寬度為終端的 `dockPercent`%（預設 40%，扣掉邊框，最窄 40 欄），視窗縮放後約 2 秒內跟著調整。終端寬度只在終端機的面板繪製或執行 `/dashboard` 時讀得到，所以剛啟動時先用引擎預設寬度，第一次繪製後才換成比例寬度；附掛的 Desktop／手機畫面不影響。手動拖過的寬度優先（引擎規則）。全螢幕版面 110 欄起才停靠；session 開始時自動開啟（沒人要求）則要 144 欄，窄一點時用 `/dashboard` 開。

## 使用

```
claude --plugin-dir N:\projects\github\cc-dashboard
```

| 指令 | 作用 |
| :- | :- |
| `/dashboard` | 開啟面板 |
| `/dashboard close` | 關閉 |
| `/dashboard reset` | 清掉子代理、檢查、諮詢、紀錄與回合（額度、壓縮次數、Codex 與分支保留） |
| `/dashboard refresh` | 立刻重讀 Codex 額度、分支與其他 session 的等待（不論面板是否顯示；Fable 照自己的排程） |
| `/dashboard layout auto\|compact\|wide\|mini` | 本 session 的版面 |

用 `ctrl+x tab` 聚焦面板後：`1`–`6` 展開子代理，`f` `s` `o` 展開權限明細，`u` 展開未審檔案清單。`/clear` 會連同對話重設面板（Codex 與分支不受影響）。

## Codex 額度

只讀、只顯示。需要 `USERPROFILE` 與 `SystemRoot`（Windows）；任一個沒有就不讀，Codex 面板不出現。

- 模型：`~/.claude/model-choice.json` 的 `codex`（沒有就顯示規則預設的 `gpt-6-sol`）；強度：`~/.codex/config.toml` 的 `model_reasoning_effort`。
- 視窗：從 `~/.codex/sessions/YYYY/MM/DD` 最近 14 個日期資料夾中（累計列到 200 個檔就不再往更舊的資料夾找；某個資料夾列不出來就當作空的），依每個檔案自己的最後修改時間（逐檔向系統查，不用目錄列表上可能過時的時間；查不到時沿用列表上的時間）挑最近修改的 2 個 rollout（長時間續用的舊 session 仍寫在原本的檔案裡；這 2 個都讀不到 codex 讀數時才再讀接下來的 2 個，最多 4 個），取事件時間 `timestamp` 最晚的讀數（相同時取最近修改的；沒有可解析時間的讀數視為最舊）。每個 rollout 各跑一次指令（每次更新通常 2 次，最多 4 次），用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（完整路徑，不靠 PATH）取檔尾 2000 行中含 `"limit_id":"codex"` 的行。rollout 的路徑放在環境變數 `ROLLOUT`，不放進指令文字。依視窗長度分辨 5 小時與每週。
- 新讀數缺某個視窗時保留舊值。每 120 秒一次。

## Fable 週額度

`GET https://api.anthropic.com/api/oauth/usage`，由引擎的授權 handle 代為帶憑證（plugin 拿不到憑證，且只有 bearer 登入可用；不是 bearer 就不發請求、不顯示）。取 `limits[]` 中 `kind` 為 `weekly_scoped`、模型名稱含 Fable 的那筆。每 90 秒一次，失敗後等待時間加倍、最長 10 分鐘（或遵守較長的 `retry-after`），失敗時保留上次數字並把標籤改成 `Fable~`；該視窗的重設時間過了之後顯示 `~0%`。

## 等你回應

- **讀（其他 session）**：本機 session registry `~/.claude/sessions/<pid>.json`（只讀最新的 32 個、64 KB 以下、檔名為數字的一般檔案），加上行程表 `%SystemRoot%\System32\tasklist.exe /FO CSV /NH`（完整路徑，15 秒逾時），只算 pid 仍是 `claude`／`node` 的 session；再讀它們的標記檔 `~/.claude/mods-state/status-sidebar/waiting/<pid>.json`，檔內 `sessionId` 必須與 registry 相同（pid 被重用的舊檔不算）。標記約每 5 秒讀一次，registry 與 `tasklist` 約每 30 秒。任何一步讀不到就不顯示（不猜）。
- **寫（本 session 自己的）**：同一個資料夾、與 status-sidebar 相同格式 `{"sessionId":…,"reason":"permission"｜"question"｜null,"sinceMs":…}`，所以兩邊的 session 互看得到。`classic.PermissionRequest` 寫 `permission`，`AskUserQuestion`／`ExitPlanMode` 開始時寫 `question`；該呼叫回傳、你輸入新的 prompt、主回合結束、session 結束時清除。事件驅動，面板沒開也會寫。
- 權限等待只知道何時開始、要等該呼叫回傳才結束，所以是「可能」在等你。session 名稱經 `plain()` 去掉控制字元後才畫。

## Codex 執行（子代理）

主對話經 Bash 或 PowerShell 執行的 `codex exec`／`codex exec resume`（子代理的呼叫不算）。只在「指令位置」才算：引號內、註解、heredoc 本體、PowerShell here-string 裡提到的 `codex exec` 都不是執行（遮蔽與比對為單次掃描，只看前 64 KB）。用途依指令判斷：`resume` 為 `Codex resume`，`--sandbox read-only` 為 `Codex plan draft`，`workspace-write` 為 `Codex review`，其他為 `Codex`；卡片的模型取自 Codex 面板讀到的模型。

- 前景執行：呼叫回傳時結束，`isError` 或被拒絕為失敗。
- 轉成背景（結果帶 `backgroundTaskId`）：卡片持續執行中，由 `task-notification` 通知結束（只認 `<summary>` 之前的 `task-id`、`tool-use-id`、`status`；`failed`／`killed` 或非 0 結束碼為失敗）。通知不會讓本 mod 開任何檔案。
- 每回合結束的 `classic.Stop` 核對：仍掛著的前景執行推斷為失敗，引擎清單裡已沒有的背景執行推斷為完成。

## 分支

只讀的 `git`，經 `$.process.run`（15 秒逾時），每一道都帶 `--no-optional-locks -c core.quotePath=false -c core.fsmonitor=false -c protocol.ext.allow=never` 與環境變數 `GIT_NO_LAZY_FETCH=1`：`rev-parse --show-toplevel`、`config`（列出 filter driver 並對 `status`／`hash-object` 全部關掉；partial clone 整個不讀；列不出來就不往下讀）、`status --ignore-submodules=all --porcelain=v2 --branch -z -uall`、`hash-object --no-filters --stdin-paths`（不帶 `-w`，不寫入物件）。符號連結與落在 repository 外的路徑不雜湊，永遠算未審。輸出被截斷視為失敗。每 30 秒一次，主回合結束後提前一次。

- **更新**＝與 HEAD 不同的檔案數（含未追蹤）。
- **未審**＝已更新、但內容與「最近一次審查所見」不同的檔案數。
- 審查紀錄（本 plugin 唯一的寫入）：自己的 `$.store`，key `git-reviewed:<repository 根目錄>`，值為「路徑 → 內容雜湊」；最多保留最近 8 個 repository、每個 2000 個路徑（超過就存 `too-many-paths`，顯示 `unreviewed ?`）。只在這些時刻寫入：(1) `Skill` 工具呼叫的 skill 名稱含 `review`；(2) `Agent` 工具呼叫的 `subagent_type` 含 `review`——兩者都在呼叫開始時讀樹，呼叫未被拒絕、未回報錯誤才寫入；(3) 你自己輸入（`composer`／`bridge`／`sdk`）的 `/…review` 斜線指令，送出當下讀樹並寫入。

Fable、Codex、git 與其他 session 的等待只在面板顯示時輪詢（每 2 秒檢查哪個到期），面板關閉或在背景分頁時不發請求、不開任何程序。例外：為了知道自己標記檔的檔名，session 啟動時（或要寫標記而 pid 還不知道時）會查一次 registry 與 `tasklist`。

## 推測，不是量測

- 顧問的時機：`before a plan`＝本回合還沒有編輯，`error repeats`＝主迴圈連續 2 次以上錯誤，`before done`＝已有編輯。標 `(inferred)`，`moments: false` 可關掉。
- server 端的顧問（如 `advisor`）內容是加密的：只能計次與計時。
- 子代理的 ctx 是最近一次請求的完整輸入，不是費用。
- 首字時間與 tok/s 是在本 mod 的 `turn.step` hook 量的，包含其下的一切（其他 plugin 的 hook、引擎、網路與重試）。

## 設定

`/config`，或 `settings.json` 的 `pluginConfigs["cc-dashboard"].options`：

| 選項 | 預設 | 說明 |
| :- | :- | :- |
| `architectPattern` | `advisor\|architect` | 算作顧問的 agent 類型與 server tool（正規表示式） |
| `matchDescriptions` | `false` | 也比對 agent 說明 |
| `architectLabel` | `ARCHITECT` | 顧問的名稱 |
| `gateLabel` | `GATE` | 權限面板的名稱 |
| `panels` | `main,codex,git,architect,gate,agents,loops,receipt,log` | 顯示哪些面板、依序 |
| `layout` | `auto` | `mini`、`compact`、`wide` 或 `auto` |
| `dockPercent` | `40` | 全螢幕時側欄占終端寬度的百分比（20–80） |
| `maxCards` | `3` | 並排卡片數上限（1–6） |
| `motion` | `while-active` | `off` 讓連接線靜止 |
| `moments` | `true` | 顯示推測的諮詢時機 |
| `palette` | `theme` | `pastel` 為深色終端機的固定色 |
| `openOnStart` | `true` | session 開始時開啟面板 |
| `statusLine` | `true` | 在狀態列顯示上下文、子代理、諮詢與拒絕 |

## 結構

| 檔案 | 內容 |
| :- | :- |
| `hooks/register.tsx` | 事件 hook、狀態存取、Codex／git 的 I/O 與輪詢、每個面板的繪製（所有碰 `$` 的程式都在這裡） |
| `hooks/core.ts` | 所有 reducer、格式化與版面規則（純函式），含 Codex 視窗與分支文字 |
| `hooks/rail.tsx`、`hooks/elapsed.tsx` | surface 模組：動畫連接線與計時器 |
| `hooks/lib/codex-quota.ts` | Codex rollout、config、model-choice 的解析與走訪（收讀取函式，不碰 `$`） |
| `hooks/lib/git.ts`、`git-tree.ts`、`git-filters.ts` | git status 解析、只讀 git 指令、filter 關閉、未審計算 |
| `hooks/lib/review-store.ts` | 審查紀錄的讀寫與上限 |
| `hooks/lib/fable.ts` | Fable 回應的解析與退避時間 |
| `hooks/lib/sessions.ts`、`waiting.ts`、`serial.ts` | registry／tasklist 解析、等待標記的格式與提醒文字、依序寫入的佇列 |
| `hooks/lib/codex.ts`、`shell-mask.ts`、`notify.ts` | 判斷 `codex exec` 與用途、遮掉 shell 裡不是程式碼的部分、背景任務通知 |
| `hooks/lib/plain.ts`、`system.ts` | 外部字串去控制字元與「多久以前」（`3m ago`）、`tasklist`／PowerShell 完整路徑 |
| `types/index.d.ts` | 狀態型別 |
| `tests/` | `dashboard.test.ts`（Flightdeck 原有面板）、`dashboard-extras.test.ts`（Codex 額度、分支、審查、Fable、等你回應、Codex 卡片、摘要列、輪詢）與各 lib 的單元測試 |

## 測試

```
claude plugin test
claude plugin validate .
npx -p typescript tsc -p .   # 第一次以 --plugin-dir 互動式載入後（會寫出 .claude-plugin/types/）
```

## 授權

MIT，見 [LICENSE](LICENSE)。Flightdeck © Stephen Casella。
