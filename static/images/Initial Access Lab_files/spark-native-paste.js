// BUGFIX (paste in a Spark console should use the guest's clipboard, not the host's):
//
// With clipboard mapping on (mapClipboard=1), Spark's surface treats V specially. In the
// keydown handler in spark/surface_min.js:
//
//     (86!=b||!a.ctrlKey&&!a.metaKey||a.ctrlKey&&a.altKey||!pa)&&qa(d,b,T.getScancode(a))
//
// (86 = V, pa = clipboard mapping on, qa = forward scancode to guest) every clause is false
// for Ctrl+V / Cmd+V, so the V scancode is NOT forwarded. The handler then returns true
// WITHOUT calling cancelDefault, deliberately letting the browser's own clipboard action fire
// instead, and Spark's onPaste reads the host clipboard and types it into the guest.
//
// Note the suppression is specific to V: for Ctrl+X and Ctrl+C, `86!=b` is true, so those
// forward their scancode normally and behave like any other guest shortcut.
//
// We never want host-clipboard injection: the product already has a deliberate "Type Text"
// action for pushing host-side text into a lab (instructions.js / sendText, which calls
// session.writeText directly and never raises a "paste" event -- unaffected by this file).
// Paste should mean "paste the guest's own clipboard," which is what a real Ctrl+V at the
// guest does.
//
// Two separate repairs are needed, because the browser event that a paste keystroke produces
// is platform-dependent:
//
//   1. A native "paste" event fires (Ctrl+V on Windows/Linux, Cmd+V on macOS -- these are the
//      OS-bound paste shortcuts). Intercept it in the capture phase ahead of Spark's own
//      bubble-phase handler on the input element, so onPaste never runs and the host clipboard
//      is never read, and forward a real Ctrl+V to the guest in its place.
//
//   2. macOS + physical Ctrl+V raises NO native paste event at all -- macOS binds paste to
//      Cmd+V only -- so case 1 can never fire for it. Combined with the scancode suppression
//      above, the keystroke reaches the guest as absolutely nothing, which is the "Ctrl+V does
//      nothing on a Mac" bug. keydown is the only event macOS delivers here, so send the paste
//      chord from there instead, using the same writeKeyComb call case 1 uses.
//
//      Do NOT try to be cleverer than that by tapping only the V scancode on the assumption
//      that the guest is already holding Ctrl (because Spark forwarded the real Ctrl keydown).
//      That was tried and it is wrong: the guest is NOT holding Ctrl at that point, and a bare
//      V tap arrives in the guest as a literal "v" character. writeKeyComb presses and releases
//      the whole chord, which is what actually lands as a paste.
//
//      Accepted side effect, same as spark-paste-modifiers.js documents: the guest treats Ctrl
//      as released afterwards even if the user is still physically holding it. Pressing another
//      key without letting go of Ctrl will not register as a chord. That is the right reading of
//      the user's intent -- they asked to paste -- and case 1 has always behaved this way.
//
// Both are applied only on connections with clipboard mapping ON. With mapping off the
// suppression clause (`!pa`) passes and Spark forwards V by itself, so either repair would
// send a second Ctrl+V on every paste.
//
// Guarded so a future Spark build that renames writeKeyComb surfaces loudly rather than
// silently regressing.

function applySparkNativePastePolicy(session, wrapperEl) {

    if (!wrapperEl || typeof wrapperEl.addEventListener !== "function") {
        console.warn("No Spark view wrapper element; native paste fix not applied.");
        return;
    }

    // Reconnects rebuild the session, so drop any handlers left over from a prior attempt rather
    // than stacking listeners that would write to a dead session.
    //
    // This runs BEFORE the session is validated on purpose. The session guard below exists for a
    // future Spark build that renames writeKeyComb, and in that case the policy has to switch off
    // cleanly: returning with the old handlers still attached would leave them swallowing paste
    // and Ctrl+V (both call preventDefault) while writing to a session that is gone -- worse than
    // never having applied the policy. The properties are cleared too, so what the wrapper
    // records stays true.
    if (wrapperEl._nativePasteHandler) {
        wrapperEl.removeEventListener("paste", wrapperEl._nativePasteHandler, true);
        wrapperEl._nativePasteHandler = null;
    }
    if (wrapperEl._macCtrlVHandler) {
        wrapperEl.removeEventListener("keydown", wrapperEl._macCtrlVHandler, true);
        wrapperEl._macCtrlVHandler = null;
    }

    if (!session || typeof session.writeKeyComb !== "function") {
        // Nothing can be forwarded, so the policy stays off and Spark's own behaviour resumes:
        // the host clipboard is injected on paste again, and Ctrl+V goes dead on macOS.
        console.warn("Spark session has no writeKeyComb(); native paste fix not applied.");
        return;
    }

    const nativePasteHandler = function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            session.writeKeyComb("Ctrl+V", 20);
        } catch (err) {
            console.warn("Could not forward Ctrl+V to the guest:", err);
        }
    };

    wrapperEl._nativePasteHandler = nativePasteHandler;
    wrapperEl.addEventListener("paste", nativePasteHandler, true);

    // macOS only: no native paste event exists for physical Ctrl+V, so the paste listener above
    // never sees it. Everywhere else Ctrl+V IS the OS paste shortcut and the listener handles it;
    // doing both would double the keystroke.
    // Both halves of this check are load-bearing, so don't "simplify" it to either one alone:
    // `typeof` is what survives appcfg-lod.js never loading, because `?.` does not protect an
    // undeclared identifier (a bare `hi5` would be a ReferenceError). The optional chain then
    // covers a hi5 that exists but is null or malformed -- `typeof null` is "object", so the
    // typeof test alone would fall through and throw on the dereference.
    if (typeof hi5 === "undefined" || !hi5?.browser?.isMacOS) {
        return;
    }

    const macCtrlVHandler = function (e) {
        // Ctrl+V only. Cmd+V still routes through the native paste event above, and Ctrl+Alt+V is
        // AltGr on some layouts -- Spark's own suppression clause exempts it for the same reason.
        if (!e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        // Match the physical key rather than the produced character.
        if (e.code ? e.code !== "KeyV" : e.keyCode !== 86) {
            return;
        }
        // Belt and braces: macOS raises no paste event for this combo, and preventing the default
        // guarantees none appears later and double-pastes through the listener above.
        e.preventDefault();
        // Deliberately NOT stopPropagation() -- Spark's own keydown handler should still run and
        // keep its internal key bookkeeping consistent. It withholds V, which is what we supply.
        //
        // Shift is part of the chord the user asked for, not noise to strip: Ctrl+Shift+V is the
        // paste shortcut in gnome-terminal and friends, where plain Ctrl+V means something else.
        // Spark's suppression clause has no shiftKey term, so Ctrl+Shift+V is withheld on macOS
        // for exactly the same reason Ctrl+V is -- forward whichever one was actually pressed.
        const combo = e.shiftKey ? "Ctrl+Shift+V" : "Ctrl+V";
        try {
            session.writeKeyComb(combo, 20);
        } catch (err) {
            console.warn("Could not forward " + combo + " to the guest:", err);
        }
    };

    wrapperEl._macCtrlVHandler = macCtrlVHandler;
    wrapperEl.addEventListener("keydown", macCtrlVHandler, true);
}
