class Emitter {
    constructor() {
        this.eventMap = new Map();
    }

    on(event, callback) {
        if (!this.eventMap.has(event)) {
            this.eventMap.set(event, []);
        }
        this.eventMap.get(event).push(callback);
    }

    off(event, callback) {
        if (this.eventMap.has(event)) {
            const callbacks = this.eventMap.get(event).filter(cb => cb !== callback);
            this.eventMap.set(event, callbacks);
        }
    }

    emit(event, ...data) {
        if (this.eventMap.has(event)) {
            this.eventMap.get(event).forEach(callback => {
                callback(...data);
            });
        }
    }
}

/** ApiV1 class provides methods to interact with the lab environment. 
    You can access it using the syntax api.v1.[methodName] 
*/
class ApiV1 {

    // The screen this frame's latest getEnvironmentScreenDataUrl screenshot showed, see
    // getEnvironmentScreenDataUrl: { consoleId, width, height }, or null.
    #screenshotFrame = null;
    // A compact grayscale copy of that screenshot's screen, which useMouseInEnvironment's
    // checkTarget compares the screen around its spot against, or null.
    #screenshotCopy = null;
    // The tour showInEnvironment has up, or null.
    #tour = null;
    // The bubble showInEnvironment has up, or null.
    #environmentBubble = null;

    constructor() {
        this.emitter = new Emitter();
    }

    getLabConsole() {
        if (typeof labConsole !== 'undefined') {
            return labConsole;
        }
        if (typeof labClient !== 'undefined' && labClient.isChildClient()) {
            return window.parent.consoleWindow.labConsole;
        }
    }

    getInstructionsLabClient() {
        if (typeof labClient !== 'undefined') {
            return labClient;
        }
        if (typeof labConsole !== 'undefined' && labConsole.isChildClient()) {
            return window.parent.instructionsLabClient;
        }
    }

    /** Returns the current environment connection status, 
      * For example, the current connection status of the selected virtual machine in a virtualization lab. 
      * This is typically used to determine if the lab environment is connected or disconnected.
      * Example: api.v1.getEnvironmentConnectionStatus();
      * @returns {Object} An object containing the environment type, status, and other details.
    */
    getEnvironmentConnectionStatus() {
        const response = {
            environment_type: "none",
            environment_type_code: 0,
            machine_id: null,            
            status: "disconnected",
            status_code: 0,
            error: null
        };
        const labConsole = this.getLabConsole();
        if (labConsole != null && typeof labConsole.getSelectedMachine === 'function') {
            const selectedMachine = labConsole.getSelectedMachine();
            if (selectedMachine != null) {
                response.environment_type = "machine";
                response.environment_type_code = 1;
                response.machine_id = selectedMachine.ProfileId;
                const rc = this.getLabConsole()?.getSelectedRemoteController();
                if (rc != null) {
                    const connectionState = rc.getConnectionState();
                    if (connectionState == 1) {
                        response.status = "connected";
                        response.status_code = 1;
                    }
                }
            }
        }
        return response;
    }

    /** Returns the latency of the current environment connection.
      * For example, the current latency between the lab client and the selected virtual machine in a virtualization lab.
      * This is typically used to measure the responsiveness of the connection.
      * Example: api.v1.getEnvironmentLatency();
      * @returns {number} The latency in milliseconds, or 0 if not available.
    */
    getEnvironmentLatency() {
        return this.getLabConsole()?.getLastLatency() ?? 0;
    }

    /** Returns a snapshot of the current environment screen as a base64-encoded data URL.
      * For example, the current screen contents of the selected virtual machine or endpoint in a
      * virtualization lab. Screen data is captured client-side from the active remote controller
      * and is not always available; the response indicates whether the snapshot succeeded and,
      * if not, why.
      *
      * Available to in-page callers only. This method is intentionally NOT exposed via the
      * postMessage host-page bridge — screen contents are an open-ended exfiltration primitive
      * and we restrict capture to scripts already running inside the lab-client's frames.
      *
      * A successful capture is also recorded as this frame's latest screenshot: which console it
      * shows and at what resolution. Spots passed to useMouseInEnvironment and showInEnvironment
      * are in the pixels of that screenshot, and are refused as "stale" once the student has
      * switched consoles, the screen's resolution has changed, or the student has used the console
      * with their own mouse, keys or touch since the capture began. Every in-page caller in the frame
      * shares this record, so any caller's screenshot is what later spots are checked against.
      * When the student switches consoles while the capture runs, the screenshot recorded is not
      * the one in view, so a spot on it answers stale. What a wait measures from is described on
      * waitForEnvironmentScreen. The record also keeps a compact grayscale copy of the screen, at
      * most 640 pixels wide, which useMouseInEnvironment's checkTarget and a wait on a region
      * measure against.
      *
      * Example: await api.v1.getEnvironmentScreenDataUrl();
      * @returns {Promise<Object>} A promise resolving to an object with `ok`, `data_url`,
      *   `reason`, and `message` fields. The async return shape lets capture paths that need
      *   asynchronous work (DOM rasterization, future server-side capture, etc.) participate
      *   alongside the synchronous canvas-based paths.
      *   `ok` is true only when `data_url` is a real data URL.
      *   `reason` is null on success; otherwise one of:
      *     "not_supported"  — the lab build does not expose screen capture at all, or the active
      *                        target type fundamentally cannot produce screen data (e.g., a
      *                        web-display container, or an endpoint whose protocol the lab
      *                        client doesn't render natively).
      *     "not_available"  — the active target type supports screen capture but cannot produce
      *                        data right now (e.g., no target selected, or not connected).
      *     "capture_failed" — the underlying capture call threw.
    */
    async getEnvironmentScreenDataUrl() {
        const labConsole = this.getLabConsole();
        if (labConsole == null || typeof labConsole.getScreenDataUrl !== 'function') {
            return {
                ok: false, data_url: null, reason: "not_supported",
                message: "Screen data is not supported in this lab environment."
            };
        }
        // Read as the capture begins, since a capture can take a while and the student can switch
        // consoles meanwhile.
        const frameAtCapture = this.#currentScreenFrame(labConsole);
        let result;
        try {
            // Internal contract returns a canvas; we encode to PNG at this
            // public-API boundary so the data_url shape stays unchanged for
            // existing in-page consumers.
            result = await labConsole.getScreenDataUrl();
        } catch (e) {
            console.error('getEnvironmentScreenDataUrl: capture failed', e);
            return {
                ok: false, data_url: null, reason: "capture_failed",
                message: "Failed to capture screen data."
            };
        }
        if (result?.ok && result.canvas) {
            try {
                const dataUrl = result.canvas.toDataURL("image/png");
                try {
                    this.#rememberScreenshotFrame(labConsole, frameAtCapture, result.canvas);
                } catch (e) {
                    console.warn('getEnvironmentScreenDataUrl: remembering the screen captured failed', e);
                }
                return { ok: true, data_url: dataUrl, reason: null, message: null };
            } catch (e) {
                console.error('getEnvironmentScreenDataUrl: encode failed', e);
                return {
                    ok: false, data_url: null, reason: "capture_failed",
                    message: "Failed to capture screen data."
                };
            }
        }
        const reason = result?.reason ?? "not_available";
        const messages = {
            not_supported: "Screen data is not supported for the active target.",
            not_available: "Screen data is not currently available.",
            capture_failed: "Failed to capture screen data."
        };
        return { ok: false, data_url: null, reason, message: messages[reason] ?? null };
    }

    /** Returns a snapshot of the entire lab client UI (parent chrome, the
      * environment iframe, and the instructions iframe -- or, in split mode,
      * the popped-out instructions window) as a base64-encoded PNG data URL.
      *
      * The composite is performed on the lab client wrapper window, which is
      * the only context with reach into both same-origin iframes plus the
      * popped-out window reference. The current call is therefore only
      * available when this api is invoked from inside that wrapper -- i.e.
      * from a script running in the console or instructions iframe. Callers
      * loaded into the popped-out instructions window itself, or into a
      * standalone instructions page, will receive "not_supported".
      *
      * Sub-failures (environment disconnected, instructions inaccessible) do
      * NOT fail the overall capture: the affected slot is rendered with a
      * "Screen unavailable" placeholder and the rest of the UI is returned
      * intact. The overall call only reports `ok: false` when no composite
      * could be produced at all.
      *
      * Available to in-page callers only. Like getEnvironmentScreenDataUrl,
      * this is intentionally NOT exposed via the postMessage host-page
      * bridge -- a full-UI capture is strictly more sensitive than the
      * environment alone (instructions may render lab tokens, credentials,
      * URLs) and we restrict capture to scripts already running inside the
      * lab-client's frames.
      *
      * Example: await api.v1.getLabClientScreenDataUrl();
      * @returns {Promise<Object>} A promise resolving to an object with `ok`,
      *   `data_url`, `reason`, and `message` fields. `ok` is true only when
      *   `data_url` is a real data URL. `reason` is null on success;
      *   otherwise one of:
      *     "not_supported"  — invoked outside the lab client wrapper.
      *     "capture_failed" — the composite path threw.
      *     "not_available"  — fallback reason if a future wrapper returns
      *                        ok:false without supplying its own reason. The
      *                        current wrapper only emits "not_supported" or
      *                        "capture_failed"; documenting the api-side
      *                        fallback so callers don't have to special-case
      *                        an unfamiliar reason later.
    */
    async getLabClientScreenDataUrl() {
        let host;
        try {
            host = window.parent;
        } catch {
            return {
                ok: false, data_url: null, reason: "not_supported",
                message: "Lab client screen capture is only available inside the lab client wrapper."
            };
        }
        if (host == null || host === window || typeof host.getLabClientScreenDataUrl !== 'function') {
            return {
                ok: false, data_url: null, reason: "not_supported",
                message: "Lab client screen capture is only available inside the lab client wrapper."
            };
        }
        let result;
        try {
            result = await host.getLabClientScreenDataUrl();
        } catch (e) {
            console.error('getLabClientScreenDataUrl: capture failed', e);
            return {
                ok: false, data_url: null, reason: "capture_failed",
                message: "Failed to capture lab client screen."
            };
        }
        if (result?.ok) {
            return { ok: true, data_url: result.data_url, reason: null, message: null };
        }
        const reason = result?.reason ?? "not_available";
        const messages = {
            not_supported: "Lab client screen capture is not supported in this build.",
            not_available: "Lab client screen capture is not currently available.",
            capture_failed: "Failed to capture lab client screen."
        };
        return { ok: false, data_url: null, reason, message: messages[reason] ?? null };
    }

    /** Sends text to the current environment, typed into the console where it can take typed
      * text, otherwise sent as the student's typed text is. Where the console queues input
      * (Hyper-V and RDP endpoint consoles), the text goes in after the input still going into
      * it, and the input sent after it waits for it. There, text up to 200 characters goes as key
      * presses; longer text goes as a clipboard paste, with CRLF line breaks, where the console
      * shares the clipboard with the student, and as key presses where it doesn't.
      * This is typically used to send commands to a virtual machine console in a virtualization lab.
      * Example: api.v1.sendTextToEnvironment("text to be sent");
      * @param {string} text - The text to send to the environment.
      * @returns {void} No return value.
    */
    sendTextToEnvironment(text) {
        const labConsole = this.getLabConsole();
        if (labConsole == null || typeof text !== "string") {
            return;
        }
        if (typeof labConsole.typeKeys === "function") {
            labConsole.typeKeys(text);
        } else {
            labConsole.typeText(text);
        }
    }

    /** Presses a key combination in the current environment's console.
      * This is typically used to press shortcuts such as Ctrl+Shift+Esc or Win+R, or keys such as
      * Tab and Enter, in a virtual machine console or one of its endpoints. The keys go out in
      * order behind any text still being typed into the same console.
      *
      * Optionally the answer waits until the screen changes or settles after the keys, and carries
      * a screenshot of the screen afterwards; both are of the console that took the keys, and are
      * refused as "not_available" once the student switches to another console. Such a screenshot
      * is recorded like one from getEnvironmentScreenDataUrl, so spots can be picked on it at once.
      *
      * Also exposed through the postMessage host-page bridge, without waitUntil, screenshot and
      * asStudent: pressing keys carries the same privilege as sendTextToEnvironment. The request is
      * { event_id: "pressKeysInEnvironment", keys, repeat, version? } and the reply is
      * { event_Id: "environment_keys_pressed", ok, reason, message }. A frame without a console, or
      * a request without keys, gets no reply.
      *
      * Example: await api.v1.pressKeysInEnvironment("Ctrl+Shift+Esc");
      * Example: await api.v1.pressKeysInEnvironment("Tab", { repeat: 3, screenshot: true });
      * @param {string} keys - Key names joined with +, such as "Ctrl+Shift+Esc", "Win+R" or "Tab".
      *   Known names: Ctrl, Alt, Shift, Win (also Control, Windows, Meta), Tab, Enter, Esc, Space,
      *   Backspace, Delete, Insert, Home, End, PageUp, PageDown, Up, Down, Left, Right, F1 to F12,
      *   letters and digits, in any case. At most one of them may be other than Ctrl, Alt, Shift
      *   and Win, which are pressed first.
      * @param {Object} [options]
      * @param {number} [options.repeat=1] - How many times to press the keys, 1 to 20. Every press
      *   goes out or none does.
      * @param {Object} [options.waitUntil] - A wait to follow the keys with, as waitForEnvironmentScreen
      *   takes it: { until, timeoutSeconds?, quietSeconds?, region? }. A wait until the screen changes
      *   measures from the screen just before the keys went out. A region is placed as the keys are
      *   taken, so one that is malformed or "stale" refuses them.
      * @param {boolean} [options.screenshot] - true to answer with the screen afterwards.
      * @param {boolean} [options.asStudent] - true to treat a console hidden from students as
      *   nothing selected, as for an author previewing the lab as a student.
      * @param {Function} [options.onCapturing] - Called just before the screenshot is captured.
      * @returns {Promise<Object>} Resolves { ok, reason, message }, plus, when asked for:
      *   `waited`, how the wait went, shaped as waitForEnvironmentScreen answers; and `screenshot`,
      *   shaped as getEnvironmentScreenDataUrl answers, plus the screen's `width` and `height` in
      *   pixels when it succeeded. `ok` says whether the keys were taken; it stands whatever happens
      *   to the wait or the screenshot. `reason` is null on success; otherwise one of:
      *     "not_supported"  - the lab has no console to press keys in, or the selected console
      *                        can't take them right now.
      *     "not_available"  - nothing is selected.
      *     "stale"          - waitUntil has a region, on a screenshot that no longer counts, as
      *                        for waitForEnvironmentScreen.
      *     "failed"         - the keys, repeat or waitUntil are malformed.
      *   Input the console drops before sending, or hasn't sent within 30 seconds on top of the
      *   time the console's pastes and typed text ahead of it can take, fails the wait and the
      *   screenshot with reason "failed".
    */
    async pressKeysInEnvironment(keys, options = {}) {
        const request = options || {};
        const read = ApiV1.#readActionWait(request);
        if (read.failure) {
            return read.failure;
        }
        const sending = this.#actionSending(request, read.wait);
        let result;
        try {
            result = this.#pressKeys(keys, request, sending);
        } catch (e) {
            result = ApiV1.#failure('failed', 'The keys could not be pressed.');
        }
        return this.#finishAction(result, read.wait, sending, request);
    }

    /** Uses the mouse in the current environment's console: moves it, clicks, double-clicks,
      * right-clicks, drags or scrolls at a spot on the screen.
      * Spots are in the pixels of this frame's latest getEnvironmentScreenDataUrl screenshot (or one
      * returned by pressKeysInEnvironment or useMouseInEnvironment), scaled down or not, so the
      * caller names that screenshot's size. Once the student has switched consoles, the screen's
      * resolution has changed, or the student has used the console with their own mouse, keys or
      * touch since that screenshot began (the caller's own and other API input don't count), the
      * spot may no longer mean anything and the gesture is refused as "stale": take a new
      * screenshot and find the spot on it. The gesture goes out in order behind
      * any input still being sent to the same console.
      *
      * With checkTarget: true, the screen around the gesture's start, and a drag's end (24 by 24
      * pixels of the screenshot each), is first compared with the copy kept of the latest screenshot, and when it has
      * changed beyond a little the gesture is refused as "stale" and nothing is sent. That lets a
      * caller send several clicks on stable parts of the screen from one screenshot, and stop as
      * soon as one of them has moved. The comparison is made when the gesture is taken, before any
      * input queued ahead of it goes out, so it protects only gestures sent one at a time, each
      * awaited. Without a copy, such as when the screenshot's screen couldn't be read, the gesture
      * goes as it would without checkTarget.
      *
      * Available to in-page callers only, NOT through the postMessage host-page bridge: a spot is
      * only meaningful on a screenshot, and screenshots are in-page only.
      *
      * Example: const shot = await api.v1.getEnvironmentScreenDataUrl();
      *          await api.v1.useMouseInEnvironment({ action: "click", x: 120, y: 48, screenshotWidth: 960, screenshotHeight: 540 });
      * @param {Object} gesture
      * @param {string} gesture.action - "move", "click", "double_click", "triple_click", "right_click", "drag" or "scroll".
      * @param {number} gesture.x - The spot across the screenshot, from 0 to screenshotWidth.
      * @param {number} gesture.y - The spot down the screenshot, from 0 to screenshotHeight.
      * @param {number} [gesture.toX] - Where a drag ends across the screenshot.
      * @param {number} [gesture.toY] - Where a drag ends down the screenshot.
      * @param {string} [gesture.direction="down"] - A scroll's direction, "up" or "down".
      * @param {number} [gesture.amount=1] - A scroll's notches, 1 to 20.
      * @param {number} gesture.screenshotWidth - The screenshot's width in pixels.
      * @param {number} gesture.screenshotHeight - The screenshot's height in pixels.
      * @param {boolean} [gesture.checkTarget=false] - true to refuse the gesture as "stale" when the
      *   screen around its start, or a drag's end, no longer looks as it did in the latest screenshot.
      * @param {Object} [gesture.waitUntil] - As pressKeysInEnvironment takes it.
      * @param {boolean} [gesture.screenshot] - As pressKeysInEnvironment takes it.
      * @param {boolean} [gesture.asStudent] - As pressKeysInEnvironment takes it.
      * @param {Function} [gesture.onCapturing] - As pressKeysInEnvironment takes it.
      * @returns {Promise<Object>} Resolves as pressKeysInEnvironment does, with one more reason:
      *     "stale"          - no screenshot has been taken in this frame since the page loaded,
      *                        the screen has changed since the latest one, or the student has
      *                        used the console since it; with checkTarget, also when the screen
      *                        around the spot, or a drag's end, has changed since it.
      *   "not_supported" also covers a console with no screen the mouse can reach, such as a
      *   terminal, or one that isn't connected; "failed" covers a malformed gesture or screenshot size.
    */
    async useMouseInEnvironment(gesture) {
        const request = gesture || {};
        const read = ApiV1.#readActionWait(request);
        if (read.failure) {
            return read.failure;
        }
        const sending = this.#actionSending(request, read.wait);
        let result;
        try {
            result = this.#useMouse(request, sending);
        } catch (e) {
            result = ApiV1.#failure('failed', 'The mouse could not be used.');
        }
        return this.#finishAction(result, read.wait, sending, request);
    }

    /** Shows a bubble over the current environment's console: pointing at a spot, around a region,
      * or, with no spot, a tip about the screen as a whole. Given steps, it is a tour: one bubble at
      * a time, which the student moves through with Back and Next and finishes with Done. A single
      * bubble goes when the student uses the console, unless options.doneLabel gives it a Done
      * button: then it stays up while the student follows along, like a tour. Either way it ends
      * on Done, its close button, the next bubble or a change of console; options.onMarkEnded
      * hears how a single bubble ended, options.onTourEnded how a tour did, and
      * options.onTourStep each step a tour shows. Spots are in the pixels of this frame's latest
      * screenshot, and answer "stale" as for useMouseInEnvironment, also once the student has
      * used the console since it; a tip needs no screenshot. The bubble shows the mark's note as plain
      * text, cut to 200 characters, styled by mentor-bubble.css.
      *
      * Available to in-page callers only, NOT through the postMessage host-page bridge: arbitrary
      * text drawn over the VM's screen is a spoofing vector, and spots need an in-page screenshot.
      *
      * Example: await api.v1.showInEnvironment({ note: "Click Start", x: 12, y: 530, screenshotWidth: 960, screenshotHeight: 540 }, { label: "Look here" });
      * Example: await api.v1.showInEnvironment({ steps: [{ note: "Save your work" }, { note: "Then sign out" }] }, { label: "Tip" });
      * @param {Object} mark - { note?, x?, y?, width?, height?, screenshotWidth?, screenshotHeight? }:
      *   a note, a spot (x and y), or both; with width and height the spot is a region's top left
      *   corner. Or { steps, screenshotWidth?, screenshotHeight? } with 1 to 10 such marks for a tour.
      *   screenshotWidth and screenshotHeight are the screenshot's size, needed when any mark has a spot.
      * @param {Object} [options]
      * @param {string} [options.label] - The bubble's heading when it points at a spot or region.
      * @param {string} [options.tipLabel] - The heading of a tip, with no spot; defaults to label.
      * @param {string} [options.backLabel] - Text of a link back to the caller, shown with onBack.
      * @param {Function} [options.onBack] - Called when the student follows the link back. The
      *   bubble stays up.
      * @param {string} [options.closeLabel="Close"] - The close button's accessible name.
      * @param {string} [options.minimizeLabel="Minimize"] - The minimize button's accessible name.
      *   The student can drag the bubble by its heading, or shrink it to the mentor's avatar, while
      *   it is up; neither ends it, and the next bubble starts where the mentor puts it.
      * @param {Object} [options.tourLabels] - { next, back, done, step }: a tour's button texts,
      *   and its place, with {0} the step and {1} the number of steps.
      * @param {string} [options.doneLabel] - Gives a single bubble a Done button with this text,
      *   and keeps it up while the student uses the console. Ignored for a tour, which has its own.
      * @param {Function} [options.onMarkEnded] - Called once when a single bubble ends, with
      *   { reason }: "done" (its Done button), "closed", "replaced", "console_changed",
      *   "cleared", "student_input" (only for a bubble without Done), or the reason
      *   clearShownInEnvironment was given.
      * @param {Function} [options.onTourStep] - Called with { step, steps } each time a tour shows
      *   a step: its first as it opens, then each the student moves to with Next or Back; step is
      *   from 1, as for onTourEnded.
      * @param {Function} [options.onBubble] - Called with each bubble element before it shows.
      * @param {Function} [options.onTourEnded] - Called once when a tour ends, with
      *   { completed, reason, step, steps }: completed is true when the student pressed Done on the
      *   last step; reason is "done", "closed", "replaced", "console_changed" or
      *   "cleared"; step is the step it was on, from 1.
      * @param {boolean} [options.asStudent] - As pressKeysInEnvironment takes it.
      * @returns {Promise<Object>} Resolves { ok, reason, message }. `reason` is null on success;
      *   otherwise "not_supported" (no console to show anything on, or the selected console has no
      *   screen, isn't connected, or can't show the bubble), "not_available" (nothing is selected),
      *   "stale" (as for useMouseInEnvironment) or "failed" (a malformed mark).
    */
    async showInEnvironment(mark, options = {}) {
        try {
            return this.#show(mark || {}, options || {});
        } catch (e) {
            return ApiV1.#failure('failed', 'That could not be shown.');
        }
    }

    /** Takes down the bubble or tour showInEnvironment has up over the console, if any. It ends
      * with the reason given, "cleared" by default.
      * Available to in-page callers only, like showInEnvironment.
      * Example: api.v1.clearShownInEnvironment();
      * @param {string} [reason="cleared"] - The reason onMarkEnded or onTourEnded hears.
      * @returns {void} No return value.
    */
    clearShownInEnvironment(reason = 'cleared') {
        const labConsole = this.getLabConsole();
        if (this.#environmentBubble === null || labConsole == null || typeof labConsole.clearMentorOverlay !== 'function') {
            return;
        }
        labConsole.clearMentorOverlay(reason);
    }

    /** Waits until the current environment's screen visibly changes, or stops changing.
      * This is typically used instead of a fixed pause after something was started in the
      * environment. A wait until the screen changes measures from the latest screenshot any lab
      * client API caller in any frame of the lab page took of the console in view, if it shows the
      * console the wait is on, so a change since then counts at once. Otherwise it measures from
      * when the wait starts.
      *
      * Given a region of the latest screenshot, the wait watches only that part of the screen, such
      * as a Next button turning active or a text area being typed in, and ignores changes
      * elsewhere. The region is checked and scaled like a region showInEnvironment marks, and
      * answers "stale" when no screenshot has been taken, or the console in view or its size has
      * changed since, but not because the student has used the console, which is often what a
      * wait waits for.
      * It is compared at the detail of the screenshot's copy, and counts as changed once a small
      * patch of it does, such as a word typed, or a share of a region too small for that, such as
      * a checkbox. A control in it lighting up on hover counts too, so after a click watch a
      * region away from the spot clicked.
      * A wait on a region until it changes measures from the latest screenshot's copy of the region.
      *
      * Available to in-page callers only, NOT through the postMessage host-page bridge: what a
      * wait measures from is an in-page screenshot.
      *
      * Example: await api.v1.waitForEnvironmentScreen({ until: "settles", timeoutSeconds: 30 });
      * Example: await api.v1.waitForEnvironmentScreen({ until: "changes", region: { x: 800, y: 500, width: 90, height: 30, screenshotWidth: 960, screenshotHeight: 540 } });
      * @param {Object} options
      * @param {string} options.until - "changes" or "settles".
      * @param {number} [options.timeoutSeconds=10] - How long to wait at most: more than 0, at most 600.
      * @param {number} [options.quietSeconds=2] - For "settles", how long the screen must stay still:
      *   more than 0, at most 30 and no more than timeoutSeconds. The default shrinks to fit a short wait.
      * @param {Object} [options.region] - { x, y, width, height, screenshotWidth, screenshotHeight }:
      *   the part of the screen to watch, its top left corner and size in pixels of the latest
      *   screenshot, kept on it, and that screenshot's size.
      * @param {boolean} [options.asStudent] - As pressKeysInEnvironment takes it.
      * @returns {Promise<Object>} Resolves { ok, reason, message, waitedMs, measuredFrom? }.
      *   `waitedMs` is how long it waited. `measuredFrom`, for "changes", is "screenshot" or "now".
      *   `reason` is null on success; otherwise one of:
      *     "timeout"        - the screen didn't change, or settle, in time.
      *     "not_supported"  - the lab has no console to watch, or the selected one has no screen.
      *     "not_available"  - nothing is selected, or the student switched consoles while waiting.
      *     "stale"          - the region is on a screenshot that no longer counts: none has been
      *                        taken since the page loaded, or the console in view or its size
      *                        has changed since.
      *     "failed"         - the options are malformed, or the screen could not be watched.
    */
    async waitForEnvironmentScreen(options) {
        try {
            const labConsole = this.getLabConsole();
            if (labConsole == null || typeof labConsole.waitForScreen !== 'function') {
                return ApiV1.#waitFailure('not_supported', 'This lab has no console to watch.');
            }
            const read = ApiV1.#readWait(options);
            if (read.failure) {
                return ApiV1.#waitFailure(read.failure.reason, read.failure.message);
            }
            if (!ApiV1.#hasSelection(labConsole, options.asStudent === true)) {
                return ApiV1.#waitFailure('not_available', 'Nothing is selected to watch.');
            }
            const regionFailure = this.#placeWaitRegion(read.wait, labConsole);
            if (regionFailure) {
                return ApiV1.#waitFailure(regionFailure.reason, regionFailure.message);
            }
            return ApiV1.#waitOutcome(await ApiV1.#watchScreen(labConsole, Object.assign({ fromSeenScreen: true }, read.wait)));
        } catch (e) {
            return ApiV1.#waitFailure('failed', 'The screen could not be watched.');
        }
    }

    // --- Driving the console: limits and the pieces of the methods above ---------------------

    // Key names, by the DOM key code the consoles take.
    static #KEY_CODES = (function () {
        const codes = {
            ctrl: 17, control: 17, alt: 18, shift: 16, win: 91, windows: 91, meta: 91,
            tab: 9, enter: 13, return: 13, esc: 27, escape: 27, space: 32, backspace: 8,
            delete: 46, del: 46, insert: 45, ins: 45, home: 36, end: 35,
            pageup: 33, pgup: 33, pagedown: 34, pgdn: 34, up: 38, down: 40, left: 37, right: 39
        };
        for (let n = 1; n <= 12; n++) codes['f' + n] = 111 + n;
        for (let c = 65; c <= 90; c++) codes[String.fromCharCode(c + 32)] = c;
        for (let c = 48; c <= 57; c++) codes[String.fromCharCode(c)] = c;
        return codes;
    })();
    static #MODIFIER_KEY_CODES = [16, 17, 18, 91];
    static #MAX_KEY_REPEAT = 20;
    static #MOUSE_ACTIONS = ['move', 'click', 'double_click', 'triple_click', 'right_click', 'drag', 'scroll'];
    static #SCROLL_DIRECTIONS = ['up', 'down'];
    static #MAX_SCROLL_AMOUNT = 20;
    // How far the screenshot's shape may stray from the screen's before its size can't be the one named.
    static #SCREENSHOT_ASPECT_TOLERANCE = 0.02;
    static #MAX_TOUR_STEPS = 10;
    // The side, in screenshot pixels, of the patch around a spot that checkTarget compares.
    static #TARGET_PATCH_SIZE = 24;
    static #WAIT_UNTIL = ['changes', 'settles'];
    static #DEFAULT_WAIT_SECONDS = 10;
    static #MAX_WAIT_SECONDS = 600;
    static #DEFAULT_QUIET_SECONDS = 2;
    static #MAX_QUIET_SECONDS = 30;
    // How long past its own timeout a wait gets before this page answers for it.
    static #WAIT_GRACE_MS = 5000;
    // How long an action's screen gets to settle before its screenshot: still for half a second,
    // or three seconds at most.
    static #ACTION_SETTLE_WAIT = { until: 'settles', timeoutMs: 3000, quietMs: 500 };
    // How long a key press or gesture gets to go out, on top of the time the console's pastes and
    // typed text ahead of it can take, before the answer stops waiting for it.
    static #ACTION_SEND_TIMEOUT_MS = 30000;
    static #INPUT_DROPPED = 'The input was dropped before it was sent.';
    static #SWITCHED_CONSOLES = 'The student switched consoles before the screen could be watched.';

    static #inputNotSent(timeoutMs) {
        return `The input had not been sent after ${Math.round(timeoutMs / 1000)} seconds.`;
    }

    static #failure(reason, message) {
        return { ok: false, reason: reason, message: message };
    }

    static #waitFailure(reason, message, waitedMs = 0) {
        return { ok: false, reason: reason, message: message, waitedMs: waitedMs };
    }

    static #isGiven(value) {
        return value !== undefined && value !== null;
    }

    static #isPositiveInteger(value) {
        return Number.isInteger(value) && value > 0;
    }

    static #isPositiveUpTo(value, max) {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
    }

    static #isOnScreenshotAxis(value, limit) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit;
    }

    // Whether the console has something selected to act on. With asStudent, a console hidden from
    // students counts as nothing. mentor.js getEnvironmentInfo applies the same student-visibility rule.
    static #hasSelection(labConsole, asStudent) {
        if (typeof labConsole.getSelectedMachine === 'function') {
            const machine = labConsole.getSelectedMachine();
            if (machine) return !asStudent || machine.IsStudentVisible === true;
            const endpoint = typeof labConsole.getSelectedEndpoint === 'function' ? labConsole.getSelectedEndpoint() : null;
            return !!endpoint && (!asStudent || endpoint.IsStudentVisible === true);
        }
        return typeof labConsole.getSelectedContainer === 'function' && !!labConsole.getSelectedContainer();
    }

    // The selected console's screen, or null, also when reading it fails.
    #currentScreenFrame(labConsole) {
        try {
            return labConsole != null && typeof labConsole.getScreenFrame === 'function' ? labConsole.getScreenFrame() : null;
        } catch (e) {
            return null;
        }
    }

    // Which console is selected, named as a screen frame names it, or null when none is or reading
    // it fails. A console with no screen showing, such as one still connecting, is still named.
    #selectedConsoleId() {
        const labConsole = this.getLabConsole();
        if (labConsole == null) return null;
        try {
            const frame = typeof labConsole.getScreenFrame === 'function' ? labConsole.getScreenFrame() : null;
            if (frame?.consoleId) return frame.consoleId;
            const machine = typeof labConsole.getSelectedMachine === 'function' ? labConsole.getSelectedMachine() : null;
            if (machine) return 'machine:' + machine.ProfileId;
            const endpoint = typeof labConsole.getSelectedEndpoint === 'function' ? labConsole.getSelectedEndpoint() : null;
            return endpoint ? 'endpoint:' + endpoint.Id : null;
        } catch (e) {
            return null;
        }
    }

    static #isSameFrame(a, b) {
        return a === b || (a !== null && b !== null && a.consoleId === b.consoleId && a.width === b.width && a.height === b.height);
    }

    // Records the screen a screenshot shows, read as the capture began. When the student switched
    // consoles meanwhile, the screen recorded isn't the one in view, so a spot answers stale, and
    // the screen in view isn't the one the caller saw. canvas is the screenshot's, copied as it
    // was encoded.
    #rememberScreenshotFrame(labConsole, frameAtCapture, canvas) {
        this.#screenshotFrame = frameAtCapture;
        this.#screenshotCopy = null;
        if (!ApiV1.#isSameFrame(frameAtCapture, this.#currentScreenFrame(labConsole))) return;
        try {
            this.#screenshotCopy = typeof labConsole.copyScreen === 'function' ? labConsole.copyScreen(canvas) || null : null;
        } catch (e) {
            this.#screenshotCopy = null;
        }
        if (typeof labConsole.rememberSeenScreen === 'function') labConsole.rememberSeenScreen(this.#screenshotCopy);
    }

    // How a spot to act on, on the latest screenshot, maps onto the selected console's screen: as
    // #screenshotMapping, and stale once the student has used the console since the screenshot,
    // which may have moved what was there.
    #spotMapping(request, frame) {
        const mapping = this.#screenshotMapping(request, frame);
        if (mapping.failure || this.#screenshotFrame.studentInputCount === frame.studentInputCount) return mapping;
        return { failure: ApiV1.#failure('stale', 'The student has used the console since your screenshot. Take a new one and find the spot on it.') };
    }

    // How a spot on the latest screenshot maps onto the selected console's screen, or the failure
    // to answer with: { scale } or { failure }.
    #screenshotMapping(request, frame) {
        if (!ApiV1.#isPositiveInteger(request.screenshotWidth) || !ApiV1.#isPositiveInteger(request.screenshotHeight)) {
            return { failure: ApiV1.#failure('failed', 'screenshotWidth and screenshotHeight must be the size in pixels of the screenshot the spot is on.') };
        }
        if (this.#screenshotFrame === null) {
            return { failure: ApiV1.#failure('stale', 'No screenshot has been taken since the lab page loaded, so earlier ones no longer count. Take a new one and find the spot on it.') };
        }
        if (!ApiV1.#isSameFrame(this.#screenshotFrame, frame)) {
            return { failure: ApiV1.#failure('stale', 'The screen has changed since the last screenshot. Take a new one and find the spot on it.') };
        }
        const screenAspect = frame.width / frame.height;
        const screenshotAspect = request.screenshotWidth / request.screenshotHeight;
        if (Math.abs(screenshotAspect - screenAspect) / screenAspect > ApiV1.#SCREENSHOT_ASPECT_TOLERANCE) {
            return { failure: ApiV1.#failure('failed', 'The screenshot was ' + frame.width + ' by ' + frame.height + ' pixels; screenshotWidth and screenshotHeight must be its size, or its size scaled down.') };
        }
        return { scale: { x: frame.width / request.screenshotWidth, y: frame.height / request.screenshotHeight } };
    }

    // A spot on the screenshot as a pixel of the console's screen.
    static #screenPixel(value, scale, size) {
        return Math.min(size - 1, Math.round(value * scale));
    }

    // "Ctrl+Shift+Esc" as key codes with the modifiers first, which is the order consoles press
    // them in. Null when a name is unknown or repeated, or more than one key isn't a modifier.
    static #parseKeys(keys) {
        if (typeof keys !== 'string' || keys.trim() === '') return null;
        const codes = [];
        for (const part of keys.split('+')) {
            const code = ApiV1.#KEY_CODES[part.trim().toLowerCase()];
            if (code === undefined || codes.includes(code)) return null;
            codes.push(code);
        }
        const modifiers = codes.filter(function (code) { return ApiV1.#MODIFIER_KEY_CODES.includes(code); });
        const others = codes.filter(function (code) { return !ApiV1.#MODIFIER_KEY_CODES.includes(code); });
        return others.length > 1 ? null : modifiers.concat(others);
    }

    // sending: what the answer waits on once the keys have gone out, see #actionSending, or null.
    #pressKeys(keys, request, sending) {
        const labConsole = this.getLabConsole();
        if (labConsole == null || typeof labConsole.pressKeys !== 'function') {
            return ApiV1.#failure('not_supported', 'This lab has no console to press keys in.');
        }
        const keyCodes = ApiV1.#parseKeys(keys);
        if (keyCodes === null) {
            return ApiV1.#failure('failed', 'Name the keys like Ctrl+Shift+Esc, Win+R or Tab: known key names joined with +, at most one of them not Ctrl, Alt, Shift or Win.');
        }
        const repeat = ApiV1.#isGiven(request.repeat) ? request.repeat : 1;
        if (!Number.isInteger(repeat) || repeat < 1 || repeat > ApiV1.#MAX_KEY_REPEAT) {
            return ApiV1.#failure('failed', 'repeat must be a whole number from 1 to ' + ApiV1.#MAX_KEY_REPEAT + '.');
        }
        if (!ApiV1.#hasSelection(labConsole, request.asStudent === true)) {
            return ApiV1.#failure('not_available', 'Nothing is selected to press keys in.');
        }
        const regionFailure = this.#placeWaitRegion(sending?.wait, labConsole);
        if (regionFailure) {
            return regionFailure;
        }
        // Every press goes out or none does: a console with no room for them all refuses them up
        // front, and one that refuses a press partway through drops the presses it took before it
        // that haven't gone out yet.
        const refused = ApiV1.#failure('not_supported', "The selected console can't take those keys right now.");
        if (typeof labConsole.canTakeInput === 'function' && labConsole.canTakeInput(repeat) === false) {
            return refused;
        }
        ApiV1.#takeActionBaseline(labConsole, sending);
        const onStart = ApiV1.#baselineAtStart(labConsole, sending);
        const reports = [];
        for (let i = 0; i < repeat; i++) {
            const report = sending ? sending.reporterForInput() : function () {};
            reports.push(report);
            if (labConsole.pressKeys(keyCodes, report, onStart) !== true) {
                reports.forEach(function (taken) { taken.abandoned = true; });
                return refused;
            }
        }
        ApiV1.#allowForPacedInput(labConsole, sending);
        sending?.handedOver();
        return { ok: true, reason: null, message: null };
    }

    // sending: what the answer waits on once the gesture has gone out, see #actionSending, or null.
    #useMouse(request, sending) {
        const labConsole = this.getLabConsole();
        if (labConsole == null || typeof labConsole.useMouse !== 'function') {
            return ApiV1.#failure('not_supported', 'This lab has no console to use the mouse in.');
        }
        const action = request.action;
        if (!ApiV1.#MOUSE_ACTIONS.includes(action)) {
            return ApiV1.#failure('failed', 'action must be one of ' + ApiV1.#MOUSE_ACTIONS.join(', ') + '.');
        }
        if (!ApiV1.#isOnScreenshotAxis(request.x, request.screenshotWidth) || !ApiV1.#isOnScreenshotAxis(request.y, request.screenshotHeight)) {
            return ApiV1.#failure('failed', 'x and y must be a spot on the screenshot, in its pixels, with screenshotWidth and screenshotHeight its size.');
        }
        if (action === 'drag' && (!ApiV1.#isOnScreenshotAxis(request.toX, request.screenshotWidth) || !ApiV1.#isOnScreenshotAxis(request.toY, request.screenshotHeight))) {
            return ApiV1.#failure('failed', 'A drag needs toX and toY, where it ends on the screenshot.');
        }
        const direction = ApiV1.#isGiven(request.direction) ? request.direction : 'down';
        const amount = ApiV1.#isGiven(request.amount) ? request.amount : 1;
        if (action === 'scroll' && (!ApiV1.#SCROLL_DIRECTIONS.includes(direction) || !Number.isInteger(amount) || amount < 1 || amount > ApiV1.#MAX_SCROLL_AMOUNT)) {
            return ApiV1.#failure('failed', 'A scroll needs direction up or down and amount, a whole number of notches from 1 to ' + ApiV1.#MAX_SCROLL_AMOUNT + '.');
        }
        if (ApiV1.#isGiven(request.checkTarget) && typeof request.checkTarget !== 'boolean') {
            return ApiV1.#failure('failed', 'checkTarget must be true or false.');
        }
        if (!ApiV1.#hasSelection(labConsole, request.asStudent === true)) {
            return ApiV1.#failure('not_available', 'Nothing is selected to use the mouse in.');
        }
        const frame = typeof labConsole.getScreenFrame === 'function' ? labConsole.getScreenFrame() : null;
        if (frame === null) {
            return ApiV1.#failure('not_supported', "The selected console has no screen the mouse can reach, or isn't connected.");
        }
        const mapping = this.#spotMapping(request, frame);
        if (mapping.failure) {
            return mapping.failure;
        }
        const screenGesture = {
            action: action,
            x: ApiV1.#screenPixel(request.x, mapping.scale.x, frame.width),
            y: ApiV1.#screenPixel(request.y, mapping.scale.y, frame.height)
        };
        if (action === 'drag') {
            screenGesture.toX = ApiV1.#screenPixel(request.toX, mapping.scale.x, frame.width);
            screenGesture.toY = ApiV1.#screenPixel(request.toY, mapping.scale.y, frame.height);
        }
        if (action === 'scroll') {
            screenGesture.direction = direction;
            screenGesture.amount = amount;
        }
        const regionFailure = this.#placeWaitRegion(sending?.wait, labConsole);
        if (regionFailure) {
            return regionFailure;
        }
        if (request.checkTarget === true && !this.#isTargetUnchanged(labConsole, screenGesture, mapping.scale, frame)) {
            return ApiV1.#failure('stale', 'The screen around your spot has changed since your screenshot. Take a new one and find the spot on it.');
        }
        ApiV1.#takeActionBaseline(labConsole, sending);
        if (labConsole.useMouse(screenGesture, sending?.reporterForInput(), ApiV1.#baselineAtStart(labConsole, sending)) !== true) {
            return ApiV1.#failure('not_supported', "The selected console can't take the mouse right now.");
        }
        ApiV1.#allowForPacedInput(labConsole, sending);
        sending?.handedOver();
        return { ok: true, reason: null, message: null };
    }

    // A wait as asked for, waitForEnvironmentScreen's options or an action's waitUntil: { wait } in
    // the console's terms, or { failure }.
    static #readWait(request) {
        const until = request?.until;
        if (!ApiV1.#WAIT_UNTIL.includes(until)) {
            return { failure: ApiV1.#failure('failed', 'until must be changes or settles.') };
        }
        const timeoutSeconds = ApiV1.#isGiven(request.timeoutSeconds) ? request.timeoutSeconds : ApiV1.#DEFAULT_WAIT_SECONDS;
        if (!ApiV1.#isPositiveUpTo(timeoutSeconds, ApiV1.#MAX_WAIT_SECONDS)) {
            return { failure: ApiV1.#failure('failed', 'timeoutSeconds must be more than 0 and at most ' + ApiV1.#MAX_WAIT_SECONDS + '.') };
        }
        // Only a wait until the screen settles has a quiet time. One given must fit within the
        // wait; the default shrinks to fit a short one.
        const quietGiven = until === 'settles' && ApiV1.#isGiven(request.quietSeconds);
        const quietSeconds = quietGiven ? request.quietSeconds : Math.min(ApiV1.#DEFAULT_QUIET_SECONDS, timeoutSeconds);
        if (quietGiven && (!ApiV1.#isPositiveUpTo(quietSeconds, ApiV1.#MAX_QUIET_SECONDS) || quietSeconds > timeoutSeconds)) {
            return { failure: ApiV1.#failure('failed', 'quietSeconds must be more than 0, at most ' + ApiV1.#MAX_QUIET_SECONDS + ' and no more than timeoutSeconds.') };
        }
        const wait = { until: until, timeoutMs: timeoutSeconds * 1000, quietMs: quietSeconds * 1000 };
        if (ApiV1.#isGiven(request.region)) {
            const region = request.region;
            if (!ApiV1.#isRegionOnScreenshot(region)) {
                return { failure: ApiV1.#failure('failed', 'A region needs x and y for its top left corner, a width and height that keep it on the screenshot, and screenshotWidth and screenshotHeight, the size in pixels of the screenshot it is on.') };
            }
            // Placed on the console's screen by #placeWaitRegion once the screen is known.
            wait.screenshotRegion = { x: region.x, y: region.y, width: region.width, height: region.height, screenshotWidth: region.screenshotWidth, screenshotHeight: region.screenshotHeight };
        }
        return { wait: wait };
    }

    static #isRegionOnScreenshot(region) {
        return typeof region === 'object'
            && ApiV1.#isPositiveInteger(region.screenshotWidth) && ApiV1.#isPositiveInteger(region.screenshotHeight)
            && ApiV1.#isOnScreenshotAxis(region.x, region.screenshotWidth) && ApiV1.#isOnScreenshotAxis(region.y, region.screenshotHeight)
            && typeof region.width === 'number' && region.width > 0 && typeof region.height === 'number' && region.height > 0
            && ApiV1.#isOnScreenshotAxis(region.x + region.width, region.screenshotWidth) && ApiV1.#isOnScreenshotAxis(region.y + region.height, region.screenshotHeight);
    }

    // Places a wait's region, given on the latest screenshot, on the selected console's screen,
    // checked as a mark's region is: null once placed, or the failure to answer with.
    #placeWaitRegion(wait, labConsole) {
        if (!wait?.screenshotRegion) return null;
        const frame = this.#currentScreenFrame(labConsole);
        if (frame === null) {
            return ApiV1.#failure('not_supported', "The selected console has no screen to watch, or isn't connected.");
        }
        const mapping = this.#screenshotMapping(wait.screenshotRegion, frame);
        if (mapping.failure) {
            return mapping.failure;
        }
        wait.region = ApiV1.#screenArea(wait.screenshotRegion, mapping.scale, frame);
        delete wait.screenshotRegion;
        return null;
    }

    // An area of the screenshot as remote pixels of the console's screen, kept on it.
    static #screenArea(area, scale, frame) {
        const x = ApiV1.#screenPixel(area.x, scale.x, frame.width);
        const y = ApiV1.#screenPixel(area.y, scale.y, frame.height);
        return {
            x: x,
            y: y,
            width: Math.max(1, Math.min(frame.width - x, Math.round(area.width * scale.x))),
            height: Math.max(1, Math.min(frame.height - y, Math.round(area.height * scale.y)))
        };
    }

    // Whether the screen around a gesture's start, and a drag's end, in remote pixels, still
    // looks as the latest screenshot's copy shows it. Without a copy, or a console that can
    // compare, it is taken to.
    #isTargetUnchanged(labConsole, gesture, scale, frame) {
        if (this.#screenshotCopy === null || typeof labConsole.screenAreaMatches !== 'function') return true;
        const spots = gesture.action === 'drag' ? [[gesture.x, gesture.y], [gesture.toX, gesture.toY]] : [[gesture.x, gesture.y]];
        const halfWidth = Math.max(1, Math.round(ApiV1.#TARGET_PATCH_SIZE / 2 * scale.x));
        const halfHeight = Math.max(1, Math.round(ApiV1.#TARGET_PATCH_SIZE / 2 * scale.y));
        return spots.every(([x, y]) => {
            const left = Math.max(0, x - halfWidth);
            const top = Math.max(0, y - halfHeight);
            const patch = { x: left, y: top, width: Math.min(frame.width, x + halfWidth) - left, height: Math.min(frame.height, y + halfHeight) - top };
            try {
                return labConsole.screenAreaMatches(this.#screenshotCopy, patch) !== false;
            } catch (e) {
                return true;
            }
        });
    }

    // The wait an action asks to be followed by, read before the action is taken so a bad one
    // refuses the whole request: { wait }, { wait: null } when none was asked for, or { failure }.
    static #readActionWait(request) {
        return ApiV1.#isGiven(request.waitUntil) ? ApiV1.#readWait(request.waitUntil) : { wait: null };
    }

    static #waitOutcome(watched) {
        const outcome = { ok: watched.ok === true, reason: watched.reason || null, message: watched.message || null, waitedMs: watched.waitedMs };
        if (watched.measuredFrom) outcome.measuredFrom = watched.measuredFrom;
        return outcome;
    }

    // The console's wait, settled by this page's own clock as well: a wait handed to a popped-out
    // console's window stops when that window closes, and a long wait in a hidden tab samples
    // late as the browser slows its timers, and the caller still needs its answer. Either way no
    // answer came before its deadline, which is a timeout.
    static #watchScreen(labConsole, wait) {
        const deadlineMs = wait.timeoutMs + ApiV1.#WAIT_GRACE_MS;
        let timer = null;
        const deadline = new Promise(function (resolve) {
            timer = setTimeout(function () {
                resolve(ApiV1.#waitFailure('timeout', 'The wait ran past its time without an answer from the console.', deadlineMs));
            }, deadlineMs);
        });
        return Promise.race([Promise.resolve(labConsole.waitForScreen(wait)), deadline]).finally(function () {
            clearTimeout(timer);
        });
    }

    // What an action's answer waits on before its wait and screenshot, or null when it asks for
    // neither and answers at once. The console may queue the input, so the wait starts only once
    // every press of it has gone out, from a screen taken as it starts going out. Its consoleId is
    // the console selected as the request was accepted, the one the wait and the screenshot are of.
    // reporterForInput() makes each input's report, handedOver() says no more presses follow, sent
    // resolves true once all went out, false once any was dropped, and abandon() marks every report
    // abandoned, so the console drops a press it hasn't sent yet instead of sending it.
    #actionSending(request, wait) {
        if (wait === null && request.screenshot !== true) return null;
        let resolveSent;
        const sent = new Promise(function (resolve) { resolveSent = resolve; });
        let pending = 0;
        let allSent = true;
        let complete = false;
        const reporters = [];
        const settle = function () {
            if (complete && pending === 0) resolveSent(allSent);
        };
        return {
            sent: sent,
            sendTimeoutMs: ApiV1.#ACTION_SEND_TIMEOUT_MS,
            consoleId: this.#selectedConsoleId(),
            wait: wait,
            baseline: null,
            measuresChange: wait?.until === 'changes',
            started: false,
            isHandedOver: function () { return complete; },
            reporterForInput: function () {
                pending++;
                let reported = false;
                const reporter = function (wentOut) {
                    if (reported) return;
                    reported = true;
                    pending--;
                    if (wentOut !== true) allSent = false;
                    settle();
                };
                reporters.push(reporter);
                return reporter;
            },
            handedOver: function () {
                complete = true;
                settle();
            },
            abandon: function () {
                reporters.forEach(function (reporter) { reporter.abandoned = true; });
            }
        };
    }

    // The screen just before the action, for a wait until it changes to measure from. Without one,
    // the wait measures from when it begins.
    static #takeActionBaseline(labConsole, sending) {
        if (!sending?.measuresChange || typeof labConsole.takeScreenBaseline !== 'function') return;
        try {
            sending.baseline = labConsole.takeScreenBaseline(sending.wait?.region) || null;
        } catch (e) {
            sending.baseline = null;
        }
    }

    // The hook each press calls as it starts going out, or undefined when no wait measures from
    // the screen. Input that waited behind other input, such as text still being typed, starts
    // after the handover, by when the screen taken just before it may have moved on, so the first
    // press to start then takes it again. One that starts during the handover goes out from the
    // screen taken just before, as does input on a console that can't say when it starts.
    static #baselineAtStart(labConsole, sending) {
        if (!sending?.measuresChange) return undefined;
        return function () {
            if (sending.started) return;
            sending.started = true;
            if (sending.isHandedOver()) ApiV1.#takeActionBaseline(labConsole, sending);
        };
    }

    // Input queued behind a paste or typed text goes out only once that text is in, so its send
    // timeout also allows the time the console's pastes and typed text ahead of it can take.
    static #allowForPacedInput(labConsole, sending) {
        if (!sending || typeof labConsole.pacedTimeAhead !== 'function') return;
        let pacedTimeAheadMs;
        try {
            pacedTimeAheadMs = Number(labConsole.pacedTimeAhead());
        } catch {
            return;
        }
        if (pacedTimeAheadMs > 0) sending.sendTimeoutMs += pacedTimeAheadMs;
    }

    // 'sent', 'dropped', or 'timeout' when the console hasn't said within the send timeout, at
    // which point what it hasn't sent yet is abandoned.
    static #awaitSendOutcome(sending) {
        let timer = null;
        const timeout = new Promise(function (resolve) {
            timer = setTimeout(function () { resolve('timeout'); }, sending.sendTimeoutMs);
        });
        const reported = sending.sent.then(function (wentOut) { return wentOut ? 'sent' : 'dropped'; });
        return Promise.race([reported, timeout]).then(function (sendOutcome) {
            if (sendOutcome === 'timeout') sending.abandon();
            return sendOutcome;
        }).finally(function () {
            clearTimeout(timer);
        });
    }

    // Completes an action's answer once it has been taken. With a wait, it first waits and says
    // how that went, in waited; a wait until the screen changes then lets the change settle
    // briefly, so a screenshot isn't caught mid-transition. With screenshot: true the answer
    // carries the screen, captured after the wait, or once the screen has briefly settled when
    // there was none, which is quick but can come before a slow app has reacted. Both start only
    // once the console says the action has gone out; input it dropped instead, or never sent,
    // fails them without waiting or capturing. Both are of the console that took the action, so
    // once the student switches to another they answer not_available instead.
    async #finishAction(result, wait, sending, request) {
        const wantsScreenshot = request.screenshot === true;
        if (result.ok !== true || (wait === null && !wantsScreenshot)) {
            return result;
        }
        const startedAt = Date.now();
        const sendOutcome = sending ? await ApiV1.#awaitSendOutcome(sending) : 'sent';
        if (sendOutcome !== 'sent') {
            const message = sendOutcome === 'dropped' ? ApiV1.#INPUT_DROPPED : ApiV1.#inputNotSent(sending.sendTimeoutMs);
            if (wait !== null) {
                result.waited = ApiV1.#waitFailure('failed', message, Date.now() - startedAt);
            }
            if (wantsScreenshot) {
                result.screenshot = { ok: false, data_url: null, reason: 'failed', message: message };
            }
            return result;
        }
        // Once the student has switched away from the console that took the action, the screen in
        // view isn't the one the action went to, so it is neither watched nor captured.
        const switchedAway = () => {
            if (sending == null || this.#selectedConsoleId() === sending.consoleId) return false;
            // A wait that already finished on the right console keeps its outcome.
            if (wait !== null && result.waited === undefined) {
                result.waited = ApiV1.#waitFailure('not_available', ApiV1.#SWITCHED_CONSOLES, Date.now() - startedAt);
            }
            if (wantsScreenshot) {
                result.screenshot = { ok: false, data_url: null, reason: 'not_available', message: ApiV1.#SWITCHED_CONSOLES };
            }
            return true;
        };
        if (switchedAway()) return result;
        const labConsole = this.getLabConsole();
        const canWatch = labConsole != null && typeof labConsole.waitForScreen === 'function';
        if (wait !== null) {
            try {
                if (!canWatch) {
                    result.waited = ApiV1.#waitFailure('not_supported', 'This lab has no console to watch.');
                } else {
                    const actionWait = sending?.baseline ? Object.assign({}, wait, { since: sending.baseline }) : wait;
                    const watched = ApiV1.#waitOutcome(await ApiV1.#watchScreen(labConsole, actionWait));
                    if (watched.ok && wait.until === 'changes') {
                        const settled = await ApiV1.#watchScreen(labConsole, ApiV1.#ACTION_SETTLE_WAIT);
                        watched.waitedMs += settled.waitedMs || 0;
                    }
                    // A switch during the wait means it watched another console, so it isn't kept.
                    if (switchedAway()) return result;
                    result.waited = watched;
                }
            } catch (e) {
                result.waited = ApiV1.#waitFailure('failed', 'The screen could not be watched.');
            }
        }
        if (!wantsScreenshot) {
            return result;
        }
        try {
            if (wait === null && canWatch) {
                await ApiV1.#watchScreen(labConsole, ApiV1.#ACTION_SETTLE_WAIT);
            }
            if (switchedAway()) return result;
            if (typeof request.onCapturing === 'function') request.onCapturing();
            const shot = await this.getEnvironmentScreenDataUrl();
            if (switchedAway()) return result;
            if (shot.ok && this.#screenshotFrame) {
                shot.width = this.#screenshotFrame.width;
                shot.height = this.#screenshotFrame.height;
            }
            result.screenshot = shot;
        } catch (e) {
            result.screenshot = { ok: false, data_url: null, reason: 'capture_failed', message: 'The screen could not be captured.' };
        }
        return result;
    }

    // A mark as asked for, checked against the screenshot it is on: { mark } or { failure }.
    static #readMark(mark, screenshot) {
        const note = typeof mark?.note === 'string' ? mark.note.trim().slice(0, globalThis.mentorBubble.MAX_NOTE_CHARACTERS) : '';
        const hasSpot = ApiV1.#isGiven(mark?.x) || ApiV1.#isGiven(mark?.y);
        const hasRegion = ApiV1.#isGiven(mark?.width) || ApiV1.#isGiven(mark?.height);
        if (!hasSpot && note === '') {
            return { failure: ApiV1.#failure('failed', 'Give a note, a spot (x and y), or both.') };
        }
        if (hasSpot && (!ApiV1.#isOnScreenshotAxis(mark.x, screenshot.screenshotWidth) || !ApiV1.#isOnScreenshotAxis(mark.y, screenshot.screenshotHeight))) {
            return { failure: ApiV1.#failure('failed', 'x and y must be a spot on the screenshot, in its pixels, with screenshotWidth and screenshotHeight its size.') };
        }
        if (hasRegion && (!hasSpot || typeof mark.width !== 'number' || !(mark.width > 0) || typeof mark.height !== 'number' || !(mark.height > 0)
            || !ApiV1.#isOnScreenshotAxis(mark.x + mark.width, screenshot.screenshotWidth) || !ApiV1.#isOnScreenshotAxis(mark.y + mark.height, screenshot.screenshotHeight))) {
            return { failure: ApiV1.#failure('failed', 'A region needs x and y for its top left corner and a width and height that keep it on the screenshot.') };
        }
        return { mark: { note: note, hasSpot: hasSpot, hasRegion: hasRegion, x: mark.x, y: mark.y, width: mark.width, height: mark.height } };
    }

    // Where a mark sits on the console's screen, or null for a tip.
    static #markTarget(mark, scale, frame) {
        if (!mark.hasSpot) return null;
        if (mark.hasRegion) return ApiV1.#screenArea(mark, scale, frame);
        return { x: ApiV1.#screenPixel(mark.x, scale.x, frame.width), y: ApiV1.#screenPixel(mark.y, scale.y, frame.height) };
    }

    #show(request, options) {
        const labConsole = this.getLabConsole();
        if (labConsole == null || typeof labConsole.showMentorOverlay !== 'function') {
            return ApiV1.#failure('not_supported', 'This lab has no console to show anything on.');
        }
        // mentor-bubble.js builds the bubble; a page without it can't show one.
        if (typeof globalThis.mentorBubble?.create !== 'function') {
            return ApiV1.#failure('not_supported', 'This page cannot show anything on the console.');
        }
        const isTour = ApiV1.#isGiven(request.steps);
        if (isTour && (!Array.isArray(request.steps) || request.steps.length < 1 || request.steps.length > ApiV1.#MAX_TOUR_STEPS)) {
            return ApiV1.#failure('failed', 'steps must be a list of 1 to ' + ApiV1.#MAX_TOUR_STEPS + ' marks.');
        }
        if (isTour && ['note', 'x', 'y', 'width', 'height'].some(function (field) { return ApiV1.#isGiven(request[field]); })) {
            return ApiV1.#failure('failed', 'Give steps or a single mark, not both.');
        }
        const marks = [];
        for (const asked of isTour ? request.steps : [request]) {
            const read = ApiV1.#readMark(asked, request);
            if (read.failure) {
                return read.failure;
            }
            marks.push(read.mark);
        }
        if (!ApiV1.#hasSelection(labConsole, options.asStudent === true)) {
            return ApiV1.#failure('not_available', 'Nothing is selected to show anything on.');
        }
        const frame = typeof labConsole.getScreenFrame === 'function' ? labConsole.getScreenFrame() : null;
        if (frame === null) {
            return ApiV1.#failure('not_supported', "The selected console has no screen to show anything on, or isn't connected.");
        }
        let scale = null;
        if (marks.some(function (mark) { return mark.hasSpot; })) {
            const mapping = this.#spotMapping(request, frame);
            if (mapping.failure) {
                return mapping.failure;
            }
            scale = mapping.scale;
        }
        const shown = marks.map(function (mark) { return { note: mark.note, target: ApiV1.#markTarget(mark, scale, frame) }; });
        const isShowing = isTour
            ? this.#showTourStep(labConsole, { marks: shown, options: options, index: 0, changingStep: false }, 0)
            : this.#showMark(labConsole, shown[0], options, null);
        if (!isShowing) {
            return ApiV1.#failure('not_supported', "The selected console has no screen to show anything on, or isn't connected.");
        }
        return { ok: true, reason: null, message: null };
    }

    // Shows one mark, as a step of the tour when one is given. Returns whether it is showing.
    #showMark(labConsole, mark, options, stepOfTour) {
        const label = mark.target ? options.label : (options.tipLabel ?? options.label);
        const controls = stepOfTour ? this.#tourControls(labConsole, stepOfTour) : null;
        const hasBack = typeof options.backLabel === 'string' && typeof options.onBack === 'function';
        const hasDone = stepOfTour === null && typeof options.doneLabel === 'string';
        const bubble = globalThis.mentorBubble.create({
            label: label,
            note: mark.note,
            controls: controls,
            done: hasDone ? { text: options.doneLabel, onClick: () => { if (this.#environmentBubble === bubble) labConsole.clearMentorOverlay('done'); } } : null,
            back: hasBack ? { text: options.backLabel, onClick: options.onBack } : null,
            closeLabel: options.closeLabel,
            movable: true,
            minimizeLabel: options.minimizeLabel,
            onClose: function () { labConsole.clearMentorOverlay('closed'); }
        });
        if (typeof options.onBubble === 'function') options.onBubble(bubble);
        // A mark cleared while it was being placed never showed, so it has no end to report.
        let hasShown = false;
        const isShowing = labConsole.showMentorOverlay({
            bubble: bubble,
            target: mark.target,
            removeBubble: globalThis.mentorBubble.fadeOut,
            keepThroughStudentInput: stepOfTour !== null || hasDone,
            onClear: (reason) => {
                if (this.#environmentBubble === bubble) this.#environmentBubble = null;
                if (stepOfTour) {
                    this.#tourStepCleared(stepOfTour, reason);
                } else if (hasShown && typeof options.onMarkEnded === 'function') {
                    options.onMarkEnded({ reason: reason });
                }
            }
        }) === true;
        if (isShowing) {
            hasShown = true;
            this.#environmentBubble = bubble;
        }
        return isShowing;
    }

    // Where the student is in the tour, and Back, Next or Done.
    #tourControls(labConsole, step) {
        const labels = step.tour.options.tourLabels || {};
        const text = function (name, fallback) { return typeof labels[name] === 'string' ? labels[name] : fallback; };
        const controls = document.createElement('div');
        controls.className = 'mentor-pointer-tour';
        const count = document.createElement('span');
        count.className = 'mentor-pointer-tour-count';
        count.textContent = text('step', '{0} of {1}').replace('{0}', step.index + 1).replace('{1}', step.tour.marks.length);
        controls.appendChild(count);
        // A button on a tour that has already ended, such as one still fading out, does nothing.
        const button = (className, buttonText, onClick) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.className = className;
            element.textContent = buttonText;
            element.addEventListener('click', () => { if (this.#tour === step.tour) onClick(); });
            controls.appendChild(element);
        };
        if (step.index > 0) {
            button('mentor-pointer-tour-back', text('back', 'Back'), () => { this.#showTourStep(labConsole, step.tour, step.index - 1, '.mentor-pointer-tour-back'); });
        }
        if (step.index < step.tour.marks.length - 1) {
            button('mentor-pointer-tour-next', text('next', 'Next'), () => { this.#showTourStep(labConsole, step.tour, step.index + 1, '.mentor-pointer-tour-next'); });
        } else {
            button('mentor-pointer-tour-next', text('done', 'Done'), function () { labConsole.clearMentorOverlay('done'); });
        }
        return controls;
    }

    // Shows the tour's first step, or the one its own Back or Next moves to, and tells whoever showed
    // the tour which step the student is on. Back and Next replace its bubble without ending it, and
    // move the keyboard to the same control on the new bubble, or to Next or Done when it has none,
    // as on the first step.
    #showTourStep(labConsole, shownTour, index, focusSelector) {
        shownTour.index = index;
        shownTour.changingStep = true;
        let isShowing;
        try {
            isShowing = this.#showMark(labConsole, shownTour.marks[index], shownTour.options, { tour: shownTour, index: index });
        } finally {
            shownTour.changingStep = false;
        }
        if (isShowing) {
            this.#tour = shownTour;
            const bubble = this.#environmentBubble;
            if (focusSelector && bubble) {
                (bubble.querySelector(focusSelector) || bubble.querySelector('.mentor-pointer-tour-next')).focus();
            }
            if (typeof shownTour.options.onTourStep === 'function') {
                shownTour.options.onTourStep({ step: index + 1, steps: shownTour.marks.length });
            }
        } else if (this.#tour === shownTour) {
            this.#endTour(shownTour, 'console_changed');
        }
        return isShowing;
    }

    #tourStepCleared(step, reason) {
        if (reason === 'replaced' && step.tour.changingStep) return;
        this.#endTour(step.tour, reason);
    }

    // Tells whoever showed the tour how it ended: completed when the student pressed Done on the
    // last step, otherwise why it went and the step it was on.
    #endTour(endedTour, reason) {
        if (this.#tour !== endedTour) return;
        this.#tour = null;
        if (typeof endedTour.options.onTourEnded === 'function') {
            endedTour.options.onTourEnded({
                completed: reason === 'done',
                reason: reason,
                step: endedTour.index + 1,
                steps: endedTour.marks.length
            });
        }
    }

    /** Returns the value of a lab token by its name.
      * Lab tokens are used to replace placeholders in instructions with actual values.
      * You do not need to use the @lab prefix like you do within lab instructions and scripts.
      * Example: api.v1.getLabToken("LabProfile.Name");
      * @param {string} name - The name of the lab token to retrieve.
      * @returns {string|null} The value of the lab token, or null if it does not exist.
    */
    getLabToken(name) {
        const instructionsLabClient = this.getInstructionsLabClient();
        if (instructionsLabClient != null) {
            const tokenName = `@lab.${name}`;
            const tokens = instructionsLabClient.getReplacementTokens();
            for (const token of tokens) {
                if (token.Token === tokenName) {
                    return token.Replacement;
                }
            }
        }
        return null;
    }

    /** Returns every lab token with its value, as instructions write the token.
      * Example: api.v1.getLabTokens().find((t) => t.token === "@lab.VirtualMachine(Windows11).Username")?.value;
      * @returns {{token: string, value: string, type: string}[]} Each token, with type "text", "link" (the value is a link's HTML, such as a VM's select link) or "html"; empty when the lab has none.
    */
    getLabTokens() {
        return (this.getInstructionsLabClient()?.getReplacementTokens() ?? []).map(function (token) {
            return {
                token: token.Token,
                // Stored with each $ doubled for String.replace, which reads $$ as one $.
                value: String(token.Replacement ?? '').replace(/\$\$/g, '$'),
                type: LAB_TOKEN_TYPE_NAMES[token.Type] ?? 'text',
            };
        });
    }

    /** Returns the lab's instructions as their markdown source, the text authors write, with tokens unresolved.
      * Example: api.v1.getInstructionsMarkdown();
      * @returns {string|null} The whole source, or null when the lab has no instructions.
    */
    getInstructionsMarkdown() {
        return this.getInstructionsLabClient()?.getInstructionsMarkdown() ?? null;
    }

    /** Returns each instructions page's markdown source, in the order the pages show.
      * External manual pages, which have no source, are not included.
      * Example: api.v1.getInstructionsPagesMarkdown()[api.v1.getInstructionsPageIndex()];
      * @returns {string[]|null} One entry per page with a source, or null when the source doesn't split into the pages shown, such as when a replacement adds a page break.
    */
    getInstructionsPagesMarkdown() {
        return this.getInstructionsLabClient()?.getPagesMarkdown() ?? null;
    }

    /** Returns the value of a lab variable by its name.
      * Lab variables are used to store values that can be shared across different parts of the lab environment.   
      * Example: api.v1.getLabVariable("myVariable");
      * @param {string} name - The name of the lab variable to retrieve.
      * @returns {string|null} The value of the lab variable, or null if it does not exist.
    */
    getLabVariable(name) {
        const instructionsLabClient = this.getInstructionsLabClient();   
        if (instructionsLabClient == null) {
            return null;
        }
        return instructionsLabClient.getVariable(name) ?? null;     
    }

    /** Sets a lab variable with the specified name and value.
      * Lab variables are used to store values that can be shared across different parts of the lab environment.
      * Example: api.v1.setLabVariable("myVariable", "myValue");
      * @param {string} name - The name of the lab variable to set.
      * @param {string} value - The value to set for the lab variable.
      * @returns {void} No return value.
    */
    setLabVariable(name, value) {
        const instructionsLabClient = this.getInstructionsLabClient();
        if (instructionsLabClient == null) {
            return;
        }
        instructionsLabClient.setAndSaveVariable(name, value);     
    }

    /** Sends a notification to the lab client.
      * This is typically used to display messages to the user in the lab environment. The notification will be displayed as a toast within the lab client UI.
      * Example: api.v1.sendLabNotification("This is a notification message.");
      * @param {string} text - The text of the notification to send.
      * @returns {void} No return value.
    */ 
    sendLabNotification(text) {
        // Call the local frame's showNotification; when embedded it delegates up to
        // the wrapper, which picks the visible frame.
        if (typeof labClient !== 'undefined') {
            labClient.showNotification({ content: text });
            return;
        }
        if (typeof labConsole !== 'undefined') {
            labConsole.showNotification(text);
            return;
        }
    }

    /** Returns the index of the current instructions page.
      * This is typically used to determine which page of instructions the user is currently viewing in a lab environment.
      * Example: api.v1.getInstructionsPageIndex();
      * @param {string} text - The text of the instructions page to check.
      * @returns {number|null} The index of the current instructions page, or null if not available.
    */
    getInstructionsPageIndex(text) {
        const instructionsLabClient = this.getInstructionsLabClient();
        if (instructionsLabClient == null) {
            return null;
        }
        return instructionsLabClient.getInstructionsPageIndex();
    }

    /** Returns the number of minutes remaining in the lab.
      * This is typically used to display a countdown timer for the lab duration.
      * Example: api.v1.getMinutesRemaining();
      * @returns {number} The number of minutes remaining in the lab, or 0 if not available.
    */
    getMinutesRemaining() {
        const instructionsLabClient = this.getInstructionsLabClient();
        if (instructionsLabClient != null) {
            return instructionsLabClient?.getMinutesRemaining();
        }
        return this.getLabConsole()?.getMinutesRemaining() ?? 0;
    }

    /** Navigates to a specific instructions page by its index.
      * This is typically used to programmatically change the current page of instructions in a lab environment.
      * Example: api.v1.gotoInstructionsPage(2);
      * @param {number} index - The index of the instructions page to navigate to.
    */
    gotoInstructionsPage(index) {
        const instructionsLabClient = this.getInstructionsLabClient();
        if (instructionsLabClient == null) {
            return;
        }
        instructionsLabClient.gotoInstructionsPage(index);
    }

    /** Evaluates an activity by its alias.
      * This is typically used to check if a specific activity in the lab has been completed or passed.
      * Example: api.v1.evaluateActivity("alias");
      * @param {string} alias - The alias of the activity to evaluate.
      * @param {number} [index=0] - The index of the activity to evaluate (default is 0).
      * @returns {void} No return value.
    */
    evaluateActivity(alias, index = 0) {
        const instructionsLabClient = this.getInstructionsLabClient();
        if (instructionsLabClient == null) {
            return;
        }
        instructionsLabClient.evaluateActivity(alias, index);
    }

    /** A function to register a callback for when the environment connection status changes.
      * This is typically used to listen for changes in the connection status of the lab environment, such as when a virtual machine connects or disconnects.
      * Example: api.v1.onEnvironmentConnectionStatusChange((status) => { console.log(status); });
      * @param {Function} callback - The function to call when the connection status changes.
      * @returns {void} No return value.
    */
    onEnvironmentConnectionStatusChange(callback) {
        // Each frame (instructions, labConsole) has its own api object with its
        // own emitter. We don't try to register cross-frame here -- instead the
        // emit side (api.machineConnected / api.machineDisconnected) fans out
        // the event to both frames' emitters, so a subscriber in either frame
        // just registers locally and is guaranteed to receive it. This avoids
        // a timing race where the labConsole frame's lab-client-api.js might
        // not have run yet at the moment a subscriber calls this method.
        this.emitter.on('environmentConnectionStatusChange', callback);
    }

    /** A function to register a callback for when the selected lab environment changes.
      * Fires when the active target switches -- a different virtual machine is
      * selected, or a different container tab is activated -- including the
      * initial auto-selection performed during lab startup. This is the right
      * event for "which target should I show context for?". For "is the active
      * target currently connected?", use onEnvironmentConnectionStatusChange.
      * Example: api.v1.onEnvironmentSelectionChanged((data) => { console.log(data); });
      * @param {Function} callback - The function to call when the selection changes.
      *   Receives a payload object: { event_name, environment_type, environment_type_code,
      *   machine_id? | container_id? | endpoint_id? }. Exactly one of the *_id fields is
      *   present, matched to environment_type ("machine" | "container" | "endpoint").
      * @returns {void} No return value.
    */
    onEnvironmentSelectionChanged(callback) {
        // See onEnvironmentConnectionStatusChange for the cross-frame fan-out rationale.
        this.emitter.on('environmentSelectionChanged', callback);
    }

    /** A function to register a callback for when a lab variable changes.
      * This is typically used to listen for changes in lab variables, which can be used to store and share values across different parts of the lab environment.
      * Example: api.v1.onLabVariableChanged((name, value) => { console.log(name, value); });
      * @param {Function} callback - The function to call when a lab variable changes.
      * @returns {void} No return value.
    */ 
    onLabVariableChanged(callback) {
        // See onEnvironmentConnectionStatusChange for the rationale: the emit
        // side fans events out to both frames' emitters, so subscribers just
        // register locally regardless of which frame they're in.
        this.emitter.on('labVariableChanged', callback);
    }

    /** A function to register a callback for when the instructions page changes.
      * This is typically used to listen for changes in the current page of instructions in a lab environment.
      * Example: api.v1.onInstructionsPageChanged((pageIndex) => { console.log(pageIndex); });
      * @param {Function} callback - The function to call when the instructions page changes.
      * @returns {void} No return value.
    */
    onInstructionsPageChanged(callback) {
        // See onEnvironmentConnectionStatusChange.
        this.emitter.on('instructionsPageChanged', callback);
    }

    /** A function to register a callback for when the instructions are replaced in place, such as by an author editing them live.
      * Example: api.v1.onInstructionsUpdated(() => { console.log(api.v1.getInstructionsMarkdown()); });
      * @param {Function} callback - The function to call after the new instructions are shown.
      * @returns {void} No return value.
    */
    onInstructionsUpdated(callback) {
        // See onEnvironmentConnectionStatusChange.
        this.emitter.on('instructionsUpdated', callback);
    }

    /** A function to register a callback for when an activity is completed.
      * This is typically used to listen for the completion of activities in a lab environment, such as when a user finishes a task or exercise.
      * Example: api.v1.onActivityCompleted((activityInfo) => { console.log(activityInfo); });
      * @param {Function} callback - The function to call when an activity is completed.
      * @returns {void} No return value.
    */
    onActivityCompleted(callback) {
        // See onEnvironmentConnectionStatusChange.
        this.emitter.on('activityCompleted', callback);
    }

    /** A function to register a callback for when the lab's data has finished loading.
      * Fires once per lab session, after instructions.js has fetched the lab payload from the
      * server and populated the in-memory labData object. Useful for plugins that need to
      * read lab-derived state (lab title, page list, etc.) and want to avoid the early
      * window where those reads return null.
      * Example: api.v1.onLabDataLoaded(() => { console.log('lab data ready'); });
      * @param {Function} callback - The function to call when lab data has loaded.
      * @returns {void} No return value.
    */
    onLabDataLoaded(callback) {
        // See onEnvironmentConnectionStatusChange.
        this.emitter.on('labDataLoaded', callback);
    }
}

// ReplacementTextType, by its number and by its name, as the server may send either.
const LAB_TOKEN_TYPE_NAMES = { 0: 'text', 10: 'link', 20: 'html', 30: 'text', Text: 'text', Link: 'link', Html: 'html', Standard: 'text' };

const api = {
    v1: new ApiV1(),

    _runningInFullLabClient: null,

    runningInFullLabClient: () => {
        if (api._runningInFullLabClient != null) return api._runningInFullLabClient;
        try {
            //if we get a successful determination, we'll cache it for future use, as it will not change.
            api._runningInFullLabClient = window.parent?.isClientWrapper && window.parent.isClientWrapper();
            return api._runningInFullLabClient;
        } catch (ex) {
            console.debug("Error determining if running in full lab client, assuming not. Error: ", ex);
            return false;
        }
    },

    // The page embedding the lab client, or the lab client's own window when nothing embeds it.
    hostWindow: () => api.runningInFullLabClient() ? window.parent.parent : window.parent,

    postMessageFromHostWindow: (data) => {
        const hostWindow = api.hostWindow();
        if (hostWindow == null) return;
        hostWindow.postMessage(data, "*");
    },

    // Each frame (instructions, labConsole) loads its own copy of this script,
    // so each has its own api object with its own emitter. The api.* fire
    // helpers below use these two functions to fan events out to the OTHER
    // frame's emitter so subscribers can simply register locally and receive
    // events regardless of which frame emitted them. No-op when not in the
    // expected frame or when the cross-frame target hasn't initialised yet.
    emitOnInstructionsFrameApi: (eventName, ...args) => {
        try {
            if (typeof labConsole === 'undefined' || !labConsole.isChildClient()) return;
            const instructionsApi = window.parent
                && typeof window.parent.getInstructionsWindow === 'function'
                && window.parent.getInstructionsWindow()?.api;
            instructionsApi?.v1?.emitter?.emit(eventName, ...args);
        } catch { /* cross-frame access can throw during teardown; ignore */ }
    },
    emitOnLabConsoleFrameApi: (eventName, ...args) => {
        try {
            if (typeof labClient === 'undefined' || !labClient.isChildClient()) return;
            const consoleApi = window.parent
                && window.parent.consoleWindow
                && window.parent.consoleWindow.api;
            consoleApi?.v1?.emitter?.emit(eventName, ...args);
        } catch { /* cross-frame access can throw during teardown; ignore */ }
    },

    machineConnected: (machineId) => {
        let data = {
            event_name: "environment_connection_status_change",
            environment_type: "machine",
            environment_type_code: 1,
            machine_id: machineId,
            status: "connected",
            status_code: 1
        };
        api.v1.emitter.emit("environmentConnectionStatusChange", data);
        // Each frame loads its own api/emitter. When this fires in the
        // labConsole frame, also re-emit on the instructions-frame emitter so
        // subscribers there (e.g. mentor.js) receive the event without any
        // cross-frame registration routing.
        api.emitOnInstructionsFrameApi("environmentConnectionStatusChange", data);
        api.postMessageFromHostWindow(data);
    },
    machineDisconnected: (machineId) => {
        let data = {
            event_name: "environment_connection_status_change",
            environment_type: "machine",
            environment_type_code: 1,
            machine_id: machineId,
            status: "disconnected",
            status_code: 0
        };
        api.v1.emitter.emit("environmentConnectionStatusChange", data);
        api.emitOnInstructionsFrameApi("environmentConnectionStatusChange", data);
        api.postMessageFromHostWindow(data);
    },
    // Fired when the active virtual machine changes (initial auto-select at
    // lab init, or a user-initiated tab switch). Distinct from machineConnected:
    // selection is about which target is active in the UI; connection is about
    // whether that target is currently reachable. Subscribers that want to
    // refresh context based on the active target use onEnvironmentSelectionChanged.
    machineSelected: (machineId) => {
        let data = {
            event_name: "environment_selection_changed",
            environment_type: "machine",
            environment_type_code: 1,
            machine_id: machineId
        };
        api.v1.emitter.emit("environmentSelectionChanged", data);
        api.emitOnInstructionsFrameApi("environmentSelectionChanged", data);
        api.postMessageFromHostWindow(data);
    },
    // Container-lab analogue of machineSelected. Containers don't have a
    // separate "connected" transition the way VMs do -- once selected, the
    // container is the active target -- so this is the single signal for
    // "active container changed".
    containerSelected: (containerId) => {
        let data = {
            event_name: "environment_selection_changed",
            environment_type: "container",
            environment_type_code: 2,
            container_id: containerId
        };
        api.v1.emitter.emit("environmentSelectionChanged", data);
        api.emitOnInstructionsFrameApi("environmentSelectionChanged", data);
        api.postMessageFromHostWindow(data);
    },
    // Fired when a VM endpoint (SSH, RDP, VNC, Telnet, HTTP/HTTPS) becomes
    // the active target. Endpoints and machines are mutually exclusive at
    // the virt-client level: selecting an endpoint clears selectedMachine
    // and vice versa. From the mentor / context-update standpoint they're
    // a third kind of "selected environment".
    virtualMachineEndpointSelected: (endpointId) => {
        let data = {
            event_name: "environment_selection_changed",
            environment_type: "endpoint",
            environment_type_code: 3,
            endpoint_id: endpointId
        };
        api.v1.emitter.emit("environmentSelectionChanged", data);
        api.emitOnInstructionsFrameApi("environmentSelectionChanged", data);
        api.postMessageFromHostWindow(data);
    },
    labVariableChanged: (name, value) => {
        api.v1.emitter.emit("labVariableChanged", name, value);
        // Fan out to the labConsole-frame emitter (see emitOnLabConsoleFrameApi).
        api.emitOnLabConsoleFrameApi("labVariableChanged", name, value);
        api.postMessageFromHostWindow({ event_name: "lab_variable_changed", name: name, value: value });
    },
    instructionsPageChanged: (pageIndex) => {
        api.v1.emitter.emit("instructionsPageChanged", pageIndex);
        api.emitOnLabConsoleFrameApi("instructionsPageChanged", pageIndex);
        api.postMessageFromHostWindow({ event_name: "instructions_page_changed", page_index: pageIndex });
    },
    instructionsUpdated: () => {
        api.v1.emitter.emit("instructionsUpdated");
        api.emitOnLabConsoleFrameApi("instructionsUpdated");
    },
    activityCompleted: (activityInfo) => {
        api.v1.emitter.emit("activityCompleted", activityInfo);
        api.emitOnLabConsoleFrameApi("activityCompleted", activityInfo);
        api.postMessageFromHostWindow({ event_name: "activity_completed", id: activityInfo.id, alias: activityInfo.alias, activity_type: activityInfo.activityType, passed: activityInfo.passed });
    },

    // Fired once from instructions.js after the lab-data AJAX completes and the labData
    // object is populated. Subscribers (api.v1.onLabDataLoaded) can rely on
    // labClient.getLabData() / getCurrentPageHeading() / etc. returning real values from
    // this point forward. Idempotent on re-fire (the event simply re-runs each subscriber);
    // current call site fires it exactly once per lab session.
    labDataLoaded: () => {
        api.v1.emitter.emit("labDataLoaded");
        api.emitOnLabConsoleFrameApi("labDataLoaded");
        api.postMessageFromHostWindow({ event_name: "lab_data_loaded" });
    }
}

globalThis.api = api;

window.onload = function () {

    function receiveMessageFromHostPage (event) {
        if (!event?.data?.event_id) return;
        // The bridge takes requests only from the page embedding the lab client, and answers only
        // it. Frames inside the lab client, such as a VM's web endpoint or HTML in the instructions,
        // and pages that opened it can post here too, and must not reach lab tokens or the VM's input.
        const hostWindow = api.hostWindow();
        const labClientWindow = api.runningInFullLabClient() ? window.parent : window;
        if (event.source !== hostWindow || hostWindow === labClientWindow) {
            console.debug("Lab client API request ignored: it did not come from the page embedding the lab client.", event.data.event_id);
            return;
        }
        let event_id = event.data.event_id;
        let version = event.data.version ?? 1;
        if (version != 1) return; //we'll implement other versions as they become available.
        switch (event_id) {
            case "getEnvironmentConnectionStatus":
                if (typeof labConsole !== 'undefined') {
                    let conn_status = api.v1.getEnvironmentConnectionStatus();
                    conn_status["event_name"] = "environment_connection_status";
                    api.postMessageFromHostWindow(conn_status);                    
                }
                break;
            case "getEnvironmentLatency":
                if (typeof labConsole !== 'undefined') {
                    api.postMessageFromHostWindow({ event_Id: "environment_latency", latency: api.v1.getEnvironmentLatency() });
                }
                break;
            // Note: getEnvironmentScreenDataUrl is intentionally not exposed via postMessage.
            // Screen contents are an open-ended exfiltration primitive (credentials, demo data,
            // anything currently on screen), so we restrict capture to in-page callers that
            // already have DOM access. External embedders cannot request screen data through
            // this channel.
            //
            // getLabClientScreenDataUrl is excluded for the same reason -- and more strongly,
            // since a full-UI capture additionally includes the instructions pane (lab tokens,
            // credentials, URLs surfaced as replacement text). Same rule: in-page callers only.
            //
            // useMouseInEnvironment, showInEnvironment, clearShownInEnvironment and
            // waitForEnvironmentScreen are excluded too. A spot for the mouse or a bubble is in
            // the pixels of an in-page screenshot, which embedders can't take; a bubble draws
            // arbitrary text over the VM's screen, a spoofing vector in an embedder's hands; and
            // what a wait measures from is an in-page screenshot. Same rule: in-page callers only.
            case "sendTextToEnvironment":
                if (typeof labConsole !== 'undefined' && event.data?.text != null) {
                    api.v1.sendTextToEnvironment(event.data.text);
                }
                break;
            // Same input privilege as sendTextToEnvironment, so embedders may press keys too, but
            // without waitUntil or screenshot: a screenshot is in-page only (see above).
            case "pressKeysInEnvironment":
                if (typeof labConsole !== 'undefined' && event.data?.keys != null) {
                    api.v1.pressKeysInEnvironment(event.data.keys, { repeat: event.data.repeat }).then(function (result) {
                        api.postMessageFromHostWindow({ event_Id: "environment_keys_pressed", ok: result.ok, reason: result.reason, message: result.message });
                    });
                }
                break;
            case "getLabToken":
                if (typeof labClient !== 'undefined' && event.data?.name != null) {
                    api.postMessageFromHostWindow({ event_Id: "lab_token", value: api.v1.getLabToken(event.data.name) });
                }
                break;
            case "getLabVariable":
                if (typeof labClient !== 'undefined' && event.data?.name != null) {
                    api.postMessageFromHostWindow({ event_Id: "lab_variable", value: api.v1.getLabVariable(event.data.name) });
                }
                break;
            case "sendLabNotification":
                if (typeof labClient !== 'undefined' && event.data?.notification != null) {
                    api.v1.sendLabNotification(event.data.notification)
                }
                break;
            case "getInstructionsPageIndex":
                if (typeof labClient !== 'undefined') {
                    api.postMessageFromHostWindow({ event_Id: "instructions_page_index", page_index: api.v1.getInstructionsPageIndex() });

                }
                break;
            case "getMinutesRemaining":
                if (typeof labClient !== 'undefined') {
                    api.postMessageFromHostWindow({ event_Id: "minutes_remaining", minutes_remaining: api.v1.getMinutesRemaining() });
                }
                break;
            case "gotoInstructionsPage":
                if (typeof labClient !== 'undefined' && event.data.page_index != null) {
                    api.v1.gotoInstructionsPage(event.data.page_index);
                }
                break;
            case "evaluateActivity":
                if (typeof labClient !== 'undefined' && event.data.alias != null) {
                    api.v1.evaluateActivity(event.data.alias);
                }
                break;
        }
    }

    if (api.runningInFullLabClient()) {
        window.parent.addEventListener("message", receiveMessageFromHostPage, false);
    } else {
        window.addEventListener("message", receiveMessageFromHostPage, false);
    }
}
