<#
.SYNOPSIS
    Registers a Windows Scheduled Task that runs collect.ps1 every 10 minutes.
.DESCRIPTION
    Run this once (as the user who should own the task) to create/update the
    "HermesStatusCollector" scheduled task. Re-running replaces the existing
    task rather than duplicating it, so it's safe to re-run after editing
    the trigger interval below.

    Prerequisites (not done by this script):
      - Docker CLI on PATH for the account running the task (needed for the
        container-health section of collect.ps1).
      - A .env file in this same directory (copy .env.example, fill in
        ADMIN_PASSWORD / API_BASE_URL).
.NOTES
    Verify after registering:
        Start-ScheduledTask -TaskName "HermesStatusCollector"
        Get-ScheduledTaskInfo -TaskName "HermesStatusCollector"   # LastTaskResult should be 0
        Get-Content ".\logs\hermes_status_error.log" -ErrorAction SilentlyContinue   # should be empty/absent
#>

$ErrorActionPreference = "Stop"

$TaskName = "HermesStatusCollector"
$ScriptDir = $PSScriptRoot

if (-not (Test-Path (Join-Path $ScriptDir ".env"))) {
    Write-Host "WARNING: no .env found in $ScriptDir -- copy .env.example to .env and fill in ADMIN_PASSWORD / API_BASE_URL before this task will succeed." -ForegroundColor Yellow
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptDir\collect.ps1`"" `
    -WorkingDirectory $ScriptDir

# Every 10 minutes, indefinitely -- Windows Task Scheduler triggers don't
# have a native "every N minutes forever" trigger, so this is expressed as
# a one-time trigger with a repetition pattern that has no explicit end.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration ([TimeSpan]::MaxValue)

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Collects CPU/RAM/disk, Docker container health, scheduled-task results and recent deploy activity, and pushes them to Aiportal's HERMES 戰情室 endpoints." `
    -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered: runs collect.ps1 every 10 minutes, working directory $ScriptDir" -ForegroundColor Green
Write-Host ""
Write-Host "To verify right now:"
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`"   # LastTaskResult should be 0"
Write-Host "  Get-Content `"$ScriptDir\logs\hermes_status_error.log`" -ErrorAction SilentlyContinue   # should be empty/absent on success"
