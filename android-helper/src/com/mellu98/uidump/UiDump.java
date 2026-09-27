package com.mellu98.uidump;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import com.android.uiautomator.core.UiAutomationShellWrapper;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.util.List;

/**
 * Dump della gerarchia UI SENZA attendere lo stato idle.
 *
 * `uiautomator dump` chiama waitForIdle(1000, 10000) e, se in 10 s non trova
 * un secondo di quiete, esce con "ERROR: could not get idle state.". Nella live
 * TikTok con asta attiva (conto alla rovescia, commenti) la quiete non arriva
 * mai. Qui si usa la stessa connessione UiAutomation della shell (uiautomator.jar
 * di sistema) ma l'albero si legge subito, finestra per finestra.
 *
 * Avvio (dal Mac, via adb):
 *   CLASSPATH=/system/framework/uiautomator.jar:/data/local/tmp/ada-ui-dump.jar \
 *     app_process /system/bin com.mellu98.uidump.UiDump
 *
 * stdout: XML compatibile con `uiautomator dump` (nodi <node ... bounds="[x1,y1][x2,y2]">).
 * stderr: una riga "UIDUMP-ERROR: ..." in caso di errore, exit code 1.
 */
public final class UiDump {

    private static final int FLAG_INCLUDE_NOT_IMPORTANT_VIEWS = 0x02;
    private static final int FLAG_RETRIEVE_INTERACTIVE_WINDOWS = 0x40;
    /** Il bridge UiAutomation appena connesso non risponde subito. */
    private static final long BRIDGE_SETTLE_MS = 300;
    private static final int ROOT_ATTEMPTS = 10;
    private static final long ROOT_RETRY_MS = 150;
    private static final int MAX_DEPTH = 120;

    private UiDump() {}

    public static void main(String[] args) {
        int exitCode = 0;
        UiAutomationShellWrapper wrapper = new UiAutomationShellWrapper();
        try {
            wrapper.connect();
            UiAutomation automation = wrapper.getUiAutomation();
            configure(automation);
            Thread.sleep(BRIDGE_SETTLE_MS);

            String xml = dumpWithRetry(automation);
            PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), false, "UTF-8");
            out.print(xml);
            out.flush();
        } catch (Throwable t) {
            System.err.println("UIDUMP-ERROR: " + t);
            exitCode = 1;
        } finally {
            try {
                wrapper.disconnect();
            } catch (Throwable ignored) {
                // la connessione può non essere mai partita: niente da chiudere
            }
        }
        System.exit(exitCode);
    }

    /** Stesse opzioni di `uiautomator dump` (non compresso) + accesso a tutte le finestre. */
    private static void configure(UiAutomation automation) {
        AccessibilityServiceInfo info = automation.getServiceInfo();
        info.flags |= FLAG_INCLUDE_NOT_IMPORTANT_VIEWS | FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        automation.setServiceInfo(info);
    }

    private static String dumpWithRetry(UiAutomation automation) throws InterruptedException {
        RuntimeException lastFailure = null;
        for (int attempt = 0; attempt < ROOT_ATTEMPTS; attempt++) {
            StringBuilder body = new StringBuilder(64 * 1024);
            try {
                if (appendAllWindows(automation, body) > 0 || appendActiveWindow(automation, body)) {
                    return "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>"
                            + "<hierarchy rotation=\"0\" source=\"ui-dump-no-idle\">"
                            + body
                            + "</hierarchy>";
                }
            } catch (RuntimeException e) {
                // Albero cambiato durante la lettura (relayout continuo nella live): si riprova
                lastFailure = e;
            }
            Thread.sleep(ROOT_RETRY_MS);
        }
        String reason = lastFailure == null ? "nessuna finestra leggibile" : "ultimo errore: " + lastFailure;
        throw new IllegalStateException(reason + " dopo " + ROOT_ATTEMPTS + " tentativi");
    }

    /** Finestre in ordine di z-order (la più in alto per prima), come le restituisce il sistema. */
    private static int appendAllWindows(UiAutomation automation, StringBuilder xml) {
        List<AccessibilityWindowInfo> windows = automation.getWindows();
        if (windows == null) {
            return 0;
        }
        int dumped = 0;
        for (int i = 0; i < windows.size(); i++) {
            AccessibilityWindowInfo window = windows.get(i);
            AccessibilityNodeInfo root = window == null ? null : window.getRoot();
            if (root == null) {
                continue;
            }
            Rect windowBounds = new Rect();
            window.getBoundsInScreen(windowBounds);
            xml.append("<window index=\"").append(i)
                    .append("\" type=\"").append(window.getType())
                    .append("\" layer=\"").append(window.getLayer())
                    .append("\" bounds=\"").append(formatBounds(windowBounds)).append("\">");
            appendNode(root, 0, 0, windowBounds, xml);
            xml.append("</window>");
            dumped++;
        }
        return dumped;
    }

    /** Ripiego se il sistema non espone l'elenco finestre. */
    private static boolean appendActiveWindow(UiAutomation automation, StringBuilder xml) {
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (root == null) {
            return false;
        }
        Rect clip = new Rect();
        root.getBoundsInScreen(clip);
        appendNode(root, 0, 0, clip, xml);
        return true;
    }

    private static void appendNode(AccessibilityNodeInfo node, int index, int depth, Rect clip, StringBuilder xml) {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        // Come uiautomator: bounds visibili, tagliati al perimetro della finestra
        if (!bounds.intersect(clip)) {
            bounds.setEmpty();
        }

        xml.append("<node index=\"").append(index).append('"');
        appendAttr(xml, "text", node.getText());
        appendAttr(xml, "resource-id", node.getViewIdResourceName());
        appendAttr(xml, "class", node.getClassName());
        appendAttr(xml, "package", node.getPackageName());
        appendAttr(xml, "content-desc", node.getContentDescription());
        appendFlag(xml, "checkable", node.isCheckable());
        appendFlag(xml, "checked", node.isChecked());
        appendFlag(xml, "clickable", node.isClickable());
        appendFlag(xml, "enabled", node.isEnabled());
        appendFlag(xml, "focusable", node.isFocusable());
        appendFlag(xml, "focused", node.isFocused());
        appendFlag(xml, "scrollable", node.isScrollable());
        appendFlag(xml, "long-clickable", node.isLongClickable());
        appendFlag(xml, "password", node.isPassword());
        appendFlag(xml, "selected", node.isSelected());
        xml.append(" bounds=\"").append(formatBounds(bounds)).append('"');

        int childCount = node.getChildCount();
        if (childCount == 0 || depth >= MAX_DEPTH) {
            xml.append("/>");
            return;
        }
        xml.append('>');
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            // Come uiautomator: i figli non visibili all'utente non si scrivono
            if (child != null && child.isVisibleToUser()) {
                appendNode(child, i, depth + 1, clip, xml);
            }
        }
        xml.append("</node>");
    }

    private static String formatBounds(Rect r) {
        return "[" + r.left + "," + r.top + "][" + r.right + "," + r.bottom + "]";
    }

    private static void appendFlag(StringBuilder xml, String name, boolean value) {
        xml.append(' ').append(name).append("=\"").append(value).append('"');
    }

    private static void appendAttr(StringBuilder xml, String name, CharSequence value) {
        xml.append(' ').append(name).append("=\"");
        if (value != null) {
            escapeInto(xml, value);
        }
        xml.append('"');
    }

    private static void escapeInto(StringBuilder xml, CharSequence value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '&': xml.append("&amp;"); break;
                case '<': xml.append("&lt;"); break;
                case '>': xml.append("&gt;"); break;
                case '"': xml.append("&quot;"); break;
                case '\'': xml.append("&apos;"); break;
                case '\n': xml.append("&#10;"); break;
                case '\r': xml.append("&#13;"); break;
                case '\t': xml.append("&#9;"); break;
                default:
                    if (c >= 0x20) {
                        xml.append(c);
                    }
            }
        }
    }
}
