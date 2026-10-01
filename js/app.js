/* ==========================================================================
   App shell - hash router and helpers shared by the views.

   A view is an object with mount(container, params, query). mount() may
   return a promise, and resolves to either a cleanup function or an object:
     { destroy(), refresh(), isDirty() }
   refresh() is called when fonts finish loading or the window is resized,
   because the layout engine measures real text.
   ========================================================================== */

var App = (function () {
    'use strict';

    var viewEl;
    var current = null;          // { destroy, refresh, isDirty }
    var currentHash = '';
    var token = 0;               // guards against a slow mount finishing after a newer navigation
    var suppress = false;

    var ROUTES = [
        { re: /^\/?$/,                     nav: 'dashboard', view: function () { return DashboardView; } },
        { re: /^\/invoices$/,              nav: 'invoices',  view: function () { return InvoicesView; } },
        { re: /^\/invoice\/([^/]+)$/,      nav: 'invoices',  view: function () { return EditorView; } },
        { re: /^\/customers(?:\/([^/]+))?$/, nav: 'customers', view: function () { return CustomersView; } },
        { re: /^\/templates\/([AB])$/,     nav: 'templates', view: function () { return DesignerView; } },
        { re: /^\/settings$/,              nav: 'settings',  view: function () { return SettingsView; } }
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

    function parseHash() {
        var raw = location.hash.replace(/^#/, '') || '/';
        var q = raw.indexOf('?');
        var path = q === -1 ? raw : raw.slice(0, q);
        var query = {};
        if (q !== -1) {
            raw.slice(q + 1).split('&').forEach(function (kv) {
                var i = kv.indexOf('=');
                if (i > 0) query[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
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

    function start() {
        viewEl = document.getElementById('view');

        DB.init().then(function () {
            return DB.listFonts().then(Fonts.registerCustom);
        }).then(function () {
            window.addEventListener('hashchange', onHashChange);
            window.addEventListener('resize', Dandy.debounce(refresh, 120));
            window.addEventListener('beforeunload', function (e) {
                if (current && current.isDirty && current.isDirty()) { e.preventDefault(); e.returnValue = ''; }
            });
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
            route();
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

    return { summarise: summarise, statusPill: statusPill, go: go, esc: esc, refresh: refresh };
})();
