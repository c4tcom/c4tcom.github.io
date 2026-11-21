// Watching the VM's screen for the mentor: whether it visibly changes, or stops changing.
//
// The screen is compared as a small grayscale thumbnail, each of its pixels the average of a block
// of the real screen. A pixel counts as changed when its brightness moves by more than a little, and
// the screen counts as changed when more than a sliver of the thumbnail does. So a blinking cursor
// or a ticking clock, which barely move any block, don't count, while a window opening, a page
// loading or a dialog appearing do. A busy progress bar or a video counts as changing, which is
// right for waiting until the screen stops changing.
//
// A wait can watch just a region of the screen instead, such as a button that turns active or
// a text area being typed in. The region is compared at the full detail of the screenshot's copy,
// and counts as changed once a small patch of it does: a word typed into a large area changes only
// a little of it. A small region, such as a checkbox, counts as changed once a share of it does,
// since all of it may be smaller than that patch.
//
// A screenshot also keeps a compact grayscale copy of the screen, at most 640 pixels wide. A region
// measured from a screenshot is cut from it, and a spot about to be clicked is checked against it.
// A region or spot read live is drawn the same way, the whole screen down to the copy's grid, and
// only its block read back, so the two compare pixel for pixel: drawing just the area would blend
// its edges differently from drawing the whole screen.
window.screenWatch = (function () {
    "use strict";

    const THUMBNAIL_WIDTH = 64;
    const THUMBNAIL_HEIGHT = 40;
    // How far, out of 255, a thumbnail pixel's brightness must move to count as changed.
    const MIN_BRIGHTNESS_CHANGE = 24;
    // The share of the thumbnail that must change for the screen to count as changed.
    const MIN_CHANGED_SHARE = 0.005;
    const SAMPLE_INTERVAL_MS = 250;
    // How many of a region's pixels, on the copy's grid, must change for it to count as changed,
    // or this share of them in a region too small for that.
    const REGION_MIN_CHANGED_PIXELS = 20;
    const SMALL_REGION_MIN_CHANGED_SHARE = 0.05;
    const COPY_MAX_WIDTH = 640;
    // The share of the patch around a spot that must change for the spot to count as moved on.
    const PATCH_MIN_CHANGED_SHARE = 0.2;

    // One small canvas serves every thumbnail, since a wait samples the screen four times a second.
    let thumbnailContext = null;
    // And another every copy.
    let copyContext = null;

    // The canvas as a grayscale thumbnail, or null when it can't be read, such as while a
    // console reconnects or resizes and its canvas has no size. With area, in the screen's own
    // pixels, it is that region's pixels on the copy's grid instead.
    function thumbnail(canvas, area) {
        if (!canvas || !canvas.width || !canvas.height) return null;
        if (area) return readArea(canvas, area);
        if (!thumbnailContext) {
            const small = document.createElement("canvas");
            small.width = THUMBNAIL_WIDTH;
            small.height = THUMBNAIL_HEIGHT;
            thumbnailContext = small.getContext("2d", { willReadFrequently: true });
            if (!thumbnailContext) return null;
            // High-quality smoothing averages each block rather than picking one pixel from it.
            thumbnailContext.imageSmoothingEnabled = true;
            thumbnailContext.imageSmoothingQuality = "high";
        }
        let pixels;
        try {
            thumbnailContext.drawImage(canvas, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
            pixels = thumbnailContext.getImageData(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT).data;
        } catch (e) {
            return null;
        }
        return grayscale(pixels, THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT);
    }

    function grayscale(rgba, count) {
        const gray = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
            gray[i] = (rgba[4 * i] * 299 + rgba[4 * i + 1] * 587 + rgba[4 * i + 2] * 114) / 1000;
        }
        return gray;
    }

    // The whole canvas drawn at width by height, read back in grayscale over block, or null when
    // it can't be read.
    function drawGray(canvas, width, height, block) {
        if (!copyContext) {
            copyContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
            if (!copyContext) return null;
        }
        try {
            const target = copyContext.canvas;
            if (target.width !== width) target.width = width;
            if (target.height !== height) target.height = height;
            // Resizing a canvas resets its context, smoothing included.
            copyContext.imageSmoothingEnabled = true;
            copyContext.imageSmoothingQuality = "high";
            copyContext.drawImage(canvas, 0, 0, width, height);
            return grayscale(copyContext.getImageData(block.x, block.y, block.width, block.height).data, block.width * block.height);
        } catch (e) {
            return null;
        }
    }

    // The pixel grid of a compact copy of a screen of this size.
    function copyGrid(screenWidth, screenHeight) {
        const width = Math.min(screenWidth, COPY_MAX_WIDTH);
        const height = Math.max(1, Math.round(screenHeight * width / screenWidth));
        return { width: width, height: height, scaleX: width / screenWidth, scaleY: height / screenHeight };
    }

    // The block of the copy's pixels that covers an area of the screen, given in the screen's pixels.
    function copyBlock(grid, area) {
        const left = Math.min(grid.width - 1, Math.max(0, Math.floor(area.x * grid.scaleX)));
        const top = Math.min(grid.height - 1, Math.max(0, Math.floor(area.y * grid.scaleY)));
        const right = Math.min(grid.width, Math.max(left + 1, Math.ceil((area.x + area.width) * grid.scaleX)));
        const bottom = Math.min(grid.height, Math.max(top + 1, Math.ceil((area.y + area.height) * grid.scaleY)));
        return { x: left, y: top, width: right - left, height: bottom - top };
    }

    // The canvas's pixels over an area, on the copy's grid, or null when they can't be read.
    function readArea(canvas, area) {
        const grid = copyGrid(canvas.width, canvas.height);
        return drawGray(canvas, grid.width, grid.height, copyBlock(grid, area));
    }

    // The copy's pixels over an area, given in the screen's pixels.
    function cutArea(copy, area) {
        const block = copyBlock(copyGrid(copy.screenWidth, copy.screenHeight), area);
        const gray = new Uint8Array(block.width * block.height);
        for (let row = 0; row < block.height; row++) {
            const start = (block.y + row) * copy.width + block.x;
            gray.set(copy.pixels.subarray(start, start + block.width), row * block.width);
        }
        return gray;
    }

    /**
     * A compact copy of the canvas, for a screenshot to keep: grayscale, at most 640 pixels wide.
     * @param {HTMLCanvasElement} canvas - The console's screen.
     * @returns {Object|null} { screenWidth, screenHeight, width, height, pixels }, or null when the
     *   canvas can't be read.
     */
    function copy(canvas) {
        if (!canvas || !canvas.width || !canvas.height) return null;
        const grid = copyGrid(canvas.width, canvas.height);
        const pixels = drawGray(canvas, grid.width, grid.height, { x: 0, y: 0, width: grid.width, height: grid.height });
        return pixels === null ? null : { screenWidth: canvas.width, screenHeight: canvas.height, width: grid.width, height: grid.height, pixels: pixels };
    }

    /**
     * Whether an area of the canvas still looks as the copy shows it: few enough of its pixels
     * have changed brightness by more than a little.
     * @param {Object} screenCopy - A copy from copy().
     * @param {HTMLCanvasElement} canvas - The console's screen now.
     * @param {Object} area - { x, y, width, height } in the screen's pixels.
     * @returns {boolean|null} false also when the screen's size has changed since the copy, and
     *   null when the canvas can't be read.
     */
    function areaMatches(screenCopy, canvas, area) {
        if (!canvas || canvas.width !== screenCopy.screenWidth || canvas.height !== screenCopy.screenHeight) return false;
        const now = readArea(canvas, area);
        return now === null ? null : !hasChanged(cutArea(screenCopy, area), now, PATCH_MIN_CHANGED_SHARE);
    }

    // minChangedShare defaults to the whole screen's; thumbnails of different sizes have changed.
    function hasChanged(before, after, minChangedShare) {
        if (before.length !== after.length) return true;
        return changedPixels(before, after) > before.length * (minChangedShare ?? MIN_CHANGED_SHARE);
    }

    function regionHasChanged(before, after) {
        if (before.length !== after.length) return true;
        return changedPixels(before, after) > Math.min(REGION_MIN_CHANGED_PIXELS, before.length * SMALL_REGION_MIN_CHANGED_SHARE);
    }

    function changedPixels(before, after) {
        let changed = 0;
        for (let i = 0; i < before.length; i++) {
            if (Math.abs(before[i] - after[i]) > MIN_BRIGHTNESS_CHANGE) changed++;
        }
        return changed;
    }

    /**
     * Waits until the screen visibly changes, or until it settles: no change for quietMs. A change
     * is measured from since when given, so a change that came
     * before the wait began counts at once; otherwise from the screen when the wait begins.
     * @param {Function} sample - The screen's thumbnail, or region's pixels, now, or null once there
     *   is no screen to watch.
     * @param {string} until - "changes" or "settles".
     * @param {number} timeoutMs - How long to wait at most.
     * @param {number} quietMs - For "settles", how long the screen must stay still.
     * @param {Uint8Array} [since] - For "changes", the sample to measure a change from.
     * @param {Object} [region] - The region the samples are of, when they are of one, which
     *   counts as changed once a small patch of it does.
     * @returns {Promise<Object>} { ok, reason, message, waitedMs }, with reason timeout or not_available.
     */
    function waitFor(sample, until, timeoutMs, quietMs, since, region) {
        const changedSince = region ? regionHasChanged : function (before, after) { return hasChanged(before, after); };
        const started = Date.now();
        const screenAtStart = sampleOrNull(sample);
        if (screenAtStart === null) {
            return Promise.resolve(result(false, "not_available", "The screen went away.", started));
        }
        const baseline = until === "changes" && since ? since : screenAtStart;
        if (until === "changes" && changedSince(baseline, screenAtStart)) {
            return Promise.resolve(result(true, null, null, started));
        }
        let previous = screenAtStart;
        let lastChange = started;
        const timeoutMessage = until === "changes" ? "The screen didn't change in time." : "The screen didn't stop changing in time.";
        return new Promise(function (resolve) {
            const check = function () {
                const now = Date.now();
                // A timer that fires a little late takes a sample past the deadline: it can't count a
                // change, but a still one can confirm the screen stayed still up to the deadline.
                const late = now - started > timeoutMs;
                if (late && until === "changes") {
                    resolve(result(false, "timeout", timeoutMessage, started));
                    return;
                }
                const current = sampleOrNull(sample);
                if (current === null) {
                    resolve(result(false, "not_available", "The screen went away while waiting.", started));
                    return;
                }
                if (until === "changes") {
                    if (changedSince(baseline, current)) {
                        resolve(result(true, null, null, started));
                        return;
                    }
                } else {
                    if (changedSince(previous, current)) {
                        lastChange = now;
                        previous = current;
                    }
                    const quietUntil = late ? started + timeoutMs : now;
                    if (quietUntil - lastChange >= quietMs) {
                        resolve(result(true, null, null, started));
                        return;
                    }
                }
                if (now - started >= timeoutMs) {
                    resolve(result(false, "timeout", timeoutMessage, started));
                    return;
                }
                window.setTimeout(check, SAMPLE_INTERVAL_MS);
            };
            window.setTimeout(check, SAMPLE_INTERVAL_MS);
        });
    }

    // A sample that throws counts as no screen, so the wait always settles rather than dying in a timer.
    function sampleOrNull(sample) {
        try {
            return sample();
        } catch (e) {
            return null;
        }
    }

    function result(ok, reason, message, started) {
        return { ok: ok, reason: reason, message: message, waitedMs: Date.now() - started };
    }

    return {
        thumbnail: thumbnail,
        hasChanged: hasChanged,
        waitFor: waitFor,
        copy: copy,
        // A region's pixels as a screen's copy shows it, to measure a change in the region from.
        regionOfCopy: cutArea,
        areaMatches: areaMatches
    };
})();
