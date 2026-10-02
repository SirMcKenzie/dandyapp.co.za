/* ==========================================================================
   App shell - hash router and helpers shared by the views.

   A view is an object with mount(container, params, query). mount() may
   return a promise, and resolves to either a cleanup function or an object:
     { destroy(), refresh(), isDirty(), pendingSave() }
   refresh() is called when fonts finish loading or the window is resized,
   because the layout engine measures real text.
   pendingSave() starts saving anything unsaved and returns true if there was something to save,
   so closing the tab can be held up until the write lands.
   ========================================================================== */

var App = (function () {
    'use strict';

    var viewEl;
    var current = null;          // { destroy, refresh, isDirty }
    var currentHash = '';
    var token = 0;               // guards against a slow mount finishing after a newer navigation
    var suppress = false;
    var HOME_TITLE = document.title;     // the long, descriptive title belongs to the home page only

    var ROUTES = [
        { re: /^\/?$/,                     nav: 'dashboard', title: '',          view: function () { return DashboardView; } },
        { re: /^\/invoices$/,              nav: 'invoices',  title: 'Invoices',  view: function () { return InvoicesView; } },
        { re: /^\/invoice\/([^/]+)$/,      nav: 'invoices',  title: 'Invoice',   view: function () { return EditorView; } },
        { re: /^\/customers(?:\/([^/]+))?$/, nav: 'customers', title: 'Customers', view: function () { return CustomersView; } },
        { re: /^\/templates\/([AB])$/,     nav: 'templates', title: 'Templates', view: function () { return DesignerView; } },
        { re: /^\/settings$/,              nav: 'settings',  title: 'Settings',  view: function () { return SettingsView; } }
    ];

    function esc(s) { return Dandy.escapeHtml(s == null ? '' : s); }

    /* --- Shared helpers ------------------------------------------------------ */

    /* Pair every invoice with its payments and derived numbers. */
    function summarise(invoices, payments) {
        var byInvoice = {};
        payments.forEach(function (p) { (byInvoice[p.invoiceId] = byInvoice[p.invoiceId] || []).push(p); });
        return invoices.map(function (inv) {
            var pays = byInvoice[inv.id] || [];
            var total = Billing.calcTotals(inv).total;
            var paid = Billing.paidTotal(pays);
            return {
                inv: inv, pays: pays, total: total, paid: paid,
                balance: total - paid,
                status: Billing.derivedStatus(inv, pays)
            };
        });
    }

    function statusPill(status) {
        return '<span class="st st-' + status + '">' + esc(Billing.STATUS_LABEL[status]) + '</span>';
    }

    /* A hand-typed or truncated link can hold a bad escape such as "%"; keep the raw text then. */
    function safeDecode(s) {
        try { return decodeURIComponent(s); } catch (e) { return s; }
    }

    function parseHash() {
        var raw = location.hash.replace(/^#/, '') || '/';
        var q = raw.indexOf('?');
        var path = q === -1 ? raw : raw.slice(0, q);
        var query = {};
        if (q !== -1) {
            raw.slice(q + 1).split('&').forEach(function (kv) {
                var i = kv.indexOf('=');
                if (i > 0) query[safeDecode(kv.slice(0, i))] = safeDecode(kv.slice(i + 1));
            });
        }
        return { path: path, query: query };
    }

    function go(hash) { location.hash = hash; }

    /* --- Navigation state -------------------------------------------------------- */

    function setNav(section) {
        Dandy.els('.pill-nav a[data-nav]').forEach(function (a) {
            if (a.dataset.nav === section) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
        // The drawer is cloned from the pill nav at load, so match by href.
        var hrefs = {};
        Dandy.els('.pill-nav a[data-nav]').forEach(function (a) { hrefs[a.getAttribute('href')] = a.dataset.nav; });
        Dandy.els('.nav-drawer .drawer-links a').forEach(function (a) {
            if (hrefs[a.getAttribute('href')] === section) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
        var drawer = document.getElementById('nav-drawer');
        if (drawer && drawer.classList.contains('open')) document.getElementById('burger').click();
    }

    /* Each view gets its own tab title, a screen-reader announcement, and the
       "about" text (which exists for people and crawlers arriving at the home page) only on home. */
    function setPage(match) {
        document.title = match.title ? match.title + ' | DANDYAPP' : HOME_TITLE;
        var announcer = document.getElementById('route-announcer');
        if (announcer) announcer.textContent = match.title || 'Dashboard';
        var about = document.getElementById('about');
        if (about) about.hidden = match.nav !== 'dashboard';
    }

    /* --- Router -------------------------------------------------------------------- */

    function normalise(view) {
        if (typeof view === 'function') return { destroy: view };
        return view || {};
    }

    function route() {
        var where = parseHash();
        var match = null, params = [];

        for (var i = 0; i < ROUTES.length && !match; i++) {
            var m = ROUTES[i].re.exec(where.path);
            if (m) { match = ROUTES[i]; params = m.slice(1); }
        }
        if (!match) { go('#/'); return; }

        var mine = ++token;
        var leaving = current;
        current = null;
        currentHash = location.hash;

        Promise.resolve(leaving && leaving.destroy ? leaving.destroy() : null).then(function () {
            if (mine !== token) return;
            viewEl.innerHTML = '';
            setNav(match.nav);
            setPage(match);
            window.scrollTo(0, 0);
            return Promise.resolve(match.view().mount(viewEl, params, where.query)).then(function (v) {
                if (mine !== token) { if (v) normalise(v).destroy && normalise(v).destroy(); return; }
                current = normalise(v);
                Dandy.hydrateIcons(viewEl);
            });
        }).catch(function (err) {
            console.error(err);
            viewEl.innerHTML = '<div class="panel"><p class="note note-bad">' + Dandy.icon('alert') +
                '<span>Something went wrong loading this page: ' + esc(err && err.message) + '</span></p></div>';
            Dandy.hydrateIcons(viewEl);
        });
    }

    function onHashChange() {
        if (suppress) { suppress = false; return; }
        // A designer with unsaved changes gets one chance to stop the navigation.
        if (current && current.isDirty && current.isDirty() &&
            !window.confirm('Discard your unsaved template changes?')) {
            suppress = true;
            location.hash = currentHash;
            return;
        }
        route();
    }

    function refresh() { if (current && current.refresh) current.refresh(); }

    /* Draw the current page again (used when a tab that was locked out becomes free). */
    function reload() { route(); }

    /* Makes the app installable and usable offline. Network first, so it never serves stale files while online. */
    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        var register = function () { navigator.serviceWorker.register('/sw.js').catch(function () { /* optional enhancement */ }); };
        if (document.readyState === 'complete') register(); else window.addEventListener('load', register);
    }

    function start() {
        viewEl = document.getElementById('view');

        var ver = document.getElementById('app-version');
        if (ver && Config.version) { ver.textContent = Config.version; ver.hidden = false; }

        DB.init().then(function () {
            return DB.listFonts().then(Fonts.registerCustom);
        }).then(function () {
            window.addEventListener('hashchange', onHashChange);
            window.addEventListener('resize', Dandy.debounce(refresh, 120));
            window.addEventListener('beforeunload', function (e) {
                var unsaved = current && current.isDirty && current.isDirty();
                var saving = current && current.pendingSave && current.pendingSave();
                if (unsaved || saving) { e.preventDefault(); e.returnValue = ''; }
            });
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
            route();
            registerServiceWorker();
            // A backup restored in another tab replaced the data this tab is showing.
            Locks.onReload(function () { location.reload(); });
        }).catch(function (err) {
            console.error(err);
            viewEl.innerHTML = '<div class="panel"><p class="note note-bad">' + Dandy.icon('alert') +
                '<span><b>Storage is unavailable.</b><br>This app keeps your invoices in your browser\'s IndexedDB, ' +
                'which is blocked here (private browsing, or site data disabled). Open it in a normal window.' +
                '<br><small>' + esc(err && err.message) + '</small></span></p></div>';
            Dandy.hydrateIcons(viewEl);
        });
    }

    document.addEventListener('DOMContentLoaded', start);

    return { summarise: summarise, statusPill: statusPill, go: go, esc: esc, refresh: refresh, reload: reload };
})();
