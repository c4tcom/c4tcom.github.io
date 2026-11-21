if (typeof window.LabClientConfig === "undefined") {
    throw new Error("lab-client.js: window.LabClientConfig is missing; check the Razor bootstrap block in LabClient.cshtml.");
}

var consoleWrapper;
var consoleWindow;
var instructionsWrapper;
var instructionsWidth = LabClientConfig.instructionsWidth;
let instructionsPanelCollapsed = false;
var instructionsLabClient;
var instructionsLoaded = false;
var consoleLoaded = false;
var externalInstructionsWindow = null;
var layoutVersion = LabClientConfig.labLayoutVersionId;
var isRtl = false;

$(function () {
    consoleWrapper = document.getElementById("consoleWrapper");
    instructionsWrapper = document.getElementById("instructionsWrapper");
    instructionsWrapper.style.width = instructionsWidth + "px";
    consoleWrapper.style.width = ($(window).width() - instructionsWidth) + "px";
    consoleWindow = document.getElementById("consoleIFrame").contentWindow;
    isRtl = window.getComputedStyle(document.getElementById('consoleWrapper'), null).getPropertyValue('direction') === "rtl";

    setSplitterAriaValue(instructionsWidth, $(window).width());

    $("#fullScreenMessage").on("keydown", function (e) {
        if (!$("#fullScreenMessage").is(":visible"))
            return;
        if (e.which === 27) { //esc
            $("#fullScreenMessage").find(".escape").click();
        }

        if (e.which === 9) { //tab
            const $focusable = $("#fullScreenMessage").find('a[href]:not([tabindex^="-"]), area[href]:not([tabindex^="-"]), input:not([type="hidden"]):not([type="radio"]):not([disabled]):not([tabindex^="-"]), input[type="radio"]:not([disabled]):not([tabindex^="-"]):checked, select:not([disabled]):not([tabindex^="-"]), textarea:not([disabled]):not([tabindex^="-"]), button:not([disabled]):not([tabindex^="-"]), iframe:not([tabindex^="-"]), audio[controls]:not([tabindex^="-"]), video[controls]:not([tabindex^="-"]), [contenteditable]:not([tabindex^="-"]), [tabindex]:not([tabindex^="-"])').filter(":visible");
            if ($focusable.length === 0) {
                e.preventDefault();
                return;
            }
            if (e.shiftKey && document.activeElement === $focusable[0]) {
                e.preventDefault();
                $focusable[$focusable.length - 1].focus();
            } else if (!e.shiftKey && document.activeElement === $focusable[$focusable.length - 1]) {
                e.preventDefault();
                $focusable[0].focus();
            }
        }
    });

    $("#splitter").draggable({
        helper: "clone",
        appendTo: "body",
        iframeFix : true,
        axis: "x",
        zIndex: 10,
        scroll: false,
        start: function () {

        },
        drag: function (event, ui) {
            const totalWidth = $(window).width();
            const offsetWidth = isRtl ? totalWidth - ui.offset.left : ui.offset.left;
            let consoleWidth = offsetWidth;
            if (consoleWidth < 300) { consoleWidth = 300; }
            if (totalWidth - consoleWidth < 300) { consoleWidth = Math.max(300, totalWidth - 300); }
            consoleWrapper.style.width = consoleWidth + "px";
            instructionsWidth = $(window).width() - consoleWidth;
            instructionsWrapper.style.width = instructionsWidth + "px";
        },
        stop: function () {
            if (instructionsWidth == null || isNaN(instructionsWidth) || instructionsWidth < 0) { return;}
            setSplitterAriaValue(instructionsWidth, $(window).width());
            const url = "/VirtualizationClient/ChangeNavBarWidth/" + LabClientConfig.labId + "?width=" + instructionsWidth;
            $.ajax({
                type: "POST",
                dataType: "json",
                data: {},
                cache: false,
                url: url
            }).always(function (response) {
            });
        }
    });

    $(".splitter-handle").on("keydown", function(e) {
        let totalWidth = $(window).width(),
            consoleWidth = totalWidth - instructionsWidth,
            distance = 10; //pixels moved on each press

        // Reposition if one of the directional keys is pressed
        switch (e.keyCode) {
            case 37:
            case 38: consoleWidth -= distance; break; // Left/Up
            case 39:
            case 40: consoleWidth += distance; break; // Right/Down
            default: return true; // Exit and bubble
        }

        // The minimum width of each frame is 250px
        consoleWidth = Math.min(Math.max(250, consoleWidth), totalWidth - 250);
        consoleWrapper.style.width = consoleWidth + "px";
        instructionsWidth = totalWidth - consoleWidth;
        instructionsWrapper.style.width = instructionsWidth + "px";
        setSplitterAriaValue(instructionsWidth, totalWidth);

        // Don't scroll page
        e.preventDefault();
    });

        //for zoom change detection
    let px_ratio = window.devicePixelRatio || window.screen.availWidth / document.documentElement.clientWidth;

    function isZooming() {
        const newPx_ratio = window.devicePixelRatio || window.screen.availWidth / document.documentElement.clientWidth;
        if (newPx_ratio !== px_ratio) {
            px_ratio = newPx_ratio;
            return true;
        } else {
            return false;
        }
    }

    $(window).resize(function () {
        if (externalInstructionsWindow == null) {
            const windowWidth = $(window).width();
            if (instructionsPanelCollapsed) {
                consoleWrapper.style.width = "100%";
            } else {
                consoleWrapper.style.width = (windowWidth - instructionsWidth) + "px";
                setSplitterAriaValue(instructionsWidth, windowWidth);
            }
        }
        // Call unconditionally so px_ratio keeps tracking DPI across a rejoin.
        const zoomed = isZooming();
        // Skip while split: the panel is in another window, so rebalancing width
        // here leaves empty space on the right of the console.
        if (externalInstructionsWindow == null && zoomed && !instructionsPanelCollapsed) {
            const consoleWrapperWidth = $(consoleWrapper).width();
            if (consoleWrapperWidth < 300) {
                console.log("Environment area too small upon zoom change, resizing to 300px.");
                consoleWrapper.style.width = "300px";
                instructionsWidth = $(window).width() - 300;
                instructionsWrapper.style.width = instructionsWidth + "px";
            } else {
                instructionsWidth = $(window).width() - consoleWrapperWidth;
                if (instructionsWidth < 300) {
                    console.log("Instructions area too small upon zoom change, resizing to 300px.");
                    instructionsWidth = 300;
                    instructionsWrapper.style.width = instructionsWidth + "px";
                    consoleWrapper.style.width = ($(window).width() - instructionsWidth) + "px";
                }
            }
        }
    });

    $(window).on("unload", function () {
        if (externalInstructionsWindow != null) {
            externalInstructionsWindow.close();
            if (window.opener && resizedForExternalInstructionsWindow) {
                if (!screenIsMaximized() && !screenIsMinimized()) {
                    window.resizeBy(instructionsWidth, 0);
                }
                resizedForExternalInstructionsWindow = false;
            }
        }
    });

    $("#closeWindow").click(function () {
        try {
            window.close();
        } catch (e) {
            //
        }
    });
});

function copyableClicked(element) {
    const $element = $(element);
    const text = $element.text();
    $("#copyInput").show();
    $("#copyInput").val(text).select();
    const offset = $element.offset();
    const x = offset.left;
    const y = offset.top - 40;
    try {
        const successful = document.execCommand("copy");
        if (successful) {
            showClickFeedbackMessage(LabClientConfig.localization.copiedToClipboard, x, y, 2000);
        } else {
            showClickFeedbackMessage(LabClientConfig.localization.copyingWasUnsuccessful, x, y, 2000);
        }
    } catch (err) {
        showClickFeedbackMessage(LabClientConfig.localization.copyingWasUnsuccessful, x, y, 2000);
        console.log("Unable to copy. " + err);
    }
    $("#copyInput").hide();
}

function showClickFeedbackMessage(text, x, y, duration) {
    const $message = $("<div class='clickFeedbackMessage noselect' role='alert'>" + text + "</div>");
    $message.appendTo($("body")).hide();
    $message.css({ left: x, top: y });
    $message.fadeIn("fast");
    window.setTimeout(function () {
        $message.fadeOut("fast", function () { $message.remove(); });
    }, duration);
}

function isClientWrapper() {
    return true;
}

// True when a notification from the hidden embedded instructions iframe will be
// routed to the console: panel collapsed and not split. When split, the external
// window owns instructions notifications, so the embedded iframe must stay silent.
function notificationRoutesToConsole() {
    return layoutVersion === 2
        && instructionsPanelCollapsed
        && externalInstructionsWindow == null;
}

function updateTimer(minutesRemaining, isShareExpiration) {
    instructionsLabClient.updateTimer(minutesRemaining, isShareExpiration);
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.updateTimer(minutesRemaining, isShareExpiration);
    }
}

function showNotification(notification, persistent, id) {
    // Normalize the legacy (content, persistent, id) shape to an object so buttons
    // / autocloseTimeout survive whichever frame renders it. Treat as an
    // already-built notification when it's an object with content OR buttons
    // (a buttons-only action prompt has no content); matches the console frame's
    // normalizeNotification so the two agree on shape.
    const notificationObj = (notification && typeof notification === "object" && (notification.content || notification.buttons))
        ? notification
        : { content: notification, persistent: persistent, id: id };

    // Collapsed v2 panel: instructions are hidden, so render in the console frame.
    if (layoutVersion === 2
        && instructionsPanelCollapsed
        && consoleLoaded
        && consoleWindow
        && consoleWindow.labConsole
        && consoleWindow.labConsole.renderNotificationLocally) {
        consoleWindow.labConsole.renderNotificationLocally(notificationObj);
        return;
    }
    // renderNotificationLocally, not showNotification: the latter delegates back
    // up to this wrapper when it's a child client, which would loop.
    const renderInInstructions = instructionsLabClient.renderNotificationLocally
        ? instructionsLabClient.renderNotificationLocally
        : instructionsLabClient.showNotification; // fallback for older instructions frames
    renderInInstructions(notificationObj);
}

var fullScreenMessageShown;

function showFullScreenMessage(options) {
    if (consoleLoaded && consoleWindow && consoleWindow.labConsole && consoleWindow.labConsole.prepareForFullScreenMessage) {
        consoleWindow.labConsole.prepareForFullScreenMessage();
    }
    const $dialog = $("#fullScreenMessage");
    $dialog.show();
    fullScreenMessageShown = true;
    if (options) {
        $("#fullScreenMessageTitle").html(options.title ? options.title : "").removeAttr("tabindex");
        $("#fullScreenMessageText").html(options.message ? options.message : "");
        if (options.showLoadingImage) {
            $("#fullScreenMessage").addClass("withLoadingImage");
        } else {
            $("#fullScreenMessage").removeClass("withLoadingImage");
        }
        const $buttonWrapper = $("#fullScreenMessageButtonWrapper");
        if (options.buttons || (options.showCloseWindowButton && window.opener)) {
            $buttonWrapper.show();
            if (options.showCloseWindowButton && window.opener) {
                $("#closeWindow").show();
                if (options.buttons) {
                    $("#closeWindow").removeClass("primary");
                } else {
                    $("#closeWindow").addClass("primary");
                }
            } else {
                $("#closeWindow").hide();
            }
            const $buttons = $("#fullScreenMessageButtons");
            $buttons.html("");
            if (options.buttons) {
                for (let i = 0; i < options.buttons.length; i++) {
                    const button = options.buttons[i];
                    const $button = $('<input type="button" value="' + button.text + '" />');
                    if (button.click) {
                        $button.click(button.click);
                    }
                    if (button.primary) {
                        $button.addClass("primary");
                    }
                    if (button.escape) {
                        $button.addClass("escape");
                    }
                    $buttons.append($button);
                }
            }
            $buttonWrapper.find("input.escape").focus();
        } else {
            $buttonWrapper.hide();
            $("#fullScreenMessageTitle").attr("tabindex", "0");
            $("#fullScreenMessageTitle")[0].blur(); //in case title already had focus, we need to remove focus so screen readers pick up the change in text
            $("#fullScreenMessageTitle")[0].focus();
        }
        if (options.open) {
            options.open();
        }
    }
    return {
        close: close,
        getElementById: function (elementId) {
            const $element = $dialog.find("#" + elementId);
            if ($element.length > 0) return $element[0];
            return null;
        }
    };
}

function hideFullScreenMessage() {
    if (instructionsLoaded && consoleLoaded) {
        $("#fullScreenMessage").hide();
        fullScreenMessageShown = false;
        consoleWindow.labConsole.recoverFromFullScreenMessage();
        instructionsLabClient.setupKnowledgeExpanders();
    }
}

function getFullScreenMessage() {
    return $("#fullScreenMessage");
}

var complete = false;
var closing = false;

function labIsComplete() {
    if (complete === true) return;
    complete = true;
    $("#modalDialog").remove();
    if (externalInstructionsWindow != null) {
        externalInstructionsWindow.close();
        instructionsLabClient = document.getElementById("instructionsIFrame").contentWindow.labClient;
    }
    consoleWindow.labConsole.labIsComplete();
    instructionsLabClient.labIsComplete();
    if (window.opener) {
        try {
            window.opener.postMessage("labDone", "*");
        } catch (e) {
            //
        }
    }
    try {
        if (window.parent && window.parent.labIsComplete) {
            window.parent.labIsComplete();
        }
    } catch (e) {

    }
}

function getHelpExtensionsPlaceHolder() {
    return instructionsLabClient.getHelpExtensionsPlaceHolder();
}

function getMainMenuExtensionsPlaceHolder() {
    return instructionsLabClient.getMainMenuExtensionsPlaceHolder();
}

function getResourcesExtensionsPlaceHolder() {
    return instructionsLabClient.getResourcesExtensionsPlaceHolder();
}

function getDeveloperToolsMenu() {
    return instructionsLabClient.getDeveloperToolsMenu();
}

function getFullScreenProgressWrapper() {
    return $("#fullScreenProgressWrapper");
}

function getFullScreenMessageContainer() {
    return $("#fullScreenMessage");
}

function consoleHasLoaded() {
    consoleLoaded = true;
    if (instructionsLoaded && consoleWindow?.labConsole?.instructionsHaveLoaded) {
        consoleWindow.labConsole.instructionsHaveLoaded();
    }
    // Catches up to the zoom already active; later changes arrive via applyInstructionsZoom.
    if (consoleWindow?.labConsole?.applyZoom) {
        consoleWindow.labConsole.applyZoom(instructionsZoom);
    }
    return instructionsLabClient.consoleHasLoaded();
}

var resizedForExternalInstructionsWindow = false;
var instructionsScrollTop = null;
var instructionsZoom = 100;

function instructionsHaveLoaded() {
    instructionsLoaded = true;
    const instructionsFrameWindow = document.getElementById("instructionsIFrame").contentWindow;
    instructionsLabClient = instructionsFrameWindow.labClient;
    // The wrapper pages own the theme script call for the instructions frame. consoleHasLoaded
    // runs it only for a virtualization client, once its console loads, so any other lab runs it here.
    if (!instructionsLabClient.getLabData()?.IsVirtualizationClient) {
        instructionsFrameWindow.initializeThemeScript?.();
    }
    // Catches up to the zoom the iframe already restored on load; later
    // changes arrive via applyInstructionsZoom, called from its setZoom().
    applyInstructionsZoom(instructionsLabClient.getZoom());
    document.getElementById("consoleIFrame").src = LabClientConfig.consoleUrl;
    window.setTimeout(function () {
        if (!consoleLoaded ) {
            showFullScreenMessage({ title: ":-(", message: "The virtualization client could not be loaded" })
        };
    }, 10000);
    const isIeOrEdge = navigator.userAgent.indexOf('Trident') >= 0 || navigator.userAgent.indexOf('Edge') >= 0;
    if (!isIeOrEdge) {
        const mainMenuExtensionsPlaceHolder = getMainMenuExtensionsPlaceHolder();
        if (layoutVersion === 1) {
            mainMenuExtensionsPlaceHolder.append($('<div id="splitWindows" tabindex="0" role="button" class="menuItem link-list-item split-windows-link icon-link">' + LabClientConfig.localization.splitWindows + '</div>'));
        } else {
            mainMenuExtensionsPlaceHolder.append($('<div class="link-list-item"><a id="splitWindows" href="#" class="split-windows-link icon-link">' + LabClientConfig.localization.splitWindows + '</a></div>'));
        }
        mainMenuExtensionsPlaceHolder.find("#splitWindows").on("click keypress", function (e) {
            if (!a11yClick(e)) return;
            splitWindows();
        });
    }
    if (consoleLoaded) {
         consoleWindow.labConsole.instructionsHaveLoaded();
    }
}

window.setTimeout(function () {
    if (!instructionsLoaded) {
        showFullScreenMessage({ title: ":-(", message: "The instructions window could not be loaded" })
    };
}, 10000);

function splitWindows() {
    instructionsLabClient.closeSettingsMenu();
    instructionsScrollTop = instructionsLabClient.getInstructionsScrollTop();
    instructionsZoom = instructionsLabClient.getZoom();
    let left = window.screenX + $(document).outerWidth();
    if (window.opener) {
        left -= instructionsWidth;
    }
    externalInstructionsWindow = window.open(LabClientConfig.instructionsWindowUrl, "instructions", "resizable=1, left=" + left + ", top=" + window.screenY + ", width=" + instructionsWidth + ", height=" + window.innerHeight);
    externalInstructionsWindow.focus();
    hideInstructionsForExternalWindow();
}

function hideInstructionsForExternalWindow() {
    instructionsWrapper.style.display = "none";
    consoleWrapper.style.width = "100%";
    $("#splitter").hide();
    // Splitting supersedes a collapsed panel: instructions move to the external
    // window, so route notifications there, not the console.
    instructionsPanelCollapsed = false;
    if (window.opener && !resizedForExternalInstructionsWindow) {
        window.resizeBy(-instructionsWidth, 0);
        resizedForExternalInstructionsWindow = true;
    }
    notifyConsoleSplitState(true);
}

function notifyConsoleSplitState(isSplit) {
    const consoleIFrame = document.getElementById("consoleIFrame");
    if (consoleIFrame && consoleIFrame.contentWindow) {
        consoleIFrame.contentWindow.postMessage({ action: "splitWindowStateChanged", isSplit: isSplit }, "*");
    }
}

function joinWindows() {
    const windowToClose = externalInstructionsWindow;
    externalInstructionsClosing();
    if (windowToClose && !windowToClose.closed) {
        windowToClose.close();
    }
}

function getInstructionsResourcesPlaceHolder() {
    return document.getElementById("instructionsIFrame").contentWindow.labClient.getResourcesExtensionsPlaceHolder().html();
}

function externalInstructionsWindowLoaded() {
    if (externalInstructionsWindow == null) { //most likely, the user has reloaded the instructions window, so we must re-establish the window reference
        externalInstructionsWindow = window.open("", "instructions");
        if (!externalInstructionsWindow) { return; }
        hideInstructionsForExternalWindow();
    }
    const externalInstructionsLabClient = externalInstructionsWindow.getInstructionsFrameContentWindow().labClient;
    const externalResourcesContainer = externalInstructionsLabClient.getResourcesExtensionsPlaceHolder();
    const localInstructionsLabClient = document.getElementById("instructionsIFrame").contentWindow.labClient;
    const localResources = localInstructionsLabClient.getResourcesExtensionsPlaceHolder();
    localResources.children().each(function () {
        externalResourcesContainer.append(this);
    });
    const externalHelpItems = externalInstructionsLabClient.getHelpExtensionsPlaceHolder();
    const localHelpItems = localInstructionsLabClient.getHelpExtensionsPlaceHolder();
    localHelpItems.children().each(function () {
        externalHelpItems.append(this);
    });
    instructionsLabClient = externalInstructionsLabClient; //swap our active "instructionsLabClient" reference for the one in the external window rather than the one in the local iframe
    localInstructionsLabClient.splitWindowOpened();
    window.setTimeout(function () {
        instructionsLabClient.setZoom(instructionsZoom);
        instructionsLabClient.setInstructionsScrollTop(instructionsScrollTop);
    }, 1);
}

function getInstructionsWindow() {
    if (externalInstructionsWindow != null) {
        return externalInstructionsWindow.getInstructionsFrameContentWindow();
    }
    return document.getElementById("instructionsIFrame").contentWindow;
}

function screenIsMaximized() {
    return screen.availWidth - window.innerWidth === 0;
}

function screenIsMinimized() {
    return document.hidden === true;
}

function externalInstructionsClosing() {
    if (externalInstructionsWindow == null) return;
    let externalInstructionsPageIndex = 0;
    let externalInstructionsScrollTop = 0;
    let externalInstructionsZoom = 100;
    let externalInstructionsLastCompletedTaskIndex = 0;
    let externalInstructionsCompletedTasksJson = null;

    const externalLabClient = externalInstructionsWindow.getInstructionsFrameContentWindow().labClient;
    const resources = externalLabClient.getResourcesExtensionsPlaceHolder();
    const newResources = document.getElementById("instructionsIFrame").contentWindow.labClient.getResourcesExtensionsPlaceHolder();
    resources.children().each(function () {
        newResources.append(this);
    });
    const externalHelpItems = externalLabClient.getHelpExtensionsPlaceHolder();
    const localHelpItems = document.getElementById("instructionsIFrame").contentWindow.labClient.getHelpExtensionsPlaceHolder();
    externalHelpItems.children().each(function () {
        localHelpItems.append(this);
    });
    externalInstructionsZoom = externalLabClient.getZoom(externalInstructionsScrollTop);
    externalInstructionsPageIndex = externalLabClient.getInstructionsPageIndex();
    externalInstructionsScrollTop = externalLabClient.getInstructionsScrollTop();
    externalInstructionsLastCompletedTaskIndex = externalLabClient.getLastCompletedTaskIndex();
    externalInstructionsCompletedTasksJson = externalLabClient.getCompletedTasksJson();

    if (fullScreenMessageShown && !labIsComplete) {
        hideFullScreenMessage();
    }
    externalInstructionsWindow = null;
    if (window.opener && resizedForExternalInstructionsWindow) {
        if (!screenIsMaximized() && !screenIsMinimized()) {
            window.resizeBy(instructionsWidth, 0);
        }
        resizedForExternalInstructionsWindow = false;
    }
    instructionsLabClient = document.getElementById("instructionsIFrame").contentWindow.labClient;
    instructionsWrapper.style.display = "block";
    instructionsPanelCollapsed = false;
    if (!instructionsWidth || instructionsWidth < 200) {
        instructionsWidth = LabClientConfig.instructionsWidth;
    }
    consoleWrapper.style.width = ($(window).width() - instructionsWidth) + "px";
    instructionsWrapper.style.width = instructionsWidth + "px";
    $("#splitter").show();
    notifyConsoleSplitState(false);

    instructionsLabClient.selectInstructionsPage(externalInstructionsPageIndex);
    instructionsLabClient.setLastCompletedTask(externalInstructionsLastCompletedTaskIndex);
    instructionsLabClient.setCompletedTasksJson(externalInstructionsCompletedTasksJson);
    window.setTimeout(function () {
        instructionsLabClient.setZoom(externalInstructionsZoom);
        instructionsLabClient.setInstructionsScrollTop(externalInstructionsScrollTop);
    }, 1);
}

function setNavigationTab(tab) {
    if (consoleHasLoaded) {
        consoleWindow.labConsole.setNavigationTab(tab);
    }
    instructionsLabClient.selectTab(tab);
}

function navigationTabChanged(tab) {
    if (consoleHasLoaded) {
        consoleWindow.labConsole.setNavigationTab(tab);
    }
    if (externalInstructionsWindow) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.selectTab(tab);
    }
}

function setTheme(themeName) {
    if (!themeName) return;
    $("#themeStylesheet").attr("href", "/css/" + themeName + ".css?v=9");
    instructionsLabClient.setTheme(themeName);
}

function themeChanged(themeName, themeId, themeStyleSheetUrl) {
    if (!themeName) return;
    if (themeStyleSheetUrl) {
        $("#themeStylesheet").attr("href", themeStyleSheetUrl);
        document.getElementById("consoleIFrame").contentWindow.labConsole.setTheme(themeName, themeStyleSheetUrl);
    } else {
        $("#themeStylesheet").attr("href", "/css/" + themeName + ".css?v=9");
        document.getElementById("consoleIFrame").contentWindow.labConsole.setTheme(themeName);
    }
    if (externalInstructionsWindow) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.setTheme(themeName);
    }
    if (window.opener) {
        try {
            window.opener.postMessage({ action: "setTheme", themeId: themeId }, "*");
        } catch (e) {
            //
        }
    }
}

function setVariables(variables) {
    instructionsLabClient.setVariables(variables);
}

function getLabData() {
    return instructionsLabClient.getLabData();
}

function addChildWindow(childWindow) {
    instructionsLabClient.addChildWindow(childWindow);
}

function setAndSaveLabVariable(name, val) {
    instructionsLabClient.setAndSaveVariable(name, val);
}

function getLabVariable(name) {
    return instructionsLabClient.getVariable(name);
}

window.onbeforeunload = function () {
    closing = true;
};

function childWindowClosing() {
    if (!complete && !closing) {
        closing = true;
        window.location.reload();
    }
}

function disableNavigationWarning() {
    instructionsLabClient.disableNavigationWarning();
    if (externalInstructionsWindow) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.disableNavigationWarning();
    }
}

function typeText(text, canUseVmClipboard) {
    if (canUseVmClipboard == null) canUseVmClipboard = false;
    consoleWindow.labConsole.typeText(text, canUseVmClipboard);
}

function sendKeyCombo(keys) {
    consoleWindow.labConsole.sendKeyCombo(keys);
}

function getSelectedMachine() {
    if (typeof consoleWindow?.labConsole?.getSelectedMachine !== 'function') return null;
    return consoleWindow.labConsole.getSelectedMachine();
}

function getVmSize() {
    return consoleWindow.labConsole.getVmSize();
}

function selectMachineById(id) {
    consoleWindow.labConsole.selectMachineById(id, true);
}

function selectEndpointById(id) {
    consoleWindow.labConsole.selectEndpointById(id, true);
}

function getMachineById(id) {
    return consoleWindow.labConsole.getMachineByProfileId(id);
}

function reconnectToSelectedMachine() {
    consoleWindow.labConsole.reconnectToSelectedMachine();
}

function loadOpticalMediaOnSelectedMachine(id) {
    consoleWindow.labConsole.loadOpticalMediaOnSelectedMachine(id);
}

function loadFloppyMediaOnSelectedMachine(id) {
    consoleWindow.labConsole.loadFloppyMediaOnSelectedMachine(id);
}

function executeCommandOnSelectedMachine(language, commandText) {
    consoleWindow.labConsole.executeCommandOnSelectedMachine(language, commandText);
}

function sendCtrlAltDelete() {
    consoleWindow.labConsole.sendCtrlAltDelete();
}

function fitWindowToConsole(width, height, callback) {
    width += $("#instructionsWrapper").outerWidth();
    const win = $(window);
    if (width !== win.width() || height !== win.height()) {
        window.resizeBy(-1, -1); //necessary if currently maximized.
        window.setTimeout(function () {
            const widthDelta = width - win.width();
            const heightDelta = height - win.height();
            window.resizeBy(widthDelta, heightDelta);
        }, 200);
        if (callback) { callback(); }
    }
}

function selectInstructionsPage(index) {
    instructionsLabClient.selectInstructionsPage(index);
}

function setLastCompletedTask(index) {
    instructionsLabClient.setLastCompletedTask(index);
}

function setCompletedTasksJson(completedTasksJson) {
    instructionsLabClient.setCompletedTasksJson(completedTasksJson);
}

function getInstructionsScrollTop() {
    return instructionsLabClient.getInstructionsScrollTop();
}

function setInstructionsScrollTop(y) {
    instructionsLabClient.setInstructionsScrollTop(y);
}

function getInstructionsZoom() {
    return instructionsLabClient.getZoom();
}

function setInstructionsZoom(zoom) {
    instructionsLabClient.setZoom(zoom);
}

// Called from the instructions iframe's setZoom(); v1 has no zoom feature so
// never calls this.
function applyInstructionsZoom(zoom) {
    if (layoutVersion === 1) return;
    instructionsZoom = zoom;
    $("body").css("font-size", zoom + "%");
    if (consoleLoaded && consoleWindow?.labConsole?.applyZoom) {
        consoleWindow.labConsole.applyZoom(zoom);
    }
}

function selectTab(id) {
    instructionsLabClient.selectTab(id);
}

function setNavigationBarWidth(width) {
    instructionsWidth = width;
    instructionsWrapper.style.width = instructionsWidth + "px";
    let windowWidth = $(window).width();
    consoleWrapper.style.width = (windowWidth - instructionsWidth) + "px";
    setSplitterAriaValue(width, windowWidth);
}

function setSplitterAriaValue(instructionsWidth, windowWidth) {
    let splitPercent = 100 - Math.round(100 * (instructionsWidth / windowWidth));
    $(".splitter-handle").attr("aria-valuenow", splitPercent);
}

function setInstructionsPanelCollapsed(collapsed) {
    instructionsPanelCollapsed = collapsed;
    if (collapsed) {
        instructionsWrapper.style.display = "none";
        $("#splitter").hide();
        consoleWrapper.style.width = "100%";
    } else {
        instructionsWrapper.style.display = "block";
        if (!instructionsWidth || instructionsWidth < 200) {
            instructionsWidth = LabClientConfig.instructionsWidth;
        }
        instructionsWrapper.style.width = instructionsWidth + "px";
        consoleWrapper.style.width = ($(window).width() - instructionsWidth) + "px";
        $("#splitter").show();
    }
}

function pauseServerSync(val) {
    consoleWindow.labConsole.pauseServerSync(val);
}

function a11yClick(event) {
    if (event.type === 'click') {
        return true;
    }
    else if (event.type === 'keypress') {
        const code = event.charCode || event.keyCode;
        if ((code === 32) || (code === 13)) {
            return true;
        }
        return false;
    }
    else {
        return false;
    }
}

function showDialog(options) {
    if (!options) return;
    let $dialog = $("#modalDialog");
    let isUpdatedContent = false;
    if ($dialog.length > 0) {
        $dialog.find(".dialogContent").html("");
        $dialog.find(".dialogButtons").html("");
        isUpdatedContent = true;
    } else {
        // v2: inherits zoom via body cascade (kept in sync by applyInstructionsZoom above).
        $dialog = $('<div id="modalDialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle" aria-describedby="dialogContent"><div class="dialogMask"></div><div class="dialogBox primary-color-border"><div class="dialog-header"><div id="dialogTitle" class="dialogTitle"></div><div class="dialogCloseButton" role="button" aria-label="Close" tabindex="0"></div></div><div id="dialogContent" class="dialogContent"></div><div class="dialogButtons"></div></div></div>');
        $dialog.keydown(function (e) {
            if (e.which === 27) { //esc
                close();
            }
            if (e.which === 9) { //tab
                const $focusable = $dialog.find('a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"], iframe#contentDialogIFrame').filter(":visible");
                if ($focusable.length === 0) return;
                if (e.shiftKey && document.activeElement === $focusable[0]) {
                    e.preventDefault();
                    $focusable[$focusable.length - 1].focus();
                } else if (!e.shiftKey && document.activeElement === $focusable[$focusable.length - 1]) {
                    e.preventDefault();
                    $focusable[0].focus();
                }
            }
        });
        $dialog.on("click keypress", ".dialogContent img, .dialogContent.imageLink", function (e) {
            if (!a11yClick(e)) return;
            let $this = $(this);
            if ($this.parent().is("a")) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            let imgUrl = $this.hasClass("imageLink") ? this.href : this.src;
            let url = "/Instructions/Image/" + getLabData().LabProfileId + "/?url=" + encodeURIComponent(imgUrl);
            if (this.title) {
                url += "&title=" + encodeURIComponent(this.title);
            }
            if (this.alt || this.text) {
                url += "&altText=" + encodeURIComponent(this.alt ? this.alt : this.text);
            }
            let imageWindow = window.open(url, "imageWindow", "menubar=no,location=no,resizable=yes,scrollbars=yes,status=no");
            addChildWindow(imageWindow);
            try {
                imageWindow.focus();
            } catch (e) {
                console.log("Error opening image window." + e);
            }
        });
    }
    const $dialogBox = $dialog.find(".dialogBox");
    const close = function () {
        if (options.suppressDefaultClose && options.close) {
            options.close();
        } else {
            const h = $dialogBox.outerHeight();
            const offset = $dialogBox.offset();
            $dialogBox.css("marginTop", 0).animate({ marginTop: -h - offset.top }, 300);
            $dialog.delay(200).fadeOut("fast", function () {
                $dialog.remove();
                if (options.close) {
                    options.close();
                }
            });
        }
    };
    $dialog.find(".dialogCloseButton").on("click keypress", function (e) {
        if (!a11yClick(e)) return;
        close();
        consoleWindow?.labConsole?.focusSelectedRemoteController?.();
    });

    if (options.minimumDisplaySeconds > 0) {
        const $closeButton = $dialog.find(".dialogCloseButton").hide();
        const $countDown = $("<div class='dialogCloseCountDown'>You can close this in " + options.minimumDisplaySeconds + " seconds...</div>").insertAfter($closeButton);
        let secondsSpent = 0;
        const closeDialogInterval = window.setInterval(function () {
            secondsSpent += 1;
            $countDown.html("You can close this in " + (options.minimumDisplaySeconds - secondsSpent) + " seconds...</div>");
            if (secondsSpent >= options.minimumDisplaySeconds) {
                window.clearInterval(closeDialogInterval);
                $countDown.hide();
                $dialog.find(".dialogCloseButton").show();
            }
        }, 1000);
    }

    if (options.title) {
        $dialog.find(".dialogTitle").html(options.title).show();
    } else {
        $dialog.find(".dialogTitle").hide();
        $dialog.addClass("noTitle");
    }
    if (options.content) {
        $dialog.find(".dialogContent").removeClass("noScroll").append(options.content);
    } else if (options.url) {
        const urlLower = options.url.toLowerCase();
        if (urlLower.indexOf(".mp4") !== -1) {
            $dialog.find(".dialogContent").removeClass("noScroll").append('<video src="' + options.url + '" controls autoplay></video>');
        } else if (urlLower.indexOf(".png") !== -1 || urlLower.indexOf(".jpg") !== -1 || urlLower.indexOf(".jpeg") !== -1 || urlLower.indexOf(".gif") !== -1) {
            $dialog.find(".dialogContent").removeClass("noScroll").append('<img src="' + options.url + '" controls alt="" /></iframe>');
        } else {
            $dialog.find(".dialogContent").addClass("noScroll").append('<iframe id="contentDialogIFrame" src="' + options.url + '" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>');
        }
    } else {
        $dialog.find(".dialogContent").hide();
    }
    if (options.buttons && options.buttons.length > 0) {
        $dialog.addClass("hasButtons");
        const $dialogButtons = $dialog.find(".dialogButtons");
        const numButtons = options.buttons.length;
        for (let i = 0; i < numButtons; i++) {
            const button = options.buttons[i];
            const $button = $('<input type="button" value="' + button.text + '" aria-label="' + button.text + '" />');
            if (button.click) {
                $button.click(button.click);
            }
            if (button.primary) {
                $button.addClass("primary");
            }
            if (button.closeDialog) {
                $button.click(close);
            }
            if (button.disabled) {
                $button.prop("disabled", true);
            }
            if (button.hidden) {
                $button.hide();
            }
            $dialogButtons.append($button);
        }
    }
    if (!isUpdatedContent) {
        $("body").append($dialog);
        $dialog.hide().fadeIn("fast", function () {
            setTimeout(
                function () {
                    const $inputs = $dialog.find(".dialogContent input");
                    if ($inputs.length > 0) {
                        $inputs[0].focus();
                    } else {
                        const $primaryButton = $dialog.find(".dialogButtons input.primary");
                        if ($primaryButton.length > 0) {
                            $primaryButton.focus();
                        } else {
                            $dialog.find(".dialogCloseButton").focus();
                        }
                    }
                    if (options.open) {
                        options.open();
                    }
                }, 100);

                $dialog.on("click keypress", ".copyable, code:not(.nocopy)", function (e) {
                    if (!a11yClick(e)) return;
                    if (e.offsetX > 0 && $(this).is("code") && $(this).parent().is("pre")) return; //for code blocks, only fire if the click is on the pseudo-element icon
                    copyableClicked(this);
                });

        });
        const h = $dialogBox.outerHeight();
        const offset = $dialogBox.offset();
        $dialogBox.css("marginTop", -h - offset.top).animate({ marginTop: 0 }, 400);
    } else if (options.open) {
        window.setTimeout(options.open, 1);
    }
    return {
        close: close,
        getElementById: function (elementId) {
            const $element = $dialog.find("#" + elementId);
            if ($element.length > 0) return $element[0];
            return null;
        },
        getElementByClass: function (elementClass) {
            const $element = $dialog.find("." + elementClass);
            if ($element.length > 0) return $element[0];
            return null;
        },
        setupDatepicker: function (elementId, options) {
            const $element = $dialog.find("#" + elementId);
            $element.datepicker(options);
        },
        setupTimepicker: function (elementId, options) {
            const $element = $dialog.find("#" + elementId);
            $element.timepicker(options);
        },
        getDateFromDatePicker: function (elementId) {
            const $element = $dialog.find("#" + elementId);
            return $element.datepicker("getDate");
        },
        getButtons: function () {
            return $dialog.find(".dialogButtons input[type='button']");
        },
        hideButtons: function () {
            return $dialog.find(".dialogButtons").hide();
        },
        showButtons: function () {
            return $dialog.find(".dialogButtons").show();
        },
        getContent: function () {
            return $dialog.find(".dialogContent");
        },
        show: function () {
            $dialog.show();
        },
        hide: function () {
            $dialog.hide();
        }
    };
}

function closeDialog(animate = true) {
    const $dialog = $("#modalDialog");
    if ($dialog.length == 0) { return; }
    const $dialogBox = $dialog.find(".dialogBox");
    const h = $dialogBox.outerHeight();
    const offset = $dialogBox.offset();
    if (animate) {
        $dialogBox.css("marginTop", 0).animate({ marginTop: -h - offset.top }, 300);
        $dialog.delay(200).fadeOut("fast", function () {
            $dialog.remove();
        });
    } else {
        $dialog.remove();
    }
}

function hideDialogIfVisible() {
    if($("#modalDialog").is(":visible")) {
        $("#modalDialog").hide();
    }
}

function showDialogIfHidden() {
    if($("#modalDialog").is(":hidden")) {
        $("#modalDialog").show();
    }
}

function dialogIsActive() {
    return $("#modalDialog").length > 0;
}

function showChooserDialog(options) {
    if (!options || !options.url) return;

    // v2: inherits zoom via body cascade (kept in sync by applyInstructionsZoom above).
    let dialogHtml = "<div id='chooserDialog' class='dialog hasButtons' role='dialog' aria-modal='true' aria-labelledby='dialogTitle'><div class='dialogMask'></div><div class='dialogBox'></iframe>";
    if (LabClientConfig.labLayoutVersionId === 2)
        dialogHtml += "<div class='dialog-header'><div class='dialogTitle'>Choose Lab Series</div><div class='dialogCloseButton' role='button' aria-label='" + LabClientConfig.localization.close + "' tabindex='0'></div></div>";
    else
        dialogHtml += "<div class='dialogCloseButton' role='button' aria-label='" + LabClientConfig.localization.close + "' tabindex='0'></div><div class='dialogTitle'></div>";
    dialogHtml += "<div class='dialogContent noScroll noPadding'><iframe class='contentDialogIFrame' style='width:100%;height:100%;border:none;' allowfullscreen></iframe></div><div class='dialogButtons'><input class='okButton primary' type='button' value='" + LabClientConfig.localization.ok + "' aria-label='" + LabClientConfig.localization.ok + "' /><input class='cancelButton' type='button' value='" + LabClientConfig.localization.cancel + "' aria-label='" + LabClientConfig.localization.cancel + "' /></div><div class='dialogTabTrapper' tabindex='0' /></div></div>";
    let $dialog = $(dialogHtml);

    const getChoices = function (e) {
        if (e.data && e.data.command === "getChoices") {
            if (options.choicesMade) {
                options.choicesMade(e.data.choices);
            }
        }
    };
    window.addEventListener("message", getChoices, false);
    const close = function () {
        $dialog.remove();
        window.removeEventListener("message", getChoices);
        if (options.close) {
            options.close();
        }
    };
    $dialog.find(".dialogCloseButton").on("click keypress", function (e) {
        if (!a11yClick(e)) return;
        close();
    });
    if (options.title) {
        $dialog.find(".dialogTitle").html(options.title).show();
    } else {
        $dialog.find(".dialogTitle").hide();
        $dialog.addClass("noTitle");
    }
    const $iframe = $dialog.find(".contentDialogIFrame");
    $iframe.attr("src", options.url);
    $dialog.find(".dialogButtons .okButton").click(function () {
        $iframe[0].contentWindow.postMessage({command:"getChoices"}, '*');
    });
    $dialog.find(".dialogButtons .cancelButton").click(function () {
        close();
    });
    $("body").append($dialog);
    const $primaryButton = $dialog.find(".dialogButtons input.primary");
    if ($primaryButton.length > 0) {
        $primaryButton.focus();
    } else {
        $dialog.find(".dialogCloseButton").focus();
    }
    if (options.open) {
        options.open();
    }
    return {
        close:close,
        show: function () {
            $dialog.show();
        },
        hide: function () {
            $dialog.hide();
        }
    };
}

function takeScreenshot(callback) {
    if (typeof consoleWindow?.labConsole?.getSelectedMachine !== 'function') {
        callback?.({ success: false, error: LabClientConfig.localization.sorryAnErrorOccurred });
        return;
    }
    const vm = consoleWindow.labConsole.getSelectedMachine();
    if (vm == null) {
        callback?.({ success: false, error: LabClientConfig.localization.sorryAnErrorOccurred });
        return;
    }
    try {
        const url = "/VirtualizationClient/TakeInstructionsScreenshot/" + LabClientConfig.labId + "?machineId=" + vm.ProfileId;
        $.ajax({
            type: "POST",
            dataType: "json",
            data: {},
            cache: false,
            url: url
        }).always((response) => {
            if (!response?.Success) {
                const error = response && response.Error ? response.Error : LabClientConfig.localization.sorryAnErrorOccurred;
                callback?.({ success: false, error });
                return;
            }
            callback?.({ success: true, url: response.Url });
        });
    } catch (e) {
        callback?.({ success: false, error: LabClientConfig.localization.sorryAnErrorOccurred });
    }
}

function getElementById(id) {
    return document.getElementById(id);
}

function instructionsUpdated(rawContent) {
    if (externalInstructionsWindow != null) {
        const instructionsFrameWindow = externalInstructionsWindow.getInstructionsFrameContentWindow();
        instructionsFrameWindow.postMessage({
            action: "updateInstructions",
            instructions: rawContent,
            bubbleToParent: false
        }, "*");
    }
}

function instructionsUpdatedFromSplitWindow(rawContent) {
    const instructionsFrameWindow = document.getElementById("instructionsIFrame").contentWindow;
    instructionsFrameWindow.postMessage({
        action: "updateInstructions",
        instructions: rawContent,
        bubbleToParent: false
    }, "*");
}

function getInstructionsEditWindow() {
    return document.getElementById("instructionsIFrame").contentWindow.labClient.getInstructionsEditWindow();
}

function startVirtualizationServerSync(pollInterval){
    consoleWindow.labConsole.startServerSync(pollInterval);
}

function setLabState(state) {
    consoleWindow.labConsole.setLabState(state);
    instructionsLabClient.setLabState(state);
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.setLabState(state);
    }
}

function selectContainerById(id) {
    consoleWindow.labConsole.selectContainerById(id, true);
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.containerSelected(id);
    }
}

function containerSelected(containerId) {
    instructionsLabClient.containerSelected(containerId);
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.containerSelected(containerId);
    }
}

function reconnectContainer(containerId) {
    consoleWindow.labConsole.reconnectContainer(containerId);
}

function openContainerInNewWindow(containerId) {
    consoleWindow.labConsole.openContainerInNewWindow(containerId);
}

function closeContainerWindow(containerId) {
    consoleWindow.labConsole.closeContainerWindow(containerId);
}

function containerWindowClosed(containerId) {
    instructionsLabClient.containerWindowClosed(containerId);
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.containerWindowClosed(containerId);
    }
}

function containerWindowOpened(containerId) {
    instructionsLabClient.containerWindowOpened(containerId);
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.containerWindowOpened(containerId);
    }
}

function getContainersOpenInSeparateWindow() {
    return consoleWindow.labConsole.getContainersOpenInSeparateWindow();
}

function setIgnoreVirtualMachineStateDuringSync(ignore) {
    consoleWindow.labConsole.setIgnoreVirtualMachineStateDuringSync(ignore);
}

function updateReplacementTokens() {
    instructionsLabClient.updateReplacementTokens();
    if (externalInstructionsWindow != null) {
        document.getElementById("instructionsIFrame").contentWindow.labClient.updateReplacementTokens();
    }
}

//for monitor page
var labConsole = {
    getConsoleSize: function () {
        if (!consoleLoaded) return null;
        const size = consoleWindow.labConsole.getConsoleSize();
        if (size == null) return null;
        size.width += $("#instructionsWrapper").outerWidth();
        return size;
    },
    refreshDisplay: function () {
        if (!consoleLoaded) return;
        consoleWindow.labConsole.refreshDisplay();
    }
};

function endLab(markComplete) {
    //always call the child instructions window for this particular call
    document.getElementById("instructionsIFrame").contentWindow.labClient.endLab(markComplete);
}

function saveLab() {
    //always call the child instructions window for this particular call
    document.getElementById("instructionsIFrame").contentWindow.labClient.saveLab();
}

function hideConsole() {
    consoleWrapper.style.display = "none";
    $("#instructionsWrapper").css("width", "100%");
    $("#splitter").hide();
    instructionsLabClient.integratedLayoutHidden();
}

function showConsole() {
    consoleWrapper.style.display = "block";
    instructionsWrapper.style.width = instructionsWidth + "px";
    $("#splitter").show();
    instructionsLabClient.integratedLayoutShown();
}

function openVirtualMachineInNewWindow(machineId) {
    consoleWindow.labConsole.openMachineInNewWindow(machineId);
}

function updateCloudCredentials(cloudCredentials){
    instructionsLabClient.updateCloudCredentials(cloudCredentials);
}

async function getScreenDataUrl() {
    if (!consoleLoaded) return { ok: false, canvas: null, reason: "not_available" };
    return await consoleWindow.labConsole.getScreenDataUrl();
}

// Cross-origin nested iframes (e.g. a Mentor tab pointed at a third-
// party domain) are leaf nodes from html2canvas's perspective -- their
// contents never appear in the rasterization. Paint a solid black
// rectangle over each visible nested iframe so the composite doesn't
// show a mysterious empty box where embedded content was sitting.
// slotOriginX/Y is the position of the instructions tile in the
// composite's CSS-pixel coords.
//
// Same-origin nested iframes are skipped: html2canvas already walks
// into them and rasterizes their contents naturally, so painting
// black over them would clobber legitimate captured content.
function obscureNestedIframes(ctx, dpr, slotOriginX, slotOriginY, instWin) {
    if (!instWin || !instWin.document) return;
    const iframes = instWin.document.querySelectorAll("iframe");
    if (iframes.length === 0) return;
    ctx.save();
    ctx.fillStyle = "#000";
    for (const f of iframes) {
        const r = f.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        // Cross-origin contentDocument access returns null per spec
        // (some browsers throw); either result means we should paint
        // over. Truthy contentDocument means same-origin -- skip.
        let sameOrigin = false;
        try { sameOrigin = !!f.contentDocument; } catch { sameOrigin = false; }
        if (sameOrigin) continue;
        ctx.fillRect(
            Math.round((slotOriginX + r.left) * dpr),
            Math.round((slotOriginY + r.top) * dpr),
            Math.round(r.width * dpr),
            Math.round(r.height * dpr)
        );
    }
    ctx.restore();
}

// Tracks documents that have had a one-time-per-session html2canvas
// warmup pass run against them. See instructions IIFE in
// composeLabClientScreen for the rationale (priming html2canvas
// internal state so first-capture heading font renders correctly).
const _html2canvasWarmedDocs = new WeakSet();

// html2canvas is lazy-loaded on first call. The library is ~200KB and
// is only needed by getLabClientScreenDataUrl(), which most lab
// deliveries never invoke. Keeping it off the eager script payload
// saves the bytes for the common case; the first caller pays a single
// network round-trip, after which the cached promise resolves
// synchronously and the browser HTTP cache reuses the file on later
// page loads. Concurrent first-callers share one in-flight load.
let _html2canvasPromise = null;
function loadHtml2Canvas() {
    if (_html2canvasPromise) return _html2canvasPromise;
    _html2canvasPromise = new Promise(function (resolve, reject) {
        if (typeof html2canvas === "function") { resolve(html2canvas); return; }
        const s = document.createElement("script");
        s.src = "/lib/html2canvas/html2canvas.min.js";
        s.async = true;
        s.onload = function () {
            if (typeof html2canvas === "function") resolve(html2canvas);
            else reject(new Error("html2canvas script loaded but global is missing"));
        };
        s.onerror = function () {
            _html2canvasPromise = null; // allow retry on a later call
            reject(new Error("Failed to load html2canvas"));
        };
        document.head.appendChild(s);
    });
    return _html2canvasPromise;
}

// Public boundary for api.v1.getLabClientScreenDataUrl(). The composite
// work lives in composeLabClientScreen() and returns a canvas; this
// wrapper exists only to encode that canvas to a PNG data URL for the
// current single-shot use case. A future streaming entry point would
// not build on this -- html2canvas is too slow per-frame and isn't
// safe under concurrent calls -- but a one-off-screenshot consumer
// could feed the returned canvas through toBlob() instead of
// toDataURL() to skip the base64 hop.
async function getLabClientScreenDataUrl() {
    try {
        const canvas = await composeLabClientScreen();
        return { ok: true, data_url: canvas.toDataURL("image/png"), reason: null };
    } catch (e) {
        console.error("getLabClientScreenDataUrl: composite failed", e);
        return { ok: false, data_url: null, reason: "capture_failed" };
    }
}

// Composite the parent chrome, the environment iframe, and the
// instructions iframe (or popped-out instructions window) into a single
// canvas. Sub-failures (env disconnected, instructions inaccessible) are
// rendered as a "Screen unavailable" placeholder in the affected slot
// rather than failing the overall capture -- the surrounding UI is still
// useful on its own. Only an exception from the parent rasterization or
// the canvas composite itself escapes and surfaces as capture_failed.
//
// In-flight lock: html2canvas is not parallel-safe (see sharedOpts
// comment), AND the tab dance mutates instructions-window state that
// two concurrent composites would clobber for each other. If a second
// caller arrives while a composite is running, they share the in-flight
// promise and both receive the same result -- which is the right
// semantic for a "current screen" request.
let _composeInFlight = null;
async function composeLabClientScreen() {
    if (_composeInFlight) return _composeInFlight;
    _composeInFlight = composeLabClientScreenImpl();
    try {
        return await _composeInFlight;
    } finally {
        _composeInFlight = null;
    }
}

async function composeLabClientScreenImpl() {
    // Lazy-load html2canvas. First lab-screen capture in the session
    // pays the network round-trip; later calls and reloads hit cache.
    const html2canvas = await loadHtml2Canvas();

    // Holds the tab dance restore state so we can defer the actual
    // selectTab(originalTabId) call until the finally block below.
    // Deferring guarantees we restore even if compositing throws after
    // the dance was initiated (which would otherwise strand the user
    // on Instructions). The restore still runs after the happy-path
    // obscureNestedIframes pass; throw paths skip obscure entirely so
    // the early restore is safe in that case too.
    let pendingTabRestoreId = null;
    let pendingTabRestoreWin = null;
    try {

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));

    const consoleEl = document.getElementById("consoleIFrame");
    const instructionsEl = document.getElementById("instructionsIFrame");
    const poppedOut = (typeof externalInstructionsWindow !== "undefined"
        && externalInstructionsWindow != null
        && !externalInstructionsWindow.closed);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // html2canvas options shared by every rasterization call:
    //   scale: clamp to our DPR so each tile renders at the same
    //          resolution we composite at.
    //   useCORS: ask the library to fetch cross-origin <img> sources
    //          with CORS headers when present. We don't set allowTaint
    //          because a tainted canvas can't be exported via toDataURL.
    //   logging: silence the library's verbose console output.
    //   backgroundColor: null means transparent, so iframe slots in
    //          the parent capture don't get an opaque fill underneath
    //          the tiles we paint over them.
    const sharedOpts = {
        scale: dpr,
        useCORS: true,
        logging: false,
        backgroundColor: null
    };

    // html2canvas is not parallel-safe: it appends a temporary render
    //   container to the document for each call, and concurrent calls
    //   clobber each other's font / pseudo-element state. The most
    //   visible symptom is icon-font pseudo-elements rendering as
    //   missing-glyph boxes in one or more outputs. Even non-
    //   html2canvas async work running concurrently with the chain
    //   has been observed to disturb font state (per prior debugging
    //   sessions), so the entire capture sequence below is fully
    //   serial: env capture first, then html2canvas calls one at a
    //   time. Trade-off: marginally longer total time vs. an
    //   intermittent font glitch on first captures.

    // Environment. Same code path for virtualization and container
    //    clients -- both expose labConsole.getScreenDataUrl(), which
    //    returns { ok, canvas, reason } so we can drawImage the
    //    canvas straight into the composite without a PNG round-trip.
    const envResult = await (async function () {
        try {
            if (!consoleLoaded || !consoleWindow || !consoleWindow.labConsole
                || typeof consoleWindow.labConsole.getScreenDataUrl !== "function") {
                return { ok: false, canvas: null };
            }
            return await consoleWindow.labConsole.getScreenDataUrl();
        } catch (e) {
            console.error("composeLabClientScreen: env capture failed", e);
            return { ok: false, canvas: null };
        }
    })();

    // 1. Parent chrome. Skip the iframe elements during capture --
    //    html2canvas would otherwise try to traverse same-origin
    //    iframes itself, which both duplicates work and triggers
    //    its canvas-readback paths on the env iframe's VM display
    //    canvas (where preserveDrawingBuffer rules apply). We paint
    //    our own captures over those slots in step 4.
    // Resolve the splitter's live background color so we can pin it
    // inline on the clone -- the rule that paints it lives in the
    // theme stylesheet (an external <link>) and the base color is
    // in the wrapper's inline <style>; neither reliably reaches
    // html2canvas's clone sandbox, leaving the splitter element
    // transparent and the wrapper's body bg showing through as a
    // light line where a dark gray bar should be.
    let splitterBg = null;
    try {
        const sp = document.getElementById("splitter");
        if (sp) {
            const c = window.getComputedStyle(sp).backgroundColor;
            if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") splitterBg = c;
        }
    } catch { /* ignore */ }
    let parentCanvas;
    try {
        parentCanvas = await html2canvas(document.body, Object.assign({}, sharedOpts, {
            width: vw,
            height: vh,
            ignoreElements: function (el) {
                return el === consoleEl || el === instructionsEl;
            },
            onclone: function (clonedDoc) {
                // Make the body bg transparent in the clone. We
                // explicitly draw the body bg into the composite
                // ourselves (the initial fillRect with the live
                // body's computed bg), and we want parentCanvas's
                // iframe slots to be transparent so iframe canvases
                // drawn beneath show through. Critically, this also
                // gives the drag handle's rounded-corner cutouts
                // genuine transparency in parentCanvas -- otherwise
                // those cutouts would be filled by body-bg paint
                // and produce opaque dots when we redraw the handle
                // on top of the iframe canvases.
                if (clonedDoc.body) clonedDoc.body.style.backgroundColor = "transparent";
                if (splitterBg) {
                    const sp = clonedDoc.getElementById("splitter");
                    if (sp) sp.style.backgroundColor = splitterBg;
                }
            }
        }));
    } catch (e) {
        console.error("composeLabClientScreen: parent chrome capture failed", e);
        throw e;
    }

    // 2b. Console iframe body via html2canvas -- env-slot fallback when
    //     the direct canvas-readback path returns no canvas (no target
    //     selected, disconnected, "Please wait while connecting...",
    //     unsupported endpoint type). Renders the iframe's actual DOM
    //     state in place rather than a generic "Screen unavailable"
    //     placeholder.
    //
    //     windowWidth/windowHeight tell html2canvas which window's
    //     dimensions to use for viewport-relative CSS (vw/vh units,
    //     flex/grid sizing based on container width). Without them
    //     the library defaults to the calling window's dimensions,
    //     and the iframe's body lays out for the wrong viewport.
    const consoleChromeResult = await (async function () {
        try {
            if (!consoleWindow || !consoleWindow.document || !consoleWindow.document.body) {
                return { ok: false };
            }
            const w = consoleEl.getBoundingClientRect().width;
            const h = consoleEl.getBoundingClientRect().height;
            if (w <= 0 || h <= 0) return { ok: false };
            const canvas = await html2canvas(consoleWindow.document.body,
                Object.assign({}, sharedOpts, {
                    width: w,
                    height: h,
                    windowWidth: consoleWindow.innerWidth,
                    windowHeight: consoleWindow.innerHeight,
                    // Same defensive height-pin pattern as the
                    // instructions capture below. Container-client-v2's
                    // layout uses body/html { height: 100% } and
                    // calc(100% - 26px) on #containerWrapper.withTabs,
                    // and virtualization-client has its own height-100%
                    // chain. Both collapse in html2canvas's clone if
                    // there's no rooted pixel-height anchor at the
                    // top -- which manifests as missing console
                    // chrome / tabs and content stacking at the top.
                    onclone: function (clonedDoc, clonedRoot) {
                        if (clonedDoc.documentElement) {
                            clonedDoc.documentElement.style.height = h + "px";
                        }
                        clonedRoot.style.height = h + "px";
                        clonedRoot.style.minHeight = h + "px";
                        clonedRoot.style.position = "relative";
                    }
                }));
            return { ok: true, canvas: canvas, width: w, height: h };
        } catch (e) {
            console.error("composeLabClientScreen: console chrome capture failed", e);
            return { ok: false };
        }
    })();

    // 3. Instructions. getInstructionsWindow() returns the contentWindow
    //    of the active instructions iframe whether it is inline (joined
    //    state) or hosted inside the popped-out window (split state),
    //    so the rasterization call is identical in both. The body's
    //    ownerDocument is same-origin in both states.
    //
    //    html2canvas's scrollY option offsets the source capture by
    //    that many pixels; passing the iframe's current scroll position
    //    makes the tile match what the user sees rather than the top
    //    of the document.
    //
    //    onclone pins explicit pixel heights on html + body. In the
    //    live page these elements have `height: 100%`, which resolves
    //    against the iframe's viewport. html2canvas's cloned context
    //    doesn't reproduce that ancestor sizing, so the percentage
    //    cascade collapses and any flex/percentage-height descendants
    //    render at zero. Setting the clone's root heights explicitly
    //    is harmless to the live DOM (the clone is detached) and
    //    keeps the layout faithful.
    const instResult = await (async function () {
        try {
            const instWin = (typeof getInstructionsWindow === "function") ? getInstructionsWindow() : null;
            if (!instWin || !instWin.document || !instWin.document.body) {
                return { ok: false };
            }
            // Mentor-tab fix-up. The screenshot is most commonly
            // invoked from the mentor chat composer, which forces the
            // Mentor tab active -- and that tab's body content is a
            // cross-origin chat iframe that obscureNestedIframes
            // correctly blacks out, leaving the captured pane empty.
            // Briefly switching to Instructions for the duration of
            // the rasterization gives the mentor a usable view of the
            // lab. Other tabs (Resources / Help) render fine on their
            // own, so we leave them alone -- the student's literal
            // view is preserved when it's actually capturable.
            // selectTab is purely a class/visibility toggle (no AJAX,
            // no URL change, no events), so the dance is cheap.
            try {
                const instJq = instWin.jQuery || instWin.$;
                if (instJq && typeof instWin.labClient?.selectTab === 'function') {
                    const $current = instJq('.tabHeading.selected', instWin.document);
                    const currentId = $current.length > 0 ? $current.attr('data-id') : null;
                    if (currentId === '4') { // Mentor tab
                        pendingTabRestoreId = currentId;
                        pendingTabRestoreWin = instWin;
                        instWin.labClient.selectTab(0);
                    }
                }
            } catch (e) {
                console.warn("composeLabClientScreen: tab-switch dance failed", e);
            }
            const instBody = instWin.document.body;
                const targetW = poppedOut ? instWin.innerWidth : instructionsEl.getBoundingClientRect().width;
                const targetH = poppedOut ? instWin.innerHeight : instructionsEl.getBoundingClientRect().height;
                const docEl = instWin.document.documentElement;
                const scrollY = instWin.scrollY || instWin.pageYOffset
                    || (docEl && docEl.scrollTop)
                    || instBody.scrollTop || 0;
                // Compute the live body's resolved background color
                // here so we can hand it to html2canvas as the canvas
                // backdrop. sharedOpts uses backgroundColor:null
                // (transparent) because the wrapper-page composite
                // overlays iframe slots and we don't want an opaque
                // fill clobbering what's underneath -- but for the
                // instructions capture specifically, we DO want a
                // bg fill: the iframe body's content area has a
                // real bg color (V2 uses var(--page-background-color);
                // V1 uses concrete white), and html2canvas with
                // backgroundColor:null produces a transparent body
                // area where content's bg shows through to the
                // wrapper's black fill below.
                let liveBodyBg = null;
                try {
                    const c = instWin.getComputedStyle(instWin.document.body).backgroundColor;
                    if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") liveBodyBg = c;
                } catch { /* ignore */ }
                // One-time-per-document warmup: a full throwaway
                // html2canvas call on the instructions body. The
                // "second capture works" observation tells us
                // html2canvas retains internal state across calls
                // that fixes the heading font; this warmup exercises
                // that priming once at session start and discards
                // the result. Memoized via WeakSet so it runs only
                // once per instructions document.
                if (!_html2canvasWarmedDocs.has(instWin.document)) {
                    _html2canvasWarmedDocs.add(instWin.document);
                    try {
                        const warm = await html2canvas(instBody, Object.assign({}, sharedOpts, {
                            width: targetW,
                            height: targetH,
                            scrollY: scrollY,
                            windowWidth: instWin.innerWidth,
                            windowHeight: instWin.innerHeight,
                            backgroundColor: liveBodyBg || "#fff",
                            onclone: function (clonedDoc, clonedRoot) {
                                if (clonedDoc.documentElement) {
                                    clonedDoc.documentElement.style.height = targetH + "px";
                                }
                                clonedRoot.style.height = targetH + "px";
                                clonedRoot.style.minHeight = targetH + "px";
                                clonedRoot.style.position = "relative";
                            }
                        }));
                        void warm;
                    } catch (e) {
                        console.warn("composeLabClientScreen: instructions warmup failed", e);
                    }
                }
                const canvas = await html2canvas(instBody, Object.assign({}, sharedOpts, {
                    width: targetW,
                    height: targetH,
                    scrollY: scrollY,
                    windowWidth: instWin.innerWidth,
                    windowHeight: instWin.innerHeight,
                    backgroundColor: liveBodyBg || "#fff",
                    onclone: function (clonedDoc, clonedRoot) {
                        // Pin html + body to the iframe's measured
                        // height. In the live page these are
                        // height:100%, which resolves against the
                        // iframe viewport; html2canvas's clone needs
                        // a rooted pixel anchor for the percentage
                        // cascade to resolve. position:relative on
                        // body makes it the containing block for any
                        // absolutely-positioned descendants (notably
                        // V2's .tab-content with top:100/bottom:100),
                        // which otherwise resolve against the
                        // sandbox's initial containing block and
                        // collapse. Matches the console-chrome
                        // capture's onclone, which has the same
                        // requirement and works.
                        if (clonedDoc.documentElement) {
                            clonedDoc.documentElement.style.height = targetH + "px";
                        }
                        clonedRoot.style.height = targetH + "px";
                        clonedRoot.style.minHeight = targetH + "px";
                        clonedRoot.style.position = "relative";
                    }
                }));
                return { ok: true, canvas: canvas, width: targetW, height: targetH };
        } catch (e) {
            console.error("composeLabClientScreen: instructions capture failed", e);
            return { ok: false };
        }
    })();

    // 4. Composite. The rasterization tasks return canvases directly
    //    so we drawImage them straight onto the output canvas. In
    //    split state, the inline #instructionsIFrame is display:none,
    //    so its rect is empty -- we append the popped-out capture as
    //    a side-by-side panel instead.
    const consoleRect = consoleEl.getBoundingClientRect();
    const instRect = poppedOut ? null : instructionsEl.getBoundingClientRect();

    const outW = poppedOut
        ? (vw + (instResult.ok ? instResult.width : 0))
        : vw;
    const outH = poppedOut
        ? Math.max(vh, instResult.ok ? instResult.height : 0)
        : vh;

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(outW * dpr));
    out.height = Math.max(1, Math.round(outH * dpr));
    const ctx = out.getContext("2d");

    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    ctx.fillStyle = (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)") ? bodyBg : "#000";
    ctx.fillRect(0, 0, out.width, out.height);

    // Compositing order: iframe canvases first, then parent chrome on
    // top. parentCanvas has the iframe slots transparent (body bg
    // forced transparent in the parent-capture onclone, iframe
    // elements skipped via ignoreElements), so when it's drawn last
    // it overlays chrome/splitter/handle on top of the iframe content
    // without covering the iframe pixels themselves. Single drawImage
    // for the wrapper instead of three (full parent + splitter
    // region + handle region) in the earlier order.

    // Environment slot. Prefer the html2canvas-of-console-body capture
    // (consoleChromeResult): it includes the iframe's chrome -- toolbar,
    // machine/endpoint tabs, status bar -- AND the VM display canvas
    // (html2canvas reads canvas content via toDataURL, same path the
    // VM controllers use directly, so preserveDrawingBuffer:true
    // canvases come through correctly). Falling back to envResult.canvas
    // (just the bare display) loses the chrome and stretches the
    // display vertically to cover where chrome would be.
    if (consoleChromeResult.ok && consoleChromeResult.canvas) {
        ctx.drawImage(consoleChromeResult.canvas,
            Math.round(consoleRect.left * dpr), Math.round(consoleRect.top * dpr),
            Math.round(consoleRect.width * dpr), Math.round(consoleRect.height * dpr));
    } else if (envResult.ok && envResult.canvas) {
        ctx.drawImage(envResult.canvas,
            Math.round(consoleRect.left * dpr), Math.round(consoleRect.top * dpr),
            Math.round(consoleRect.width * dpr), Math.round(consoleRect.height * dpr));
    } else {
        drawUnavailable(ctx,
            Math.round(consoleRect.left * dpr), Math.round(consoleRect.top * dpr),
            Math.round(consoleRect.width * dpr), Math.round(consoleRect.height * dpr));
    }

    // Instructions slot (+ obscure any nested iframes inside it)
    if (instResult.ok && instResult.canvas) {
        const instWin = (typeof getInstructionsWindow === "function") ? getInstructionsWindow() : null;
        if (poppedOut) {
            ctx.drawImage(instResult.canvas,
                Math.round(vw * dpr), 0,
                Math.round(instResult.width * dpr), Math.round(instResult.height * dpr));
            obscureNestedIframes(ctx, dpr, vw, 0, instWin);
        } else {
            ctx.drawImage(instResult.canvas,
                Math.round(instRect.left * dpr), Math.round(instRect.top * dpr),
                Math.round(instRect.width * dpr), Math.round(instRect.height * dpr));
            obscureNestedIframes(ctx, dpr, instRect.left, instRect.top, instWin);
        }
    } else if (!poppedOut && instRect) {
        drawUnavailable(ctx,
            Math.round(instRect.left * dpr), Math.round(instRect.top * dpr),
            Math.round(instRect.width * dpr), Math.round(instRect.height * dpr));
    }

    // Parent chrome on top. Single drawImage; the splitter and its
    // drag handle paint here, and the handle's rounded-corner
    // transparency lets the iframe canvases beneath show through at
    // the corners.
    ctx.drawImage(parentCanvas, 0, 0, Math.round(vw * dpr), Math.round(vh * dpr));

    return out;
    } finally {
        // Tab restore always runs -- happy path lands here after
        // obscureNestedIframes (which is required: the mentor iframe
        // must stay hidden through that pass or it triggers a
        // full-area black overpaint on the captured instructions
        // content). Throw paths land here too; the obscure pass was
        // skipped, so an immediate restore is safe.
        if (pendingTabRestoreId != null && pendingTabRestoreWin
            && typeof pendingTabRestoreWin.labClient?.selectTab === 'function') {
            try {
                pendingTabRestoreWin.labClient.selectTab(parseInt(pendingTabRestoreId, 10));
            } catch (e) {
                console.warn("composeLabClientScreen: tab-restore failed", e);
            }
        }
    }
}

function drawUnavailable(ctx, x, y, w, h) {
    // Black fill with centered "Screen unavailable" label. Font sized
    // off the shorter dimension so it stays legible on narrow tiles.
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#fff";
    const px = Math.max(12, Math.round(Math.min(w, h) * 0.04));
    ctx.font = px + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Screen unavailable", x + w / 2, y + h / 2);
    ctx.restore();
}
