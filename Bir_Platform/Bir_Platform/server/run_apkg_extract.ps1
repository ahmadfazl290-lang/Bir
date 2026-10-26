param(
    [Parameter(Mandatory=$true)][string]$PackagePath,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$ResultPath,
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\Anki')
)
$ErrorActionPreference = 'Stop'
$packageFullPath = [System.IO.Path]::GetFullPath($PackagePath)
$outputFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $ResultPath) { $ResultPath = Join-Path $outputFullPath 'result.json' }
$resultFullPath = [System.IO.Path]::GetFullPath($ResultPath)
$runtimeFullPath = [System.IO.Path]::GetFullPath($RuntimeDirectory)
$runtimeDll = Join-Path $runtimeFullPath 'python313.dll'
if (-not (Test-Path -LiteralPath $runtimeDll -PathType Leaf)) { throw 'The installed Anki runtime is unavailable.' }
$escapedRuntimeDll = $runtimeDll.Replace('\', '\\').Replace('"', '\"')
$nativeInteropCode = @"
using System;
using System.Runtime.InteropServices;
public static class BirEmbeddedAnkiPython {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
 [DllImport("$escapedRuntimeDll", CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)] public static extern void Py_SetPath(string path);
 [DllImport("$escapedRuntimeDll", CallingConvention=CallingConvention.Cdecl)] public static extern void Py_Initialize();
 [DllImport("$escapedRuntimeDll", CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Ansi)] public static extern int PyRun_SimpleString(string code);
 [DllImport("$escapedRuntimeDll", CallingConvention=CallingConvention.Cdecl)] public static extern int Py_FinalizeEx();
}
"@
Add-Type -TypeDefinition $nativeInteropCode
$configuration = @{
    BIR_APKG_PACKAGE = $packageFullPath
    BIR_APKG_OUTPUT = $outputFullPath
    BIR_APKG_RESULT = $resultFullPath
    BIR_APKG_SCRIPT = (Join-Path $PSScriptRoot 'apkg_extract.py')
} | ConvertTo-Json -Compress
$configurationBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($configuration))
[void][BirEmbeddedAnkiPython]::SetDllDirectory($runtimeFullPath)
[BirEmbeddedAnkiPython]::Py_SetPath("$runtimeFullPath\python313.zip;$runtimeFullPath;$runtimeFullPath\app_packages")
[BirEmbeddedAnkiPython]::Py_Initialize()
$nativeResult = [BirEmbeddedAnkiPython]::PyRun_SimpleString("import os, runpy, json, base64; os.environ.update(json.loads(base64.b64decode('$configurationBase64'))); runpy.run_path(os.environ['BIR_APKG_SCRIPT'], run_name='__main__')")
[void][BirEmbeddedAnkiPython]::Py_FinalizeEx()
if ($nativeResult -ne 0) { throw 'Anki package extraction failed before producing its result.' }
if (-not (Test-Path -LiteralPath $resultFullPath -PathType Leaf)) { throw 'Anki package extraction did not produce a result.' }
Write-Output $resultFullPath
