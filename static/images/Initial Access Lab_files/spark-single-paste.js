// BUGFIX (one Ctrl+V pastes twice: the host clipboard, then the guest's own clipboard):
//
// Pressing Ctrl+V in a Spark VNC console injects the host clipboard into the guest and then,
// ~300ms later, delivers a real Ctrl+V to the guest as well -- so the guest pastes its own
// clipboard on top. Confirmed in production with two deliberately different clipboards: pasting
// once produced HOSTSIDE followed by VMSIDE.
//
// The cause is a missing return in Spark's own VNC module. vnc_min.js wires the surface's
// clip-data handler in addSurface():
//
//     function yb(a) {
//       if (pa && a && (a = a.getData("text/plain")))
//         if (R.useVMWKeyEvent) g.writeText(a);
//         else { /* build clip packet */ J(c.buffer) }
//     }
//     ...
//     a.onclipdata = yb;
//
// It injects the clipboard and returns nothing. surface_min.js treats that return value as
// "did you handle this?", and fires a fallback keystroke when the answer is no:
//
//     q.onclipdata && (c = !q.onclipdata(y.clipData, !0));   // !undefined === true, always
//     c && setTimeout(hb, 300);                              // hb sends Ctrl+V to the guest
//
// Because yb never returns truthy, the fallback fires on every paste, on top of the injection.
// (There is a second call site with a 500ms fallback on the clip-request path; it uses the same
// contract and the same shape of clip-data object, so this wrapper covers both.)
//
// Fix: wrap onclipdata and report "handled" when there actually was text to inject. We check the
// same condition yb does rather than claiming success unconditionally, so that a paste with
// nothing to inject still falls through to Spark's Ctrl+V -- which is the sensible behavior when
// the host clipboard is empty or holds a type we cannot send.
//
// Must be called AFTER Vnc.addSurface(), because addSurface() is what assigns onclipdata. The
// session sets `onclipdata = null` on close and addSurface reassigns yb to a fresh surface on
// reconnect, so this is applied per connection attempt rather than once.
//
// Guarded so a future Spark build that stops assigning onclipdata -- or starts returning a value
// of its own -- surfaces loudly rather than silently regressing to double pastes.

function applySparkSinglePastePolicy(localInterface) {

    if (!localInterface || typeof localInterface.onclipdata !== "function") {
        console.warn("Spark surface has no onclipdata(); duplicate-paste fix not applied.");
        return localInterface;
    }

    const nativeOnClipData = localInterface.onclipdata;

    localInterface.onclipdata = function (clipData) {
        const result = nativeOnClipData.apply(this, arguments);

        // If Spark ever starts honouring the contract itself, defer to it entirely rather than
        // substituting our own answer. Inert against today's yb(), which always returns undefined.
        if (result) {
            return result;
        }

        // Only claim the paste when there was text for Spark to inject -- the same condition yb
        // itself checks before doing any work.
        try {
            if (clipData && typeof clipData.getData === "function" && clipData.getData("text/plain")) {
                return true;
            }
        } catch (err) {
            console.warn("Could not inspect clip data for the duplicate-paste fix:", err);
        }

        return result;
    };

    return localInterface;
}
