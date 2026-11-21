// Removes the elements, attributes and URL schemes that can run script from HTML that comes from authors,
// other users or the API, before it is put on the page. Shared by the instructions (instructions-processor.js)
// and lab notifications on the instructions and virtualization client pages.
//
// This is a block-list: anything it doesn't name is kept. AB#109091 replaces it with an allow-list sanitizer.
const htmlSanitizer = (() => {
    'use strict';

    /**
     * Determine if an HTML element should be removed based on its tag name and attributes.
     *
     * @param {HTMLElement} element the HTML element to check
     * @returns {boolean} true if the element should be removed, false otherwise
     */
    function shouldRemoveElement(element) {
        const tagName = element.tagName.toLowerCase();
        // noscript: its text is parsed as markup here but written back as raw markup once the nodes join the page, so
        // escaped tags inside it come back as live elements when the result is shown. base and meta: a base href
        // changes how the whole page resolves relative links, and a meta refresh navigates away.
        const blockedHtmlElements = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'noscript', 'base', 'meta']);
        const trustedEmbedIframeSrcPattern = /^(https?:)?\/\/(?:www\.)?youtube\.com\/embed\//i;

        if (!blockedHtmlElements.has(tagName)) {
            return false;
        }

        if (tagName !== 'iframe') {
            return true;
        }

        const src = element.getAttribute('src');

        return src == null || !trustedEmbedIframeSrcPattern.test(src.trim());
    }

    /**
     * Handle sanitizing an HTML element
     *
     * @param {HTMLElement} element the element to sanitize
     */
    function sanitizeElement(element) {
        // Avoid non-element nodes
        if (element.nodeType !== 1) {
            return;
        }

        if (shouldRemoveElement(element)) {
            element.remove();
            return;
        }

        sanitizeUnsafeAttributes(element);

        // Sanitize child elements. A copy is walked because removing a child shifts the live list, which would skip
        // the sibling after every removed element.
        Array.from(element.children).forEach((child) => sanitizeElement(child));
    }

    /**
     * Handles sanitizing HTML content before injecting it into the DOM
     *
     * @param {string} rawHTML the HTML content to sanitize
     * @returns sanitized HTML
     */
    function sanitizeHTML(rawHTML) {
        let sanitisedHTML = $.parseHTML(rawHTML);
        const wrapper = document.createElement('div');

        sanitisedHTML.forEach((node) => wrapper.appendChild(node));

        // Sanitize parsed HTML elements
        Array.from(wrapper.childNodes).forEach((node) => {
            if (node.nodeType === 1) {
                sanitizeElement(node);
            }
        });

        return Array.from(wrapper.childNodes);
    }

    /**
     * Handle sanitizing unsafe attributes on an HTML element
     *
     * @param {HTMLElement} element the HTML element to sanitize
     */
    function sanitizeUnsafeAttributes(element) {
        let attributes = element.attributes;

        for (let i = attributes.length - 1; i >= 0; i--) {
            const attribute = attributes[i];
            const name = attribute.name.toLowerCase();
            // A browser drops tabs and newlines anywhere in a URL, and control characters or spaces before it, so
            // "java<tab>script:" still runs as javascript:. Strip them the same way before checking the scheme.
            const value = attribute.value.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '').toLowerCase();

            if (
                name.startsWith('on') || // Remove event handler attributes (e.g., onclick, onmouseover)
                name === 'srcdoc' || // Remove inline iframe HTML
                name === 'srcset' || // Remove srcset attribute to prevent loading multiple sources
                value.startsWith('javascript:') || // Remove javascript: URLs
                value.startsWith('data:') || // Remove data: URLs to prevent embedding potentially unsafe content
                value.startsWith('vbscript:') // Remove vbscript: URLs (legacy, but still a potential risk)
            ) {
                element.removeAttribute(name);
            }
        }
    }

    /**
     * Sanitizes an HTML string and returns it as a string, for code that builds or passes markup as text.
     *
     * @param {string} rawHTML the HTML content to sanitize; null or undefined gives an empty string
     * @returns {string} the sanitized HTML
     */
    function sanitizeToString(rawHTML) {
        if (rawHTML === null || rawHTML === undefined || rawHTML === '') {
            return '';
        }
        const wrapper = document.createElement('div');
        sanitizeHTML(String(rawHTML)).forEach((node) => wrapper.appendChild(node));
        return wrapper.innerHTML;
    }

    return {
        sanitize: sanitizeHTML,
        sanitizeToString: sanitizeToString,
    };
})();
