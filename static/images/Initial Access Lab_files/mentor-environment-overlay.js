// The mentor over the VM console: its bubble pointing at a spot or a region of the VM's screen, a
// tip about the screen as a whole, and a ripple where it clicks.
//
// Everything sits on one layer over the visible part of the console's canvas, in this page, so it
// shows wherever the console does: docked beside the instructions, in fullscreen, or in a window of
// its own while the instructions are split off into another. Spots are in remote pixels, which is
// what the canvas holds: the console never scales it, but it can be scrolled within its wrapper or
// centered in it, so each mark is placed from where the canvas is on screen right now.
//
// The layer and the marks on it take no clicks, so the student's input reaches the VM through
// them; the bubble itself is solid, so a click on it never lands on something hidden under it. The
// student's own input to the console clears the bubble, unless it is a step of a tour, or a mark
// with a Done button, that the student is meant to follow along with. The next bubble clears it,
// as do its buttons, a switch to another console and a change in the VM's resolution, since the
// spot no longer means anything then. The mentor's own mouse and keys raise no events here, so
// they leave it up. Whoever showed the bubble hears why it went: replaced, student_input,
// console_changed, or the reason given to clear().
//
// The student can drag a movable bubble by its handle, or move it with the arrow keys, off
// something it hides, and shrink it to the mentor's avatar and back. Neither is input to the VM, and
// neither ends the bubble. Where they put it holds while it is up, through the console moving or
// resizing; the next bubble starts where the mentor puts it.
window.mentorEnvironmentOverlay = (function () {
    "use strict";

    const LAYER_CLASS = "mentor-environment-layer";
    const BUBBLE_GAP_PX = 12;
    const BUBBLE_SIDE_PX = 8;
    const BUBBLE_MAX_WIDTH_PX = 360;
    const TAIL_INSET_PX = 16;
    // Half the tail's width in mentor-bubble.css: from its left edge to its tip, and about how far it
    // reaches out of the bubble.
    const TAIL_HALF_PX = 7;
    const BOX_GAP_PX = 4;
    // The ring that pulses around a spot, with its outline, which the bubble's tail stops at.
    const SPOT_RADIUS_PX = 13;
    const RIPPLE_MS = 900;
    // Long enough for the caller's fade-out of the bubble to finish.
    const BUBBLE_FADE_WAIT_MS = 900;
    const STUDENT_INPUT_EVENTS = ["mousedown", "keydown", "wheel", "touchstart"];
    // How far a press on the handle travels before it is a drag rather than a click.
    const DRAG_THRESHOLD_PX = 3;
    const KEY_MOVE_PX = 10;
    const KEY_MOVES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

    let shown = null;

    // The part of the canvas the student can see: its own box cut down by every ancestor that
    // clips it, such as the console's scrolling wrapper, and by the window.
    function visibleRect(canvas) {
        const rect = canvas.getBoundingClientRect();
        let left = Math.max(rect.left, 0);
        let top = Math.max(rect.top, 0);
        let right = Math.min(rect.right, document.documentElement.clientWidth);
        let bottom = Math.min(rect.bottom, document.documentElement.clientHeight);
        for (let el = canvas.parentElement; el && el !== document.body; el = el.parentElement) {
            const style = window.getComputedStyle(el);
            if (style.overflowX === "visible" && style.overflowY === "visible") continue;
            const clip = el.getBoundingClientRect();
            left = Math.max(left, clip.left);
            top = Math.max(top, clip.top);
            right = Math.min(right, clip.right);
            bottom = Math.min(bottom, clip.bottom);
        }
        return { left: left, top: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }

    // Lays the layer over the visible part of the canvas. Returns where a remote pixel lands on it.
    function fitLayer(layer, canvas) {
        const view = visibleRect(canvas);
        layer.style.left = view.left + "px";
        layer.style.top = view.top + "px";
        layer.style.width = view.width + "px";
        layer.style.height = view.height + "px";
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        return {
            width: view.width,
            height: view.height,
            x: function (remoteX) { return rect.left - view.left + remoteX * scaleX; },
            y: function (remoteY) { return rect.top - view.top + remoteY * scaleY; },
            scaleX: scaleX,
            scaleY: scaleY
        };
    }

    function themeStylesheet() {
        return document.getElementById("themeStylesheet");
    }

    // Whether this page shows a dark theme, whose bright primary color the bubble darkens to keep
    // its text readable. The bubble's colors come from this page's theme, which can differ from the
    // page the mentor built it in, and which the student can switch while the bubble is up.
    function isDarkTheme() {
        const href = (themeStylesheet() || {}).href || "";
        return /[?&]mode=dark(?:&|$)/i.test(href);
    }

    // Whether the student's input went to the VM: a press over the visible part of its screen, or
    // a key while the VM has focus. Pressing the console's own controls, such as its fullscreen
    // button, isn't using the VM. Spark keeps the VM's focus in an input of its own beside the canvas.
    function isInputToScreen(event, canvas) {
        if (event.type === "keydown") {
            for (let el = canvas.parentElement; el && el !== document.body; el = el.parentElement) {
                if (el.contains(document.getElementById("wsinput"))) return el.contains(event.target);
            }
            return canvas.parentElement !== null && canvas.parentElement.contains(event.target);
        }
        const point = event.touches && event.touches.length ? event.touches[0] : event;
        const view = visibleRect(canvas);
        return point.clientX >= view.left && point.clientX < view.left + view.width
            && point.clientY >= view.top && point.clientY < view.top + view.height;
    }

    /**
     * Tells onInput each time the student uses the console's screen, as a bubble hears it: a press
     * on the mentor's own layer, such as a bubble's button, isn't using the console. The mentor's
     * mouse and keys raise no events here, so they aren't heard. A console popped out into a
     * window of its own hears its student there, so a canvas in another page's document isn't
     * this page's to hear.
     * @param {Function} getCanvas - Returns the canvas of the console in view, or null.
     * @param {Function} onInput - Called once for each input.
     * @returns {Function} Stops watching.
     */
    function watchStudentInput(getCanvas, onInput) {
        const heard = function (event) {
            const target = event.target;
            if (target && typeof target.closest === "function" && target.closest("." + LAYER_CLASS)) return;
            const canvas = getCanvas();
            if (canvas && canvas.ownerDocument === document && isInputToScreen(event, canvas)) onInput();
        };
        STUDENT_INPUT_EVENTS.forEach(function (type) { document.addEventListener(type, heard, { capture: true, passive: true }); });
        return function () {
            STUDENT_INPUT_EVENTS.forEach(function (type) { document.removeEventListener(type, heard, true); });
        };
    }

    function createLayer() {
        const layer = document.createElement("div");
        layer.className = LAYER_CLASS;
        document.body.appendChild(layer);
        return layer;
    }

    function addLayerElement(className, layer) {
        const element = document.createElement("div");
        element.className = className;
        element.setAttribute("aria-hidden", "true");
        layer.appendChild(element);
        return element;
    }

    // A ripple where the mentor clicked, at a remote pixel of the canvas.
    function ripple(canvas, x, y) {
        if (!canvas || !canvas.isConnected || !canvas.width || !canvas.height) return;
        const layer = createLayer();
        const at = fitLayer(layer, canvas);
        const ring = addLayerElement("mentor-environment-ripple", layer);
        ring.style.left = Math.round(at.x(x)) + "px";
        ring.style.top = Math.round(at.y(y)) + "px";
        window.setTimeout(function () { layer.remove(); }, RIPPLE_MS);
    }

    // Places the bubble below the spot or region with its tail on it, or above when below would
    // leave the screen, or inside a region that leaves room on neither side. A tip about the whole
    // screen hangs from its top. A bubble taller than the screen keeps within it, its note scrolling.
    function placeBubble(bubble, at, target) {
        const width = Math.min(BUBBLE_MAX_WIDTH_PX, Math.max(0, at.width - 2 * BUBBLE_SIDE_PX));
        bubble.style.width = Math.round(width) + "px";
        bubble.style.maxHeight = Math.round(Math.max(0, at.height - 2 * BUBBLE_SIDE_PX)) + "px";
        if (!target) {
            bubble.style.left = Math.round((at.width - width) / 2) + "px";
            bubble.style.top = BUBBLE_SIDE_PX + "px";
            return true;
        }
        const left = at.x(target.x);
        const top = at.y(target.y);
        const right = at.x(target.x + target.width);
        const bottom = at.y(target.y + target.height);
        const visible = right >= 0 && left <= at.width && bottom >= 0 && top <= at.height;
        if (!visible) return false;
        // The tail's tip stops at a spot's ring, so it still points at the spot once the ring has
        // faded; a region's bubble keeps clear of its outline.
        const isSpot = target.width === 0 && target.height === 0;
        const clearance = isSpot ? SPOT_RADIUS_PX + TAIL_HALF_PX : BOX_GAP_PX + BUBBLE_GAP_PX;
        const below = bottom + clearance;
        const above = top - clearance - bubble.offsetHeight;
        const fitsBelow = below + bubble.offsetHeight <= at.height;
        const isAbove = !fitsBelow && above >= 0;
        // With room on neither side, the bubble sits inside the region, tailless, where it can be seen.
        const isInside = !fitsBelow && !isAbove;
        const insideTop = Math.max(BUBBLE_SIDE_PX, Math.min(top + clearance, at.height - BUBBLE_SIDE_PX - bubble.offsetHeight));
        // The tail's tip sits on a spot, and at the start of a region.
        const aim = isSpot ? left - TAIL_HALF_PX : left;
        const bubbleLeft = Math.max(BUBBLE_SIDE_PX, Math.min(aim - TAIL_INSET_PX, at.width - BUBBLE_SIDE_PX - width));
        bubble.style.left = Math.round(bubbleLeft) + "px";
        bubble.style.top = Math.round(isInside ? insideTop : isAbove ? above : below) + "px";
        bubble.classList.toggle("mentor-pointer-caption--above", isAbove);
        bubble.classList.toggle("mentor-pointer-caption--inside", isInside);
        const tail = Math.max(TAIL_INSET_PX, Math.min(aim - bubbleLeft, width - 2 * TAIL_INSET_PX));
        bubble.style.setProperty("--mentor-pointer-tail-left", Math.round(tail) + "px");
        return true;
    }

    // Lets the student move a movable bubble by its handle, with the pointer or the arrow keys, and
    // shrink it to its avatar and back. A moved bubble loses its tail, the mark staying on its target.
    // The handle keeps its presses and keys to itself, so the VM never gets them. Returns a function
    // that keeps the bubble where the student put it, within the layer, each time it is placed, or
    // null for a bubble that doesn't move. placeAgain places the bubble again.
    function makeMovable(bubble, placeAgain) {
        if (!bubble.classList.contains("mentor-pointer-caption--movable")) return null;
        const avatar = bubble.querySelector(".mentor-pointer-avatar");
        const label = bubble.querySelector(".mentor-pointer-label");
        const minimize = bubble.querySelector(".mentor-pointer-minimize");
        let bounds = null;
        // Where the student moved it, and where it was as they shrank it unmoved.
        let moved = null;
        let minimizedAt = null;
        let drag = null;
        let justDragged = false;

        const isMinimized = function () { return bubble.classList.contains("mentor-pointer-caption--minimized"); };
        const position = function () {
            return { left: parseFloat(bubble.style.left) || 0, top: parseFloat(bubble.style.top) || 0 };
        };
        const putAt = function (wanted) {
            const maxLeft = bounds ? Math.max(0, bounds.width - bubble.offsetWidth) : wanted.left;
            const maxTop = bounds ? Math.max(0, bounds.height - bubble.offsetHeight) : wanted.top;
            const kept = { left: Math.round(Math.max(0, Math.min(wanted.left, maxLeft))), top: Math.round(Math.max(0, Math.min(wanted.top, maxTop))) };
            bubble.style.left = kept.left + "px";
            bubble.style.top = kept.top + "px";
            return kept;
        };
        const moveTo = function (wanted) {
            moved = putAt(wanted);
            bubble.classList.add("mentor-pointer-caption--moved");
        };
        // Shrunk, the avatar is the button that brings the bubble back.
        const setMinimized = function (minimizing) {
            minimizedAt = minimizing && !moved ? position() : null;
            bubble.classList.toggle("mentor-pointer-caption--minimized", minimizing);
            if (avatar) {
                if (minimizing) {
                    avatar.removeAttribute("aria-hidden");
                    avatar.setAttribute("role", "button");
                    avatar.setAttribute("aria-label", label ? label.textContent : "");
                    avatar.setAttribute("aria-expanded", "false");
                    avatar.tabIndex = 0;
                } else {
                    avatar.setAttribute("aria-hidden", "true");
                    ["role", "aria-label", "aria-expanded", "tabindex"].forEach(function (name) { avatar.removeAttribute(name); });
                }
            }
            placeAgain();
            const focusTo = minimizing ? avatar : minimize;
            if (focusTo && bubble.isConnected && bubble.classList.contains("mentor-pointer-caption")) focusTo.focus();
        };

        const startDrag = function (event) {
            if (event.button !== 0) return;
            const handle = event.currentTarget;
            drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: position(), isMoving: false };
            justDragged = false;
            if (event.pointerId !== undefined && typeof handle.setPointerCapture === "function") {
                try { handle.setPointerCapture(event.pointerId); } catch (e) { /* the pointer is already gone */ }
            }
            // Keeps the press from selecting text, and from reaching the page as a mouse press.
            event.preventDefault();
            event.stopPropagation();
        };
        const continueDrag = function (event) {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.isMoving && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            drag.isMoving = true;
            moveTo({ left: drag.from.left + dx, top: drag.from.top + dy });
        };
        const endDrag = function (event) {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.stopPropagation();
            justDragged = drag.isMoving;
            drag = null;
            const handle = event.currentTarget;
            if (event.pointerId !== undefined && typeof handle.releasePointerCapture === "function") {
                try { handle.releasePointerCapture(event.pointerId); } catch (e) { /* released already */ }
            }
        };
        const moveByKey = function (event) {
            if (event.currentTarget === avatar && !isMinimized()) return;
            if (event.currentTarget === avatar && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                event.stopPropagation();
                setMinimized(false);
                return;
            }
            const move = KEY_MOVES[event.key];
            if (!move) return;
            event.preventDefault();
            event.stopPropagation();
            const from = position();
            moveTo({ left: from.left + move[0] * KEY_MOVE_PX, top: from.top + move[1] * KEY_MOVE_PX });
        };

        [avatar, label].forEach(function (handle) {
            if (!handle) return;
            handle.addEventListener("pointerdown", startDrag);
            handle.addEventListener("pointermove", continueDrag);
            handle.addEventListener("pointerup", endDrag);
            handle.addEventListener("pointercancel", endDrag);
            handle.addEventListener("keydown", moveByKey);
        });
        if (avatar) {
            avatar.addEventListener("click", function () {
                const wasDragged = justDragged;
                justDragged = false;
                if (isMinimized() && !wasDragged) setMinimized(false);
            });
        }
        if (minimize) minimize.addEventListener("click", function () { setMinimized(true); });

        return function (at) {
            bounds = at;
            const kept = moved || minimizedAt;
            if (kept) putAt(kept);
        };
    }

    /**
     * Shows the mentor's bubble over the console.
     * @param {Object} options
     * @param {HTMLCanvasElement} options.canvas - The console's canvas.
     * @param {HTMLElement} options.bubble - The bubble, built in the lab client API caller's page.
     * @param {Object} [options.target] - { x, y, width?, height? } in remote pixels: a spot, or a region when sized.
     * @param {Function} [options.removeBubble] - Takes the bubble away, so it can fade; removed outright otherwise.
     * @param {boolean} [options.keepThroughStudentInput] - Leaves it up while the student uses the console.
     * @param {Function} [options.onClear] - Told why the bubble went, once it has.
     * @returns {boolean} Whether it is showing, which it isn't when the console has nothing on screen to point at.
     */
    function show(options) {
        clear("replaced");
        const canvas = options.canvas;
        const width = canvas.width;
        const height = canvas.height;
        const target = options.target || null;
        const region = target && target.width > 0 && target.height > 0 ? target : null;
        const layer = createLayer();
        const spot = target && !region ? addLayerElement("mentor-environment-spot", layer) : null;
        const box = region ? addLayerElement("mentor-pointer-box", layer) : null;
        const bubble = options.bubble;
        const matchTheme = function () {
            bubble.classList.toggle("mentor-pointer-caption--dark", isDarkTheme());
        };
        matchTheme();
        const theme = themeStylesheet();
        if (!target) bubble.classList.add("mentor-environment-tip");
        layer.appendChild(bubble);
        const placement = target ? { x: target.x, y: target.y, width: region ? region.width : 0, height: region ? region.height : 0 } : null;

        const keepWhereStudentPutIt = makeMovable(bubble, function () { place(); });
        const place = function () {
            // A console that went away, or a screen at another resolution, leaves nothing to point at.
            if (!canvas.isConnected || canvas.width !== width || canvas.height !== height || canvas.getClientRects().length === 0) {
                clear("console_changed");
                return;
            }
            const at = fitLayer(layer, canvas);
            if (spot) {
                spot.style.left = Math.round(at.x(target.x)) + "px";
                spot.style.top = Math.round(at.y(target.y)) + "px";
            }
            if (box) {
                box.style.left = Math.round(at.x(region.x) - BOX_GAP_PX) + "px";
                box.style.top = Math.round(at.y(region.y) - BOX_GAP_PX) + "px";
                box.style.width = Math.round(region.width * at.scaleX + 2 * BOX_GAP_PX) + "px";
                box.style.height = Math.round(region.height * at.scaleY + 2 * BOX_GAP_PX) + "px";
            }
            // Shown before placing, so a bubble coming back into view is measured at its real size.
            bubble.style.display = "";
            const isPlaced = placeBubble(bubble, at, placement);
            if (isPlaced && keepWhereStudentPutIt) keepWhereStudentPutIt(at);
            bubble.style.display = isPlaced ? "" : "none";
        };
        const clearOnStudentInput = function (event) {
            if (!bubble.contains(event.target) && isInputToScreen(event, canvas)) clear("student_input");
        };

        const watchesStudentInput = options.keepThroughStudentInput !== true;
        if (watchesStudentInput) {
            STUDENT_INPUT_EVENTS.forEach(function (type) { document.addEventListener(type, clearOnStudentInput, true); });
        }
        window.addEventListener("resize", place);
        document.addEventListener("scroll", place, true);
        // A switch of color mode loads the theme stylesheet again.
        if (theme) theme.addEventListener("load", matchTheme);
        const canvasResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(function () { place(); }) : null;
        if (canvasResizeObserver) canvasResizeObserver.observe(canvas);

        const showing = {
            onClear: options.onClear,
            remove: function () {
                if (watchesStudentInput) {
                    STUDENT_INPUT_EVENTS.forEach(function (type) { document.removeEventListener(type, clearOnStudentInput, true); });
                }
                window.removeEventListener("resize", place);
                document.removeEventListener("scroll", place, true);
                if (theme) theme.removeEventListener("load", matchTheme);
                if (canvasResizeObserver) canvasResizeObserver.disconnect();
                // The bubble fades out on the layer, so the layer goes once the bubble has.
                if (options.removeBubble) {
                    if (spot) spot.remove();
                    if (box) box.remove();
                    options.removeBubble(bubble);
                    window.setTimeout(function () { layer.remove(); }, BUBBLE_FADE_WAIT_MS);
                } else {
                    layer.remove();
                }
            }
        };
        shown = showing;
        place();
        return shown === showing;
    }

    function clear(reason) {
        if (!shown) return;
        const leaving = shown;
        shown = null;
        leaving.remove();
        if (leaving.onClear) leaving.onClear(reason || "cleared");
    }

    return { show: show, clear: clear, ripple: ripple, watchStudentInput: watchStudentInput };
})();
