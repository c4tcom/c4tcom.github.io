// Rasterize an xterm-rendered terminal element to a canvas.
//
// Used by both the container terminal (container-client.js) and the SSH/
// PowerShell terminal (ssh-client.js). Two paths:
//
//   1. Forward-compat: if the terminal element contains <canvas> children
//      (xterm canvas renderer or WebGL addon), composite them directly --
//      pixel-perfect, no library required. The WebGL branch additionally
//      requires preserveDrawingBuffer:true at xterm setup time; without it
//      the canvas reads back blank pixels.
//
//   2. Today's bundled xterm is DOM-only, so we fall back to dom-to-image-more
//      to rasterize the DOM subtree.
//
// When we eventually upgrade xterm, only this helper changes; the surrounding
// API surface and mentor flow do not.
//
// Returns an HTMLCanvasElement. The caller decides whether to encode (single
// frame -> toDataURL at the public API boundary) or composite (drawImage onto
// a larger canvas in the lab-client wrapper). Keeping the intermediate as a
// canvas avoids a per-tile PNG encode/decode round-trip in the composite path.
// Shared DPR factor for both rasterization paths so they produce equally
// sharp output on hi-DPI displays. Clamped to [1, 3]: never below 1 (would
// de-resolve below what was rendered), never above 3 (diminishing returns
// vs. ~16x payload size at 4x DPR).
function clampedDevicePixelRatio() {
    return Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
}

async function rasterizeTerminal(rootEl) {
    if (!rootEl) {
        throw new Error('rasterizeTerminal: rootEl is required');
    }
    const canvases = rootEl.querySelectorAll('canvas');
    if (canvases.length > 0) {
        return rasterizeTerminalCanvases(rootEl, canvases);
    }
    if (typeof domtoimage === 'undefined' || typeof domtoimage.toCanvas !== 'function') {
        throw new TypeError('dom-to-image-more is not loaded');
    }
    // Render at devicePixelRatio so output is sharp on hi-DPI displays.
    // dom-to-image-more rasterizes at CSS-pixel dimensions by default; without
    // this the canvas is half-resolution on 2x displays. The transform/origin
    // pair expands the CSS-pixel-sized SVG foreignObject into the larger canvas.
    const dpr = clampedDevicePixelRatio();
    const options = { bgcolor: '#000' };
    if (dpr !== 1) {
        const rect = rootEl.getBoundingClientRect();
        options.width = rect.width * dpr;
        options.height = rect.height * dpr;
        options.style = {
            transform: 'scale(' + dpr + ')',
            transformOrigin: 'top left'
        };
    }
    // Suppress scrollbars in the captured subtree. xterm uses virtualized
    // rendering -- only the visible rows are in the DOM -- so the scrollbar
    // is UI chrome, not content. cloneNode resets scrollTop to 0, which would
    // also pin the cloned scrollbar to the top regardless of live position.
    // Hiding via inline overflow:hidden on the live elements is safe because
    // xterm row widths are fixed pixel values and don't reflow when the
    // scrollbar gutter disappears. Restored in finally so the live UI is
    // unaffected outside the capture window.
    const restoreScrollbars = hideOverflowScrollbars(rootEl);
    try {
        return await domtoimage.toCanvas(rootEl, options);
    } finally {
        restoreScrollbars();
    }
}

function hideOverflowScrollbars(rootEl) {
    // Mark only elements that actually have overflow:auto/scroll, then suppress
    // overflow + scrollbars on those via an !important stylesheet rule.
    //
    // We can't use a blanket `.marker *` rule because that propagates
    // overflow:hidden to every descendant -- including row containers whose
    // children have content-box-sized borders that extend slightly outside
    // their parent (e.g., xterm's hollow unfocused-cursor border). Clipping
    // those rows truncates the cursor's top/bottom border in the capture.
    //
    // !important is required because dom-to-image-more reads computed styles
    // from the cloned tree, and inline-style overrides don't always propagate
    // through its clone in the same way a stylesheet rule does.
    const marker = 'lod-capture-no-scroll-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
    const markedEls = [];
    function maybeMark(el) {
        const cs = globalThis.getComputedStyle(el);
        if (cs.overflow === 'auto' || cs.overflow === 'scroll'
            || cs.overflowX === 'auto' || cs.overflowX === 'scroll'
            || cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            el.classList.add(marker);
            markedEls.push(el);
        }
    }
    maybeMark(rootEl);
    for (const node of rootEl.querySelectorAll('*')) {
        maybeMark(node);
    }
    const styleEl = document.createElement('style');
    styleEl.textContent =
        '.' + marker + ' {' +
        '  overflow: hidden !important;' +
        '  scrollbar-width: none !important;' +
        '}' +
        '.' + marker + '::-webkit-scrollbar {' +
        '  display: none !important;' +
        '  width: 0 !important;' +
        '  height: 0 !important;' +
        '}';
    document.head.appendChild(styleEl);
    return function restore() {
        for (const el of markedEls) {
            el.classList.remove(marker);
        }
        styleEl.remove();
    };
}

function rasterizeTerminalCanvases(rootEl, canvases) {
    // Composite into a DPR-scaled output canvas so this branch produces
    // equally sharp results to the DOM path on hi-DPI displays. Each source
    // canvas is drawn with explicit destination dimensions in CSS-pixels-times-DPR;
    // a 3-arg drawImage(c, dx, dy) would paint at the source's backing-store
    // size, which for DPR-aware canvas/WebGL renderers exceeds the CSS box.
    const dpr = clampedDevicePixelRatio();
    const rect = rootEl.getBoundingClientRect();
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(rect.width * dpr));
    out.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    for (const c of canvases) {
        const cRect = c.getBoundingClientRect();
        ctx.drawImage(
            c,
            Math.round((cRect.left - rect.left) * dpr),
            Math.round((cRect.top - rect.top) * dpr),
            Math.max(1, Math.round(cRect.width * dpr)),
            Math.max(1, Math.round(cRect.height * dpr))
        );
    }
    return out;
}
