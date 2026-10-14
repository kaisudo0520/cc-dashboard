# cc-dashboard

Claude Code mod：在 transcript 旁的 dock Pane 畫一個即時「任務控制台」。只顯示真實資料，不做假數字。

## 內容

- **額度標頭**（最上方，青框，顯示「剩餘」）：寬版左 Claude、右 Codex；窄版為六行精簡文字。標題 `1: ▾ 額度 · 剩餘` 是按鈕，熱鍵 `1`（pane 取得焦點時）或點按收合成只剩這一行（`▸`），再按展開；收合時寬版少 6 列、窄版少 5 列，多出的列給 SESSION LOG 與子代理。
  - Claude：`Claude 模型 · effort`；`5小時`、`1週`、`Fable`，每列為剩餘長條、百分比與重設倒數。額度標頭沒有 CTX 列，context 只由下方的 Context 條顯示。
  - Codex（只讀顯示）：`Codex 模型 · effort`，`5小時`、`每週`；讀不到數字時在下方顯示原因（例如 `no usage recorded yet`）。
  - 一律只顯示真實數字，未知顯示 `—`。視窗的重設時間過了之後保留最後一次讀數、百分比前加 `~`、右欄改為 `過期`，**不會**推算成 100%，直到新讀數到來。Fable 請求失敗時保留舊值，標籤變成 `Fable~`。
- **等待提醒**（額度標頭下方，紅字一行，窄版同為一行並截斷）：只在「另一個仍在執行的 Claude Code session 正在等你」時出現，格式 `! 等你回應：<session 名稱> <權限／提問> <等待時間>`，多個時加 ` · 另有 <n>`（排最久的那個在前）；沒有人在等就整行不存在、不占列。等待時間是從該 session 開始等到現在（`剛剛`／`N分前`／`N時前`）。權限等待只知道何時開始、要等該呼叫回傳才結束，所以是「可能」在等你。提醒占的那一列向 SESSION LOG 借，不影響 MAIN、子代理方塊、CODEX 與分支欄。`tasklist` 或 session registry 讀不到時**不顯示**（不猜）。
- **標頭／圖例**：`CC DASHBOARD`、主模型與 effort；`■ 主模型 · lead`、`■ 子代理模型 · swarm`、`■ 顧問模型 · advisor`（橘／藍／紫）。顧問沒在用（沒設 `advisorModel` 且諮詢 0 次）時，`advisor` 圖例項目不畫。
- **MAIN 區塊**（橘框）：模型、effort、目前活動（閒置／思考中／執行工具 X）、回合數與本回合經過時間。
- **ADVISOR 欄**（紫框，左）：`settings` 的 `advisorModel`、顧問諮詢次數與最近一次時間。**沒設定顧問模型、也沒有任何諮詢時整欄（含窄版的顧問行）不畫**，寬度與高度讓給子代理方塊；一旦設了模型或發生第一次諮詢就自動出現（沒有模型但有諮詢時模型欄顯示 `on`）。`/clear` 只清掉諮詢次數，設定的模型保留。
- **子代理方塊**（藍框，右）：每個子代理的類型、模型、狀態圖示、任務描述與經過時間（只在 `$.agent.list()` 看到、不知起點的子代理顯示 `—`）。顯示執行中的，再補最近結束的，數量依 pane 高度。**結束的列只在結束後 60 秒內顯示**，之後不再畫（結束時間不明的立刻不畫）；SESSION LOG 的紀錄保留。子代理區只保留「要畫的列數」那麼多的位置（執行中的加上 60 秒內結束的，最多 4 個），沒有任何一列時整個區域不畫（也沒有「尚無子代理」方框），省下的列數都給 SESSION LOG；列到期或新子代理開始，下一次繪製就重新配置。引擎在全部閒置時會停掉重繪計時器，所以到期時另排一次性的重繪（`$.clock.after`，同時最多一個，沒有列要到期時就沒有）。
- **CODEX 區塊**（綠框，寬版在子代理列下方、全寬；窄版每筆一行）：本 session 的主對話經 Bash 或 PowerShell 啟動的 `codex exec`／`codex exec resume`（前景或背景）。每筆顯示狀態圖示與狀態（執行中／完成／失敗）、用途、Codex session id、經過時間。用途依指令判斷：`resume` 為「Codex 續談」，`--sandbox read-only` 為「Codex 規劃草稿」，`workspace-write` 為「Codex 審查」，其他為「Codex」；呼叫帶有 `description` 時顯示在用途旁。session id 未知顯示 `—`，不猜。沒有任何 Codex 執行時整個區塊（含圖例中的 `■ Codex`）不出現；顯示執行中的，再補最近結束的，數量依 pane 高度（最多 3 筆）。**結束的 Codex 列與子代理一樣，只在結束後 60 秒內顯示**，全部到期後整個區塊與圖例項目一起消失（SESSION LOG 保留）。執行中的 Codex 與執行中的子代理一樣，讓計時器持續重繪。
- **分支（git）面板**（只在 session 的目錄位於 git repository 內時出現，否則整個隱藏）：
  - 內容：分支名、變更檔案數（含未追蹤）、upstream 與 `↑ahead ↓behind`（沒有 upstream 顯示 `無上游`）、未審檔案數。
  - **未審**＝已變更、但內容與「最近一次審查所見」不同的檔案。`u` 鍵（pane 取得焦點時）或點按鈕切換展開未審路徑清單，最多列 20 個，更多以 `… 另有 N 個` 計。沒有未審時顯示 `✓ 未審 0`，沒有按鈕可展開。
  - **雜湊檢查失敗（或讀不到審查紀錄）時顯示 `未審 未知`，絕不顯示 `✓ 未審 0`。** git 無法執行時面板隱藏，不保留舊數字。
  - 位置：寬版且欄寬 ≥ 98 時為右側欄（與 MAIN／子代理並排，額度標頭仍在最上方、全寬）；欄寬 68–97 的寬版與窄版改為一行摘要 `<分支> · 變更 <n> · 未審 <n>`（位於 CODEX 之後、SESSION LOG 之前），展開時路徑接在其下。展開清單只向 SESSION LOG 借列（寬版最少留 3 行），放不下的以 `… 另有 N 個` 收尾；MAIN、子代理方塊與 CODEX 的列數不受影響。
  - 寬版再加一行摘要時，進入寬版所需的高度多 1 列。
  - 標題 `2: ▾ 分支` 是按鈕，熱鍵 `2`（pane 取得焦點時）或點按收合：收合後不論寬度都是一行 `2: ▸ 分支 <摘要>`，沒有 `u` 按鈕、不列路徑；收合狀態與 `u` 的展開狀態各自保留。
- **流向線**：MAIN → 子代理 → 回 MAIN；有工作時圓點移動（4 fps），全部閒置時計時器取消，不再重繪；pane 關閉或在背景分頁時也不重繪（下一個事件或重新開啟 pane 時再啟動）。
- **Context 條**（寬版與窄版相同，位於 CODEX 區塊之下、分支摘要行與 SESSION LOG 之上，一行）：`Context <長條> <已用%>  <已用 tokens>/<window>`，顯示的是**已使用**比例（70% 以上變黃、90% 以上變紅），色與文字沿用原版。還沒有量測時顯示 `Context —`；有量測但缺百分比或 tokens 時對應位置顯示 `—`。
- **SESSION LOG**：最近事件加上 `HH:MM:SS`：回合開始／完成、工具呼叫、子代理啟動／結束、顧問諮詢、Codex 啟動／完成／失敗。
- **Footer**（最下方一行，在 SESSION LOG 之後）：左邊是熱鍵提示 `1額度 2分支 u路徑`（只列有作用的鍵：沒有 git repository 時只有 `1額度`，沒有可展開的未審路徑或分支已收合時沒有 `u路徑`），右邊是按鈕 `↻ 重新整理`。按下後立即重讀額度（Claude、Codex）、git 與其他 session 的等待標記（含 registry 與 `tasklist`），走原本的輪詢機制：已在進行中的讀取不會重複開始；**不動 Fable**，它的 90 秒排程與失敗後的退避照舊。熱鍵只註冊 `1`、`2`、`u`（`3`–`6` 是 status-sidebar 裡沒有移植的面板，不重新分配）。**列數不夠時 Footer 最先被拿掉**：只有在 SESSION LOG 給它一列後仍保有 3 行時才畫；展開的未審清單比 Footer 優先拿列。
- **窄版**：pane 寬度不到 68 欄或高度不到 25 列時，改為單欄堆疊的精簡版（Context 條仍在 CODEX 與 SESSION LOG 之間）。進入寬版所需的高度另外要加：有 Codex 執行時 +4、分支用摘要行（寬度 < 98 或已收合）+1；沒有顧問欄時 −1、額度收合時 −6。
- **縮小時的取捨順序**（70 欄左右、很高的 dock 與一般寬版相同）：先拿掉 Footer，再縮短 SESSION LOG 到 3 行，再減少子代理方塊（先丟結束的）到 1 個，最後整個改為窄版（流向線與外框一起消失）；寬版的分支欄在欄寬不到 98 時就是摘要行。額度標頭（或其標題行）、MAIN 與 CODEX 在任何大小都保留，極小的高度改靠 pane 捲動。

## 試用

```
claude --plugin-dir N:\projects\github\cc-dashboard
```

載入後會自動開 pane。開啟時不指定寬度（dock 用預設寬度）；高度要等畫面第一次取得終端機高度後，才以其 60% 向引擎要求一次（僅 pane 貼在輸入框上方的 inline 模式生效，dock 忽略；使用者拖曳過的大小優先）。之後每次開啟都沿用這個數字，不會每次重繪都重開。

- `/dashboard`：pane 正在顯示時關閉；否則開啟（含在背景分頁或等待更寬終端機的 pane）。載入時只自動開一次，熱重載不會重開你關掉的 pane。

此目錄只用 `--plugin-dir` 試載，沒有全域安裝。`.claude-plugin/types/` 由 Claude Code 在互動式 session 載入 mod 時寫入（已被其內部 `.gitignore` 排除）；若目錄不存在，複製另一個 mod 的 `.claude-plugin/types/`，或先用 `--plugin-dir` 開一次互動式 session。

## 資料來源與限制

| 區塊 | 來源 |
| :- | :- |
| 顧問諮詢次數／時間 | `turn.step` 結果的 `serverToolUses`（名稱為 `advisor` 者）。主對話與子代理請求中的顧問諮詢都會計入同一個次數。顧問由 API 端執行，沒有 `tool.call` 事件，只在該步驟結束後才看得到，所以次數在每個請求完成時才更新。 |
| 顧問模型 | `$.settings.read()` 的 `advisorModel`（每回合重讀，以涵蓋 `/advisor` 的變更）。以 `--advisor` 旗標指定的顧問不一定出現在 settings 中，此時要等到第一次諮詢，ADVISOR 欄才出現，模型欄顯示 `on`。 |
| 子代理 | `agent.spawn` 的結果（id、模型）、`$.agent.list()` 的狀態、子代理的 `turn.step`／`turn.complete`。 |
| Codex 執行 | 主對話的 `tool.call`（Bash／PowerShell，子代理的呼叫不計）：指令判斷是否為 `codex exec`（只在「指令位置」才算：字串開頭，或換行、`;`、`&`、`|`、`(`、`{`、反引號之後，前面可有 `then`／`do`／`else`／`if`／`while`／`until`、`time`、`nohup`、`env`／`timeout`／`npx`（含它們的旗標與帶值的旗標，如 `timeout -s KILL 10m`、`env -u FOO`、`npx --package …`、時間、`@openai/codex@latest` 這樣的套件名）、環境變數賦值，以及指向 `codex` 的路徑；`codex` 與 `exec` 之間不能換行。先把引號內的字、`#` 註解（PowerShell 還有 `<# … #>`）、heredoc 本體（結束字採近似 bash 的規則：任何一部分有引號或反斜線，就把引號與反斜線拿掉再原樣比對，所以 `<<'END-OF-BRIEF'`、`<<"A B"`、`<<\EOF`、`<<E"OF"` 都對；沒有引號的結束字以字母或底線開頭，之後是字母、數字、`_`、`.`、`-`，如 `EOF.md`；`<<2`、`<<=` 這種不是結束字的是位移，不是 heredoc。算術 `$(( … ))`、`$[ … ]` 和位於指令開頭的 `(( … ))` 都整段跳過，裡面的 `<<` 一樣是位移）和 PowerShell here-string（只在 PowerShell 模式）遮掉，所以 `echo note: codex exec`、`cat > run.sh <<'EOF'` 裡的 `codex exec` 都不是執行；但引號裡的 `$( … )` 會執行，`"$(codex exec …)"` 算。只有前 64 KB 會被檢查，遮蔽與比對都是單次掃描（100 KB 約 20 ms），惡意構造的長指令不會變慢；被截斷處還開著的引號、heredoc 或 here-string 一律遮到結尾，所以超長的 `git commit -m "…codex exec…"` 不會被誤判。旗標只看這個指令本身，到下一個 `;`、`|`、`&`（`2>&1` 的不算）或換行為止；`-s`／`--sandbox` 是在遮過的程式碼裡找位置、再從原文讀值，所以 `codex exec "x -s workspace-write" -s read-only` 是「規劃草稿」。已知限制：`bash -c "codex exec …"` 這種把整條指令放進引號的寫法看不到；`$((` 開頭但其實是 `$( (子殼層) )` 的寫法會被當成算術而略過（結果是漏判，不是誤判）；`$'…'` 這種 ANSI-C 引號只當一般單引號處理，在超過 64 KB 被截斷處附近可能誤判；每個包裝詞（`timeout`、`env`、`npx`）只認它自己帶值的旗標，沒列在內的旗標會被當成沒有值；heredoc 結束字與 bash 有幾處刻意的偏差：bash 會把 `<<2`、`<<=`、`<<$X` 與沒有引號的 `let x=1<<2` 當 heredoc，這裡當位移，含 `!`、`:`、`+` 的結束字（如 `<<EOF!`）會被截短而遮到結尾；`if`／`while`／`for`／`then` 之後的 `(( … ))` 不當算術，裡面的 `<<變數` 會被當成 heredoc 而漏判之後的行。通知的網路路徑過濾不認 NT 前綴 `\??\UNC\`，但第一個區塊的標頭由引擎寫出，且只有對得上已追蹤 Codex 執行的 id 才會讀檔）、用途與 `resume` 的 session id；前景結果的 `isError` 決定完成或失敗，session id 取自結果的 stderr／stdout 開頭的 `session id:` 行。轉成背景的執行以結果的 `backgroundTaskId` 追蹤，由 `prompt.submit`（來源 `task-notification`）的通知結束，並讀通知附的 `<output-file>`（`$.fs.read`，只留開頭 8 KB 來解析，讀不到就維持 `—`；通知只認 `<summary>` 之前的 `task-id`、`tool-use-id`、`output-file`、`status`，摘要或結果裡偽造的標籤與整個偽造的通知區塊都不算；`output-file` 還必須以 `<task-id>.output` 為檔名才會被讀，同一個 `task-id` 只處理第一個區塊，同一段文字的**第一個區塊**決定檔案可以在哪個資料夾：所有 `output-file` 都必須和第一個區塊的檔案同資料夾；第一個區塊沒有合格的檔案（沒寫、檔名不對、不是通知）時，整段文字裡**沒有任何**區塊能讀檔；網路路徑（以 `\\` 或 `//` 開頭）在任何區塊都不收。資料夾不符的區塊照樣回報，只是不讀檔，所以任務寫出的文字不能指定要讀哪個檔案）取得 session id。每回合結束的 `classic.Stop` 以 `background_tasks` 核對：不在清單的背景執行推斷為完成、仍掛著的前景執行推斷為失敗，之後若收到正式通知會改寫。CODEX 區塊只看本 session 啟動的執行（額度標頭才會讀 `~/.codex/sessions`，見下）；區塊不顯示模型與 effort。`/clear`、`/resume` 後重新開始。 |
| Claude 額度與 Context 條 | `$.session.usage()` 的 `rateLimits`（`five_hour`、`seven_day`）與 `context`（Context 條的來源）；`session.measure` 也會更新。每 30 秒輪詢一次。 |
| Fable | `GET https://api.anthropic.com/api/oauth/usage`，由引擎的授權 handle 代為帶憑證（plugin 拿不到憑證，且只有 bearer 登入可用）；每 90 秒一次，失敗後等待時間加倍、最長 10 分鐘（或遵守 `retry-after`）。 |
| Codex 額度 | 讀 `~/.codex/sessions/YYYY/MM/DD` 下最新的 rollout（最多試 4 個），用 `$.process.run` 執行 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（以 `$.env.get('SystemRoot')` 組完整路徑，不靠 PATH；`SystemRoot` 讀不到就不執行，Codex 額度顯示 `SystemRoot is not set`）取檔尾 2000 行中含 `"limit_id":"codex"` 的行；路徑走環境變數 `ROLLOUT`，不放進指令文字。每 120 秒一次。模型取自 `~/.claude/model-choice.json` 的 `codex`（沒有就顯示規則預設的 `gpt-6-sol`），effort 取自 `~/.codex/config.toml`，兩者皆只讀。 |
| 分支（git） | 只讀的 `git`，由 `$.process.run`（15 秒逾時）執行，共四道，**每一道**都帶 `git --no-optional-locks -c core.quotePath=false -c core.fsmonitor=false -c protocol.ext.allow=never`，且環境變數 `GIT_NO_LAZY_FETCH=1`（`--no-optional-locks` 讓 `status` 不刷新 index、不取鎖，輪詢不會寫入 repository；`core.fsmonitor=false` 讓 `status` 不執行 repository 設定檔指定的 fsmonitor 程式；`protocol.ext.allow=never` 拒絕會執行指令的 `ext::` 傳輸；`GIT_NO_LAZY_FETCH` 讓部分 clone 不去連 promisor remote）。repository 自己的設定檔不被信任，其中最大的缺口是 filter：設定檔的 `filter.<名稱>.clean／smudge／process` 會在 `status` 比對內容時被執行。所以先用 `git config -z --name-only --get-regexp "^(filter\.|extensions\.partialclone$|remote\..*\.(promisor|partialclonefilter)$)"`（在根目錄）列出所有 driver 名稱（含 `/etc`、全域設定的，例如 git-lfs），再對 `status` 與 `hash-object` 每個 driver 加 `-c filter.<名稱>.clean= -c filter.<名稱>.smudge= -c filter.<名稱>.process= -c filter.<名稱>.required=false`。同一次 `git config` 也查 `extensions.partialclone`、`remote.*.promisor`、`remote.*.partialclonefilter`：**只要是部分 clone（partial clone）就整個不讀**，因為 `GIT_NO_LAZY_FETCH` 要 git 2.44 以上才有效（舊版會忽略它），而本 plugin 沒有可靠的版本檢查；選設定檢查而不是版本檢查，是因為它沒有狀態、不依賴解析 `git --version`，代價是新版 git 的部分 clone 使用者也看不到分支面板。`git config` 在沒有任何符合的設定時結束碼是 1 且沒有輸出：那是「沒有 filter」，不是失敗；結束碼 1 卻有輸出、其他結束碼、**輸出被引擎截斷**（引擎只保留 stdout 前 4 MiB，`isStdoutTruncated`；一個約 27 KB 的設定檔就可能把 `[filter "x"]` 擠到 4 MiB 之外）、非空輸出沒有以 NUL 結尾（最後一個名稱被切掉）、無法安全放進 `-c` 的名稱（含 `=`、換行，或根本不是 `filter.` 開頭）一律當失敗：**面板隱藏、不再往下讀**（fail closed）。`status` 的輸出被截斷也同樣當失敗（面板隱藏，不顯示殘缺的計數）；`hash-object` 的輸出被截斷則雜湊為未知。代價：用 git-lfs 的 repository，被關掉 clean filter 的 `status` 會把部分檔案顯示成已變更。四道依序是：`git rev-parse --show-toplevel`（session 目錄）、`git config …`（根目錄）、`git [filter 關閉項] status --ignore-submodules=all --porcelain=v2 --branch -z -uall`（根目錄；`--ignore-submodules=all` 讓 submodule 與它們的 filter 完全不進來，submodule 的變更因此不列入「變更」數）、`git hash-object --no-filters --stdin-paths`（在根目錄，stdin 為「仍在磁碟上的已變更路徑」，**不帶 `-w`**，不寫入物件；`--no-filters` 讓雜湊不執行設定檔裡的 clean filter。審查當下與輪詢時的雜湊用同樣的旗標，所以比對仍然成立；因為不套用 filter，換行轉換類的檔案雜湊與 `git hash-object <file>` 預設值可能不同，但兩邊一致）。**符號連結不雜湊**（`hash-object` 會跟著連結去讀它指向的任何檔案，甚至是裝置或 FIFO）：已追蹤的靠 `status` 的 work-tree mode `120000` 判斷；未追蹤的用 `$.fs.stat(path, { resolve: true })` 逐一檢查：是連結、`realPath` 不在 repository 根目錄之下（根目錄本身的 `realPath` 也算；涵蓋 Windows 的 junction，它不是 `isLink` 卻會落在別處）、或讀不到狀態的，都當連結。**這個檢查只做在未追蹤的路徑**：已追蹤的路徑由 git 的 mode 判斷，位在 junction 資料夾裡的已追蹤檔案不會被偵測（git 本身會把那個 junction 當成一個項目）。連結的內容記為 `unhashed`，**審查不會存這個值**，所以變更過的連結永遠算「未審」並列在清單裡，絕不會因為它而顯示成 `✓ 未審 0`。未追蹤檔案超過 500 個時不逐一檢查，雜湊直接視為未知。`-uall` 會列出未追蹤目錄下的每個檔案，未追蹤的樹很大時 `status` 與逐檔雜湊都會變慢（15 秒逾時；逾時就是「未知」）。不跑 fetch、add、commit、checkout 或任何會改變狀態的指令。每 30 秒一次（與 status-sidebar 相同），每回合結束時也提前一次；無 `git`、逾時或非 repository 時面板隱藏。 |
| 審查紀錄（唯一的寫入） | 本 plugin 自己的 `$.store`（與 status-sidebar 的 store 是不同檔案，兩邊的 key 互不讀寫），key 為 `git-reviewed:<repository 根目錄>`，值為「路徑 → 內容雜湊」（已刪除的檔案為 `deleted`；沒雜湊的連結不存）。store 有上限：只保留**最近寫入的 8 個 repository**（另一個 key `git-reviewed-index` 記順序，較舊的與舊版留下、不在索引裡的 `git-reviewed:*` 都會刪掉；刪除前會重讀一次索引，別的 session 剛列進去的不會被刪；兩個 session 同時寫入的競爭仍可能讓某個 repository 的紀錄少了或被擠掉，結果是它回到「全部未審」，也就是偏向安全的一邊，不會被當成已審），每個 repository 的紀錄最多 2000 個路徑，超過就**什麼都不存**（改存標記 `too-many-paths`），該 repository 顯示 `未審 未知`，絕不顯示成已審。**只在這些時刻寫入**：(1) 任一呼叫者（主對話或子代理）的 `Skill` 工具呼叫，skill 名稱含 `review`；(2) `Agent` 工具呼叫，`subagent_type` 含 `review`；兩者都在呼叫開始時讀樹，呼叫結束且未被拒絕（`deny`）、未回報錯誤（`isError`）才寫入；(3) 使用者自己輸入（`composer`／`bridge`／`sdk` 來源）的 `/…review` 斜線指令，於送出當下讀樹並寫入。通知、同儕訊息、句子中提到 `/code-review` 都不算。雜湊取不到時不寫入。審查事件觸發，與 pane 是否顯示無關。從 status-sidebar 換過來時，舊紀錄不會沿用：第一次審查之前，所有已變更檔案都算未審。 |
| 等待提醒（讀） | 本機 session registry：`~/.claude/sessions/<pid>.json`（只讀符合 `\d+.json` 的檔名；取 `pid`、`sessionId`、`name`，`pid` 必須是正整數），加上行程表 `%SystemRoot%\System32\tasklist.exe /FO CSV /NH`（`$.process.run`，15 秒逾時，無 shell；完整路徑由 `$.env.get('SystemRoot')` 組成，不靠 PATH；`SystemRoot` 讀不到就不執行，視為沒有人在等，也寫不出自己的標記），只算 pid 仍是 `claude`／`node` 的 session。registry 只讀最新（依修改時間）的 32 個一般檔案（資料夾、連結都不讀），且略過大於 64 KB 的；再讀其他 session 的標記檔 `~/.claude/mods-state/status-sidebar/waiting/<pid>.json`，檔內 `sessionId` 必須等於 registry 的（pid 被重用的舊檔不算）。標記每約 5 秒讀一次，registry 與 `tasklist` 約每 30 秒一次（pump 每 2 秒檢查一次，所以實際約 6 秒與 30 秒）。`tasklist` 非 0 結束、逾時，或 registry 讀不到，一律視為沒有人在等。session 名稱以 `plain()` 清掉控制字元後才畫。 |
| 等待標記（寫，本 session 自己的） | 目錄與格式與 status-sidebar **相同**，兩邊的 session 因此互看得到：`~/.claude/mods-state/status-sidebar/waiting/<本行程 pid>.json`，內容恰為 `{"sessionId":…,"reason":"permission"｜"question"｜null,"sinceMs":…}`，這是此目錄下唯一會寫的檔。寫入時機（事件驅動，pane 有沒有顯示都會寫）：session 啟動時寫一次目前狀態（通常是 `reason:null`）；`classic.PermissionRequest` 寫 `permission`；`AskUserQuestion`／`ExitPlanMode` 的 `tool.call` 開始時寫 `question`。清除（寫回 `reason:null`）：該問題工具回傳；最後一個被 `tool.check` 判為 `ask` 的呼叫回傳；使用者自己輸入的新 prompt（`composer`／`bridge`／`sdk`）；主對話回合結束；session 結束（任何原因，含 `/clear`）。狀態沒變就不重寫。本行程的 pid 由 registry 查得（查到之前不寫、也不卡住對話框），查不到就不寫。 |
| 輪詢暫停 | 額度三項、git 與其他 session 的等待標記（含 registry、`tasklist`）只在 pane 正在顯示時進行，pane 關閉或在背景分頁時不發請求、不開程序；重新顯示後約 2 秒內補讀。例外：為了知道自己的標記檔名，session 啟動時（或標記要寫而 pid 還不知道時）會查一次 registry 與 `tasklist`。每個 plugin 實例只有一個 2 秒的檢查計時器，每個來源同時最多一個讀取在進行，熱重載會取代舊的計時器。 |
| 收合與重新整理 | 純 UI 狀態，不讀寫任何檔案：收合狀態（`1` 額度、`2` 分支）存在這個 plugin 的 session UI atom（`/clear`、`/resume` 不重設）。`↻ 重新整理` 把額度（Claude、Codex）、git、其他 session 等待標記的下次讀取時間設為現在（並讓 registry 重讀），再叫一次輪詢；沒有新的程序或網路路徑，指令與上面各列相同。Fable 不在其中。 |
| 外部字串 | 引擎拒絕含控制字元的 `Text`（整棵樹都不畫），所以子代理的類型／描述／模型、Codex 的用途與 `description`、SESSION LOG 的各行（工具名稱、描述）、主模型與 effort、顧問模型、額度標頭的模型與 effort 與備註、等待提醒的 session 名稱、git 的分支／upstream／路徑，在畫出之前都經 `plain()` 把所有控制字元（Unicode Cc）、格式字元（Cf：零寬與雙向標記、U+061C、軟連字號 U+00AD、U+180E、word joiner 與隱形運算子 U+2060–2064、U+206A–206F、註解標記 U+FFF9–FFFB 等）、行與段落分隔符（Zl、Zp）和 tag 字元（U+E0000–E007F）換成空白。 |
| 回合數 | 每個主對話 `turn.start` 重新讀 `$.session.turns()`；若引擎的數字沒有比上次多 1（例如該步驟尚未計入），就用上次加 1。`/clear`、`/resume` 後重新開始。 |

## 測試

```
cd N:\projects\github\cc-dashboard
claude plugin test
claude plugin validate .
tsc --noEmit -p .
```

測試分三層：

- 純邏輯：`tests/state.test.ts`、`codex.test.ts`、`codex-call.test.ts`、`codex-state.test.ts`、`codex-quota.test.ts`、`quota.test.ts`、`quota-state.test.ts`、`quota-rows.test.ts`、`git.test.ts`、`git-tree.test.ts`、`git-rows.test.ts`、`sessions.test.ts`、`waiting.test.ts`、`notify.test.ts`、`format.test.ts`、`layout.test.ts`、`signals.test.ts`、`poll.test.ts`、`expiry.test.ts`、`footer.test.ts`。
- hook 與畫面：`tests/dashboard*.test.ts`，用 `claude-code/testing` 觸發事件並檢查繪製的樹，每個檔案一個功能：`dashboard.test.ts`（MAIN、顧問設定、子代理、Context、版面切換、動畫、pane 開關與尺寸）、`dashboard-advisor`（ADVISOR 沒在用時隱藏）、`dashboard-codex`、`dashboard-quota`、`dashboard-git`（以假的 `process.run`（git）與 `store` 回答）、`dashboard-wait`、`dashboard-expiry`（結束的列 60 秒後消失與一次性重繪，用假時鐘）、`dashboard-collapse`（熱鍵 `1`／`2`、Footer、重新整理）、`dashboard-sanitize`（外部字串的控制字元）、`dashboard-dock`（寬版／70 欄 dock／窄版的區塊順序、列數預算、縮小時的取捨順序）。共用的假引擎在 `tests/harness.ts`。
- 引擎 surface：終端機與 Desktop 兩種都有畫面測試（`dashboard.test.ts`）。

`git-tree.test.ts` 用假的 git runner 逐一檢查每道 git 指令的完整 argv 與環境變數：只有 `rev-parse`、`config`（列出 filter）、`status`、`hash-object`，都帶 `--no-optional-locks`、`-c core.fsmonitor=false`、`-c protocol.ext.allow=never` 與 `GIT_NO_LAZY_FETCH=1`，`status` 帶 `--ignore-submodules=all`，`hash-object` 帶 `--no-filters`，且不帶 `-w`；也測 filter 清單的解析、結束碼 1 等於沒有 filter、列不出清單或名稱不安全時整個停止。

## 結構

```
hooks/
  hooks.json      # modules: ./register.tsx
  register.tsx    # 與引擎的 I/O：事件 → DashEvent、計時器、pane 開關
  views.tsx       # 純繪製：DashState → 元素樹（寬版／窄版）
  quota-view.tsx  # 純繪製：額度標頭（寬版兩欄長條、窄版六行）
  git-view.tsx    # 純繪製：分支面板（右側欄方框、一行摘要）與 u 展開鈕
  lib/
    state.ts      # DashState 與純 reducer apply(state, event)
    codex.ts      # 解析 codex exec 指令（用途、session id）與輸出中的 session id 行
    codex-state.ts # Codex 執行的純 reducer（開始、轉背景、結束、核對）與顯示選取
    notify.ts     # 背景任務完成通知與 backgroundTaskId 的解析
    quota.ts      # Claude 額度視窗、Fable 回應、退避時間與「過期」判斷
    codex-quota.ts # Codex rollout 額度、effort、model-choice 的解析（只讀）、最新 rollout 檔的走訪與整個讀取（收 listing／讀檔／查詢三個函式）
    quota-state.ts # 額度事件的純 reducer（保留最後讀數）
    quota-rows.ts # 額度標頭的資料列（剩餘％、過期、倒數）
    git.ts        # git status 解析、內容雜湊對照、未審計算、審查呼叫／指令判斷、GitSnap（未審可為未知）
    git-tree.ts   # 讀 repository：四道只讀 git 指令的 argv／環境變數與結果處理、符號連結不雜湊（收 runner 與 isLink，自己不碰 `$`）
    shell-mask.ts # 把 shell 指令裡不是程式碼的部分（引號內、註解、heredoc、here-string）遮掉，找出 `codex exec` 的指令位置（單次掃描）
    git-filters.ts # 解析 `git config --name-only` 列出的 filter driver 名稱，產生關閉它們的 `-c` 選項
    review-store.ts # 審查紀錄的讀寫與上限（最近 8 個 repository、每個 2000 個路徑；收 store 的四個呼叫）
    system.ts     # `tasklist.exe`、`powershell.exe` 在 SystemRoot 底下的完整路徑
    serial.ts     # 讓工作一個接一個執行的佇列（標記檔寫入、到期重繪）
    git-rows.ts   # 分支面板的文字與列數（摘要、upstream、↑↓、未審、清單截斷）
    sessions.ts   # registry 檔、tasklist 輸出的解析，與「仍活著的 session」判斷（讀取收 list／read／tasklist 三個函式）
    poll.ts       # 輪詢排程：各來源的間隔、重新整理要讓哪些來源到期、哪些來源現在該讀
    codex-call.ts # 一次 Bash／PowerShell 的 codex exec 呼叫結果 → 結束或轉背景的事件
    expiry.ts     # 結束的列顯示 60 秒、下一次到期的時間
    footer.ts     # Footer 的熱鍵提示文字
    waiting.ts    # 等待標記的格式與解析、其他 session 的等待列、提醒文字、哪些工具算提問
    format.ts     # 時間、token、進度條、文字
    layout.ts     # 依欄寬與列高決定版面（顧問欄、額度收合、分支收合、Footer 都算進列數）
    signals.ts    # 引擎回報 → reducer 輸入的純轉換
types/index.d.ts  # DashState 型別與 PluginState 宣告
tests/            # 見上；harness.ts 是共用的假引擎
```

所有碰 `$` 的程式都留在 `register.tsx`：`claude plugin validate` 會拒絕把 `$` 傳給別的檔案匯入的函式（實測：`$ is passed to "…", a name bound to a function`），所以 git 的 I/O 沒有拆到 `hooks/io/`；`lib/git-tree.ts` 改成接收 `register.tsx` 傳入的 runner（只傳閉包、不傳 `$`），指令與結果處理因此仍可單元測試，validate 也能列出 `$.process.run (via gitRun …)`、`$.store.get (via readReviewed)`、`$.store.set (via recordReview)`。同一道限制也適用到「用表格以變數呼叫」（`READERS[source]($)` 會被拒絕：`$ itself is passed as an argument`），所以輪詢的分派是 `register.tsx` 裡的 `switch`。Codex 額度、session registry 的讀取同樣用閉包（`lib/codex-quota.ts`、`lib/sessions.ts`）。`register.tsx` 約 740 行，低於 800 行的上限；再要拆小得先改這個機制。

測試版本：Claude Code 2.1.299。
