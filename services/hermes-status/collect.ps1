<#
.SYNOPSIS
    Collects host system status (CPU/RAM/disk, Docker container health,
    scheduled-task results, recent deploy activity) and pushes it to
    Aiportal's HERMES 戰情室 endpoints.
.DESCRIPTION
    Run on the deploy host every few minutes via Windows Task Scheduler (see
    setup_task.ps1). Same "compute everything before writing, log-and-exit
    on failure" discipline as services/busyness-index/compute_daily.py: the
    full status snapshot is built in memory first, and only POSTed once
    every collection step has succeeded, so a partial failure never
    overwrites hermes_status_snapshot with half-empty data.

    Container/scheduled-task name filters below are deliberately dynamic
    (docker ps lists whatever is actually running; $TaskNamePatterns is a
    wildcard match) rather than a hardcoded list, since the exact container
    and task names on the real deploy host weren't available to confirm
    from the machine this script was written on.

    Recent-activity entries are NOT written by instrumenting HERMES itself —
    they're read from the `update.log` files that update.ps1 (Aiportal /
    pf-cwh / FitnessForge / ...) already appends to on every deploy. A small
    per-file line-count cursor (activity_cursor.json, in this directory)
    tracks what's already been posted so re-running this script doesn't
    re-post the same lines.

    Also pushes 心智指標's dailyEngagementScore every run (~every 10 min,
    same cadence as everything else here) by counting diary files on the
    NAS — folded into this existing script rather than a new one, since it
    already runs frequently and already has the .env/auth/POST plumbing.
    This intentionally reuses /api/admin/mind-index (not a new endpoint) via
    a partial push (score-only fields omitted) -- see routes/mindIndex.ts's
    "two independent pushers" comment. daily-life-score.py keeps owning the
    heavier once-daily 知識庫健康度 score; this script no longer needs to
    ask it to compute dailyEngagementScore at all.

    2026-08-21（HHI v2）: dailyEngagementScore now sums a rolling 3-day
    window (today + 2 preceding days) instead of just today — a daily
    reset-to-zero was letting the weakest-link correction's effective
    weight balloon toward ~30% on any low-writing day. Also pushes a new
    社交指標（social）POST to /api/admin/social-index, computed from a
    separate NAS file (social_interactions.jsonl, written by HERMES's own
    L1/L2 diary pipeline — this script only reads it, never writes it) plus
    the same diary-based "觀測日" check used for the mind score.

    Prerequisite (not done by this script): a `.env` file in this same
    directory (copy .env.example, fill in ADMIN_PASSWORD / API_BASE_URL).
#>

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$ScriptHadError = $false

# ── Config ──────────────────────────────────────────────────────────────
# Wildcard patterns, not exact names — adjust once you can see the real
# task names on the deploy host (`Get-ScheduledTask | Select TaskName`).
$TaskNamePatterns = @("*Aiportal*", "*Busyness*", "*Hermes*", "*Fitness*", "*pf-cwh*", "*Health*", "*Duplicati*", "*SyncBack*")

# repo name -> update.log path, same file update.ps1 already writes via
# `Add-Content -Path $LogFile`. Missing paths are skipped, not fatal —
# not every repo on this host necessarily has update.ps1 deployed yet.
$UpdateLogPaths = @{
    "Aiportal"     = "F:\WEBAPP\SRC\Aiportal\update.log"
    "pf-cwh"       = "F:\WEBAPP\SRC\pf-cwh\update.log"
    "FitnessForge" = "F:\WEBAPP\SRC\FitnessForge\update.log"
    "Geospatial"   = "F:\WEBAPP\SRC\Geospatial\update.log"
    "vikunja"      = "F:\WEBAPP\SRC\vikunja\update.log"
}

# 心智指標的日記篇數——一天只有一個 YYYY-MM-DD.md 檔，篇數是看檔案「內容」
# 裡有幾個時間點記錄，不是檔案數量（處理邏輯見下面 dailyEngagementScore 那段）。
$DiaryFolderPath = "\\NASD723\home\SynologyDrive\obsidian\Vault\日記"

# 社交指標（HHI v2）的原始資料——HERMES 自己的 L1/L2 日記處理流程額外寫出
# 的 append-only JSONL，這支腳本只讀不寫，alias 正規化成 person_id 是
# HERMES 自己的責任（見 social_interactions.jsonl 交接文件）。
$SocialFolderPath = "\\NASD723\home\SynologyDrive\obsidian\Vault\社交"
$SocialInteractionsPath = Join-Path $SocialFolderPath "social_interactions.jsonl"
# person_id -> 中文顯示名稱同樣讀自 HERMES 這邊，不是另外在 Aiportal 前端
# 維護一份會失聯的複本——2026-08-31 起卡片上「計分對象」要顯示中文，資料
# 只有這裡有（people.yaml 是 HERMES 自己 alias 正規化用的對照表），所以這
# 支腳本從「完全不讀 people.yaml」改成唯讀查詢顯示名稱；不重算/不驗證
# alias 正規化邏輯，那仍然是 HERMES 的責任，這裡只是多開一個它已經摸得到
# 的 NAS 檔案。
$PeopleYamlPath = Join-Path $SocialFolderPath "people.yaml"

$CursorPath = Join-Path $ScriptDir "activity_cursor.json"
$LogDir = Join-Path $ScriptDir "logs"
$ErrorLogPath = Join-Path $LogDir "hermes_status_error.log"

function Write-ErrorLog {
    param([string]$Message)
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $Message"
    Add-Content -Path $ErrorLogPath -Value $line -Encoding UTF8
}

# ── Load .env (ADMIN_PASSWORD / API_BASE_URL) ──────────────────────────
$EnvPath = Join-Path $ScriptDir ".env"
if (-not (Test-Path $EnvPath)) {
    Write-ErrorLog "No .env found at $EnvPath -- copy .env.example and fill in ADMIN_PASSWORD / API_BASE_URL."
    exit 1
}
$EnvConfig = @{}
Get-Content $EnvPath | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
        $EnvConfig[$matches[1]] = $matches[2]
    }
}
$AdminPassword = $EnvConfig["ADMIN_PASSWORD"]
$ApiBaseUrl = $EnvConfig["API_BASE_URL"]
if (-not $AdminPassword -or -not $ApiBaseUrl) {
    Write-ErrorLog "ADMIN_PASSWORD or API_BASE_URL missing from .env"
    exit 1
}
$ApiBaseUrl = $ApiBaseUrl.TrimEnd("/")
$Headers = @{ "x-admin-password" = $AdminPassword; "Content-Type" = "application/json" }

try {
    # ── System resources ───────────────────────────────────────────────
    $cpuPercent = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

    $os = Get-CimInstance Win32_OperatingSystem
    $memPercent = [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100, 1)

    $disks = @()
    Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
        if ($_.Size -gt 0) {
            $disks += @{
                drive        = $_.DeviceID
                percentUsed  = [math]::Round((1 - ($_.FreeSpace / $_.Size)) * 100, 1)
                freeGb       = [math]::Round($_.FreeSpace / 1GB, 1)
                totalGb      = [math]::Round($_.Size / 1GB, 1)
            }
        }
    }

    # ── Docker container health ────────────────────────────────────────
    # Health status is parsed out of the Status string (e.g. "Up 3 hours
    # (healthy)") rather than a separate `docker inspect` call per
    # container -- avoids N extra subprocesses on hosts with many containers.
    $containers = @()
    $dockerAvailable = $true
    try {
        # No quotes inside the --format string -- an earlier version tried to
        # extract the compose-project label via {{.Label "..."}} , but a
        # quoted Go-template argument inside a native command's argument list
        # is a known Windows PowerShell 5.1 landmine (PowerShell's own
        # backtick-escaping and the Win32 argv re-quoting rules disagree,
        # and can silently mangle the argument docker.exe actually receives).
        # Project grouping isn't displayed by the frontend anyway, so it's
        # not worth the fragility -- name/status alone is enough.
        # Confirmed via local repro: with $ErrorActionPreference = "Stop" (set
        # script-wide, above), a native command writing ANYTHING to stderr --
        # even on a clean exit 0 -- gets promoted to a terminating
        # NativeCommandError by PowerShell 5.1, silently short-circuiting the
        # stdout capture below to empty even though `2>$stderrFile` redirects
        # the stderr text itself into a file rather than $null. Docker
        # Desktop is known to occasionally emit deprecation/update notices to
        # stderr on an otherwise-successful `docker ps`, so this native call
        # specifically needs $ErrorActionPreference relaxed around it.
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $stderrFile = Join-Path $env:TEMP "hermes-status-docker-stderr.txt"
        $psLines = @(docker ps -a --format "{{.Names}}||{{.Status}}" 2>$stderrFile)
        $dockerExitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if ($dockerExitCode -ne 0) {
            $dockerAvailable = $false
            Write-ErrorLog "docker ps exited $dockerExitCode : $(Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue)"
        }
        Remove-Item $stderrFile -ErrorAction SilentlyContinue
    } catch {
        $dockerAvailable = $false
        Write-ErrorLog "docker ps threw: $_"
    }
    if ($dockerAvailable -and $psLines) {
        foreach ($line in $psLines) {
            $parts = $line -split '\|\|'
            if ($parts.Count -lt 2) { continue }
            $status = $parts[1]
            $health = $null
            if ($status -match '\((healthy|unhealthy|starting)\)') { $health = $matches[1] }
            $containers += @{
                name    = $parts[0]
                project = $null
                status  = $status
                health  = $health
            }
        }
    }

    # ── Scheduled task results ─────────────────────────────────────────
    $scheduledTasks = @()
    $seenTaskNames = @{}
    foreach ($pattern in $TaskNamePatterns) {
        Get-ScheduledTask | Where-Object { $_.TaskName -like $pattern } | ForEach-Object {
            if (-not $seenTaskNames.ContainsKey($_.TaskName)) {
                $seenTaskNames[$_.TaskName] = $true
                $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath
                $scheduledTasks += @{
                    name           = $_.TaskName
                    lastRunTime    = if ($info.LastRunTime) { $info.LastRunTime.ToString("o") } else { $null }
                    lastTaskResult = if ($null -ne $info.LastTaskResult) { [int]$info.LastTaskResult } else { $null }
                }
            }
        }
    }

    # ── Push snapshot (everything above succeeded, so this is safe to send) ──
    $snapshot = @{
        cpuPercent     = $cpuPercent
        memPercent     = $memPercent
        disks          = $disks
        containers     = $containers
        scheduledTasks = $scheduledTasks
    }
    Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/hermes-status" -Method Post -Headers $Headers -Body ($snapshot | ConvertTo-Json -Depth 6) | Out-Null
}
catch {
    Write-ErrorLog "Status snapshot collection/POST failed: $_"
    # 不再 exit 1——以前這裡失敗會讓整支腳本直接結束，導致下面的近期活動/
    # 心智指標段落完全不會執行到（這是先前 SSL/DNS 故障期間「近期活動永遠
    # 空白」的真正原因，不是活動追蹤邏輯本身有問題）。三個段落是各自獨立的
    # 關注點，一個失敗不該連帶擋住其他兩個，改成記錄錯誤、繼續往下跑，最後
    # 再統一用 $ScriptHadError 反映整體是否有失敗。
    $ScriptHadError = $true
}

# ── Recent activity: tail update.log files, POST new lines only ─────────
# Failure here is non-fatal per-file (one unreadable log shouldn't block
# the others or the snapshot above, which has already been sent).
$cursor = @{}
if (Test-Path $CursorPath) {
    # -AsHashtable needs PowerShell 6+; this host runs Windows PowerShell 5.1
    # (same as update.ps1 etc.), so convert the parsed PSCustomObject by hand.
    try {
        $parsed = Get-Content $CursorPath -Raw | ConvertFrom-Json
        foreach ($prop in $parsed.PSObject.Properties) { $cursor[$prop.Name] = $prop.Value }
    } catch {
        $cursor = @{}
    }
}

foreach ($source in $UpdateLogPaths.Keys) {
    $logPath = $UpdateLogPaths[$source]
    if (-not (Test-Path $logPath)) { continue }
    try {
        # @(...) forces an array even when the file has exactly one line --
        # Get-Content otherwise returns a bare string for a single-line file,
        # which has no reliable .Count/range-slicing behavior.
        $lines = @(Get-Content $logPath)
        # First time seeing this log file (no cursor entry yet): skip
        # straight to the current end-of-file instead of backfilling every
        # historical line as an individual HTTP POST. update.log can already
        # hold weeks of deploy history by the time this script first runs --
        # posting all of it in one go is both a multi-minute stall (each
        # line is a separate round-trip) and floods "近期活動" with entries
        # from days ago on first run.
        $alreadySeen = if ($cursor.ContainsKey($source)) { [int]$cursor[$source] } else { $lines.Count }
        if ($lines.Count -le $alreadySeen) { $cursor[$source] = $lines.Count; continue }

        $newLines = $lines[$alreadySeen..($lines.Count - 1)]
        foreach ($line in $newLines) {
            # update.ps1 writes: "yyyy-MM-dd HH:mm:ss | Ns | Done"
            $occurredAt = $null
            $durationText = $null
            if ($line -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') {
                $occurredAt = [datetime]::ParseExact($matches[1], "yyyy-MM-dd HH:mm:ss", $null).ToString("o")
            }
            if ($line -match '\|\s*([\d.]+)s\s*\|') {
                $durationText = $matches[1]
            }
            $message = if ($durationText) { "deploy finished in ${durationText}s" } else { "deploy finished ($line)" }
            $body = @{ source = $source; message = $message; occurredAt = $occurredAt } | ConvertTo-Json
            try {
                Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/hermes-activity" -Method Post -Headers $Headers -Body $body | Out-Null
            } catch {
                Write-ErrorLog "Activity POST failed for $source : $_"
                $ScriptHadError = $true
            }
        }
        $cursor[$source] = $lines.Count
    } catch {
        Write-ErrorLog "Reading $logPath failed: $_"
        $ScriptHadError = $true
    }
}

($cursor | ConvertTo-Json) | Set-Content -Path $CursorPath -Encoding UTF8

# ── 日記篇數計算（心智指標的滾動窗口、社交指標的觀測日判定都要用） ──────
# 一天只有一個 YYYY-MM-DD.md 檔，不是「檔案數 = 篇數」——篇數要看檔案「內容」
# 裡有幾個時間點記錄。實際格式（由 HERMES 的 collector 寫入）：
#   ## 👤 人類編輯區          <- 使用者親自寫的，未寫則是預留位置文字
#   （你在這裡寫日記內容）
#   ## 🤖 AI 處理區            <- collector 自動 patch 追加的時間戳記條目
#   ### 05:34 🌅 早安報告 2026-08-20（四）
#   ### 06:56 需歸檔：AdventureLog 部署與 DB 備份方案
# 算法：人類編輯區有真的寫內容（不是預留位置文字）就 +1，獨立算一篇；AI 處理
# 區底下每個 ### 時間戳記條目都 +1，但標題含「早安報告／週報／月報／季報／
# 年報／知識庫維護報告」這些關鍵字的（腳本自動產生的定期報告類）不算——
# 「V 任務評論」「需歸檔：...」這種即使是 AI 寫入的，只要不是定期報告類，一
# 樣算數。2026-08-21（HHI v2）起抽成函式——心智指標的滾動 3 天窗口跟社交指標
# 的觀測日判定都要對多個檔案重跑同一套邏輯，不只算今天這一個檔案了。
$ReportKeywords = @('早安報告', '週報', '月報', '季報', '年報', '知識庫維護報告')

function Get-DiaryEntryCount {
    param([string]$FilePath)
    if (-not (Test-Path $FilePath)) { return 0 }
    # -Raw + 明確指定 Encoding UTF8——不指定的話 Windows PowerShell 5.1 對沒
    # 有 BOM 的檔案會用系統內碼讀取，這裡要拿檔案內容的中文字串去跟本檔案自
    # 己內嵌的中文關鍵字比對，編碼對不上比對永遠不會中，跟之前 collect.ps1
    # 自己缺 BOM 導致中文字面值亂碼是同一類地雷。
    $diaryContent = Get-Content -Path $FilePath -Raw -Encoding UTF8
    $count = 0

    $humanMatch = [regex]::Match($diaryContent, '(?ms)^##\s*👤\s*人類編輯區\s*\r?\n(.*?)(?=^##\s|\z)')
    if ($humanMatch.Success) {
        $humanText = $humanMatch.Groups[1].Value
        $humanText = $humanText -replace '（你在這裡寫日記內容）', ''
        $humanText = $humanText -replace '(?m)^-{3,}\s*$', ''
        if ($humanText.Trim().Length -gt 0) { $count += 1 }
    }

    $aiMatch = [regex]::Match($diaryContent, '(?ms)^##\s*🤖\s*AI\s*處理區\s*\r?\n(.*?)(?=^##\s|\z)')
    if ($aiMatch.Success) {
        # 一定要「開頭是 HH:MM」才算一個獨立條目——實測對到真的日記發現，篇
        # 幅比較長的技術類條目內部會再用 ### 分好幾個子段落（例如「問題」
        # 「處理」「狀態」「改動腳本」這種沒有時間戳的子標題），那些不是獨
        # 立的一篇，只是同一篇裡面的段落結構，不能全部算成各自一篇，會把分
        # 數灌得不合理的高。使用者原話「開頭都是時間戳」就是這個判斷依據。
        $headings = [regex]::Matches($aiMatch.Groups[1].Value, '(?m)^###\s+(\d{1,2}:\d{2}\s.+)$')
        foreach ($h in $headings) {
            $headingText = $h.Groups[1].Value
            $isReport = $false
            foreach ($kw in $ReportKeywords) {
                if ($headingText -like "*$kw*") { $isReport = $true; break }
            }
            if (-not $isReport) { $count += 1 }
        }
    }

    return $count
}

# ── 心智指標：近 3 天滾動窗口篇數總和 → dailyEngagementScore（HHI v2） ────
# 獨立的關注點，跟上面兩段一樣不互相阻擋——這裡失敗不影響快照/近期活動已經
# 送出去的結果，反之亦然。
#
# 2026-08-21 起改成滾動 3 天窗口（今天+前 2 天），不再只看今天——每天歸零
# 重來會讓最弱項修正在寫日記較少的當天把心智指標的有效權重放大到接近 30%，
# 過度主導幸福指數。
try {
    $today = Get-Date
    $n3 = 0
    $todayDiaryEntryCount = 0
    for ($i = 0; $i -lt 3; $i++) {
        # .AddDays 是對底層 DateTime 做運算，不是字串運算，跨月/跨年份界線
        # 由 .NET 本身正確處理（例如 8/31 往前推會正確落到 7/31 那個月）。
        $d = $today.AddDays(-$i)
        $filePath = Join-Path $DiaryFolderPath "$($d.ToString('yyyy-MM-dd')).md"
        $count = Get-DiaryEntryCount -FilePath $filePath
        if ($i -eq 0) {
            $todayDiaryEntryCount = $count
            if ($count -eq 0 -and -not (Test-Path $filePath)) {
                Write-ErrorLog "Today's diary file not found: $filePath"
            }
        }
        $n3 += $count
    }
    # 前幾篇日記效用最大，篇數越多邊際效果越平緩，沒有硬性封頂
    # （n3=0→0／5→33／10→50／20→67／30→75／40→80）。
    # [math]::Round 是 .NET 的 banker's rounding（四捨六入五取偶，不是常見的
    # 四捨五入），但這幾個校準值都沒有剛好卡在 .5 邊界上，跟舊公式一樣安全。
    $dailyEngagementScore = [math]::Round(100 * $n3 / ($n3 + 10))
    $mindBody = @{
        dailyEngagementScore = $dailyEngagementScore
        diaryEntryCount = $todayDiaryEntryCount   # 不變：只算今天，給卡片顯示統計用
        diaryEntryCount3Day = $n3                  # 新增：分數實際依據的滾動總和
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/mind-index" -Method Post -Headers $Headers -Body $mindBody | Out-Null
} catch {
    Write-ErrorLog "Diary engagement score (rolling window) collection/POST failed: $_"
    $ScriptHadError = $true
}

# people_id -> 中文顯示名稱（people.yaml 的 aliases 陣列取第一個當代表）。
# 不是完整的 YAML 解析器——HERMES 寫出來的 people.yaml 格式很單純（每個
# person_id 頂格、底下縮排 aliases/needs_review 兩個 key，沒有更深的巢
# 狀），用正則表達式手刻剛好夠用，不用為此多裝一個 YAML 模組依賴。alias
# 正規化成 person_id 那件事本身還是 HERMES 的責任，這裡完全不做也不驗證那
# 段邏輯，只是唯讀查「這個 id 對應的中文是什麼」給卡片顯示用。檔案不存在或
# 格式對不上的 id，呼叫端自己 fallback 回原始 person_id，不會整支腳本失敗。
function Get-PersonDisplayNames {
    param([string]$FilePath)
    $map = @{}
    if (-not (Test-Path $FilePath)) { return $map }
    $currentId = $null
    foreach ($line in (Get-Content -Path $FilePath -Encoding UTF8)) {
        if ($line -match '^(\S+):\s*$') {
            $currentId = $Matches[1]
        } elseif ($currentId -and $line -match '^\s+aliases:\s*\[(.*)\]\s*$') {
            $firstAlias = [regex]::Match($Matches[1], '"([^"]*)"')
            if ($firstAlias.Success) { $map[$currentId] = $firstAlias.Groups[1].Value }
            $currentId = $null  # 名稱抓到了，避免同一個 id 底下後面的 needs_review 行誤觸更新
        }
    }
    return $map
}

# ── 社交指標：近 7 天觀測日/互動統計 → socialScore（HHI v2，新增） ────────
# 資料來源是 HERMES 自己 L1/L2 日記處理流程額外寫出的 social_interactions.jsonl
# （見檔頭 $SocialInteractionsPath）——這支腳本只做檔案解析、產出聚合計數，
# 實際的「聚合計數 -> 三個子分數 -> 綜合分數」算術在 api-server 那邊做（見
# lib/socialIndex.ts 的 computeSocialIndex），不在這裡重算一次。
try {
    $now = Get-Date
    $windowDates = 0..6 | ForEach-Object { $now.AddDays(-$_).ToString("yyyy-MM-dd") }  # 今天+前 6 天

    # 觀測日：跟心智指標同一套 Get-DiaryEntryCount，>=1 篇就算觀測到——區分
    # 「沒寫日記」（觀測缺失）跟「沒社交」（真實的 0 訊號）。
    $observedDayCount = ($windowDates | Where-Object {
        (Get-DiaryEntryCount -FilePath (Join-Path $DiaryFolderPath "$_.md")) -ge 1
    }).Count

    $distinctPersonCount = 0
    $distinctPersonNames = @()
    $weightedInteractionPoints = 0
    $daysWithInteraction = 0

    if (Test-Path $SocialInteractionsPath) {
        $lines = (Get-Content -Path $SocialInteractionsPath -Raw -Encoding UTF8) -split "`n" |
            Where-Object { $_.Trim().Length -gt 0 }
        $records = $lines | ForEach-Object {
            try { $_ | ConvertFrom-Json } catch { $null }  # 格式錯的單行跳過，不整支腳本失敗
        } | Where-Object { $_ -and $windowDates -contains $_.date }

        # @(...) forces an array even when there's exactly one distinct
        # person — same reasoning as the $lines assignment above, otherwise
        # ConvertTo-Json below would serialize a lone name as a bare string
        # instead of a one-element JSON array.
        $distinctPersonIds = @($records | Select-Object -ExpandProperty person_id -Unique)
        $distinctPersonCount = $distinctPersonIds.Count
        # 卡片顯示用中文名字，不是原始 person_id——查不到對照（people.yaml
        # 還沒收錄這個 id，或檔案格式對不上）就照原樣顯示英文 id，不擋分數
        # 計算，也不讓整支腳本失敗。
        $personDisplayNames = Get-PersonDisplayNames -FilePath $PeopleYamlPath
        $distinctPersonNames = @($distinctPersonIds | ForEach-Object {
            if ($personDisplayNames.ContainsKey($_)) { $personDisplayNames[$_] } else { $_ }
        })
        $weightPerType = @{ face_to_face = 3; call = 2; text = 1 }
        $weightedInteractionPoints = ($records | ForEach-Object {
            if ($weightPerType.ContainsKey($_.type)) { $weightPerType[$_.type] } else { 0 }
        } | Measure-Object -Sum).Sum
        if (-not $weightedInteractionPoints) { $weightedInteractionPoints = 0 }
        $daysWithInteraction = ($records | Select-Object -ExpandProperty date -Unique).Count
    }

    $socialBody = @{
        observedDayCount = $observedDayCount
        distinctPersonCount = $distinctPersonCount
        personNames = $distinctPersonNames
        weightedInteractionPoints = $weightedInteractionPoints
        daysWithInteraction = $daysWithInteraction
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/social-index" -Method Post -Headers $Headers -Body $socialBody | Out-Null
} catch {
    Write-ErrorLog "Social index collection/POST failed: $_"
    $ScriptHadError = $true
}

if ($ScriptHadError) { exit 1 }
