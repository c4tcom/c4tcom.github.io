// A mentor's mouse gesture played into a Spark session.
//
// Spark's RDP and VNC sessions both take mouse input in remote screen pixels through
// mouseDown(x, y, button), mouseMove(x, y) and mouseUp(x, y, button), with the button as the DOM
// event.button (0 left, 2 right). The wheel has no method of its own: it is the raw input "83"
// with x, y and a direction, 1 for one notch down and 0 for one notch up, which is what Spark's
// own wheel listener in spark/surface_min.js sends.
//
// A gesture is { action, x, y, toX, toY, direction, amount } in remote pixels, with action one of
// move, click, double_click, triple_click, right_click, drag or scroll. Each action starts by
// moving to its spot, so the guest sees the pointer arrive the way a hand would put it there. A
// drag moves to its end in steps, since a guest only starts a drag once the pointer travels with
// the button held.
(function () {
    "use strict";

    const LEFT = 0;
    const RIGHT = 2;
    const DRAG_STEPS = 10;
    // Between one event and the next, well inside any guest's multi-click time.
    const STEP_INTERVAL_MS = 20;
    // How long a drag holds the button still before it moves. A QEMU tablet folds a move into the
    // press before it while the guest has yet to read that press, so a press that reaches the guest
    // together with the first moves lands partway along the drag instead of where it started.
    const DRAG_PRESS_HOLD_MS = 150;

    function steps(gesture) {
        const x = gesture.x;
        const y = gesture.y;
        const moveTo = { kind: "move", x: x, y: y };
        switch (gesture.action) {
            case "move":
                return [moveTo];
            case "click":
                return [moveTo].concat(leftClicks(x, y, 1));
            case "right_click":
                return [moveTo, press(RIGHT, x, y, true), press(RIGHT, x, y, false)];
            case "double_click":
                return [moveTo].concat(leftClicks(x, y, 2));
            case "triple_click":
                return [moveTo].concat(leftClicks(x, y, 3));
            case "drag": {
                const held = press(LEFT, x, y, true);
                held.holdMs = DRAG_PRESS_HOLD_MS;
                const drag = [moveTo, held];
                for (let i = 1; i <= DRAG_STEPS; i++) {
                    drag.push({
                        kind: "move",
                        x: Math.round(x + (gesture.toX - x) * i / DRAG_STEPS),
                        y: Math.round(y + (gesture.toY - y) * i / DRAG_STEPS)
                    });
                }
                drag.push(press(LEFT, gesture.toX, gesture.toY, false));
                return drag;
            }
            case "scroll": {
                const scroll = [moveTo];
                for (let i = 0; i < gesture.amount; i++) {
                    scroll.push({ kind: "wheel", x: x, y: y, down: gesture.direction === "down" });
                }
                return scroll;
            }
            default:
                return null;
        }
    }

    function press(button, x, y, down) {
        return { kind: down ? "down" : "up", x: x, y: y, button: button };
    }

    function leftClicks(x, y, count) {
        const presses = [];
        for (let i = 0; i < count; i++) {
            presses.push(press(LEFT, x, y, true), press(LEFT, x, y, false));
        }
        return presses;
    }

    function send(session, step) {
        switch (step.kind) {
            case "move":
                session.mouseMove(step.x, step.y);
                break;
            case "down":
                session.mouseDown(step.x, step.y, step.button);
                break;
            case "up":
                session.mouseUp(step.x, step.y, step.button);
                break;
            case "wheel":
                session.writeRawInput("83" + step.x + "\t" + step.y + "\t" + (step.down ? 1 : 0));
                break;
        }
    }

    // Each session's gestures, played one after another: a click sent during a drag would otherwise
    // land between its press and release.
    const players = new WeakMap();

    function playerFor(session) {
        let player = players.get(session);
        if (!player) {
            player = { playing: false, waiting: [], readyAt: 0 };
            players.set(session, player);
        }
        return player;
    }

    // Each step is sent STEP_INTERVAL_MS after the one before it actually went out, or the holdMs
    // that step gives, so a throttled page's late timers slow a gesture down rather than bunch its
    // steps together. A step whose send throws is passed over, except a first step play sends at
    // once, whose error reaches its caller.
    function playNext(session, player, fromPlay) {
        const gesture = player.waiting.shift();
        if (!gesture) {
            player.playing = false;
            return;
        }
        player.playing = true;
        gesture.sent = 0;
        function sendStep(atOnce) {
            const step = gesture.steps[gesture.sent++];
            try {
                send(session, step);
            } catch (e) {
                if (atOnce) {
                    player.playing = false;
                    throw e;
                }
            }
            const interval = step.holdMs > 0 ? step.holdMs : STEP_INTERVAL_MS;
            player.readyAt = Date.now() + interval;
            if (gesture.sent < gesture.steps.length) {
                window.setTimeout(function () { sendStep(false); }, interval);
                return;
            }
            if (typeof gesture.onDone === "function") {
                try {
                    gesture.onDone();
                } catch (e) {
                    // Whoever listens failing doesn't stop the gestures behind this one.
                }
            }
            playNext(session, player);
        }
        const wait = Math.max(0, player.readyAt - Date.now());
        if (wait === 0) {
            sendStep(fromPlay === true);
        } else {
            window.setTimeout(function () { sendStep(false); }, wait);
        }
    }

    // Sends the first step once the session's gesture before it has finished, at once when none is
    // playing, and the rest paced behind it, all into the session they started in, which ignores
    // them once it has closed. onDone, when given, is called once the last step has gone out.
    function play(session, gestureSteps, onDone) {
        const player = playerFor(session);
        player.waiting.push({ steps: gestureSteps, onDone: onDone });
        if (!player.playing) {
            playNext(session, player, true);
        }
    }

    // Whether the screen a gesture's spots were picked on, { width, height } in remote pixels, is
    // still the size of the console's canvas. A gesture that says nothing of its screen holds.
    function sameScreen(screen, canvas) {
        if (screen == null) {
            return true;
        }
        return canvas != null && canvas.width === screen.width && canvas.height === screen.height;
    }

    // The input queue's send for a gesture's steps: they play once their turn comes if the screen
    // they were picked on, gesture.screen, is still the size of the canvas currentCanvas returns,
    // and are dropped unsent otherwise.
    function gestureSender(gesture, gestureSteps, currentCanvas) {
        return function (session, done) {
            if (!sameScreen(gesture.screen, currentCanvas())) {
                done(false);
                return true;
            }
            play(session, gestureSteps, done);
            return true;
        };
    }

    // Tells whoever asked for keys or the mouse, through the onSent they gave, whether the input
    // went out.
    function reportSent(onSent, sent) {
        if (typeof onSent === "function") {
            onSent(sent);
        }
    }

    // Tells whoever asked for keys or the mouse, through the onStart they gave, that the input is
    // starting to go out.
    function notifyStart(onStart) {
        if (typeof onStart !== "function") {
            return;
        }
        try {
            onStart();
        } catch (e) {
            // Whoever listens failing doesn't stop the input going out.
        }
    }

    // The mentor gave up on input that hadn't gone out in time, so it never goes out.
    function isAbandoned(onSent) {
        return onSent?.abandoned === true;
    }

    // How many items a console holds waiting before it refuses more of the mentor's keys and
    // gestures, room for the mentor's longest repeat of keys and then some. Pastes, typed text and
    // Enter are never refused for room.
    const MAX_WAITING_INPUT = 32;

    // A paste or typed text Spark hasn't said is in by this many times its paced characters' time,
    // and the margin on top, is taken as never coming back, so the input behind it moves on. Spark
    // paces characters with chained timers, which run late on a busy page and far later in a
    // background tab, so the bound allows well over the nominal pace.
    const PACED_TIME_ALLOWANCE = 3;
    const PACED_DONE_MARGIN_MS = 10000;
    // The pace per character, a fallback for callers that don't give one.
    const DEFAULT_PACED_MS_PER_CHARACTER = 250;

    // How long a paste or typed text of this many characters, paced msPerCharacter apart, gets
    // before the input behind it moves on.
    function pacedTimeLimit(characters, msPerCharacter) {
        const perCharacter = msPerCharacter > 0 ? msPerCharacter : DEFAULT_PACED_MS_PER_CHARACTER;
        return Math.max(0, characters || 0) * perCharacter * PACED_TIME_ALLOWANCE + PACED_DONE_MARGIN_MS;
    }

    // Counts the page being hidden or shown, so typed text can tell the page was hidden while it
    // typed.
    let visibilityChanges = 0;
    document.addEventListener("visibilitychange", function () { visibilityChanges++; });

    // A console's mentor keys and mouse input, and the text it pastes or types, sent in the order
    // asked for: each item starts once the one before it has gone out, a gesture once its last
    // step has been sent, a paste or typed text once the console says its text is in or its time
    // is up. At most one paste waits: a new paste replaces the one still waiting along with the
    // input behind it, since that input belongs to the text it replaces, and a paste asked for
    // while one is still typing takes over from it at once, as Spark's next paced write replaces
    // the one before. Typed text is never replaced, and nor is the input asked for after it: a
    // paste replaces input only up to the next typed text, and one asked for while typed text
    // waits behind the paste still typing lets that paste finish and waits its turn. The session
    // closing or being replaced drops its input too. Each item's onStart, when given, hears once
    // that it is starting to go out, and its onSent once whether it went out (true) or was dropped
    // (false). An item whose onSent has been abandoned is dropped without either, and takes no room.
    function inputQueue() {
        let waiting = [];
        // The item still going out, or null.
        let current = null;

        function drop(isDropped) {
            const dropped = waiting.filter(isDropped);
            waiting = waiting.filter(function (item) { return !isDropped(item); });
            dropped.forEach(function (item) {
                if (!isAbandoned(item.onSent)) {
                    reportSent(item.onSent, false);
                }
            });
        }

        function dropAbandoned() {
            waiting = waiting.filter(function (item) { return !isAbandoned(item.onSent); });
        }

        function finish(item, sent) {
            if (current !== item) {
                return;
            }
            window.clearTimeout(item.timer);
            current = null;
            reportSent(item.onSent, sent);
            sendNext();
        }

        // The paste or typed text still typing is let go of without waiting for Spark to say it is in.
        function releasePaced() {
            window.clearTimeout(current.timer);
            stopTypedText(current.session);
            current = null;
        }

        // Typed text: paced like a paste, but never replaced.
        function isInTurn(item) {
            return Boolean(item.startPaced) && !item.replaceable;
        }

        // The session's pastes and typed text, still typing or waiting.
        function pacedIn(session) {
            const items = current !== null ? [current].concat(waiting) : waiting;
            return items.filter(function (item) { return item.session === session && item.startPaced; });
        }

        // A hidden page's timers are throttled, so a paste or typed text still typing there gets
        // another bound's worth of time rather than being given up on. Typed text, which
        // carries credentials and commands the input behind it mustn't cut into, gets one too when
        // the page was hidden at any point during the bound, since Spark's keys may still be
        // catching up.
        function armPacedBound(item) {
            item.visibilityChangesAtArm = visibilityChanges;
            item.timer = window.setTimeout(function () {
                if (document.hidden || (isInTurn(item) && item.visibilityChangesAtArm !== visibilityChanges)) {
                    armPacedBound(item);
                } else {
                    stopTypedText(item.session);
                    finish(item, false);
                }
            }, item.timeLimit);
        }

        function beginPaced(item) {
            current = item;
            armPacedBound(item);
            try {
                item.startPaced(item.session, function () { finish(item, true); });
            } catch (e) {
                if (current === item) {
                    releasePaced();
                }
            }
        }

        function sendNext() {
            while (current === null && waiting.length > 0) {
                const item = waiting.shift();
                if (isAbandoned(item.onSent)) {
                    continue;
                }
                notifyStart(item.onStart);
                if (item.startPaced) {
                    beginPaced(item);
                    continue;
                }
                sendItem(item);
            }
        }

        // An item whose send says it goes out later is current until it calls done, which may come
        // before its send returns.
        function sendItem(item) {
            let sending = true;
            let sentAtOnce = null;
            current = item;
            let later;
            try {
                later = item.send(item.session, function (sent) {
                    if (sending) {
                        sentAtOnce = sent !== false;
                    } else {
                        finish(item, sent !== false && item.closed !== true);
                    }
                });
            } catch (e) {
                current = null;
                reportSent(item.onSent, false);
                return;
            } finally {
                sending = false;
            }
            if (later !== true || sentAtOnce !== null) {
                current = null;
                reportSent(item.onSent, sentAtOnce !== false);
            }
        }

        // A paste or typed text still typing into another session never hears back from it, so it
        // is let go of as a close would.
        function dropOtherSessions(session) {
            if (current !== null && current.startPaced && current.session !== session) {
                releasePaced();
            }
            drop(function (item) { return item.session !== session; });
        }

        return {
            // send(session, done) sends the item into the session. It has gone out once send returns,
            // unless send returns true, when it has once send calls done, or been dropped if send
            // calls done(false). Returns whether the queue took the item, which it doesn't once
            // MAX_WAITING_INPUT items are waiting.
            add: function (session, send, onSent, onStart) {
                dropOtherSessions(session);
                dropAbandoned();
                if (waiting.length >= MAX_WAITING_INPUT) {
                    return false;
                }
                waiting.push({ session: session, send: send, onSent: onSent, onStart: onStart });
                sendNext();
                return true;
            },
            // Enter, and text written in one go rather than paced, sent as add does but never refused
            // for room, since whoever typed them has no one to tell they were dropped. Paced text
            // goes through paste or type.
            addText: function (session, send) {
                dropOtherSessions(session);
                dropAbandoned();
                waiting.push({ session: session, send: send });
                sendNext();
            },
            // Whether count more items for the session would all be taken.
            canTake: function (session, count) {
                const taking = waiting.filter(function (item) { return item.session === session && !isAbandoned(item.onSent); });
                return taking.length + count <= MAX_WAITING_INPUT;
            },
            // start(session, done) starts pasting into the session and calls done once the text is
            // in, which Spark does after typing characters paced msPerCharacter apart.
            paste: function (session, start, characters, msPerCharacter) {
                dropOtherSessions(session);
                let lastPasteIndex = -1;
                waiting.forEach(function (item, i) {
                    if (item.replaceable) {
                        lastPasteIndex = i;
                    }
                });
                // The input replaced ends at the next typed text, which goes out with the
                // input asked for after it whatever is pasted later.
                const replaceFrom = Math.max(lastPasteIndex, 0);
                const inTurnIndex = waiting.findIndex(function (item, i) { return i >= replaceFrom && isInTurn(item); });
                if (lastPasteIndex >= 0) {
                    const replaced = waiting.slice(lastPasteIndex, inTurnIndex >= 0 ? inTurnIndex : waiting.length);
                    drop(function (item) { return replaced.includes(item); });
                } else if (current !== null && current.replaceable && inTurnIndex < 0) {
                    drop(function () { return true; });
                    releasePaced();
                }
                const timeLimit = pacedTimeLimit(characters, msPerCharacter);
                waiting.push({ session: session, startPaced: start, replaceable: true, timeLimit: timeLimit });
                sendNext();
            },
            // start(session, done) starts typing into the session as paste does, but behind whatever
            // was asked for before it, and is never replaced by a paste asked for after it.
            type: function (session, start, characters, msPerCharacter) {
                dropOtherSessions(session);
                const timeLimit = pacedTimeLimit(characters, msPerCharacter);
                waiting.push({ session: session, startPaced: start, timeLimit: timeLimit });
                sendNext();
            },
            // How long the session's pastes and typed text, still typing or waiting, can hold up the
            // input asked for after them: the time each gets before the input behind it moves on.
            pacedTimeAhead: function (session) {
                return pacedIn(session).reduce(function (sum, item) { return sum + item.timeLimit; }, 0);
            },
            close: function (session) {
                if (current !== null && current.session === session) {
                    if (current.startPaced) {
                        releasePaced();
                    } else {
                        current.closed = true;
                    }
                }
                drop(function (item) { return item.session === session; });
                sendNext();
            }
        };
    }

    // The longest text typed as key presses where the console shares the clipboard. Spark types
    // keys 100 ms apart, so this much takes about 20 seconds, while longer text, such as a script
    // or a config file, would take minutes and goes in as a paste instead.
    const LONGEST_TEXT_TYPED_AS_KEYS = 200;

    // Whether typed text goes in as a clipboard paste rather than as key presses: only text longer
    // than LONGEST_TEXT_TYPED_AS_KEYS, only where the console shares the clipboard, and never
    // when options.neverClipboard is set, as it is for credentials.
    function pastesTypedText(text, sharesClipboard, options) {
        return text.length > LONGEST_TEXT_TYPED_AS_KEYS && sharesClipboard === true && options?.neverClipboard !== true;
    }

    // Spark types text as characters, and a Windows guest takes a typed digit as a number-pad key:
    // with Num Lock off there, it acts as a navigation key, so a typed 1 is End. So while the guest
    // has Num Lock off, digits go as their top-row keys instead, which Num Lock doesn't change.
    // Otherwise text goes as characters, which work on every keyboard layout. A top-row key types
    // what the guest's layout puts there, so on a layout whose top row needs Shift for digits, such
    // as French, digits typed with Num Lock off come out as that row's symbols.
    const TOP_ROW_DIGIT_SCANCODES = { "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11 };
    // The lock keys each session's guest last reported, with the lock flags Spark had then set, by
    // session.
    const reportedLockKeys = new WeakMap();
    const NUM_LOCK_FLAG = 2;
    // The paced write each session is on, so one the input queue let go of, or a later paced write
    // replaced, stops where it is.
    const writesInProgress = new WeakMap();

    // Keeps the lock keys the session's guest reports, for writeTypedText.
    function trackLockKeys(session) {
        session.onLockKeyState = function (guestLockKeys) {
            reportedLockKeys.set(session, { numLock: guestLockKeys.numLock, lockFlagsAtReport: lockFlagsSparkLastSet(session) });
        };
    }

    // The lock flags Spark last set on the session's guest, which it does on connecting, on
    // reconnecting and when the student's own lock keys differ, telling no one. Undefined before
    // the session has a screen.
    function lockFlagsSparkLastSet(session) {
        const surfaces = session.getSurfaces?.();
        if (!surfaces || surfaces.size() === 0) {
            return undefined;
        }
        return surfaces.getSurface(0)?.getController?.()?.remoteLockFlags;
    }

    // Whether the guest has Num Lock off: as it last reported, unless Spark has set its lock keys
    // since.
    function guestHasNumLockOff(session) {
        const report = reportedLockKeys.get(session);
        const currentLockFlags = lockFlagsSparkLastSet(session);
        if (report && report.lockFlagsAtReport === currentLockFlags) {
            return report.numLock === false;
        }
        if (typeof currentLockFlags === "number") {
            return (currentLockFlags & NUM_LOCK_FLAG) === 0;
        }
        return report?.numLock === false;
    }

    // Ends the session's write in progress, so it sends nothing more.
    function stopTypedText(session) {
        writesInProgress.delete(session);
    }

    function topRowScancodeOf(character) {
        return Object.hasOwn(TOP_ROW_DIGIT_SCANCODES, character) ? TOP_ROW_DIGIT_SCANCODES[character] : null;
    }

    // Writes text into the session as Spark's writeText(text, msPerKey, done) does.
    function writeTypedText(session, text, msPerKey, done) {
        const writeToken = {};
        // An unpaced write, such as one typed outside the input queue, is done before it returns,
        // so it leaves a paced write in progress going.
        if (msPerKey) {
            writesInProgress.set(session, writeToken);
        }
        if (!/[0-9]/.test(text) || !guestHasNumLockOff(session)) {
            if (msPerKey) {
                session.writeText(text, msPerKey, done);
            } else {
                session.writeText(text);
            }
            return;
        }
        const pieces = text.match(/[0-9]|[^0-9]+/g);
        if (!msPerKey) {
            // Unpaced, Spark sends each character at once and tells no one it has.
            pieces.forEach(function (piece) {
                const scancode = topRowScancodeOf(piece);
                if (scancode !== null) {
                    session.writeScancode(scancode);
                } else {
                    session.writeText(piece);
                }
            });
            return;
        }
        // A paced write ends the one Spark is still typing by replacing its characters, and a
        // first piece sent as a key wouldn't. An empty one replaces them with none; Spark calls
        // no callback for it, so none is given.
        if (topRowScancodeOf(pieces[0]) !== null) {
            session.writeText("", msPerKey);
        }
        let next = 0;
        const writeNext = function () {
            if (writesInProgress.get(session) !== writeToken) {
                return;
            }
            if (next === pieces.length) {
                done?.();
                return;
            }
            const piece = pieces[next++];
            const scancode = topRowScancodeOf(piece);
            const afterPiece = function () { window.setTimeout(writeNext, msPerKey); };
            if (scancode !== null) {
                session.writeScancode(scancode);
                afterPiece();
            } else {
                // Spark tells it is done as its last character goes, so the pause before the next
                // piece keeps the pace.
                session.writeText(piece, msPerKey, afterPiece);
            }
        };
        writeNext();
    }

    // The text with each line break, whether CRLF, CR or LF, as one CRLF.
    function withClipboardLineBreaks(text) {
        return text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
    }

    // sparkMouse also orders each console's key input and pastes with its mouse input, see inputQueue.
    window.sparkMouse = {
        steps: steps,
        play: play,
        sameScreen: sameScreen,
        gestureSender: gestureSender,
        inputQueue: inputQueue,
        reportSent: reportSent,
        notifyStart: notifyStart,
        isAbandoned: isAbandoned,
        pastesTypedText: pastesTypedText,
        withClipboardLineBreaks: withClipboardLineBreaks,
        trackLockKeys: trackLockKeys,
        writeTypedText: writeTypedText,
        MAX_WAITING_INPUT: MAX_WAITING_INPUT,
        LONGEST_TEXT_TYPED_AS_KEYS: LONGEST_TEXT_TYPED_AS_KEYS
    };
})();
