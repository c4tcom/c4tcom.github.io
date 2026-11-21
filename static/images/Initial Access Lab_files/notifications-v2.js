// Shared notification (toast) renderer for the v2 lab client, used by both the
// instructions and console frames so notifications render identically wherever
// they land. Kept free of Razor strings and frame-specific DOM ids (supplied via
// deps) so it can be a plain static script shared by both frames.
//
// Usage:
//   const render = LabClientNotifications.createNotificationRenderer({
//       getContainer: () => $("#notificationContainer"),
//       alertText: "Alert",                  // localized
//       closeText: "Close",                  // localized
//       isRtl: () => isRtl,
//       dialogIsActive: () => dialogIsActive(),
//       playNotificationSound: () => playNotificationSound(), // optional; defaults to the built-in chime
//       onPersistent: () => $("#notificationsButton").addClass("active"), // optional
//       getNotificationsDialog: () => $("#notificationsDialog"),          // optional
//   });
//   render(notification);
(function (global) {
    "use strict";

    function a11yClick(event) {
        if (!event) return true; // programmatic invocation
        if (event.type === "click") return true;
        if (event.type === "keypress") {
            const code = event.charCode || event.keyCode;
            return code === 32 || code === 13;
        }
        return false;
    }

    // Default notification chime; overridable via deps.playNotificationSound.
    // Cycles Tab/Shift+Tab through $scope's focusable descendants only, so an
    // actionable notification behaves like the modal dialog it functionally is.
    function trapTabKey(e, $scope) {
        if (e.key !== "Tab") return;
        const $focusable = $scope.find('button, input:not([disabled]), [tabindex="0"]').filter(":visible");
        if ($focusable.length === 0) return;
        if (e.shiftKey && document.activeElement === $focusable[0]) {
            e.preventDefault();
            $focusable[$focusable.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === $focusable[$focusable.length - 1]) {
            e.preventDefault();
            $focusable[0].focus();
        }
    }

    function playNotificationSound() {
        const audio = document.createElement("audio");
        document.body.appendChild(audio);
        audio.setAttribute("autoplay", true);
        audio.setAttribute("src", "/images/notification.mp3");
        // Remove the element once, however playback resolves. Relying on "ended"
        // alone leaks the node when autoplay is blocked (no gesture) or load fails,
        // since "ended" never fires. The timeout is a backstop for those cases.
        let removed = false;
        const remove = function () {
            if (removed) return;
            removed = true;
            if (audio.parentNode) audio.parentNode.removeChild(audio);
        };
        audio.addEventListener("ended", remove);
        audio.addEventListener("error", remove);
        window.setTimeout(remove, 10000);
    }

    function createNotificationRenderer(deps) {
        deps = deps || {};
        const getContainer = deps.getContainer;
        const alertText = deps.alertText || "";
        const closeText = deps.closeText || "";
        const isRtl = deps.isRtl || function () { return false; };
        const dialogIsActive = deps.dialogIsActive || function () { return false; };
        const playSound = deps.playNotificationSound || playNotificationSound;
        const onPersistent = deps.onPersistent || function () { };
        const getNotificationsDialog = deps.getNotificationsDialog || function () { return $(); };
        // Frame-specific: e.g. the instructions frame uses this to re-measure its
        // footer (height varies with zoom/content/tab) and refresh the container's
        // clearance immediately before each render, rather than relying solely on
        // whatever layout-changing action last happened to trigger it.
        const beforeRender = deps.beforeRender || (() => {});

        let notificationCounter = 0;

        return function render(notification) {
            if (!notification) return;
            if (!notification.content && !notification.buttons) return;
            const $container = getContainer();
            if (!$container || $container.length === 0) return;
            beforeRender();

            // Match by attribute value via .filter rather than interpolating the id
            // into a selector string, which breaks (and is an injection surface) if
            // the id contains quotes or selector-special characters.
            const findById = function ($scope, selector, id) {
                const idStr = String(id);
                return $scope.find(selector).filter(function () {
                    return $(this).attr("data-id") === idStr;
                });
            };

            if (notification.id) {
                const $dupeNotification = findById($container, ".notification", notification.id);
                if ($dupeNotification.length > 0) {
                    if ($dupeNotification.find(".notificationContent").text() === notification.content) {
                        // duplicate notification, don't do anything.
                        return;
                    } else {
                        $dupeNotification.slideUp("fast", function () { $(this).remove(); });
                    }
                }
            }
            if (notification.persistent) {
                onPersistent();
            }
            // Track whoever had focus before this notification appeared, so an
            // actionable (button) notification can restore it on dismissal.
            const $triggerElement = $(document.activeElement);

            // Build the skeleton from a static string (no interpolation), then set
            // dynamic attributes/text via jQuery so values are never parsed as HTML.
            // role="alert" is scoped to .notificationMessage, not the whole
            // .notificationContent - the close button (and any buttons) stay
            // outside it, since a live region shouldn't contain focusable controls.
            const labelDescriptionId = "notificationContent" + notificationCounter++;
            const $notification = $("<div class='notification primary-color-border'><div class='notificationBody'><span class='screen-reader-only'></span><div class='notificationContent'><div class='closeNotification primary-color-icon' tabindex='0'></div><div class='notificationMessage' role='alert'></div></div></div></div>");
            $notification.attr("data-id", notification.id);
            $notification.children("div").first().attr("aria-describedby", labelDescriptionId);
            $notification.find(".screen-reader-only").text(alertText);
            $notification.find(".notificationMessage").attr("id", labelDescriptionId);
            $notification.find(".closeNotification").attr({ "aria-label": closeText, "title": closeText });
            const isActionable = notification.buttons && notification.buttons.length > 0;
            if (isActionable) {
                // Functionally a modal prompt: mark it as one and keep Tab from
                // leaking focus out of it while it awaits a response.
                $notification.attr({ role: "dialog", "aria-modal": "true" });
                $notification.on("keydown", function (e) { trapTabKey(e, $notification); });
            }
            const close = function () {
                $notification.fadeOut("fast", function () {
                    $notification.show().css({ visibility: "hidden" });
                    $notification.animate({ height: 0, padding: 0, marginTop: 0 }, "fast", function () {
                        $notification.remove();
                        if (notification.close) {
                            notification.close();
                        }
                        if (isActionable && $triggerElement.length > 0 && $triggerElement.is(":visible")) {
                            $triggerElement.focus();
                        }
                    });
                });
            };
            const $notificationContent = $notification.find(".notificationContent");
            const $notificationMessage = $notification.find(".notificationMessage");
            $notificationMessage.append(notification.content);
            if (notification.hideCloseButton) {
                $notification.find(".closeNotification").hide();
            } else {
                $notification.find(".closeNotification").on("click keypress", function (e) {
                    if (!a11yClick(e)) return;
                    close();
                });
            }
            if (isActionable) {
                const $buttons = $("<div class='notificationButtonWrapper'></div>");
                const numButtons = notification.buttons.length;
                const buttons = notification.buttons;
                for (let i = 0; i < numButtons; i++) {
                    const button = buttons[i];
                    if (!button.text) continue; // skip malformed button, still render the rest
                    const $button = $("<input type='button' />").val(button.text);
                    if (button.primary) {
                        $button.addClass("primary");
                    }
                    if (button.click) {
                        $button.click(button.click);
                    }
                    if (button.closeNotification) {
                        $button.click(close);
                    }
                    $buttons.append($button);
                }
                $notificationContent.append($buttons);
            }

            $container.append($notification);
            const width = $notification.outerWidth();
            const height = $notification.outerHeight();
            const marginTop = parseInt($notification.css("marginTop"));
            $notification.hide();
            const $placeHolder = $("<div></div>");
            $placeHolder.css({ "visibility": "hidden", height: 0, width: 0 });
            $container.append($placeHolder);
            $placeHolder.animate({ height: height + marginTop, width: width }, "fast", function () {
                $placeHolder.remove();
                $notification.css({ "visibility": "hidden" }).show();
                const $slideInClone = $notification.clone(false);
                const initialCssProperties = { position: "absolute", bottom: 0, "visibility": "visible" };
                if (isRtl()) {
                    initialCssProperties.left = -width - 32;
                } else {
                    initialCssProperties.right = -width - 32;
                }
                const finalCssPosition = isRtl()
                    ? { left: 0 }
                    : { right: 0 };
                $slideInClone.css(initialCssProperties);
                $container.append($slideInClone);
                $slideInClone.animate(finalCssPosition, "fast", function () {
                    $notification.css({ "visibility": "visible" });
                    $slideInClone.remove();
                    $notification.show();
                    if (!dialogIsActive()) {
                        $notificationContent.find("input.primary").focus();
                    }
                });
            });

            playSound();

            if (notification.autocloseTimeout) {
                window.setTimeout(function () {
                    close();
                }, notification.autocloseTimeout);
            }

            const $notificationsDialog = getNotificationsDialog();
            if ($notificationsDialog && $notificationsDialog.length > 0 && notification.id) {
                findById($notificationsDialog, ".listedNotification", notification.id).slideUp("fast", function () { $(this).remove(); });
                // Build with jQuery rather than interpolating into an HTML string.
                // created is plain text (.text); content is treated as HTML via
                // .append to match how the toast above renders it (line ~109).
                const $listedNotification = $("<div class='listedNotification'><div class='listedNotificationDate'></div><div class='listedNotificationBody'></div></div>");
                $listedNotification.attr("data-id", notification.id);
                $listedNotification.find(".listedNotificationDate").text(notification.created != null ? notification.created : "");
                $listedNotification.find(".listedNotificationBody").append(notification.content);
                $notificationsDialog.prepend($listedNotification);
                $listedNotification.css({ "visibility": "hidden", "display": "none" }).slideDown("fast", function () {
                    $listedNotification.css({ "visibility": "visible", "display": "none" }).fadeIn("fast");
                });
            }
        };
    }

    global.LabClientNotifications = {
        createNotificationRenderer: createNotificationRenderer
    };
})(window);
