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
    same cadence as everything else here) by counting today's diary files on
    the NAS — folded into this existing script rather than a new one, since
    it already runs frequently and already has the .env/auth/POST plumbing.
    This intentionally reuses /api/admin/mind-index (not a new endpoint) via
    a partial push (score-only fields omitted) -- see routes/mindIndex.ts's
    "two independent pushers" comment. daily-life-score.py keeps owning the
    heavier once-daily 知識庫健康度 score; this script no longer needs to
    ask it to compute dailyEngagementScore at all.

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

# ── 心智指標：今天的日記篇數 → dailyEngagementScore ──────────────────────
# 獨立的關注點，跟上面兩段一樣不互相阻擋——這裡失敗不影響快照/近期活動已經
# 送出去的結果，反之亦然。
#
# 一天只有一個 YYYY-MM-DD.md 檔，不是「檔案數 = 篇數」——篇數要看檔案「內容」
# 裡有幾個時間點記錄。實際格式（由 HERMES 的 collector 寫入）：
#   ## 👤 人類編輯區          <- 使用者親自寫的，未寫則是預留位置文字
#   （你在這裡寫日記內容）
#   ## 🤖 AI 處理區            <- collector 自動 patch 追加的時間戳記條目
#   ### 05:34 🌅 早安報告 2026-08-20（四）
#   ### 06:56 需歸檔：AdventureLog 部署與 DB 備份方案
# 算法：人類編輯區有真的寫內容（不是預留位置文字）就 +1，獨立算一篇；AI 處理
# 區底下每個 ### 時間戳記條目都 +1，但標題含「早安報告／週報／月報／季報／
# 年報／L1／L2／L3／L4／知識庫維護報告」這些關鍵字的（腳本自動產生的定期
# 報告類）不算——「V 任務評論」「需歸檔：...」這種即使是 AI 寫入的，只要不是
# 定期報告類，一樣算數。
try {
    $today = Get-Date -Format "yyyy-MM-dd"
    $diaryEntryCount = 0
    $todayDiaryFile = Join-Path $DiaryFolderPath "$today.md"
    if (Test-Path $todayDiaryFile) {
        # -Raw + 明確指定 Encoding UTF8——不指定的話 Windows PowerShell 5.1
        # 對沒有 BOM 的檔案會用系統內碼讀取，這裡要拿檔案內容的中文字串去跟
        # 下面 script 自己內嵌的中文關鍵字比對，編碼對不上比對永遠不會中，
        # 跟之前 collect.ps1 自己缺 BOM 導致中文字面值亂碼是同一類地雷。
        $diaryContent = Get-Content -Path $todayDiaryFile -Raw -Encoding UTF8

        $humanMatch = [regex]::Match($diaryContent, '(?ms)^##\s*👤\s*人類編輯區\s*\r?\n(.*?)(?=^##\s|\z)')
        if ($humanMatch.Success) {
            $humanText = $humanMatch.Groups[1].Value
            $humanText = $humanText -replace '（你在這裡寫日記內容）', ''
            $humanText = $humanText -replace '(?m)^-{3,}\s*$', ''
            if ($humanText.Trim().Length -gt 0) { $diaryEntryCount += 1 }
        }

        $aiMatch = [regex]::Match($diaryContent, '(?ms)^##\s*🤖\s*AI\s*處理區\s*\r?\n(.*?)(?=^##\s|\z)')
        if ($aiMatch.Success) {
            # 不能用裸的 "L1"/"L2"/"L3"/"L4" 當關鍵字——實測對到真的日記發現會
            # 誤殺「需歸檔：L3 架構釐清與 no_agent cron 清理」這種只是提到 L3
            # 這個詞、內容其實是正常工作筆記的條目，不是「L3 知識庫維護報告」
            # 那種定期報告。只用「知識庫維護報告」這個完整詞組去比對，四個等
            # 級的報告標題都會含這個詞組，不需要另外比對 L1-L4。
            $reportKeywords = @('早安報告', '週報', '月報', '季報', '年報', '知識庫維護報告')
            # 一定要「開頭是 HH:MM」才算一個獨立條目——實測對到真的日記發現，
            # 篇幅比較長的技術類條目內部會再用 ### 分好幾個子段落（例如
            # 「問題」「處理」「狀態」「改動腳本」這種沒有時間戳的子標題），
            # 那些不是獨立的一篇，只是同一篇裡面的段落結構，不能全部算成
            # 各自一篇，會把分數灌得不合理的高。使用者原話「開頭都是時間戳」
            # 就是這個判斷依據。
            $headings = [regex]::Matches($aiMatch.Groups[1].Value, '(?m)^###\s+(\d{1,2}:\d{2}\s.+)$')
            foreach ($h in $headings) {
                $headingText = $h.Groups[1].Value
                $isReport = $false
                foreach ($kw in $reportKeywords) {
                    if ($headingText -like "*$kw*") { $isReport = $true; break }
                }
                if (-not $isReport) { $diaryEntryCount += 1 }
            }
        }
    } else {
        Write-ErrorLog "Today's diary file not found: $todayDiaryFile"
    }
    # 前幾篇日記效用最大，篇數越多邊際效果越平緩，沒有硬性封頂
    # （1篇=25分／2篇=40分／3篇=50分／5篇=62分／10篇=77分）。
    # [math]::Round 是 .NET 的 banker's rounding（四捨六入五取偶，不是常見的
    # 四捨五入）——5篇算出來剛好卡在 62.5 這個整數邊界，會被捨去變 62 不是
    # 進位變 63，這裡照實際算出來的值寫，不是隨口舉例。
    $dailyEngagementScore = [math]::Round(100 * $diaryEntryCount / ($diaryEntryCount + 3))
    $mindBody = @{ dailyEngagementScore = $dailyEngagementScore; diaryEntryCount = $diaryEntryCount } | ConvertTo-Json
    Invoke-RestMethod -Uri "$ApiBaseUrl/api/admin/mind-index" -Method Post -Headers $Headers -Body $mindBody | Out-Null
} catch {
    Write-ErrorLog "Diary engagement score collection/POST failed: $_"
    $ScriptHadError = $true
}

if ($ScriptHadError) { exit 1 }
