using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class BrowserWindow {
    private delegate bool WindowCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    private static bool Running(int id) {
        try { using (var process = Process.GetProcessById(id)) return !process.HasExited; }
        catch (ArgumentException) { return false; }
    }

    private static bool IsBrowserFrame(IntPtr window) {
        const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000;
        const int WS_EX_TOOLWINDOW = 0x00000080, WS_EX_NOACTIVATE = 0x08000000;
        int style = GetWindowLong(window, -16), extendedStyle = GetWindowLong(window, -20);
        // Chrome also owns link-status bubbles, tooltips and native Save As dialogs.
        // Only resize unowned, resizable application frames; leave those surfaces alone.
        return (style & (WS_CAPTION | WS_THICKFRAME)) == (WS_CAPTION | WS_THICKFRAME)
            && (extendedStyle & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) == 0
            && GetWindow(window, 4) == IntPtr.Zero; // GW_OWNER
    }

    private static void Capture() {
        var terminal = GetConsoleWindow();
        var foreground = GetForegroundWindow();
        uint foregroundId;
        GetWindowThreadProcessId(foreground, out foregroundId);
        try {
            using (var process = Process.GetProcessById((int)foregroundId)) {
                var name = process.ProcessName.ToLowerInvariant();
                if (Array.IndexOf(new[] { "windowsterminal", "cmd", "powershell", "pwsh", "conhost", "openconsole" }, name) >= 0)
                    terminal = foreground;
            }
        } catch (ArgumentException) { }
        if (!IsWindowVisible(terminal)) terminal = IntPtr.Zero;
        var area = Screen.FromHandle(terminal).WorkingArea;
        int width = area.Width;
        int height = area.Height;
        Console.WriteLine("{\"terminalHandle\":\"" + terminal.ToInt64() + "\",\"width\":" + width
            + ",\"height\":" + height + ",\"left\":" + (area.Left + (area.Width - width) / 2)
            + ",\"top\":" + (area.Top + (area.Height - height) / 2) + "}");
    }

    private static void Watch(string[] args) {
        var terminal = new IntPtr(long.Parse(args[1]));
        int browserId = int.Parse(args[2]), ownerId = int.Parse(args[3]);
        int left = int.Parse(args[4]), top = int.Parse(args[5]);
        int width = int.Parse(args[6]), height = int.Parse(args[7]);
        var positioned = new HashSet<IntPtr>();
        WindowCallback callback = delegate(IntPtr window, IntPtr state) {
            uint windowId;
            GetWindowThreadProcessId(window, out windowId);
            if (windowId != browserId || !IsWindowVisible(window) || !IsBrowserFrame(window)) return true;
            bool ready = IsWindow(terminal) && IsWindowVisible(terminal) && !IsIconic(terminal);
            var foreground = GetForegroundWindow();
            if (!positioned.Contains(window)) {
                if (SetWindowPos(window, ready ? terminal : IntPtr.Zero, left, top, width, height, ready ? 0x10u : 0x14u))
                    positioned.Add(window);
            }
            if (ready && foreground == window) {
                SetForegroundWindow(terminal);
                SetWindowPos(window, terminal, 0, 0, 0, 0, 0x13);
            }
            return true;
        };
        while (Running(ownerId) && Running(browserId)) {
            EnumWindows(callback, IntPtr.Zero);
            Thread.Sleep(250);
        }
    }

    private static int Main(string[] args) {
        try {
            SetProcessDPIAware();
            if (args.Length == 1 && args[0] == "capture") Capture();
            else if (args.Length == 8 && args[0] == "watch") Watch(args);
            else return 2;
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
