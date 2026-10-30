param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
# Test-only: secure a newly created synthetic fixture directory, never a real
# plugin installation. Children intentionally inherit this safe ACL.
$resolved = [System.IO.Path]::GetFullPath($Path)
$expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\test-results'))
if (-not $resolved.StartsWith($expectedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Not a test fixture directory.' }
$item = Get-Item -LiteralPath $resolved
if (-not $item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Expected test directory.' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $resolved -AclObject $acl
