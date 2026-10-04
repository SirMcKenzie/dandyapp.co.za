/* ==========================================================================
   Tour - a short walkthrough shown to a first-time visitor.

   Whether it has been seen is remembered in localStorage (Dandy.Store, key "tourSeen"),
   so a returning visitor goes straight to the app. It is marked seen the moment it opens,
   so a refresh half way through never brings it back. The footer link opens it again.
   Raise VERSION to show an updated tour to people who have already seen the old one.
   ========================================================================== */

var Tour = (function () {
    'use strict';

    var KEY = 'tourSeen';
    var VERSION = 1;

    var STEPS = [
        { nav: 'Dashboard', title: 'Your dashboard', img: 'dashboard',
          text: 'See what you have invoiced, been paid and are still owed, and who owes you. Download a backup here now and then, because your data lives only in this browser.' },
        { nav: 'Settings', title: 'Start with Settings', img: 'settings',
          text: 'Add your business name, VAT number, address, logo and banking details once. They appear on every invoice. Restore a backup here too.' },
        { nav: 'Customers', title: 'Keep a customer book', img: 'customers',
          text: 'Add customers one by one or import a CSV. Pick them on an invoice and their details fill in for you.' },
        { nav: 'Templates', title: 'Design your invoice', img: 'designer',
          text: 'Drag, resize and recolour the parts of the page and choose your fonts. You can keep two layouts and switch between them any time.' },
        { nav: 'New invoice', title: 'Create an invoice', img: 'editor',
          text: 'Pick a customer, add lines, set VAT and record payments while the preview updates. It warns you if a SARS detail is missing. Download PDF to save or print it.' },
        { nav: 'Invoices', title: 'Find every invoice', img: 'invoices',
          text: 'Search, filter by status, mark invoices as sent, void or duplicate them, and see who has paid.' }
    ];

    var root = null, index = 0, lastFocus = null;

    function seen() { return Dandy.Store.get(KEY, 0) >= VERSION; }

    function el(id) { return root.querySelector('#' + id); }

    function build() {
        root = document.createElement('div');
        root.className = 'tour';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'tour-title');
        root.innerHTML =
            '<div class="tour-window">' +
                '<button type="button" class="tour-x" id="tour-x" aria-label="Close tour">' + Dandy.icon('x') + '</button>' +
                '<div class="tour-shot"><img id="tour-img" alt="" width="1440" height="900" decoding="async"></div>' +
                '<div class="tour-body">' +
                    '<p class="tour-step" id="tour-step"></p>' +
                    '<h2 id="tour-title"></h2>' +
                    '<p class="tour-text" id="tour-text"></p>' +
                '</div>' +
                '<div class="tour-foot">' +
                    '<div class="tour-dots" id="tour-dots" aria-hidden="true"></div>' +
                    '<div class="btn-row">' +
                        '<button type="button" class="btn btn-sm" id="tour-skip">Skip</button>' +
                        '<button type="button" class="btn btn-sm" id="tour-back">Back</button>' +
                        '<button type="button" class="btn btn-dark btn-sm" id="tour-next"></button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(root);

        el('tour-dots').innerHTML = STEPS.map(function () { return '<i></i>'; }).join('');
        el('tour-x').addEventListener('click', close);
        el('tour-skip').addEventListener('click', close);
        el('tour-back').addEventListener('click', function () { show(index - 1); });
        el('tour-next').addEventListener('click', function () { index === STEPS.length - 1 ? close() : show(index + 1); });
        root.addEventListener('click', function (e) { if (e.target === root) close(); });
    }

    function show(i) {
        index = Math.max(0, Math.min(STEPS.length - 1, i));
        var s = STEPS[index], last = index === STEPS.length - 1;
        var img = el('tour-img');
        img.src = '/assets/screenshots/' + s.img + '.png';
        img.alt = 'Screenshot of the ' + s.nav + ' page';
        el('tour-step').textContent = 'Step ' + (index + 1) + ' of ' + STEPS.length + ' - ' + s.nav;
        el('tour-title').textContent = s.title;
        el('tour-text').textContent = s.text;
        el('tour-back').hidden = index === 0;
        el('tour-skip').hidden = last;
        el('tour-next').textContent = last ? 'Get started' : 'Next';
        Dandy.els('#tour-dots i', root).forEach(function (d, n) { d.classList.toggle('on', n === index); });
        if (STEPS[index + 1]) new Image().src = '/assets/screenshots/' + STEPS[index + 1].img + '.png';
        el('tour-next').focus();
    }

    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'ArrowRight' && index < STEPS.length - 1) show(index + 1);
        else if (e.key === 'ArrowLeft' && index > 0) show(index - 1);
        else if (e.key === 'Tab') {
            // Keep focus inside the window while it is open.
            var items = Dandy.els('button:not([hidden])', root);
            var first = items[0], end = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
            else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
        }
    }

    function open() {
        if (root) return;
        lastFocus = document.activeElement;
        Dandy.Store.set(KEY, VERSION);
        build();
        show(0);
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKey);
        requestAnimationFrame(function () { root && root.classList.add('open'); });
    }

    function close() {
        if (!root) return;
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = '';
        root.remove();
        root = null;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    /* Called once the app has drawn its first page. */
    function maybeStart() { if (!seen()) open(); }

    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('[data-tour]');
        if (t) { e.preventDefault(); open(); }
    });

    return { open: open, maybeStart: maybeStart };
})();
