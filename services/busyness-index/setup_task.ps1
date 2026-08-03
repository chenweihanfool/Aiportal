<#
.SYNOPSIS
    Registers a Windows Scheduled Task that runs compute_daily.py every day at 23:50.
.DESCRIPTION
    Run this once (as the user who should own the task) to create/update the
    "AiportalBusynessIndex" scheduled task. Re-running replaces the existing
    task rather than duplicating it, so it's safe to re-run after editing
    $PythonExe or the trigger time below.

    Prerequisites (not done by this script):
      - Python installed, with dependencies from requirements.txt:
            pip install -r requirements.txt
      - A .env file in this same directory (copy .env.example, fill in
        VIKUNJA_URL / VIKUNJA_TOKEN / DATABASE_URL) ??compute_daily.py loads
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
    Write-Host "WARNING: no .env found in $ScriptDir ??copy .env.example to .env and fill in VIKUNJA_URL / VIKUNJA_TOKEN / DATABASE_URL before this task will succeed." -ForegroundColor Yellow
}

$Action = New-ScheduledTaskAction `
    -Execute $PythonExe `
    -Argument "compute_daily.py --sqlite-path `"$SqlitePath`"" `
    -WorkingDirectory $ScriptDir

$Trigger = New-ScheduledTaskTrigger -Daily -At "23:50"

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

Write-Host "Scheduled task '$TaskName' registered: runs '$PythonExe compute_daily.py' daily at 23:50, working directory $ScriptDir" -ForegroundColor Green
Write-Host ""
Write-Host "To verify right now:"
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`"   # LastTaskResult should be 0"
Write-Host "  Get-Content `"$ScriptDir\logs\busyness_error.log`" -ErrorAction SilentlyContinue   # should be empty/absent on success"
