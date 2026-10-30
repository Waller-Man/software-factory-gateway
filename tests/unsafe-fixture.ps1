param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$resolved = [System.IO.Path]::GetFullPath($Path)
$expected = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\test-results'))
if (-not $resolved.StartsWith($expected + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Not a synthetic fixture.' }
$acl = Get-Acl -LiteralPath $resolved
$everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Read', 'Allow')))
Set-Acl -LiteralPath $resolved -AclObject $acl
