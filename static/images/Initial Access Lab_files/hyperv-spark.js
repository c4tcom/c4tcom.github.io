function remoteControllerRequiresMachineIds() {
    return true;
}

function remoteControllerRequiresRdpInfo() {
    return false;
}

function RemoteController(connInfo, onConn, onDiscon, onSizeCh) {
    let connectionInfo = connInfo;
    this.machineId = connectionInfo.machineId;
    let onConnected = onConn;
    let onDisconnected = onDiscon;
    let onSizeChanged = onSizeCh;

    const SHIFT_KEY = 42;
    const BREAK_KEY = 197;
    const ALT_KEY = 56;
    const CTRL_KEY = 29;   

    let rdp;
    let initialized = false;
    let currentMachine;
    let keyboard;
    let autologonInProgress = false;
    let connected = false;
    let shadowing = false;
    let shadowUserName = "";
    let bypassShadow = false;
    let $sparkViewWrapper = null;   
    let viewOnly = false;
    let multipleDisplayWindows = [];    

    this.initialize = function() {
        if (initialized) {
            return;
        }       
        initialized = true;
        let $vmWrapper = $("#vmWrapper");
        $sparkViewWrapper = $(`<div id='sparkViewWrapper-${connectionInfo.machineId}' class="sparkViewWrapper" style="text-align:left; position:relative; overflow:hidden;"></div>`);
        $vmWrapper.append($sparkViewWrapper);
        svGlobal.log = 0;
        keyboard = getKeyboardValue();

    }

    this.getSize = function() {
        let $canvas = $sparkViewWrapper.find("canvas");
        return { width: $canvas.width(), height: $canvas.height() };
    }

    let postConnectionTimeout = null;
    let connectionAttempts = 0;
    let intentionalDisconnect = false;

    this.disconnect = function() {
        try {
            intentionalDisconnect = true;
            if (rdp) {
                dropInputFor(rdp);
                rdp.close();
                rdp = null;
            }
            currentMachine = null;
            window.clearTimeout(postConnectionTimeout);
        } catch (e) {
            console.error('Error disconnecting:', e);
        }
    }

    function getKeyboardValue() {
        //cultures names: http://www.csharp-examples.net/culture-names/
        //all keyboard layout values: HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Keyboard Layouts
        switch (connectionInfo.language.toLowerCase()) {
            case "bg": //Bulgarian
                return 0x402;
            case "cs": //Czech
                return 0x405;
            case "da": //Danish
                return 0x406;
            case "de-de": //German
            case "de":
                return 1031;
            case "de-at": //German (Austrian)
                return 0xc07;
            case "de-ch": //German (Switzerland)
                return 2055;
            case "el":
            case "el-gr": //Greek
                return 0x408;
            case "us-EN": //English (US)
                return 1033;
            case "en-au": //English (Australia)
                return 0xc09;
            case "en-ca": //English (Canada)
                return 0x1009;
            case "en-gb": //English (United Kingdom)
                return 2057;
            case "en-ie": //English (Ireland)
                return 0x1809;
            case "en-nz": //English (New Zealand)
                return 0x1409;
            case "es":
            case "es-es": //Spanish (Spain)
                return 1034;
            case "es-mx": //Spanish (Mexico)
                return 2058;
            case "es-gt": //Spanish (Guatemala)
                return 4106;
            case "es-cr": //Spanish (Costa Rica)
                return 5130;
            case "es-pa": //Spanish (Panama)
                return 6154;
            case "es-do": //Spanish (Dominican Republic)
                return 7178;
            case "es-ve": //Spanish (Venezuela)
                return 8202;
            case "es-co": //Spanish (Colombia)
                return 9226;
            case "es-pe": //Spanish (Peru)
                return 10250;
            case "es-ar": //Spanish (Argentina)
                return 11274;
            case "es-ec": //Spanish (Ecuador)
                return 12298;
            case "es-cl": //Spanish (Chile)
                return 13322;
            case "es-ur": //Spanish (Uruguay)
                return 14346;
            case "es-py": //Spanish (Paraguay)
                return 15370;
            case "es-bo": //Spanish (Bolivia)
                return 16394;
            case "es-sv": //Spanish (El Salvador)
                return 17418;
            case "es-hn": //Spanish (Honduras)
                return 18442;
            case "es-ni": //Spanish (Nicaragua)
                return 19466;
            case "es-pr": //Spanish (Puerto Rico)
                return 20490;
            case "fi": //Finnish
            case "fi-fi":
                return 0x40b;
            case "fr": //French
            case "fr-fr":
                return 1036;
            case "fr-be": //French (Belgium)
                return 2060;
            case "fr-ca": //French (Canada)
                return 4105;
            case "fr-ch": //French (Switzerland)
                return 4108;
            case "hr": //Croatian
                return 0x41a;
            case "hu-hu": //Hungarian
            case "hu":
                return 0x40e;
            case "is-is": //Icelandic
            case "is":
                return 0x40f;
            case "it": //Italian
                return 1040;
            case "it-ch": //Italian (Swiss)
                return 0x810;
            case "ja": //Japanese
            case "ja-JP":
                return 3758162961;
            case "ko": //Korean
                return 3758162962;
            case "nl-be": //Dutch (Belgian)
                return 0x413;
            case "nl": //Dutch (Standard)
                return 0x407;
            case "nb-NO": //Norwegian (Bokmal)
            case "no":
                return 1044;
            case "nn-NO": //Norwegian (Nynorsk)
                return 2068;
            case "pl": //Polish
            case "pl-pl":
                return 0x415;
            case "pt": //Portuguese
            case "pt-pt":
                return 0x816;
            case "pt-br": //Portuguese(Brazilian)
                return 0x416;
            case "ro-ro": //Romanian
            case "ro":
                return 0x418;
            case "ru-RU": //Russian (Russia)
            case "ru":
                return 1049;
            case "sk": //Slovakian
            case "sk-sk":
                return 0x41b;
            case "sl": //Slovenian
            case "sl-si":
                return 0x424;
            case "sv-SE": //Swedish
            case "sv":
                return 1053;
            case "tr": //Turkish
            case "tr-tr":
                return 0x41f;
            default: //us-EN
                return 1033;
        }
    }

    let desiredMachine;
    let connectingMachine;

    // svGlobal.Rdp2 (rdp_min.js) unconditionally builds its connection URL as
    // "<gateway>/RDP?<params>" -- there's no branch in it for a join/shadow connection.
    // The Rdp constructor's own mode detection looks for a literal "/JOIN?" substring to
    // recognize a join and to skip its wsPost URL-shrinking (which otherwise strips every
    // param -- including `name` -- off the initial connection and defers them to a
    // follow-up frame). Routing a join through Rdp2 by appending "/JOIN" onto the gateway
    // string still connects (the gateway's own path routing tolerates "/JOIN/RDP?"), but it
    // never produces that literal "/JOIN?" substring, so the client-side mode detection
    // misses it, the params get stripped off the initial request, and the cursor label on
    // the joined session falls back to showing the connecting IP instead of `name`.
    // This mirrors Rdp2's own logic (same helpers: getServerArgs, obj2url) but targets
    // "/JOIN?" instead, so a join produces the same single-request shape a plain connect
    // does -- just against the join endpoint instead of the connect endpoint.
    function createJoinRdp(session) {
        let args = svGlobal.util.getServerArgs(session) || session;
        let gatewayHost = args.gateway || "";
        let useSSL = 1 == args.useSSL || "true" == args.useSSL || "on" == args.useSSL || null;
        let width = args.width ? parseInt(args.width, 10) : 0;
        let height = args.height ? parseInt(args.height, 10) : 0;
        let color = 16;
        if (args.color) color = parseInt(args.color, 10);
        if (args.server_bpp) color = parseInt(args.server_bpp, 10);
        let query = hi5.browser.obj2url(args);
        if (null === useSSL) useSSL = "https:" == location.protocol;
        return new svGlobal.Rdp((useSSL ? "wss://" : "ws://") + gatewayHost + "/JOIN?" + query, width, height, color);
    }

    function connect(machine) {
        
        if (machine === null) {
            return;
        }

        //console.log("Request for connection to " + machine.DisplayName + " Id = " + machine.Id);
        if (!machine.AllowDesktopConnections) {
            console.info("This machine does not allow desktop connections.");
            return;
        }

        try {
            intentionalDisconnect = false;
            if (desiredMachine !== machine) {
                connectionAttempts = 0;
            }
            if (currentMachine == machine && connected) {
                console.info("Already connected to " + machine.DisplayName);
                return;
            }
            
            desiredMachine = machine;
            window.clearTimeout(postConnectionTimeout);
            if (connectingMachine) {
                //console.log("There is already a connecting machine (" + connectingMachine.DisplayName + ") will connect " + desiredMachine.DisplayName + " when possible.");
                return;
            }
            if (rdp && rdp.running()) {
                //console.log("disconnecting from " + currentMachine.DisplayName);
                dropInputFor(rdp);
                rdp.close();
                rdp = null;
            }
            connectingMachine = machine;
            let gateway = connectionInfo.rdpHtml5GatewayAddress;
            let session = null;
            let isJoinConnection = false;
            if (shadowing && !bypassShadow) {
                if (!machine.RdpSessionId) {
                    //We are shadowing, but don't have a session to connect to. We will 1) try to get one, then either connect to what we find or create a new one
                    getFreshRdpSessionId(machine, null, 3000, 0, function (newRdpSessionId) {
                        if (labConsole.getSelectedMachine()?.ProfileId === machine.ProfileId && !connected) { //ensure the vm hasn't been changed.
                            if (newRdpSessionId) {
                                console.info("Found an RDP session to shadow.");
                            } else {
                                //still no session available
                                console.info("User session not available to shadow. Creating a new session.");
                                bypassShadow = true;
                            }
                            connect(machine);
                        }
                    });
                    currentMachine = null;
                    connectingMachine = null;
                    return;
                }
                isJoinConnection = true;
                session = {
                    keyboard: keyboard,
                    gateway: gateway,
                    name: shadowUserName,
                    id: connectingMachine.RdpSessionId
                };
                if (connectingMachine.RdpGatewayAppId) {
                    session.appId = connectingMachine.RdpGatewayAppId;
                }
                console.info("Shadowing " + connectingMachine.DisplayName + ", RDP session ID = " + connectingMachine.RdpSessionId + ", gateway app ID = " + connectingMachine.RdpGatewayAppId);
            } else {
                session = {
                    keyboard: keyboard,
                    gateway: gateway,
                    server: connectionInfo.internalConsoleAddress,
                    port: connectionInfo.internalConsolePort,
                    width: connectingMachine.Width,
                    height: connectingMachine.Height,
                    vmid: connectingMachine.Id,
                    user: connectionInfo.serverAccountName,
                    pwd: connectionInfo.serverAccountPassword,
                    name: shadowUserName
                };

                if (model.recordRdpSession) {
                    session.sessionRecord = 1;
                    session.__record_name = model.orgId + "/" + model.labInstanceId + "/" + connectingMachine.ProfileId;
                }

                if (connectingMachine.UseEnhancedSessionMode) {
                    session.vmid += ";EnhancedMode=1";
                    session.mapClipboard = model.showPasteLinks && connectingMachine.RedirectClipboard;
                    session.playSound = connectingMachine.RedirectAudioOutput ? 0 : 2; //bring to local = 0
                    session.soundPref = 1; //1 = high quality, 0 = low quality

                    session.performanceflags = 0x02 | 0x04 | 0x08 | 0x20;
                    if (!connectingMachine.AllowDesktopWallpaper) {
                        session.performanceflags = session.performanceflags | 0x01;
                    }
                    if (connectingMachine.EnableFontSmoothing) {
                        session.performanceflags = session.performanceflags | 0x80;
                    }
                    
                    if (!shadowing) {
                        session.audioRecord = connectingMachine.CaptureAudioInput ? "on" : "off";
                        session.mapCamera = connectingMachine.RedirectDevices;
                        session.smartcard = connectingMachine.RedirectSmartCards ? "on" : "off";
                        //session.mapDisk = connectingMachine.RedirectDevices;
                    }
                    //session.server_bpp = connectingMachine.ColorDepth;
                    let size = labConsole.getVmWrapperSize();
                    session.width = size.width;
                    session.height = size.height;
                }
                console.info("Connecting to " + connectingMachine.DisplayName + " w=" + session.width + " h=" + session.height);
            }
            let canvasId = `vm-canvas-${connectionInfo.machineId}`;
            $(`#${canvasId}`).remove();
            let $canvas = $(`<canvas id="${canvasId}" width="800" height="600" style="outline: none; background-color:#000;"></canvas>`);
            $canvas.appendTo($sparkViewWrapper);
            let newRdp = isJoinConnection ? createJoinRdp(session) : new svGlobal.Rdp2(session);
            window.sparkMouse.trackLockKeys(newRdp);
            let localInterface = new svGlobal.LocalInterface($canvas[0]);              

            //Use the CTRL+ALT+BREAK key combo to escape focus from the vm
            let _keyHistory = [];
            localInterface.onscancode = function (down, scancode) {
                let len = _keyHistory.length;
                let isBreak = scancode === BREAK_KEY || scancode === SHIFT_KEY;
                let hit = false;

                //29 = ctrl, 56 = alt
                isBreak = (scancode !== CTRL_KEY && scancode !== ALT_KEY);
                if (isBreak) {
                    let preisCtrlAltDown = len > 1 &&
                        _keyHistory[len - 2].scancode === CTRL_KEY && _keyHistory[len - 2].down &&
                        _keyHistory[len - 1].scancode === ALT_KEY && _keyHistory[len - 1].down;
                    let preisAltCtrlDown = len > 1 &&
                        _keyHistory[len - 2].scancode === ALT_KEY && _keyHistory[len - 2].down &&
                        _keyHistory[len - 1].scancode === CTRL_KEY && _keyHistory[len - 1].down;
                    hit = preisCtrlAltDown || preisAltCtrlDown;
                }

                _keyHistory.push({ 'down': down, 'scancode': scancode });
                if (len > 20) {
                    _keyHistory.splice(0, 10);//remove the first 10
                }

                if (hit) {
                    localInterface.getInputElement().element.blur();
                    $('#machineCommands').focus();
                }
            };

            newRdp.addSurface(localInterface);

            if (multipleDisplayWindows.length > 0) {

                localInterface.configMonitor = function () {
                    const left = 0;
                    const top = 0;
                    const width = session.width;
                    const height = session.height;
                    localInterface.setMonitor(left, top, width + left - 1, height + top - 1);
                };

                let $container = $sparkViewWrapper.parent();
                let primaryMonitorX = window.screenX;
                let primaryMonitorY = window.screenY + $container.offset().top;

                const leftDisplays = [];
                const rightDisplays = [];
                const topDisplays = [];
                const bottomDisplays = [];

                for (let multipleDisplayWindow of multipleDisplayWindows) {
                    const multipleDisplayWindowInfo = multipleDisplayWindow.getWindowInfo();

                    let xDelta = Math.abs(multipleDisplayWindowInfo.x - primaryMonitorX);
                    let yDelta = Math.abs(multipleDisplayWindowInfo.y - primaryMonitorY);

                    if (xDelta >= yDelta) {
                        if (multipleDisplayWindowInfo.x < primaryMonitorX) {
                            leftDisplays.push({ info: multipleDisplayWindowInfo, window: multipleDisplayWindow });
                        } else {
                            rightDisplays.push({ info: multipleDisplayWindowInfo, window: multipleDisplayWindow });
                        }
                    } else if (multipleDisplayWindowInfo.y < primaryMonitorY) {
                        topDisplays.push({ info: multipleDisplayWindowInfo, window: multipleDisplayWindow });
                    } else {
                        bottomDisplays.push({ info: multipleDisplayWindowInfo, window: multipleDisplayWindow });
                        console.log("bottom added")
                    }
                }

                leftDisplays.sort((a, b) => b.info.x - a.info.x);
                let leftMonitorOffset = 0;
                for (let leftDisplay of leftDisplays) {
                    leftDisplay.window.hideSetupScreen();
                    const leftDisplaySurface = leftDisplay.window.getSurface();
                    let tempOffset = leftMonitorOffset;
                    leftDisplaySurface.configMonitor = function () {
                        const left = -leftDisplay.info.width - tempOffset - 1;
                        const top = leftDisplay.info.y - primaryMonitorY;
                        const width = leftDisplay.info.width;
                        const height = leftDisplay.info.height;
                        leftDisplaySurface.setMonitor(left, top, width + left - 1, height + top - 1);
                    };
                    newRdp.addSurface(leftDisplaySurface);
                    leftMonitorOffset += leftDisplay.info.width;
                }

                rightDisplays.sort((a, b) => a.info.x - b.info.x);
                let rightMonitorOffset = session.width;
                for (let rightDisplay of rightDisplays) {
                    rightDisplay.window.hideSetupScreen();
                    const rightDisplaySurface = rightDisplay.window.getSurface();
                    let tempOffset = rightMonitorOffset;
                    rightDisplaySurface.configMonitor = function () {
                        const left = tempOffset + 1;
                        const top = rightDisplay.info.y - primaryMonitorY;
                        const width = rightDisplay.info.width;
                        const height = rightDisplay.info.height;
                        rightDisplaySurface.setMonitor(left, top, width + left - 1, height + top - 1);
                    };
                    newRdp.addSurface(rightDisplaySurface);
                    rightMonitorOffset += rightDisplay.info.width;
                }

                topDisplays.sort((a, b) => b.info.y - a.info.y);
                let topMonitorOffset = 0;
                for (let topDisplay of topDisplays) {
                    topDisplay.window.hideSetupScreen();
                    const topDisplaySurface = topDisplay.window.getSurface();
                    let tempOffset = topMonitorOffset;
                    topDisplaySurface.configMonitor = function () {
                        const left = topDisplay.info.x - primaryMonitorX;
                        const right = left + topDisplay.info.width - 1;
                        const bottom = -tempOffset - 1;
                        const top = bottom - topDisplay.info.height;
                        topDisplaySurface.setMonitor(left, top, right, bottom);
                    }
                    newRdp.addSurface(topDisplaySurface);
                    topMonitorOffset += topDisplay.info.height;
                }

                bottomDisplays.sort((a, b) => a.info.y - b.info.y);
                let bottomMonitorOffset = session.height;
                for (let bottomDisplay of bottomDisplays) {
                    bottomDisplay.window.hideSetupScreen();
                    const bottomDisplaySurface = bottomDisplay.window.getSurface();
                    let tempOffset = bottomMonitorOffset;
                    bottomDisplaySurface.configMonitor = function () {
                        const left = bottomDisplay.info.x - primaryMonitorX;
                        const right = left + bottomDisplay.info.width - 1;
                        const top = tempOffset + 1;
                        const bottom = top + bottomDisplay.info.height;
                        bottomDisplaySurface.setMonitor(left, top, right, bottom);
                    }
                    newRdp.addSurface(bottomDisplaySurface);
                    bottomMonitorOffset += bottomDisplay.info.height;
                }
            }

            if (viewOnly) {
                $sparkViewWrapper.find("#wsinput").hide();
            }

            newRdp.onerror = function (e) {
                //
            }

            newRdp.onclose = function () {
                window.clearTimeout(postConnectionTimeout);
                dropInputFor(newRdp);

                if ((!shadowing || bypassShadow) && connectingMachine === machine && connected === false && connectionAttempts < 5 && labConsole.getSelectedMachine()?.ProfileId === machine.ProfileId) {
                    connectionAttempts += 1;
                    console.warn("Connection failed... retrying attempt " + connectionAttempts);
                    connectingMachine = null;
                    labConsole.refreshMachineIds(function () {
                        connect(machine);
                    });
                    return;
                }

                console.info("disconnected");

                if (newRdp === rdp) {
                    connected = false;
                }

                if (onDisconnected) {
                    onDisconnected({ machineId: connectionInfo.machineId });
                }
                
                if (shadowing && !bypassShadow) {
                    //console.log("Shadow of session " + session.id + " ended");
                    //let's see if the current machine is still active in the client and a new session has started. This indicates the student has reconnected.
                    getFreshRdpSessionId(machine, session.id, 3000, 0, function (newSessionId) {
                        if (labConsole.getSelectedMachine()?.ProfileId === machine.ProfileId && !connected) { //ensure student hasn't switched machines
                            if (newSessionId !== session.id) { //we have a new session to connect to
                                console.info("A new RDP session exists to shadow.");
                                //console.log("Found session to shadow " + machine.RdpSessionId);
                            } else {
                                console.info("User session not available. Reconnecting to a fresh session.");
                                bypassShadow = true;
                            }
                            connect(machine);
                        }
                    });
                }
                bypassShadow = false;
                if (machine === currentMachine && !connected) {
                    currentMachine = null;
                }
                if (machine === connectingMachine) {
                    connectingMachine = null;
                }
                if (!shadowing && !connected && !intentionalDisconnect && connectionAttempts < 5 && labConsole.getSelectedMachine()?.ProfileId === machine.ProfileId) {
                    connectionAttempts += 1;
                    let delay = connectionAttempts * 2000;
                    console.info("Disconnected. Refreshing machine IDs and retrying attempt " + connectionAttempts + " in " + (delay / 1000) + "s");
                    window.setTimeout(function () {
                        labConsole.refreshMachineIds(function () {
                            connect(machine);
                        });
                    }, delay);
                } else {
                    connectionAttempts = 0;
                }
            };

            newRdp.onsessionstart = function (sessionInfo) {
                bypassShadow = false;
                if (connectingMachine !== desiredMachine) {
                    connectingMachine = null;
                    connect(desiredMachine);
                    return;
                }
                currentMachine = connectingMachine;
                connectingMachine = null;
                currentMachine.lastAttemptedScreenWidth = null;
                currentMachine.lastAttemptedScreenHeight = null;
                rdp = newRdp;
                connected = true;

                postConnectionTimeout = window.setTimeout(function () {
                    if ((rdp === null || !rdp.running()) && connectionAttempts < 5) {
                        connected = false;
                        connectionAttempts += 1;
                        console.info("Disconnect detected. Attempting reconnect " + connectionAttempts);
                        connect(machine);
                    } else {
                        connectionAttempts = 0;
                    }
                }, 1000);
                if (onConnected) {                    
                    onConnected({ machineId: connectionInfo.machineId, rdpSessionId: sessionInfo.appInfo.session, rdpGatewayAppId: sessionInfo.appInfo.appId });
                    console.info("Connected to session: " + sessionInfo.appInfo.session + ", gateway app ID: " + sessionInfo.appInfo.appId);
                }
                if (!autologonInProgress && currentMachine.UseEnhancedSessionMode && currentMachine.AttemptAutoLogon) {
                    autologonInProgress = true;
                    window.setTimeout(function () {
                        if (!autologonInProgress) { return; }
                        window.sparkMouse.writeTypedText(newRdp, currentMachine.Password);
                        window.setTimeout(function () {
                            if (!autologonInProgress) { return; }
                            newRdp.writeKeyCode(true, 13);
                            newRdp.writeKeyCode(false, 13);
                            autologonInProgress = false;
                        }, 200);
                    }, 1500);
                }
            };
            newRdp.onresolutionchange = function (w, h) {
                //console.log("logged rez change: w:" + w + " h:" + h);
                if (currentMachine) {
                    currentMachine.Width = w;
                    currentMachine.Height = h;
                }
                if (onSizeChanged) {
                    onSizeChanged(w, h);
                }
            };
            newRdp.run();
        } catch (e) {
            console.error("Connection error: " + e);
            connectingMachine = null;
        }
    }

    this.connect = connect; //allow external access to this function

    this.reconnect = function (machine) {
        if (currentMachine) {
            currentMachine = null;
            this.connect(machine);
        } else {
            this.connect(machine);
        }
    }

    function getFreshRdpSessionId(machine, currentRdpSessionId, maxWaitTime, timeWaited, callback) {
        window.setTimeout(function () {
            timeWaited += 100;
            labConsole.getMachineRdpSessionId(machine.ProfileId, function (newSessionId) {
                if (newSessionId !== currentRdpSessionId) { //we have a new session to connect to
                    console.log('New session found after ' + timeWaited + "ms");
                    if (callback) callback(newSessionId);
                } else {
                    if (timeWaited < maxWaitTime) { //we'll wait for up to 3 seconds
                        getFreshRdpSessionId(machine, currentRdpSessionId, maxWaitTime, timeWaited, callback); //we haven't reached our timeout yet, try again
                    } else {
                        if (callback) callback(newSessionId); //end of the line
                    }
                }
            });
        }, 100);
    }

    this.setViewOnly = function (v) {
        viewOnly = v;
        if ($sparkViewWrapper == null) return;
        if (viewOnly) {
            $sparkViewWrapper.find("#wsinput").hide();
        } else {
            $sparkViewWrapper.find("#wsinput").show();
        }
    }

    this.setSize = function (width, height) {
        if (currentMachine && currentMachine.UseEnhancedSessionMode && multipleDisplayWindows.length === 0) {
            let result = rdp.reconnect(width, height);
            if (result) {
                window.setTimeout(function () { labConsole.refreshVmWrapperLayout(); }, 2000);
            }
        }
    }

    this.hide = function() {
        $sparkViewWrapper.hide();
    }

    this.show = function() {
        $sparkViewWrapper.show();
    }

    this.sendCtrlAltDelete = function() {
        try {
            rdp.writeKeyComb("Ctrl+Alt+Del");
        } catch (e) {
            //
        }
    }

    this.sendAltTab = function() {
        try {
            rdp.writeKeyComb("Alt+Tab");
        } catch (e) {
            //
        }
    }

    this.getConnectionState = function () {
        return connected ? 1 : 0;
    }

    this.getValidScreenSize = function(width, height) {
        return { width: width, height: height };
    }

    this.canSendText = function() {
        return currentMachine != null && currentMachine.UseEnhancedSessionMode;
    }

    this.connectedToEnhancedSessionOrRdp = function () {
        return connected && currentMachine.UseEnhancedSessionMode;
    }

    // Text, keys and the mouse go out one after another, in the order asked for, see spark-mouse.js.
    // Spark sends paced keys from a single queue that the next paced write replaces, while an
    // unpaced key goes out at once, so input asked for while text is still going out waits for
    // Spark to report the text done. A session that closes mid-typing never reports it, which is
    // why what waits for a session is dropped once it closes.
    let queuedInput = null;

    function inputQueue() {
        if (queuedInput === null) {
            queuedInput = window.sparkMouse.inputQueue();
        }
        return queuedInput;
    }

    // Returns whether the queue took the keys.
    function writeKeysAfterTyping(combo, onSent, onStart) {
        return inputQueue().add(rdp, function (session) {
            session.writeKeyComb(combo);
            return 0;
        }, onSent, onStart);
    }

    // Input still waiting to go into a session that closes is dropped.
    function dropInputFor(session) {
        if (queuedInput !== null && session) {
            queuedInput.close(session);
        }
    }

    // The Spark name of each key joined into one combination, or null when a key has none. Only
    // space, digits and letters go out as their own character.
    function keyComboName(keys) {
        const names = keys.map(function (key) {
            return getKeyName(key) || (key === 32 || (key >= 48 && key <= 57) || (key >= 65 && key <= 90) ? String.fromCharCode(key) : null);
        });
        return names.length > 0 && names.every(Boolean) ? names.join("+") : null;
    }

    // Spark's gap between paced keys, which it types pastes and typed text with.
    const PACED_MS_PER_KEY = 100;

    // Whether the student's pastes may go through the VM's clipboard.
    function sharesClipboard() {
        return Boolean(model.showPasteLinks && currentMachine?.RedirectClipboard);
    }

    // Pastes the text through the session's clipboard once its turn comes.
    function pasteThroughClipboard(text) {
        return function (session, done) {
            session.writeClipboard(text);
            session.writeKeyComb("Ctrl+V", PACED_MS_PER_KEY, done);
        };
    }

    // Text goes into a connected session only.
    this.sendText = function (text, canUseVmClipboard) {
        $sparkViewWrapper.find("#wsinput").focus();
        if (!rdp || !connected) {
            return;
        }
        if (canUseVmClipboard && sharesClipboard()) {
            inputQueue().paste(rdp, pasteThroughClipboard(text), 1, PACED_MS_PER_KEY);
        } else if (text.length > 0) {
            // Spark reports an empty paced write neither started nor done.
            inputQueue().paste(rdp, function (session, done) {
                window.sparkMouse.writeTypedText(session, text, PACED_MS_PER_KEY, done);
            }, text.length, PACED_MS_PER_KEY);
        }
    }

    // Text typed into a connected session only, as sendText types it, but behind the input asked
    // for before it rather than in place of text still typing, and never replaced. It goes as one
    // key press per character, except that text too long to type in reasonable time is pasted
    // through the clipboard where the student's pastes may use it, see
    // sparkMouse.pastesTypedText. options.neverClipboard keeps it to key presses whatever its
    // length.
    this.typeKeys = function (text, options) {
        $sparkViewWrapper.find("#wsinput").focus();
        // Spark reports an empty paced write neither started nor done.
        if (typeof text !== "string" || !rdp || !connected || text.length === 0) {
            return;
        }
        if (window.sparkMouse.pastesTypedText(text, sharesClipboard(), options)) {
            inputQueue().type(rdp, pasteThroughClipboard(window.sparkMouse.withClipboardLineBreaks(text)), 1, PACED_MS_PER_KEY);
            return;
        }
        inputQueue().type(rdp, function (session, done) {
            window.sparkMouse.writeTypedText(session, text, PACED_MS_PER_KEY, done);
        }, text.length, PACED_MS_PER_KEY);
    }

    // How long the pastes and typed text still going into the session can hold up the input asked
    // for after them.
    this.pacedTimeAhead = function () {
        return rdp ? inputQueue().pacedTimeAhead(rdp) : 0;
    }

    this.pressEnter = function () {
        if (rdp) {
            inputQueue().addText(rdp, function (session) {
                session.writeKeyComb("Enter");
                return 0;
            });
        }
    }

    // Returns whether the console took the keys; onStart, when given, hears once when they start
    // going out, and onSent once whether they went out.
    this.pressKeys = function (keys, onSent, onStart) {
        const combo = keyComboName(keys);
        if (!rdp || !connected || combo === null) {
            return false;
        }
        return writeKeysAfterTyping(combo, onSent, onStart);
    }

    // Whether count more of the mentor's keys or gestures would all be taken.
    this.canTakeInput = function (count) {
        return inputQueue().canTake(rdp, count);
    }

    // gesture: a mentor's mouse gesture in remote pixels, see spark-mouse.js. Returns whether the
    // console took it; onStart, when given, hears once when it starts going out, and onSent once
    // whether its last step went out.
    this.useMouse = function (gesture, onSent, onStart) {
        const steps = window.sparkMouse.steps(gesture);
        if (!rdp || !connected || viewOnly || steps === null) {
            return false;
        }
        const controller = this;
        return inputQueue().add(rdp, window.sparkMouse.gestureSender(gesture, steps, function () { return controller.getScreenDataUrl(); }), onSent, onStart);
    }

    this.sendWindowsKey = function (additionalKey) {
        if (connected) {
            if (!additionalKey) {
                rdp.writeKeyComb("Windows");
            } else {
                let winCombo = "Windows+";
                let key = String.fromCharCode(additionalKey);
                winCombo += "+" + key
                rdp.writeKeyComb(winCombo);
            }
        }
    }

    function getKeyName(keyCode) {
        if (keyCode === 45) {
            return "Insert";
        }
        if (keyCode === 9) {
            return "Tab";
        }
        if (keyCode === 27) {
            return "Esc";
        }
        if (keyCode === 112) {
            return "F1";
        }
        if (keyCode === 113) {
            return "F2";
        }
        if (keyCode === 114) {
            return "F3";
        }
        if (keyCode === 115) {
            return "F4";
        }
        if (keyCode === 116) {
            return "F5";
        }
        if (keyCode === 117) {
            return "F6";
        }
        if (keyCode === 118) {
            return "F7";
        }
        if (keyCode === 119) {
            return "F8";
        }
        if (keyCode === 120) {
            return "F9";
        }
        if (keyCode === 121) {
            return "F10";
        }
        if (keyCode === 122) {
            return "F11";
        }
        if (keyCode === 123) {
            return "F12";
        }
        if (keyCode === 91 || keyCode === 92) {
            return "Windows";
        }
        if (keyCode === 17) {
            return "Ctrl";
        }
        if (keyCode === 18) {
            return "Alt";
        }
        if (keyCode === 16) {
            return "Shift";
        }
        if (keyCode === 46) {
            return "Del";
        }
        if (keyCode === 35) {
            return "End";
        }
        if (keyCode === 9) {
            return "Tab";
        }
        if (keyCode === 36) {
            return "Home";
        }
        if (keyCode === 8) {
            return "Backspace";
        }
        if (keyCode === 13) {
            return "Enter";
        }
        if (keyCode === 33) {
            return "PageUp";
        }
        if (keyCode === 34) {
            return "PageDown";
        }
        if (keyCode === 37) {
            return "Left";
        }
        if (keyCode === 38) {
            return "Up";
        }
        if (keyCode === 39) {
            return "Right";
        }
        if (keyCode === 40) {
            return "Down";
        }
    }

    this.sendKeyCombo = function (keys) {
        if (keys === null || keys.length === 0) return;
        let combo = "";
        for (let key of keys) {
            if (combo.length > 0) {
                combo += "+";
            }
            let keyName = getKeyName(key);
            if (keyName) {
                combo += keyName;
            } else {
                combo += String.fromCharCode(key);
            }
        }
        rdp.writeKeyComb(combo);

        $sparkViewWrapper.find("#wsinput").focus();
    }

    this.keyPress = function (key) {
        if (key === 45) {
            rdp.writeKeyComb("Insert");
            return;
        }

        rdp.writeKeyCode(true, key);
        rdp.writeKeyCode(false, key);
    }

    this.keyDown = function (key) {
        rdp.writeKeyCode(true, key);       
    }

    this.keyUp = function (key) {
        rdp.writeKeyCode(false, key);
    }

    this.resizeAfterConnectDelay = 100;
    this.supportsEsmOrRdp = true;
    this.supportsShadowing = true;
    this.supportsAutoFocus = true;

    this.setShadowing = function(enabled, name) {
        shadowing = enabled;
        shadowUserName = name
    }

    this.canSendWindowsKey = function()  {
        return true;
    }

    this.limitedScreenSizes = function() {
        return currentMachine != null && !currentMachine.UseEnhancedSessionMode;
    }

    this.focus = function() {
        $sparkViewWrapper.find("#wsinput").focus();
    }

    this.setAutoFocus = function(enabled) {
        hi5.appcfg.autoFocus = enabled;
    }

    this.addMultipleDisplayWindow = function (window) {
        multipleDisplayWindows.push(window);
    }

    this.removeMultipleDisplayWindow = function (windowName, reconnect) {
        const filteredList = multipleDisplayWindows.filter(item => item.name !== windowName);
        if (filteredList.length != multipleDisplayWindows.length) {
            multipleDisplayWindows = filteredList;
            if (reconnect) {
                this.reconnect(currentMachine);
            }
        }
    }

    this.getNumberOfDisplays = function () {
        return multipleDisplayWindows.length + 1;
    }

    this.getMultipleDisplayWindows = function () {
        return multipleDisplayWindows;
    }

    this.getScreenDataUrl = function () {
        if (!connected) { return null; }
        return $sparkViewWrapper.find("canvas")[0];
    }
}
