' Launch pinboard in a hidden console so no console window stays in front.
' 2026-10-20: user asked to stop keeping a foreground console / run it in the background.
' Same pattern as kuma\run-kuma.vbs (hidden cmd child, output appended to a log file).
' NOTE: this file MUST be CRLF. WSH treats a pure-LF file as one long line; the leading
'       apostrophe then comments out the whole script and the launch silently does nothing.
' Log: <project root>\logs\pinboard.log (append only, not rotated).
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
logs = root & "\logs"
If Not fso.FolderExists(logs) Then fso.CreateFolder(logs)
Set sh = CreateObject("WScript.Shell")
' 0 = hidden window; True = wait for the child (node is long-running, so this wscript stays
' alive as the parent process, which is expected).
cmd = "cmd /c cd /d """ & root & """ && pnpm start >> """ & logs & "\pinboard.log"" 2>&1"
sh.Run cmd, 0, True
