using System;
using System.Reflection;
using System.Windows.Forms;

internal static class WindowFrameTest {
    private sealed class StatusBubble : Form {
        protected override CreateParams CreateParams {
            get {
                var value = base.CreateParams;
                value.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
                return value;
            }
        }
    }

    private static void Check(Form form, bool expected, string name) {
        var method = typeof(BrowserWindow).GetMethod("IsBrowserFrame", BindingFlags.NonPublic | BindingFlags.Static);
        bool actual = (bool)method.Invoke(null, new object[] { form.Handle });
        if (actual != expected) throw new Exception(name + " was incorrectly classified");
    }

    [STAThread]
    private static void Main() {
        using (var browser = new Form())
        using (var tooltip = new Form())
        using (var tool = new Form())
        using (var saveDialog = new Form())
        using (var bubble = new StatusBubble()) {
            Check(browser, true, "browser frame");
            tooltip.FormBorderStyle = FormBorderStyle.None;
            Check(tooltip, false, "borderless link tooltip");
            tool.FormBorderStyle = FormBorderStyle.SizableToolWindow;
            Check(tool, false, "tool window");
            saveDialog.Owner = browser;
            Check(saveDialog, false, "owned Save As dialog");
            Check(bubble, false, "non-activating status bubble");
        }
        Console.WriteLine("window classification passed");
    }
}
