
var _sshClientInstances = [];

function getSshClientInstance(id) {
    for (var i = 0, numInstances = _sshClientInstances.length; i < numInstances; i++) {
        if (_sshClientInstances[i].terminalElementId === id) {
            return _sshClientInstances[i];
        }
    }
    return null;
}

// Pure KVM-serial-console auto-login prompt detection. Given the current login state and the
// accumulated tail of console output, decide the next action — kept free of socket/terminal/DOM
// so it can be unit-tested directly. Returns one of:
//   "username" — a getty login prompt is showing; type the username.
//   "password" — a password prompt is showing; type the password.
//   "success"  — a shell prompt reached; the login landed.
//   "fail"     — getty rejected the creds (or re-prompted); fall back to a manual login prompt.
//   "reveal"   — already at a shell with no login prompt (reconnect to a live session); type nothing.
//   ""         — nothing conclusive yet; keep waiting.
// A shell prompt is matched as a `user@host…$` / `…#` tail — the `@` requirement keeps MOTD or
// banner lines that merely end in `$`/`#` from being mistaken for a prompt. A getty login prompt is
// detected by a trailing `login:` and the password prompt by `Password:`. Auth failure keys only on
// getty's explicit "Login incorrect" — NOT a bare trailing `login:`, which would false-match the
// post-login MOTD "Last login:" line and abort a successful sign-in.
function serialLoginNextAction(state, buffer) {
    var atShell = /@[^\n]*[#$]\s*$/.test(buffer);
    var atLogin = /login:\s*$/i.test(buffer);
    if (state === "awaitingLogin") {
        if (atLogin) {
            return "username";
        }
        if (atShell) {
            // No login prompt — already at a shell (reconnect to a live session). Type nothing.
            return "reveal";
        }
    } else if (state === "awaitingPassword") {
        if (/password:\s*$/i.test(buffer)) {
            return "password";
        }
    } else if (state === "awaitingResult") {
        if (/login incorrect/i.test(buffer)) {
            return "fail";
        }
        if (atShell) {
            return "success";
        }
    }
    return "";
}

function SshClient(connInfo) {

    let connectionInfo = connInfo;
    this.terminalElementId = connectionInfo.terminalElementId;

    _sshClientInstances.push(this);

    var $status = $('#' + connectionInfo.statusElementId);
    var style = {};
    var DISCONNECTED = 0;
    var CONNECTING = 2;
    var CONNECTED = 1;
    var state = DISCONNECTED;
    var reconnect = false;

    var term; //xterm instance
    var sock; //websocket instance
    var terminalDomElement = document.getElementById(connectionInfo.terminalElementId);

    function parse_term_style() {
        var text = $('.xterm-helpers style').text();
        var arr = text.split('xterm-normal-char{width:');
        style.width = parseFloat(arr[1]);
        arr = text.split('div{height:');
        style.height = parseFloat(arr[1]);
    }

    function current_geometry() {
        if (!style.width || !style.height) {
            parse_term_style();
        }
        var container = terminalDomElement;
        var cols = parseInt(container.clientWidth / style.width, 10) - 1;
        var rows = parseInt(container.clientHeight  / style.height, 10);
        return { 'cols': cols, 'rows': rows };
    }

    function format_geometry(cols, rows) {
        return JSON.stringify({ 'cols': cols, 'rows': rows });
    }

    function read_as_text_with_decoder(file, callback, decoder) {
        var reader = new window.FileReader();

        if (decoder === undefined) {
            decoder = new window.TextDecoder('utf-8', { 'fatal': true });
        }

        reader.onload = function () {
            var text;
            try {
                text = decoder.decode(reader.result);
            } catch (TypeError) {
                console.error('Decoding error happened.', TypeError);
            } finally {
                if (callback) {
                    callback(text);
                }
            }
        };

        reader.onerror = function (e) {
            console.error(e);
        };

        reader.readAsArrayBuffer(file);
    }

    function read_as_text_with_encoding(file, callback, encoding) {
        var reader = new window.FileReader();
        if (encoding === undefined) {
            encoding = 'utf-8';
        }
        reader.onload = function () {
            if (callback) {
                callback(reader.result);
            }
        };
        reader.onerror = function (e) {
            console.error(e);
        };
        reader.readAsText(file, encoding);
    }

    function read_file_as_text(file, callback, decoder) {
        if (!window.TextDecoder) {
            read_as_text_with_encoding(file, callback, decoder);
        } else {
            read_as_text_with_decoder(file, callback, decoder);
        }
    }

    function resize_terminal(term) {
        var geometry = current_geometry();
        term.on_resize(geometry.cols, geometry.rows);
    }

    function connectToSession(sessionInfo) {
        try {
            sock = new window.WebSocket(sessionInfo.url);
        } catch (e) {
            state = DISCONNECTED;
            console.error("Connection failed", e);
            $status.text("Connection failed");
            throw e;
        }
        var encoding = 'utf-8';
        var decoder = window.TextDecoder ? new window.TextDecoder(encoding) : encoding;
        
        term = new Terminal({
             cursorBlink: true
        });

        if (!sessionInfo.encoding) {
            console.info('Unable to detect the default encoding of your server');
            sessionInfo.encoding = encoding;
        } else {
            console.info('The default encoding of your server is ' + sessionInfo.encoding);
        }

        function term_write(text) {
            if (term) {
                term.write(text);
                if (!term.resized) {
                    resize_terminal(term);
                    term.resized = true;
                }
            }
            feedSerialLogin(text);
        }

        function set_encoding(new_encoding) {
            if (!window.TextDecoder) {
                decoder = new_encoding;
                encoding = decoder;
                console.info('Set encoding to ' + encoding);
            } else {
                try {
                    decoder = new window.TextDecoder(new_encoding);
                    encoding = decoder.encoding;
                    console.info('Set encoding to ' + encoding);
                } catch (RangeError) {
                    console.info('Unknown encoding ' + new_encoding);
                }
            }
        }

        set_encoding(sessionInfo.encoding);

        term.on_resize = function (cols, rows) {
            if (cols !== this.geometry[0] || rows !== this.geometry[1]) {
                console.info('Resizing terminal to geometry: ' + format_geometry(cols, rows));
                this.resize(cols, rows);
                sock.send(JSON.stringify({ 'resize': [cols, rows] }));
            }
        };

        term.on('data', function (data) {
            sock.send(JSON.stringify({ 'data': data }));
        });

        // ── KVM serial-console auto-login ──────────────────────────────────────
        // Engaged only on the serial path when the VM profile supplied creds. The host attaches
        // `virsh console` to the VM's getty; we watch the console output for the login/password
        // prompts and type the creds behind a mask so the user lands on a clean shell. Three
        // protections matter: (1) a bad-creds login (lab author error) is detected and we drop to a
        // clean login prompt for manual entry; (2) reconnecting to a still-logged-in ttyS0 has no
        // login prompt, so we type nothing and just reveal the existing shell; (3) a timeout always
        // lifts the mask, so a prompt-detection miss can never trap the user behind a black overlay.
        const serialAutoLogin = !!(connectionInfo.serialConsole && connectionInfo.username && connectionInfo.password);
        let serialPrimed = false;
        let serialLoginState = serialAutoLogin ? "awaitingLogin" : "off";
        let serialBuffer = "";
        let $serialMask = null;
        let serialLoginTimer = null;
        // The grid dimensions the serial re-fit (in onopen) actually applied — the source of truth
        // for the post-login stty, so the guest tty matches the rendered grid exactly.
        let serialGrid = null;

        function removeSerialMask() {
            if ($serialMask) {
                $serialMask.remove();
                $serialMask = null;
            }
        }

        // outcome: "success" (fresh login — size the guest, clear the login noise, reveal a clean
        // shell), "fail" (auth rejected — re-summon a clean login prompt), "reconnect" (attached to a
        // detected live shell — size it to the current window and redraw), or "reveal" (timeout /
        // unknown state — just redraw and lift the mask, no sizing).
        function finishSerialLogin(outcome) {
            if (serialLoginState === "done") {
                return;
            }
            serialLoginState = "done";
            if (serialLoginTimer) {
                window.clearTimeout(serialLoginTimer);
                serialLoginTimer = null;
            }
            $status.text("");
            if (outcome === "success") {
                // A serial line carries no window-size signal, so the guest stays at the getty default
                // (~80x24) however large the xterm is — full-screen apps only use that corner. Auto-login
                // succeeded, so we are provably at a POSIX shell: pin the guest tty to the xterm size so
                // apps use the whole terminal. Set once here — a later browser resize won't re-flow (no
                // SIGWINCH over serial), and we only do this on the known-shell success path.
                if (sock && serialGrid) {
                    // Size the guest from the geometry the on-connect re-fit applied to the grid —
                    // reading it back from the terminal did not reflect the resize in this xterm
                    // build, so we use the value we know was applied.
                    sock.send(JSON.stringify({ 'data': 'stty rows ' + serialGrid.rows + ' cols ' + serialGrid.cols + '\r' }));
                }
                // Then wipe the stty echo + login noise locally (a guest-side `clear` would be a command,
                // invalid/noisy on non-POSIX consoles) and draw a fresh prompt at the new size. The delay
                // lets the stty and its echo settle behind the mask before we reveal.
                window.setTimeout(function () {
                    if (term) {
                        term.write('\x1b[2J\x1b[H');
                    }
                    if (sock) {
                        sock.send(JSON.stringify({ 'data': '\r' }));
                    }
                    removeSerialMask();
                }, 400);
            } else if (outcome === "fail") {
                if (term) {
                    term.write('\x1b[2J\x1b[H');
                }
                if (sock) {
                    sock.send(JSON.stringify({ 'data': '\r' }));
                }
                removeSerialMask();
            } else if (outcome === "reconnect") {
                // Reconnected to a detected live shell (no login prompt). It's a known shell, so it's
                // safe to size it to the current grid — the session adopts the current window size —
                // then a Ctrl-L redraw so it repaints cleanly at the new size.
                if (sock && serialGrid) {
                    sock.send(JSON.stringify({ 'data': 'stty rows ' + serialGrid.rows + ' cols ' + serialGrid.cols + '\r' }));
                }
                if (sock) {
                    sock.send(JSON.stringify({ 'data': '\f' }));
                }
                window.setTimeout(removeSerialMask, 400);
            } else {
                // Auto-login timed out with no recognized prompt: unknown state (could be a full-screen
                // app), so do NOT send stty — just nudge a redraw with Ctrl-L (a serial line never
                // repaints on attach) and lift the mask once the redraw has had a moment to arrive.
                if (sock) {
                    sock.send(JSON.stringify({ 'data': '\f' }));
                }
                window.setTimeout(removeSerialMask, 400);
            }
        }

        // Driven from term_write with each decoded output chunk. No-op unless auto-login is active.
        // The prompt detection itself lives in the pure, unit-tested serialLoginNextAction; this
        // just accumulates the console tail and performs the side effects (type creds / finish).
        function feedSerialLogin(text) {
            if (serialLoginState === "off" || serialLoginState === "done") {
                return;
            }
            serialBuffer = (serialBuffer + text).slice(-1024);
            switch (serialLoginNextAction(serialLoginState, serialBuffer)) {
                case "username":
                    // A login prompt appeared and we're typing creds — now it's genuinely a sign-in.
                    $status.text("Signing in...");
                    sock.send(JSON.stringify({ 'data': connectionInfo.username + '\r' }));
                    serialLoginState = "awaitingPassword";
                    serialBuffer = "";
                    break;
                case "password":
                    sock.send(JSON.stringify({ 'data': connectionInfo.password + '\r' }));
                    serialLoginState = "awaitingResult";
                    serialBuffer = "";
                    break;
                case "success":
                    finishSerialLogin("success");
                    break;
                case "fail":
                    finishSerialLogin("fail");
                    break;
                case "reveal":
                    // serialLoginNextAction returns "reveal" only when it detects a live shell prompt
                    // on attach (reconnect to an existing session) — a known shell, so size it.
                    finishSerialLogin("reconnect");
                    break;
            }
        }

        sock.onopen = function () {
            
            term.open(terminalDomElement, true);
            state = CONNECTED;

            if (connectionInfo.powershell) {
                //mask to hide the powershell startup
                let $mask = $("<div style='background-color:#000; top:0; bottom:0; left:0; right: 0; position:absolute; z-index:2;'></div>");
                $mask.appendTo(terminalDomElement);
                sock.send(JSON.stringify({ 'data': 'pwsh' + '\r' })); //powershell on linux
                window.setTimeout(() => {
                    sock.send(JSON.stringify({ 'data': 'powershell' + '\r' })); //powershell on windows
                    window.setTimeout(() => {
                        sock.send(JSON.stringify({ 'data': 'clear' + ' \r' }));
                        window.setTimeout(() => {
                            $status.text("");
                            $mask.remove();
                        }, 2000);                        
                    }, 500);
                }, 500);
            } else if (connectionInfo.serialConsole) {
                // xterm 2.x measures the char cell on a deferred tick (CharMeasure schedules it via
                // setTimeout), and the serial console's first byte routinely beats it — so the shared
                // first-data resize runs before the cell is measured, current_geometry() comes back
                // NaN, and the grid stays stuck at xterm's 80x24 default. Take the serial path off that
                // one-shot resize and re-fit here once the measurement is ready. Serial-only: the
                // SSH / cloud / PowerShell paths keep their existing first-data resize untouched.
                term.resized = true;
                (function fitWhenReady(attempts) {
                    const g = current_geometry();
                    if (isFinite(g.cols) && isFinite(g.rows) && g.cols > 0 && g.rows > 0) {
                        serialGrid = g;
                        term.on_resize(g.cols, g.rows);
                    } else if (attempts < 40) {
                        window.setTimeout(function () { fitWhenReady(attempts + 1); }, 25);
                    }
                })(0);
                // Neutral status for the readiness/attach window — true whether or not we end up
                // auto-signing-in. It's upgraded to "Signing in..." only once we actually start
                // typing creds (see feedSerialLogin), so reconnecting to a live shell or a timeout
                // never falsely claims a sign-in. For the no-creds path, onmessage clears it on the
                // first byte and nudges a clean login prompt.
                $status.text("Connecting to serial console...");
                if (serialAutoLogin) {
                    // Mask the login exchange; feedSerialLogin (or the timeout) lifts the mask.
                    $serialMask = $("<div style='background-color:#000; top:0; bottom:0; left:0; right:0; position:absolute; z-index:2;'></div>");
                    $serialMask.appendTo(terminalDomElement);
                    serialLoginTimer = window.setTimeout(function () { finishSerialLogin("reveal"); }, 6000);
                }
            } else {
                $status.text("");
            }
        };

        sock.onmessage = function (msg) {
            if (connectionInfo.serialConsole && !serialPrimed) {
                // First bytes are virsh console's attach banner ("Connected to domain... / Escape
                // character..."). Drop it and send a carriage return so getty redraws a clean prompt
                // (which also feeds auto-login). A serial line does not repaint, so dropping the
                // banner is safe for a login console — the \r re-summons the prompt regardless.
                serialPrimed = true;
                if (!serialAutoLogin) {
                    $status.text("");
                }
                sock.send(JSON.stringify({ 'data': '\r' }));
                return;
            }
            read_file_as_text(msg.data, term_write, decoder);
        };

        sock.onerror = function (e) {
            console.error(e);
        };

        sock.onclose = function (e) {
            // Stop any in-flight serial auto-login before teardown: lift the mask and cancel the
            // timeout so a mid-login disconnect reveals the terminal immediately (never trapped
            // behind the overlay), and so this connection's pending timer can't fire against the
            // torn-down socket after a reconnect spins up a fresh one.
            serialLoginState = "done";
            if (serialLoginTimer) {
                window.clearTimeout(serialLoginTimer);
                serialLoginTimer = null;
            }
            removeSerialMask();
            term.destroy();
            term = undefined;
            sock = undefined;
            $status.text("Disconnected");
            console.error(e.reason ? e.reason : "Disconnected");
            state = DISCONNECTED;
            if (reconnect) {         
                reconnect = false;
                getConnectionInfo();
            }
        };
    }

    let getConnectionInfo = function (attempts) {
        if (state == CONNECTED) {
            console.info("Already connected");
            return;
        }
        if (state == CONNECTING) {
            console.info("Connection already underway");
            return;
        }
        state = CONNECTING;
        // KVM serial console mints a per-session host credential server-side; the SSH-to-guest and
        // VM-endpoint paths use the existing connection-info endpoint. Distinct routes keep the two
        // features separate (a serial session never carries an endpointId).
        let url;
        if (connectionInfo.serialConsole) {
            url = "/VirtualizationClient/GetSerialConsoleInfo/" + connectionInfo.labInstanceKey + "/" + connectionInfo.machineId;
        } else {
            url = "/VirtualizationClient/GetSshConnectionInfo/" + connectionInfo.labInstanceKey + "/" + connectionInfo.machineId;
            if (connectionInfo.endpointId) {
                url += "?endpointId=" + connectionInfo.endpointId;
            }
        }
        $status.text('Connecting...');
        $.ajax({
            url: url,
            type: "POST",
            dataType: 'json',
            data: { __RequestVerificationToken: model.antiforgeryToken },
            cache: false
        }).always(function (response) {
            if (!response?.Success) {
                state = DISCONNECTED;
                let error = `Failed to get SSH connection info. `;
                if (response?.Error) {
                    error += response.Error;
                }
                console.error(error);
                attempts = attempts == null ? 1 : attempts + 1;
                if (response?.Recoverable && attempts < 60) {
                    console.info(`Will retry getting SSH connection information in 5 seconds.`);
                    window.setTimeout(function () {
                        getConnectionInfo(attempts);
                    }, 5000);
                } else {
                    $status.text('Failed to connect.');                    
                }
                return;
            }

            connectToSession(response);
        });
    };

    this.connect = function () {
        getConnectionInfo();
    };

    this.disconnect = function () {
        if (state === CONNECTED) {
            sock.close();
        }
    };

    this.reconnect = function () {
        if (state === CONNECTED) {
            reconnect = true;
            this.disconnect();
        } else {
            this.connect();
        }
    };

    this.resize =function () {
        if (term) {
            resize_terminal(term);
        }
    };

    this.show = function () {
        $status.show();
        terminalDomElement.style.display = "";
    };

    this.hide = function () {
        $status.hide();
        terminalDomElement.style.display = "none";
    };

    this.getConnectionState = function () {
        return state;
    };

    this.write = function (text) {
        if (term) {
            sock.send(JSON.stringify({ 'data': text }));
            term.focus();
        }
    }; 

    this.writeLine = function(text) {
        this.write(text + '\r');
    };

    this.sendCtrlZ = function () {
        this.write(''); //this is not an empty string, though it may appear that way in your text editor :-)
    };

    this.getScreenDataUrl = async function () {
        if (state !== CONNECTED || !term || !terminalDomElement) {
            return { ok: false, canvas: null, reason: "not_available" };
        }
        try {
            const canvas = await rasterizeTerminal(terminalDomElement);
            // Duck-type rather than `instanceof HTMLCanvasElement`: terminals
            // hosted in a pop-out window's document produce a canvas rooted
            // in that window's realm, which fails the wrapper's instanceof
            // check even though the canvas is valid. Structural detection
            // works across realms.
            if (!canvas || typeof canvas.toDataURL !== "function" || typeof canvas.getContext !== "function") {
                return { ok: false, canvas: null, reason: "capture_failed" };
            }
            return { ok: true, canvas: canvas, reason: null };
        } catch (e) {
            console.error('SshClient.getScreenDataUrl failed', e);
            return { ok: false, canvas: null, reason: "capture_failed" };
        }
    };

    this.sendCtrlC = function () {
        this.write(''); //this is not an empty string, though it may appear that way in your text editor :-)
    };

}
