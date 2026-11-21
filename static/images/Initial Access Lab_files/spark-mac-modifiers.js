// BUGFIX (Mac Control/Command reversed on the Spark VNC gateway):
//
// Spark's surface (spark/surface_min.js) applies a macOS-only modifier rewrite in
// LocalInterface's scancode mapper, driven by two flags that BOTH default to true:
//
//     converMacCtrl : Ctrl (29) -> LeftWin (219), RightCtrl (157) -> RightWin (220)
//     mapCmdToCtrl  : Cmd  (219) -> Ctrl (29),    RightCmd (220)  -> RightCtrl (157)
//
// Enabled together that is literally a swap, which is why a Mac user on an ESX lab
// gets nothing from Ctrl+X in nano and has to press Cmd+X instead. The Horizon/WMKS
// path (wmks-6.5) does no such rewrite, so the same lab behaves correctly there --
// hence "correct on Horizon, backwards on Spark".
//
// The flags are set by LocalInterface.run(layout, converMacCtrl, noKeyStuck, mapCmdToCtrl),
// which the Spark VNC module calls for us from inside Vnc.addSurface():
//
//     var b = query.ctrlToWin ?? appcfg.ctrlToWin ?? true;
//     surface.run(99997, b);          // 4th arg omitted -> mapCmdToCtrl defaults to true
//
// So the VNC path exposes no supported knob for mapCmdToCtrl at all (rdp_min/ssh_min do;
// vnc_min does not), and its ctrlToWin knob would only fix half the swap. We therefore
// wrap run() itself -- the same technique used for the setUnicode pin in html5_vnc.js --
// and pin both flags off, which restores Horizon parity: Ctrl acts as Ctrl, Cmd acts as
// Win/Super.
//
// Must be called BEFORE Vnc.addSurface(), because addSurface() is what invokes run(), and
// run() branches on mapCmdToCtrl while it wires up clipboard handling (with mapCmdToCtrl
// off on macOS it switches to the async clipboard path instead of intercepting copy/cut).
// Setting the flags as plain properties after addSurface() would flip the key mapping but
// skip that branch, leaving the surface in an inconsistent state.
//
// No-op on non-Mac clients: the rewrite block in surface_min.js is gated on isMacOS || isiOS.
//
// Guarded so a future Spark build that renames run() surfaces loudly rather than silently
// regressing.
function applySparkMacModifierPolicy(localInterface) {

    if (!localInterface || typeof localInterface.run !== "function") {
        console.warn("Spark surface has no run(); Mac Control/Command mapping fix not applied.");
        return localInterface;
    }

    const nativeRun = localInterface.run.bind(localInterface);

    localInterface.run = function (layout, converMacCtrl, noKeyStuck, mapCmdToCtrl) {
        // Preserve the caller's layout and key-stuck handling; pin only the Mac modifier flags.
        return nativeRun(layout, false, noKeyStuck, false);
    };

    return localInterface;
}
