param([string]$AuditDirectory = 'tmp/blank-export-audit', [string]$MicrosoftWordPath)
$ErrorActionPreference = 'Stop'
$auditRoot = (Resolve-Path -LiteralPath $AuditDirectory).Path
$cases = (Get-Content -LiteralPath (Join-Path $auditRoot 'results.json') -Raw | ConvertFrom-Json).results
$output = Join-Path $auditRoot 'word'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$report = [Collections.Generic.List[object]]::new()
$word = $null
$nativeProcess = $null
$rendererFailure = ''
try {
    if (-not $MicrosoftWordPath) {
        $MicrosoftWordPath = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\WINWORD.EXE').'(default)'
    }
    $binary = Get-Item -LiteralPath $MicrosoftWordPath
    if ($binary.VersionInfo.CompanyName -notmatch 'Microsoft') { throw 'Registered executable is not Microsoft Word.' }
    Add-Type 'using System; using System.Runtime.InteropServices; public static class BlankAuditWordProcess { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId); }'
    # Launch the verified executable, without changing COM/default-app registry.
    # Word.Application may otherwise be redirected to WPS while claiming the
    # name "Microsoft Word". Attach only to the process created by this script.
    if ($null -eq $word) { $nativeProcess = Start-Process -FilePath $binary.FullName -ArgumentList '/n','/q' -WindowStyle Hidden -PassThru }
    for ($attempt=0; $null -eq $word -and $attempt -lt 40; $attempt++) {
        try {
            $candidate = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
            if ($candidate.Path -notmatch 'Kingsoft') {
                [uint32]$ownerId=0
                [BlankAuditWordProcess]::GetWindowThreadProcessId([IntPtr]$candidate.Hwnd,[ref]$ownerId) | Out-Null
                if ($ownerId -eq $nativeProcess.Id) { $word=$candidate; break }
            }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if ($null -eq $word) { throw 'Microsoft Word automation could not be attached to the owned process; renderer is BLOCKED.' }
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    foreach ($case in $cases) {
        $stem = $case.type + $(if ($case.k13) { '-k13' } else { '' }) + '-s' + $case.semester + '-blank'
        $source = Join-Path $auditRoot ($stem + '.docx')
        $pdf = Join-Path $output ($stem + '.pdf')
        $doc = $null
        $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        try {
            $missing=[Type]::Missing
            $doc = $word.Documents.Open($source, $false, $true, $false, $missing, $missing, $missing, $missing, $missing, $missing, $missing, $false)
            $doc.Repaginate()
            $pages = $doc.ComputeStatistics(2)
            $doc.ExportAsFixedFormat($pdf, 17)
            $report.Add([pscustomobject]@{ type=$case.type; semester=$case.semester; k13=$case.k13; source=$source; inputSha256=$hash; pdf=$pdf; rendererPath=$word.Path; wordVersion=$word.Version; pages=$pages; status='RENDERED_PENDING_PDF_QA' })
        } catch {
            $report.Add([pscustomobject]@{ type=$case.type; semester=$case.semester; source=$source; inputSha256=$hash; status='BLOCKED'; reason=$_.Exception.Message })
            $rendererFailure=$_.Exception.Message
        } finally {
            if ($null -ne $doc) {
                $noSave = 0
                try { $doc.Close([ref]$noSave) } catch { Write-Warning ('Read-only document cleanup: '+$_.Exception.Message) }
            }
        }
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $hash) { throw "Word changed read-only input: $source" }
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $auditRoot 'word-render-results.json') -Encoding UTF8
        Write-Output ($stem + ': ' + $report[$report.Count-1].status)
        if ($rendererFailure) { break }
    }
} catch {
    $rendererFailure=$_.Exception.Message
} finally {
    if ($null -ne $word) {
        $noSave=0
        try { $word.Quit([ref]$noSave) } catch { Write-Warning ('Owned renderer cleanup: '+$_.Exception.Message) }
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
    } elseif ($null -ne $nativeProcess -and -not $nativeProcess.HasExited) {
        Stop-Process -Id $nativeProcess.Id
    }
}
foreach ($case in $cases) {
    $stem=$case.type+$(if($case.k13){'-k13'}else{''})+'-s'+$case.semester+'-blank'
    $source=Join-Path $auditRoot ($stem+'.docx')
    if (-not $report.Where({ $_.source -eq $source }).Count) {
        $report.Add([pscustomobject]@{type=$case.type;semester=$case.semester;source=$source;status='BLOCKED';reason=('Not rendered after renderer failure: '+$rendererFailure)})
    }
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $auditRoot 'word-render-results.json') -Encoding UTF8
if ($report.Where({ $_.status -eq 'BLOCKED' }).Count) { exit 1 }
