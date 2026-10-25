' Chestplate launcher: starts the app with no console window.
Option Explicit
Dim sh, fso, root, node, cmd
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
node = root & "\runtime\node\node.exe"
If Not fso.FileExists(node) Then node = "node"
sh.CurrentDirectory = root & "\app"
cmd = """" & node & """ """ & root & "\app\server.js"""
sh.Run cmd, 0, False
