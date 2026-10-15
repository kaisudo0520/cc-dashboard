# cc-dashboard

Claude Code mod：在 transcript 旁（或輸入框上方）畫一個即時的任務控制台。只顯示真實的 session 事件與讀數，不做假數字。

以 [Flightdeck](https://github.com/scasella/claude-flightdeck)（Stephen Casella，MIT）為基礎修改：版面、面板與互動沿用 Flightdeck，標籤改成中文，另外加上兩個面板：**Codex 額度**與**分支**（多少檔案未審、多少檔案更新）。

## 面板

| 面板 | 顯示 | 來源 |
| :- | :- | :- |
| **主模型** | 模型、強度、權限模式、請求數；上下文量表與壓縮次數（⟲）；費用與前兩個額度視窗（`5小時`、`7天`，已用 %），56 欄以上加上距重設的時間（↻）；上次主迴圈請求的首字時間與 tok/s | `turn.step`、`session.measure`、`session.compact`、`$.session.usage()` |
| **Codex** | `Codex · <模型> · <強度>`，`5小時`、`每週` 兩個視窗的已用 %（量表）與距重設時間。重設時間過了仍保留最後讀數，前面加 `~`、後面標 `過期`，不會推算成新視窗；讀不到數字時顯示原因（例如 `no usage recorded yet`） | 見下方「Codex 額度」 |
| **分支** | `分支 · <分支名>`、`↔ <upstream> ↑ahead ↓behind`（沒有 upstream 顯示 `無上游`）；**`未審 N 個檔案 · 更新 M 個檔案`**。全部審過顯示 `✓ 未審 0`，無法判斷時顯示 `未審 未知`（絕不顯示成 0）。有未審檔案時 `u` 展開清單（最多 8 行，其餘以 `… 另有 N 個` 計） | 見下方「分支」 |
| **顧問** | 諮詢時間軸、是否正在諮詢、上次耗時；推測的時機（規劃前／連續錯誤／完成前，標 `（推測）`）；子代理顧問建議的第一行 | 符合樣式的 agent 類型，或 assistant 列中的 server tool |
| **權限** | 每次權限檢查一格：綠＝規則允許、藍＝分類器或你允許後執行、黃＝待決、紅 ✗＝拒絕，子代理內的較暗。總計，與依工具類別（`f` 檔案／`s` 指令／`o` 其他）展開最近 5 筆（憑證遮蔽） | `tool.check`，由其後的 `tool.call` 結算 |
| **子代理** | 放得下時並排卡片：任務、類型、ctx 與輸出 tokens、步數、計時、紅色 `max_tokens`；放不下時改為同一時間軸的泳道。`1`–`6` 展開：完整任務、最近 3 個工具呼叫、回答開頭 | `agent.spawn`、`turn.step`、`tool.call`、`turn.complete` |
| **其他迴圈** | 沒有卡片認領的模型迴圈：workflow agent、壓縮、記憶分支 | 沒有卡片的 `turn.step` id |
| **回合收據** | 進行中的回合或上一回合：耗時、子代理數、編輯數、錯誤數、增加的費用 | `turn.start`、`turn.complete` |
| **工作紀錄** | 提示、啟動、完成、諮詢、編輯、錯誤與拒絕；檢視某子代理 transcript 時只列它的 | 以上全部 |

沒東西可顯示的面板不占空間：沒有子代理就沒有子代理面板，不在 git repository 裡就沒有分支面板，讀不到 Codex 就沒有 Codex 面板。寬版（dock 且 110 欄以上）左欄為主模型、Codex、顧問、權限，右欄為分支、子代理、其他迴圈、回合收據，工作紀錄在最下方全寬。在輸入框上方（非全螢幕）時是最多 8 列的摘要，Codex 與分支合成一行：`Codex 5小時 13% · 每週 40%   ⎇ main 未審 2 個檔案 · 更新 5 個檔案`。

## 使用

```
claude --plugin-dir N:\projects\github\cc-dashboard
```

| 指令 | 作用 |
| :- | :- |
| `/dashboard` | 開啟面板 |
| `/dashboard close` | 關閉 |
| `/dashboard reset` | 清掉子代理、檢查、諮詢、紀錄與回合（費用、額度、壓縮次數、Codex 與分支保留） |
| `/dashboard refresh` | 立刻重讀 Codex 額度與分支（不論面板是否顯示） |
| `/dashboard layout auto\|compact\|wide\|mini` | 本 session 的版面 |

用 `ctrl+x tab` 聚焦面板後：`1`–`6` 展開子代理，`f` `s` `o` 展開權限明細，`u` 展開未審清單。`/clear` 會連同對話重設面板（Codex 與分支不受影響）。

## Codex 額度

只讀、只顯示。需要 `USERPROFILE` 與 `SystemRoot`（Windows）；任一個沒有就不讀，Codex 面板不出現。

- 模型：`~/.claude/model-choice.json` 的 `codex`（沒有就顯示規則預設的 `gpt-6-sol`）；強度：`~/.codex/config.toml` 的 `model_reasoning_effort`。
- 視窗：`~/.codex/sessions/YYYY/MM/DD` 下最新的 rollout（最多試 4 個），用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（完整路徑，不靠 PATH）取檔尾 2000 行中含 `"limit_id":"codex"` 的行。rollout 的路徑放在環境變數 `ROLLOUT`，不放進指令文字。依視窗長度分辨 5 小時與每週。
- 新讀數缺某個視窗時保留舊值。每 120 秒一次。

## 分支

只讀的 `git`，經 `$.process.run`（15 秒逾時），每一道都帶 `--no-optional-locks -c core.quotePath=false -c core.fsmonitor=false -c protocol.ext.allow=never` 與環境變數 `GIT_NO_LAZY_FETCH=1`：`rev-parse --show-toplevel`、`config`（列出 filter driver 並對 `status`／`hash-object` 全部關掉；partial clone 整個不讀；列不出來就不往下讀）、`status --ignore-submodules=all --porcelain=v2 --branch -z -uall`、`hash-object --no-filters --stdin-paths`（不帶 `-w`，不寫入物件）。符號連結與落在 repository 外的路徑不雜湊，永遠算未審。輸出被截斷視為失敗。每 30 秒一次，主回合結束後提前一次。

- **更新**＝與 HEAD 不同的檔案數（含未追蹤）。
- **未審**＝已更新、但內容與「最近一次審查所見」不同的檔案數。
- 審查紀錄（本 plugin 唯一的寫入）：自己的 `$.store`，key `git-reviewed:<repository 根目錄>`，值為「路徑 → 內容雜湊」；最多保留最近 8 個 repository、每個 2000 個路徑（超過就存 `too-many-paths`，顯示 `未審 未知`）。只在這些時刻寫入：(1) `Skill` 工具呼叫的 skill 名稱含 `review`；(2) `Agent` 工具呼叫的 `subagent_type` 含 `review`——兩者都在呼叫開始時讀樹，呼叫未被拒絕、未回報錯誤才寫入；(3) 你自己輸入（`composer`／`bridge`／`sdk`）的 `/…review` 斜線指令，送出當下讀樹並寫入。

Codex 與 git 只在面板顯示時輪詢（每 2 秒檢查哪個到期），面板關閉或在背景分頁時不開任何程序。

## 推測，不是量測

- 顧問的時機：「規劃前」＝本回合還沒有編輯，「連續錯誤」＝主迴圈連續 2 次以上錯誤，「完成前」＝已有編輯。標 `（推測）`，`moments: false` 可關掉。
- server 端的顧問（如 `advisor`）內容是加密的：只能計次與計時。
- 子代理的 ctx 是最近一次請求的完整輸入，不是費用。
- 首字時間與 tok/s 是在本 mod 的 `turn.step` hook 量的，包含其下的一切（其他 plugin 的 hook、引擎、網路與重試）。

## 設定

`/config`，或 `settings.json` 的 `pluginConfigs["cc-dashboard"].options`：

| 選項 | 預設 | 說明 |
| :- | :- | :- |
| `architectPattern` | `advisor\|architect` | 算作顧問的 agent 類型與 server tool（正規表示式） |
| `matchDescriptions` | `false` | 也比對 agent 說明 |
| `architectLabel` | `顧問` | 顧問的名稱 |
| `gateLabel` | `權限` | 權限面板的名稱 |
| `panels` | `main,codex,git,architect,gate,agents,loops,receipt,log` | 顯示哪些面板、依序 |
| `layout` | `auto` | `mini`、`compact`、`wide` 或 `auto` |
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
| `hooks/lib/plain.ts`、`system.ts` | 外部字串去控制字元、PowerShell 完整路徑 |
| `types/index.d.ts` | 狀態型別 |
| `tests/` | `dashboard.test.ts`（Flightdeck 原有面板）、`dashboard-extras.test.ts`（Codex、分支、審查、摘要列、輪詢）與各 lib 的單元測試 |

## 測試

```
claude plugin test
claude plugin validate .
npx -p typescript tsc -p .   # 第一次以 --plugin-dir 互動式載入後（會寫出 .claude-plugin/types/）
```

## 授權

MIT，見 [LICENSE](LICENSE)。Flightdeck © Stephen Casella。
