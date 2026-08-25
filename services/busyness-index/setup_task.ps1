<#
.SYNOPSIS
    Registers a Windows Scheduled Task that runs compute_daily.py three times
    a day (11:40 / 16:50 / 21:50).
.DESCRIPTION
    Run this once (as the user who should own the task) to create/update the
    "AiportalBusynessIndex" scheduled task. Re-running replaces the existing
    task rather than duplicating it, so it's safe to re-run after editing
    $PythonExe or the trigger times below.

    2026-08-25: changed from once/day at 23:50 to three times/day — 從容指數
    was only ever as fresh as the last daily run, so the 生活從容 card (and
    the calmScore it feeds into HHI) could show a number up to ~24h stale.
    compute_daily.py already re-fetches the full live Vikunja task list and
    upserts by date (ON CONFLICT DO UPDATE), so running it more than once a
    day just overwrites today's row with a fresher computation — no logic
    change needed, purely a scheduling change. Chosen cadence (a few fixed
    times/day, not a tight ~10-min poll like collect.ps1) per explicit user
    choice, not a technical constraint — this self-hosted Vikunja instance
    has no rate-limit concern either way.

    Prerequisites (not done by this script):
      - Python installed, with dependencies from requirements.txt:
            pip install -r requirements.txt
      - A .env file in this same directory (copy .env.example, fill in
        VIKUNJA_URL / VIKUNJA_TOKEN / DATABASE_URL) — compute_daily.py loads
        it automatically via python-dotenv, no need to set them as system/task
        environment variables.
.NOTES
    Verify after registering:
        Start-ScheduledTask -TaskName "AiportalBusynessIndex"
        Get-ScheduledTaskInfo -TaskName "AiportalBusynessIndex"
    Then check the console output / logs\busyness_error.log for the result.
#>

$ErrorActionPreference = "Stop"

$TaskName = "AiportalBusynessIndex"
$ScriptDir = $PSScriptRoot
$PythonExe = "C:\Users\user\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"  # change to a full path if `python` isn't on PATH for the account running the task
$SqlitePath = Join-Path $ScriptDir "busyness_snapshots.db"

if (-not (Test-Path (Join-Path $ScriptDir ".env"))) {
    Write-Host "WARNING: no .env found in $ScriptDir — copy .env.example to .env and fill in VIKUNJA_URL / VIKUNJA_TOKEN / DATABASE_URL before this task will succeed." -ForegroundColor Yellow
}

$Action = New-ScheduledTaskAction `
    -Execute $PythonExe `
    -Argument "compute_daily.py --sqlite-path `"$SqlitePath`"" `
    -WorkingDirectory $ScriptDir

# 一天三個固定時間點，不是每隔 N 分鐘重跑一次的重複觸發器——
# Register-ScheduledTask 的 -Trigger 參數接受陣列，同一個任務掛三個
# -Daily -At 觸發器即可，不用另外拆成三個工作。
$Trigger = @(
    New-ScheduledTaskTrigger -Daily -At "11:40"
    New-ScheduledTaskTrigger -Daily -At "16:50"
    New-ScheduledTaskTrigger -Daily -At "21:50"
)

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Computes the daily Vikunja busyness index and writes it to busyness_index_history (Postgres) + the local overdue-pressure snapshot (SQLite)." `
    -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered: runs '$PythonExe compute_daily.py' daily at 11:40 / 16:50 / 21:50, working directory $ScriptDir" -ForegroundColor Green
Write-Host ""
Write-Host "To verify right now:"
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`"   # LastTaskResult should be 0"
Write-Host "  Get-Content `"$ScriptDir\logs\busyness_error.log`" -ErrorAction SilentlyContinue   # should be empty/absent on success"
