<#
Installs AgentHits Dokploy on Windows: sets up WSL2 with Ubuntu 24.04 and
runs install-agenthits.sh inside it. Run in PowerShell as administrator:

  irm https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.ps1 | iex

Update:

  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.ps1))) update

Hardening (optional) is set with environment variables before the install:

  $env:HARDEN_SSH = '1'; $env:HARDEN_UFW = '1'; $env:HARDEN_FAIL2BAN = '1'
  irm https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.ps1 | iex
#>
param(
	[ValidateSet('install', 'update', 'harden')]
	[string]$Mode = 'install'
)

$ErrorActionPreference = 'Stop'
# Without it wsl.exe prints UTF-16, which breaks matching distro names.
$env:WSL_UTF8 = '1'

$Distro = if ($env:DOKPLOY_WSL_DISTRO) { $env:DOKPLOY_WSL_DISTRO } else { 'Ubuntu-24.04' }
$BaseUrl = if ($env:AGENTHITS_SCRIPT_BASE_URL) { $env:AGENTHITS_SCRIPT_BASE_URL } else { 'https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev' }
$PassthroughVars = @(
	'DOKPLOY_IMAGE', 'DOKPLOY_RELEASE_TAG', 'DOKPLOY_OFFICIAL_VERSION', 'DOKPLOY_FORK_VERSION',
	'TRAEFIK_IMAGE', 'POSTGRES_IMAGE', 'REDIS_IMAGE', 'POSTGRES_DATA_TARGET',
	'AGENTHITS_SCRIPT_BASE_URL', 'DOCKER_VERSION', 'DOCKER_SWARM_INIT_ARGS', 'ADVERTISE_ADDR', 'PUBLIC_IP',
	'DOKPLOY_SERVER_HARDENING', 'HARDEN_SSH', 'HARDEN_UFW', 'HARDEN_FAIL2BAN', 'DOCKER_ENGINE_UPGRADE',
	'DOKPLOY_BACKUP_DIR', 'DOKPLOY_HEALTH_TIMEOUT', 'DOKPLOY_HEALTH_INTERVAL', 'DOKPLOY_TRAEFIK_SETTLE', 'AGENTHITS_PULL_RETRY_DELAY',
	'DOKPLOY_DOCKER_VERIFY_TIMEOUT'
)
# VM creator id of WSL in the Hyper-V firewall (documented by Microsoft).
$WslVmCreatorId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$KeepAliveTask = 'AgentHits Dokploy WSL'
$InstallerPath = '/root/install-agenthits.sh'

function Test-Admin {
	$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
	return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DistroInstalled {
	$names = & wsl.exe --list --quiet 2>$null
	if ($LASTEXITCODE -ne 0) { return $false }
	foreach ($name in $names) {
		if ($name.Trim([char]0, ' ') -eq $Distro) { return $true }
	}
	return $false
}

function Invoke-InDistro {
	param([string[]]$Arguments)
	& wsl.exe -d $Distro -u root --exec @Arguments | Out-Host
	return $LASTEXITCODE
}

function Install-Distro {
	if (Test-DistroInstalled) { return }

	Write-Host "Installing WSL and $Distro..."
	& wsl.exe --set-default-version 2 2>$null | Out-Null
	& wsl.exe --install -d $Distro --no-launch
	if (-not (Test-DistroInstalled)) {
		# The first WSL install enables Windows features that need a reboot,
		# and older WSL registers the distro only on its first launch.
		throw "Reboot Windows (if WSL asked for it), open '$Distro' from the Start menu once, create a user there, then run this installer again."
	}
}

function Set-WslConfig {
	$path = Join-Path $env:USERPROFILE '.wslconfig'
	$lines = New-Object System.Collections.Generic.List[string]
	if (Test-Path $path) {
		foreach ($line in Get-Content $path) { $lines.Add($line) }
	}

	$wanted = [ordered]@{ vmIdleTimeout = '-1' }
	if ([Environment]::OSVersion.Version.Build -ge 22621) {
		$wanted.Insert(0, 'networkingMode', 'mirrored')
	} else {
		Write-Warning 'Mirrored WSL networking needs Windows 11 22H2 or newer; other devices in your network will not reach the panel. Use a Hyper-V VM instead (see docs/agenthits-install.md).'
	}

	$start = -1
	for ($i = 0; $i -lt $lines.Count; $i++) {
		if ($lines[$i].Trim() -ieq '[wsl2]') { $start = $i; break }
	}
	if ($start -lt 0) {
		$lines.Add('[wsl2]')
		$start = $lines.Count - 1
	}
	$end = $lines.Count
	for ($i = $start + 1; $i -lt $lines.Count; $i++) {
		if ($lines[$i].Trim() -match '^\[.+\]$') { $end = $i; break }
	}

	$changed = $false
	foreach ($key in $wanted.Keys) {
		$found = $false
		for ($i = $start + 1; $i -lt $end; $i++) {
			if ($lines[$i] -match "^\s*$key\s*=\s*(.*)$") {
				$found = $true
				if ($Matches[1].Trim() -ne $wanted[$key]) {
					Write-Warning "$path sets $key=$($Matches[1].Trim()); the installer expects $key=$($wanted[$key]) and leaves your value as is."
				}
			}
		}
		if (-not $found) {
			$lines.Insert($start + 1, "$key=$($wanted[$key])")
			$end++
			$changed = $true
		}
	}

	if ($changed) {
		Set-Content -Path $path -Value $lines -Encoding ascii
		Write-Host "Updated $path; restarting WSL to apply it."
		& wsl.exe --shutdown
	}
}

function Set-WslFirewall {
	if (-not (Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue)) { return }

	$rules = @(
		@{ Name = 'AgentHitsDokploy-TCP'; Protocol = 'TCP'; Ports = @('80', '443', '3000') },
		@{ Name = 'AgentHitsDokploy-UDP'; Protocol = 'UDP'; Ports = @('443') }
	)
	foreach ($rule in $rules) {
		if (Get-NetFirewallHyperVRule -Name $rule.Name -ErrorAction SilentlyContinue) { continue }
		New-NetFirewallHyperVRule -Name $rule.Name -DisplayName "AgentHits Dokploy ($($rule.Protocol))" `
			-Direction Inbound -VMCreatorId $WslVmCreatorId -Protocol $rule.Protocol `
			-LocalPorts $rule.Ports -Action Allow | Out-Null
	}
}

function Test-PortsFree {
	$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
		Where-Object { $_.LocalPort -in 80, 443, 3000 } |
		ForEach-Object {
			$process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
			if ($process -and $process.ProcessName -notmatch '^(wslrelay|wslservice|vmmem|vmmemWSL)$') {
				"$($_.LocalPort) ($($process.ProcessName))"
			}
		} | Sort-Object -Unique
	if ($busy) {
		throw "Ports already in use on Windows: $($busy -join ', '). Free them and run the installer again."
	}
}

# WSL stops a distro once no Windows process holds it open, which would stop
# Docker and the panel; this task keeps one open from logon.
function Register-KeepAlive {
	$user = "$env:USERDOMAIN\$env:USERNAME"
	$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless wsl.exe -d $Distro -u root --exec sleep infinity"
	$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
	$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
	$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
	Register-ScheduledTask -TaskName $KeepAliveTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
	Start-ScheduledTask -TaskName $KeepAliveTask
}

function Get-LanIp {
	$address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
		Where-Object { $_.PrefixOrigin -in 'Dhcp', 'Manual' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|WSL' } |
		Select-Object -First 1
	if ($address) { return $address.IPAddress }
	return $null
}

function Invoke-Installer {
	$envArgs = @()
	foreach ($name in $PassthroughVars) {
		$value = [Environment]::GetEnvironmentVariable($name)
		if ($value) { $envArgs += "$name=$value" }
	}
	return Invoke-InDistro (@('env') + $envArgs + @('bash', $InstallerPath, $Mode))
}

# `exit` would close the PowerShell window when this runs through iex, so
# failures are thrown instead.
if (-not (Test-Admin)) {
	throw 'Run PowerShell as administrator and start the installer again.'
}

if ($Mode -eq 'install') {
	Install-Distro
	Set-WslConfig
	Set-WslFirewall
	Test-PortsFree
	Register-KeepAlive
} elseif (-not (Test-DistroInstalled)) {
	throw "WSL distro '$Distro' is not installed. Run the installer without 'update' first."
}

$code = Invoke-InDistro @('curl', '-fsSL', "$BaseUrl/install-agenthits.sh", '-o', $InstallerPath)
if ($code -ne 0) { throw "Could not download install-agenthits.sh inside $Distro." }

$code = Invoke-Installer
# Exit code 3: the installer has just enabled systemd and the distro must
# restart before Docker can run.
if ($code -eq 3) {
	& wsl.exe --terminate $Distro | Out-Null
	$code = Invoke-Installer
}
if ($code -ne 0) { throw "install-agenthits.sh failed with exit code $code." }

if ($Mode -eq 'install') {
	Start-ScheduledTask -TaskName $KeepAliveTask
	$lanIp = Get-LanIp
	Write-Host ''
	Write-Host 'On this PC:        http://localhost:3000'
	if ($lanIp) { Write-Host "From your network: http://${lanIp}:3000" }
	Write-Host "Shell in WSL:      wsl -d $Distro -u root"
	Write-Host 'The panel runs while you are logged in to Windows. For a 24/7 server use a Hyper-V VM (docs/agenthits-install.md).'
}
