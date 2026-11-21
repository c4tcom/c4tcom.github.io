// The mentor's speech bubble, in the markup mentor-bubble.css and mentor-environment-overlay.js
// style: an avatar, a heading, an optional note, optional controls such as a tour's, an optional
// Done button, an optional link back to the caller and a close button. The caller places it and
// sets where its tail points. A movable bubble also has a minimize button, and its avatar and
// heading are its handle; whoever places it makes them move it.
// Shared by mentor.js, over the instructions, and lab-client-api.js, over the console.
globalThis.mentorBubble = (function () {
    'use strict';

    const MAX_NOTE_CHARACTERS = 200;
    // How long a bubble takes to fade out; matches mentor-bubble.css.
    const FADE_MS = 300;

    /**
     * @param {Object} options
     * @param {string} [options.label] - The heading.
     * @param {string} [options.note] - Plain text under the heading, left out when empty.
     * @param {HTMLElement} [options.controls] - Added after the note.
     * @param {{text: string, onClick: Function}} [options.done] - A Done button, styled as a tour's.
     * @param {{text: string, onClick: Function}} [options.back] - The link back to the caller.
     * @param {string} [options.closeLabel='Close'] - The close button's accessible name.
     * @param {boolean} [options.movable] - Gives it a handle and a minimize button.
     * @param {string} [options.minimizeLabel='Minimize'] - The minimize button's accessible name.
     * @param {Function} options.onClose - Called when the close button is pressed.
     * @param {boolean} [options.dark] - Styles the bubble for a dark theme.
     * @returns {HTMLDivElement} The bubble, not yet in the page.
     */
    function create(options) {
        const bubble = document.createElement('div');
        bubble.className = 'mentor-pointer-caption';
        if (options.dark) bubble.classList.add('mentor-pointer-caption--dark');
        bubble.setAttribute('role', 'status');
        const avatar = document.createElement('span');
        avatar.className = 'mentor-pointer-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        const avatarIcon = document.createElement('span');
        avatarIcon.className = 'mentor-pointer-avatar-icon';
        avatar.appendChild(avatarIcon);
        bubble.appendChild(avatar);
        const body = document.createElement('div');
        body.className = 'mentor-pointer-body';
        const label = document.createElement('span');
        label.className = 'mentor-pointer-label';
        label.textContent = typeof options.label === 'string' ? options.label : '';
        body.appendChild(label);
        if (options.movable) {
            bubble.classList.add('mentor-pointer-caption--movable');
            avatar.classList.add('mentor-pointer-handle');
            label.classList.add('mentor-pointer-handle');
            label.tabIndex = 0;
            label.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
        }
        if (options.note) {
            const note = document.createElement('span');
            note.className = 'mentor-pointer-note';
            note.textContent = options.note;
            body.appendChild(note);
        }
        if (options.controls) {
            body.appendChild(options.controls);
        }
        if (options.done && typeof options.done.onClick === 'function') {
            const controls = document.createElement('div');
            controls.className = 'mentor-pointer-tour';
            const done = document.createElement('button');
            done.type = 'button';
            done.className = 'mentor-pointer-tour-next';
            done.textContent = typeof options.done.text === 'string' ? options.done.text : '';
            done.addEventListener('click', function () { options.done.onClick(); });
            controls.appendChild(done);
            body.appendChild(controls);
        }
        if (options.back && typeof options.back.onClick === 'function') {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'mentor-pointer-back';
            back.textContent = typeof options.back.text === 'string' ? options.back.text : '';
            back.addEventListener('click', function () { options.back.onClick(); });
            body.appendChild(back);
        }
        bubble.appendChild(body);
        if (options.movable) {
            const minimize = document.createElement('button');
            minimize.type = 'button';
            minimize.className = 'mentor-pointer-minimize';
            minimize.setAttribute('aria-label', typeof options.minimizeLabel === 'string' ? options.minimizeLabel : 'Minimize');
            minimize.textContent = '\u2212';
            bubble.appendChild(minimize);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'mentor-pointer-close';
        close.setAttribute('aria-label', typeof options.closeLabel === 'string' ? options.closeLabel : 'Close');
        close.textContent = '\u00D7';
        close.addEventListener('click', function () { options.onClose(); });
        bubble.appendChild(close);
        return bubble;
    }

    // The bubble fades out rather than vanishing. While it fades it is only a picture: no longer
    // a live bubble to its callers, out of the accessibility tree, and not clickable.
    function fadeOut(bubble) {
        bubble.classList.replace('mentor-pointer-caption', 'mentor-pointer-caption-leaving');
        bubble.removeAttribute('role');
        bubble.setAttribute('aria-hidden', 'true');
        const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
            bubble.remove();
        } else {
            setTimeout(function () { bubble.remove(); }, FADE_MS);
        }
    }

    return { create: create, fadeOut: fadeOut, MAX_NOTE_CHARACTERS: MAX_NOTE_CHARACTERS };
})();
