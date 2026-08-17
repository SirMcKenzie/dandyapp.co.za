/* ==========================================================================
   DANDYAPP core - storage, icons, toast, copy, reveal.
   Loaded by every page. Deliberately tiny and dependency-free.
   ========================================================================== */

(function (global) {
    'use strict';

    var NS = 'dandy.v1.';

    /* --- Storage ---------------------------------------------------------
       localStorage is the only persistence we have. It can be full, disabled
       (Safari private browsing), or cleared by the user at any time, so every
       access is guarded and every consumer gets a usable fallback.
       ------------------------------------------------------------------- */

    var available = (function () {
        try {
            var k = NS + '__probe';
            localStorage.setItem(k, '1');
            localStorage.removeItem(k);
            return true;
        } catch (e) {
            return false;
        }
    })();

    var memory = {};

    var Store = {
        available: available,

        get: function (key, fallback) {
            var raw;
            try {
                raw = available ? localStorage.getItem(NS + key) : memory[key];
            } catch (e) {
                raw = memory[key];
            }
            if (raw === null || raw === undefined) return fallback;
            try {
                return JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },

        set: function (key, value) {
            var raw = JSON.stringify(value);
            memory[key] = raw;
            if (!available) return false;
            try {
                localStorage.setItem(NS + key, raw);
                return true;
            } catch (e) {
                // Quota exceeded, or storage revoked mid-session.
                Dandy.toast('Could not save - browser storage is full');
                return false;
            }
        },

        remove: function (key) {
            delete memory[key];
            try { localStorage.removeItem(NS + key); } catch (e) { /* ignore */ }
        },

        keys: function () {
            var out = [];
            if (!available) return Object.keys(memory);
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
                }
            } catch (e) { /* ignore */ }
            return out;
        },

        /* Backup path. Storage this volatile needs an export or the tool is a trap. */
        exportAll: function () {
            var dump = { _format: 'dandyapp-backup', _version: 1, _exported: new Date().toISOString(), data: {} };
            Store.keys().forEach(function (k) {
                if (k.indexOf('__') === 0) return;
                dump.data[k] = Store.get(k, null);
            });
            return JSON.stringify(dump, null, 2);
        },

        importAll: function (json) {
            var parsed = JSON.parse(json);
            if (!parsed || parsed._format !== 'dandyapp-backup' || !parsed.data) {
                throw new Error('Not a DANDYAPP backup file');
            }
            var n = 0;
            Object.keys(parsed.data).forEach(function (k) {
                Store.set(k, parsed.data[k]);
                n++;
            });
            return n;
        }
    };

    /* --- Icons -----------------------------------------------------------
       A stroke-based set replacing the Font Awesome CDN. Path data only;
       the wrapper <svg> is generated so every icon is uniform.
       ------------------------------------------------------------------- */

    var PATHS = {
        'arrow-right':  '<path d="M5 12h14M13 5l7 7-7 7"/>',
        'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
        'check':        '<path d="m20 6-11 11-5-5"/>',
        'x':            '<path d="M18 6 6 18M6 6l12 12"/>',
        'copy':         '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
        'download':     '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
        'upload':       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
        'printer':      '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
        'plus':         '<path d="M12 5v14M5 12h14"/>',
        'trash':        '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
        'save':         '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
        'refresh':      '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
        'search':       '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
        'alert':        '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
        'info':         '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
        'shield':       '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        'braces':       '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
        'key':          '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.3-8.3M17 6l2 2M14 9l2 2"/>',
        'clock':        '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        'regex':        '<path d="M12 3v8M8.5 5l7 4M8.5 9l7-4"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 21h6"/>',
        'diff':         '<path d="M9 3v18M15 3v18M3 9h6M3 15h6M15 12h6"/>',
        'type':         '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
        'terminal':     '<path d="m4 17 6-5-6-5M12 19h8"/>',
        'fingerprint':  '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9M3 12a9 9 0 0 1 9-9M21 12a9 9 0 0 1-9 9M12 21a9 9 0 0 1-9-9"/>',
        'receipt':      '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2z"/><path d="M8 9h8M8 13h6"/>',
        'file-text':    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
        'chevron-right':'<path d="m9 6 6 6-6 6"/>',
        'link':         '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
        'zap':          '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
        'user':         '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    };

    function icon(name, className) {
        var d = PATHS[name];
        if (!d) return '';
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
            (className ? ' class="' + className + '"' : '') + '>' + d + '</svg>';
    }

    /* Replace every <i data-icon="name"> in a subtree with real SVG. */
    function hydrateIcons(root) {
        var nodes = (root || document).querySelectorAll('i[data-icon]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var markup = icon(el.getAttribute('data-icon'));
            if (!markup) continue;
            var tmp = document.createElement('span');
            tmp.innerHTML = markup;
            var svg = tmp.firstChild;
            if (el.className) svg.setAttribute('class', el.className);
            el.parentNode.replaceChild(svg, el);
        }
    }

    /* --- Toast ------------------------------------------------------------ */

    var toastEl, toastTimer;

    function toast(message) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.id = 'toast';
            toastEl.setAttribute('role', 'status');
            toastEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
    }

    /* --- Copy ------------------------------------------------------------- */

    function copy(text, label) {
        var done = function () { toast(label || 'Copied'); };
        var fail = function () { toast('Copy failed - select and press Cmd+C'); };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done, fail);
            return;
        }
        // file:// and plain http need the legacy path.
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy') ? done() : fail();
            document.body.removeChild(ta);
        } catch (e) {
            fail();
        }
    }

    /* --- Reveal on scroll -------------------------------------------------- */

    function reveal(root) {
        var targets = (root || document).querySelectorAll('.reveal');
        if (!targets.length) return;

        if (!('IntersectionObserver' in window)) {
            for (var i = 0; i < targets.length; i++) targets[i].classList.add('active');
            return;
        }
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });

        for (var j = 0; j < targets.length; j++) observer.observe(targets[j]);
    }

    /* --- Mobile navigation -------------------------------------------------
       The drawer is built from the page's own .pill-nav rather than repeated
       in every HTML file, so the two navigations can never drift apart. The
       burger and the drawer only exist below the pill nav's 1024px breakpoint.
       ------------------------------------------------------------------- */

    function mobileNav() {
        var header = document.querySelector('.site-header');
        var nav = header && header.querySelector('.pill-nav');
        if (!header || !nav) return;

        var burger = document.createElement('button');
        burger.className = 'burger';
        burger.type = 'button';
        burger.id = 'burger';
        burger.setAttribute('aria-label', 'Open menu');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-controls', 'nav-drawer');
        burger.innerHTML = '<span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>';
        header.appendChild(burger);

        var drawer = document.createElement('div');
        drawer.className = 'nav-drawer';
        drawer.id = 'nav-drawer';

        var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
        var cta = document.querySelector('.header-cta a');

        var items = links.map(function (a) {
            var current = a.getAttribute('aria-current') === 'page';
            return '<a href="' + escapeHtml(a.getAttribute('href')) + '"' +
                (current ? ' aria-current="page"' : '') +
                (a.classList.contains('credit') ? ' class="credit" rel="noopener"' : '') + '>' +
                escapeHtml(a.textContent.trim()) +
                (a.classList.contains('credit') ? icon('arrow-up-right') : icon('arrow-right')) +
                '</a>';
        }).join('');

        drawer.innerHTML =
            '<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Menu">' +
                '<div class="drawer-top">' +
                    '<span class="wordmark">DANDY<span>APP</span></span>' +
                    '<button type="button" class="drawer-close" aria-label="Close menu">' + icon('x') + '</button>' +
                '</div>' +
                '<nav class="drawer-links">' + items + '</nav>' +
                (cta ? '<a class="drawer-cta" href="' + escapeHtml(cta.getAttribute('href')) + '">' +
                    escapeHtml(cta.textContent.trim()) + icon('arrow-up-right') + '</a>' : '') +
            '</div>';

        document.body.appendChild(drawer);

        var lastFocus = null;

        function open() {
            lastFocus = document.activeElement;
            drawer.classList.add('open');
            burger.classList.add('is-open');
            burger.setAttribute('aria-expanded', 'true');
            burger.setAttribute('aria-label', 'Close menu');
            document.body.style.overflow = 'hidden';
            var first = drawer.querySelector('.drawer-links a');
            if (first) first.focus();
        }

        function close() {
            drawer.classList.remove('open');
            burger.classList.remove('is-open');
            burger.setAttribute('aria-expanded', 'false');
            burger.setAttribute('aria-label', 'Open menu');
            document.body.style.overflow = '';
            if (lastFocus && lastFocus.focus) lastFocus.focus();
        }

        function isOpen() { return drawer.classList.contains('open'); }

        burger.addEventListener('click', function () { isOpen() ? close() : open(); });
        drawer.querySelector('.drawer-close').addEventListener('click', close);

        // Tapping the dimmed area outside the panel closes it.
        drawer.addEventListener('click', function (e) { if (e.target === drawer) close(); });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(); }
        });

        // Growing past the breakpoint hides the burger; the drawer must not be
        // left open and locking scroll behind it. The breakpoint itself lives
        // in the stylesheet, so ask whether the burger is still rendered
        // rather than duplicating the number here.
        window.addEventListener('resize', debounce(function () {
            if (isOpen() && getComputedStyle(burger).display === 'none') close();
        }, 100));
    }

    /* --- Small helpers ----------------------------------------------------- */

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function debounce(fn, ms) {
        var t;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms || 150);
        };
    }

    function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function download(filename, text, mime) {
        var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    var Dandy = {
        Store: Store,
        icon: icon,
        hydrateIcons: hydrateIcons,
        toast: toast,
        copy: copy,
        escapeHtml: escapeHtml,
        debounce: debounce,
        download: download,
        els: els
    };

    global.Dandy = Dandy;

    document.addEventListener('DOMContentLoaded', function () {
        hydrateIcons(document);
        reveal(document);
        mobileNav();
    });

})(window);
