// BUGFIX (pasting into a Spark console fires shortcuts in the guest instead of pasting text):
//
// When you press Ctrl+V, Spark suppresses the V scancode and injects the clipboard content
// itself -- see the keydown handler in spark/surface_min.js:
//
//     (86 != b || !a.ctrlKey && !a.metaKey || a.ctrlKey && a.altKey || !pa) && qa(d, b, T.getScancode(a))
//
// (86 = V, pa = clipboard mapping enabled.) But it has already sent Ctrl DOWN to the guest, and
// it does not release it before injecting. So the guest is holding Ctrl while the clipboard
// characters arrive, and each one lands as Ctrl+<letter> rather than as text.
//
// Observed in production: pasting "appcfg-lod.js" gave Ctrl+A then Ctrl+P -- select all, then
// the print dialog. Pasting "Copying... Please try again" gave Ctrl+C then Ctrl+O, opening
// Notepad's Open dialog. The content of the clipboard decides which shortcuts fire, so the
// consequences range from harmless to destructive (Ctrl+S, Ctrl+N, Ctrl+W are all one letter
// away). It is intermittent because it depends on the modifier still being held when the
// injection lands.
//
// Fix: release the command modifiers in the guest at the start of the paste, before Spark
// injects anything. A capture-phase listener on the wrapper runs ahead of Spark's own
// bubble-phase handler on the input element, so we win the race without patching vendor code.
//
// Shift is deliberately NOT released: it only affects the case of a character rather than
// turning it into a command, and Spark's own #-class keymapping fix in html5_vnc.js depends on
// Shift semantics. Releasing a modifier the user is not holding is a no-op, so the extra
// scancodes cost nothing.
//
// SIDE EFFECT, accepted: after a paste the guest treats Ctrl as released even if the user is
// still physically holding it, so a key pressed immediately after Ctrl+V without letting go
// will not register as a chord. That is the correct reading of the user's intent -- they asked
// to paste, not to send a shortcut -- and it is strictly better than firing a random command.
//
// NOT fixed here: pressing Ctrl+V also delivers a real Ctrl+V to the guest, so the guest pastes
// its own clipboard in addition to the injected host content -- a double paste. That is a
// separate, pre-existing defect (Spark answering both halves of "which clipboard did you mean")
// and is tracked on its own.
//
// Guarded so a future Spark build that renames writeScancode surfaces loudly rather than
// silently regressing.

// XT set-1 scancodes for the modifiers that turn a letter into a command.
const SPARK_COMMAND_MODIFIER_SCANCODES = [
    29,  // left Ctrl
    157, // right Ctrl
    56,  // left Alt
    184, // right Alt (AltGr)
    219, // left Win / Meta
    220, // right Win / Meta
];

function applySparkPasteModifierPolicy(session, wrapperEl) {

    if (!wrapperEl || typeof wrapperEl.addEventListener !== "function") {
        console.warn("No Spark view wrapper element; paste modifier fix not applied.");
        return;
    }

    // Reconnects rebuild the session, so drop any handler left over from a prior attempt rather
    // than stacking listeners that would write to a dead session.
    //
    // This runs BEFORE the session is validated on purpose. The session guard below exists for a
    // future Spark build that renames writeScancode, and in that case the policy has to switch
    // off cleanly: returning with the old handler still attached would leave it releasing
    // modifier scancodes into a session that is gone on every paste. The property is cleared
    // too, so what the wrapper records stays true.
    if (wrapperEl._pasteModifierHandler) {
        wrapperEl.removeEventListener("paste", wrapperEl._pasteModifierHandler, true);
        wrapperEl._pasteModifierHandler = null;
    }

    if (!session || typeof session.writeScancode !== "function") {
        console.warn("Spark session has no writeScancode(); paste modifier fix not applied.");
        return;
    }

    const pasteModifierHandler = function () {
        try {
            // First argument must be a boolean: writeScancode() taps the key (down AND up) when
            // handed a number, which would press the modifier rather than release it.
            SPARK_COMMAND_MODIFIER_SCANCODES.forEach(function (scancode) {
                session.writeScancode(false, scancode);
            });
        } catch (err) {
            console.warn("Could not release modifiers before paste:", err);
        }
    };

    wrapperEl._pasteModifierHandler = pasteModifierHandler;
    wrapperEl.addEventListener("paste", pasteModifierHandler, true);
}
