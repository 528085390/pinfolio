<#
  pinfolio 启停脚本（后台隐藏运行，不开机自启，手动启动）
  用法：
      pinboard.ps1              启动（默认）
      pinboard.ps1 start        启动（后台隐藏，起来后自动开浏览器）
      pinboard.ps1 stop         停止
      pinboard.ps1 restart      重启
      pinboard.ps1 status       看状态
      pinboard.ps1 logs         看最近日志
  双击 start.cmd / stop.cmd 等同于 start / stop。
  2026-10-20：用户要求「启动不要前置那个窗口 / 后台运行」—— 服务改由 run-pinboard.vbs 隐藏启动，
  双击的那个窗口只活到启动完成（轮询 /api/health 到 200 后开浏览器），然后自己关掉。
  写法与 kuma 的 tools\kuma.ps1 保持一致。
#>
param(
    [ValidateSet('start','stop','restart','status','logs')]
    [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$Port    = 7788
$Url     = 'http://127.0.0.1:' + $Port + '/'
$Health  = 'http://127.0.0.1:' + $Port + '/api/health'
# 项目根按脚本位置推导（本脚本在 <root>\tools\ 下），以后搬目录不用改这里。
$Root    = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $Root 'logs\pinboard.log'
$Vbs     = Join-Path $Root 'run-pinboard.vbs'

function Get-Listener {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-PinboardNode {
    # 一条链两个 node：tsx cli（...\pinboard\node_modules\...\tsx\dist\cli.mjs server/index.ts）
    # 和它拉起的 loader 子进程（node --require ...\pinboard\... server/index.ts）。
    # 两个 CommandLine 都含 pinboard 与 index.ts，所以这两条 -like 就够；别只按端口杀，端口只挂在子进程上。
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -like '*pinboard*') -and ($_.CommandLine -like '*index.ts*') }
}

function Test-Up {
    try { return ((Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) } catch { return $false }
}

function Show-Status {
    $l = Get-Listener
    Write-Host 'pinfolio' -ForegroundColor Cyan
    if ($l) {
        Write-Host ('  状态    : 运行中 (pid ' + $l.OwningProcess + '，后台隐藏，无窗口)') -ForegroundColor Green
        $p = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
        if ($p) {
            Write-Host ('  启动于  : ' + $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss') + '  已运行 ' + [math]::Round(((Get-Date) - $p.StartTime).TotalMinutes, 1) + ' 分钟')
            Write-Host ('  优先级  : ' + $p.PriorityClass)
        }
        if (Test-Up) { Write-Host ('  接口    : ' + $Health + '  HTTP 200') -ForegroundColor Green }
        else         { Write-Host ('  接口    : ' + $Health + '  无响应') -ForegroundColor Yellow }
        Write-Host ('  地址    : ' + $Url)
    } else {
        Write-Host '  状态    : 已停止' -ForegroundColor Yellow
    }
    Write-Host ('  日志    : ' + $LogFile)
}

function Start-Pinboard {
    $l = Get-Listener
    if ($l) {
        Write-Host ('pinfolio 已经在运行 (pid ' + $l.OwningProcess + ')，只打开页面。') -ForegroundColor Yellow
        Start-Process $Url
        return
    }
    if (-not (Test-Path $Vbs)) { Write-Host ('找不到启动脚本: ' + $Vbs) -ForegroundColor Red; exit 1 }
    $logDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Write-Host '正在后台启动 pinfolio...' -ForegroundColor Cyan
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $Vbs + '"') -WorkingDirectory $Root
    $up = $false
    for ($i = 0; $i -lt 60; $i++) {          # 60 x 500ms = 最多 30 秒
        Start-Sleep -Milliseconds 500
        if (Test-Up) { $up = $true; break }
    }
    $sw.Stop()
    $sec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    if ($up) {
        $l = Get-Listener
        $pidText = if ($l) { ' (pid ' + $l.OwningProcess + ')' } else { '' }
        Write-Host ('已启动，用时 ' + $sec + ' 秒' + $pidText + '，日志: ' + $LogFile) -ForegroundColor Green
        # wscript -> cmd -> node 这条链有时会被 Windows 标成 BelowNormal + 效率模式，主机一忙 node 就被饿
        # （kuma 2026-10-19 的 SQLite 连接池停滞就是这么来的，见 kuma\OBS-NOTES.md 坑 #9）。
        if ($l) {
            $p = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
            if ($p -and $p.PriorityClass -eq 'BelowNormal') {
                try { $p.PriorityClass = 'AboveNormal'; Write-Host '  已把 node 优先级从 BelowNormal 提到 AboveNormal' -ForegroundColor DarkGray } catch { }
            }
        }
        Write-Host ('  地址    : ' + $Url)
        Start-Process $Url
    } else {
        Write-Host ('启动超时（' + $sec + ' 秒内没等到 ' + $Health + ' 返回 200）') -ForegroundColor Red
        Write-Host ('  看日志: ' + $LogFile) -ForegroundColor Red
        exit 1
    }
}

function Stop-Pinboard {
    $l = Get-Listener
    $node = @(Get-PinboardNode)
    if (-not $l -and $node.Count -eq 0) { Write-Host '本来就是停止状态。' -ForegroundColor Yellow; return }
    $pids = @()
    if ($l) { $pids += $l.OwningProcess }
    foreach ($n in $node) { if ($pids -notcontains $n.ProcessId) { $pids += $n.ProcessId } }
    foreach ($p in $pids) {
        try { Stop-Process -Id $p -Force -ErrorAction Stop; Write-Host ('已结束 pid ' + $p) }
        catch { Write-Host ('结束 pid ' + $p + ' 失败: ' + $_.Exception.Message) -ForegroundColor Red }
    }
    $free = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-Listener)) { $free = $true; break }
    }
    if ($free) { Write-Host ('已停止，端口 ' + $Port + ' 已释放。') -ForegroundColor Green }
    else { Write-Host ('端口 ' + $Port + ' 仍被占用，请检查。') -ForegroundColor Red; exit 1 }
}

function Show-Logs {
    if (-not (Test-Path $LogFile)) { Write-Host ('日志文件不存在: ' + $LogFile) -ForegroundColor Red; return }
    Write-Host ('--- ' + $LogFile + ' 最后 40 行 ---') -ForegroundColor Cyan
    # 日志是 UTF-8；Windows PowerShell 5.1 默认按 ANSI/GBK 解码会显示乱码，必须显式指定
    Get-Content -Path $LogFile -Tail 40 -Encoding UTF8
}

switch ($Action) {
    'start'   { Start-Pinboard }
    'stop'    { Stop-Pinboard }
    'restart' { Stop-Pinboard; Start-Sleep -Milliseconds 500; Start-Pinboard }
    'status'  { Show-Status }
    'logs'    { Show-Logs }
}
