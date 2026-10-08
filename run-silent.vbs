Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\tee\.gemini\antigravity-ide\scratch\fox-plains-estate"
WshShell.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\tee\.gemini\antigravity-ide\scratch\fox-plains-estate\server.js""", 0, False
