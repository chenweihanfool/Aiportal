<#
.SYNOPSIS
    Registers a Windows Scheduled Task that runs poll-control-pr.ps1 every 5 minutes.
.DESCRIPTION
    Run this once (as the user who should own the task) to create/update the
    "HermesControlChannel" scheduled task. Re-running replaces the existing
    task rather than duplicating it. Same pattern as
    services/hermes-status/setup_task.ps1 for HermesStatusCollector.

    Prerequisites (not done by this script -- see ../control-channel/README.md):
      - GitHub fine-grained PAT for this repo (Pull requests + Issues:
        Read and write).
      - GITHUB_PAT / GITHUB_REPO / CONTROL_PR_NUMBER filled into the .env in
        the parent services/hermes-status/ directory (shared with
        collect.ps1).
      - Invoke-HermesControlAction in poll-control-pr.ps1 filled in with
        whatever should actually happen on a new signal.
.NOTES
    Verify after registering:
        Start-ScheduledTask -TaskName "HermesControlChannel"
        Get-ScheduledTaskInfo -TaskName "HermesControlChannel"   # LastTaskResult should be 0
        Get-Content ".\logs\control_channel_error.log" -ErrorAction SilentlyContinue   # should be empty/absent
#>

$ErrorActionPreference = "Stop"

$TaskName = "HermesControlChannel"
$ScriptDir = $PSScriptRoot
$ServiceDir = Split-Path $ScriptDir -Parent

if (-not (Test-Path (Join-Path $ServiceDir ".env"))) {
    Write-Host "WARNING: no .env found in $ServiceDir -- fill in GITHUB_PAT / GITHUB_REPO / CONTROL_PR_NUMBER before this task will succeed." -ForegroundColor Yellow
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptDir\poll-control-pr.ps1`"" `
    -WorkingDirectory $ScriptDir

# Every 5 minutes, indefinitely -- same "one-time trigger + repetition"
# pattern as setup_task.ps1, Windows Task Scheduler has no native
# "every N minutes forever" trigger.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 365)

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Polls GitHub for new commits and new Claude-authored PR comments on the HERMES control channel PR, and drives Invoke-HermesControlAction." `
    -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered: runs poll-control-pr.ps1 every 5 minutes, working directory $ScriptDir" -ForegroundColor Green
Write-Host ""
Write-Host "To verify right now:"
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`"   # LastTaskResult should be 0"
Write-Host "  Get-Content `"$ScriptDir\logs\control_channel_error.log`" -ErrorAction SilentlyContinue   # should be empty/absent on success"
