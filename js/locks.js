/* ==========================================================================
   Locks - stops two tabs from editing the same thing at once.

   Built on the browser's Web Locks API. A lock belongs to a tab and is released
   automatically when that tab closes, crashes or navigates away, so unlike a
   "being edited" flag in the database it can never get stuck.

   What is locked
     dandyapp:invoice:<id>     one invoice, while it is open in the editor
     dandyapp:template:<A|B>   one template slot, while it is open in the designer
     dandyapp:customer:<id>    one customer, while it is open in the form
     dandyapp:settings         the Settings page (business details, defaults)
     dandyapp:numbering        a very short critical section that hands out invoice numbers

   A tab that cannot get the lock shows a read-only copy and unlocks itself the
   moment the other tab lets go. In a browser without Web Locks (very old ones)
   nothing is locked and the app behaves as it did before.
   ========================================================================== */

var Locks = (function () {
    'use strict';

    var supported = typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';
    var PREFIX = 'dandyapp:';
    var mine = {};                       // names this tab holds right now
    var handedOver = {};                 // name -> a hold taken by a waiter, to be claimed by the page that re-mounts

    var names = {
        invoice:   function (id)   { return PREFIX + 'invoice:' + id; },
        template:  function (slot) { return PREFIX + 'template:' + slot; },
        customer:  function (id)   { return PREFIX + 'customer:' + id; },
        settings:  PREFIX + 'settings',
        numbering: PREFIX + 'numbering'
    };

    var NOOP_HANDLE = { release: function () {}, unsupported: true };

    /* Take the lock if nobody has it, and keep it until release() is called.
       Resolves to a handle, or to null when another tab already holds it. */
    function acquire(name) {
        if (!supported) return Promise.resolve(NOOP_HANDLE);
        // A waiter already took the lock for this page (see whenFree): claim that hold.
        if (handedOver[name]) {
            var handle = handedOver[name];
            delete handedOver[name];
            return Promise.resolve(handle);
        }
        return new Promise(function (resolve) {
            navigator.locks.request(name, { ifAvailable: true }, function (lock) {
                if (!lock) { resolve(null); return; }
                mine[name] = true;
                return new Promise(function (held) {
                    resolve({ release: function () { delete mine[name]; held(); } });
                });
            }).catch(function () { resolve(null); });
        });
    }

    /* Call cb() once, as soon as the lock is free, with the lock already taken for this tab.

       The waiter keeps holding the lock and hands that same hold to the page that
       re-mounts, which claims it through acquire(). Releasing it and asking again
       would leave a gap in which this tab (or another waiting tab) grabs it first,
       and the page would lock itself out again, forever. Returns a cancel function. */
    function whenFree(name, cb) {
        if (!supported) return function () {};
        var controller = new AbortController();
        var fired = false;
        navigator.locks.request(name, { signal: controller.signal }, function () {
            fired = true;
            mine[name] = true;
            return new Promise(function (held) {
                var handle = { release: function () { delete mine[name]; delete handedOver[name]; held(); } };
                handedOver[name] = handle;
                cb();
                // If nothing claims it (the page went away meanwhile), do not hold the lock forever.
                setTimeout(function () { if (handedOver[name] === handle) handle.release(); }, 3000);
            });
        }).catch(function () { /* cancelled */ });
        return function cancel() { if (!fired) controller.abort(); };
    }

    /* Names of every lock currently held by any tab. */
    function heldNames() {
        if (!supported || !navigator.locks.query) return Promise.resolve([]);
        return navigator.locks.query().then(function (s) {
            return (s.held || []).map(function (l) { return l.name; });
        }, function () { return []; });
    }

    function heldElsewhere(name) {
        return heldNames().then(function (list) { return list.indexOf(name) !== -1 && !mine[name]; });
    }

    /* Is some other tab in the middle of editing something? */
    function editingElsewhere() {
        return heldNames().then(function (list) {
            return list.filter(function (n) { return n.indexOf(PREFIX) === 0 && n !== names.numbering && !mine[n]; });
        });
    }

    /* A short critical section that waits its turn. */
    function run(name, fn) {
        if (!supported) return Promise.resolve().then(fn);
        return navigator.locks.request(name, fn);
    }

    /* Run fn only if nobody else holds the lock. Resolves { ok: false } when somebody does. */
    function tryRun(name, fn) {
        if (!supported) return Promise.resolve().then(fn).then(function (value) { return { ok: true, value: value }; });
        return navigator.locks.request(name, { ifAvailable: true }, function (lock) {
            if (!lock) return { ok: false };
            return Promise.resolve().then(fn).then(function (value) { return { ok: true, value: value }; });
        });
    }

    /* Run fn (a view's render after it took a lock); if it fails, let go of the lock so
       this tab does not lock itself out of the same item until it is closed. */
    function guard(lock, fn) {
        return Promise.resolve().then(fn).catch(function (err) {
            if (lock && lock.release) lock.release();
            throw err;
        });
    }

    /* --- Read-only presentation ---------------------------------------------------------- */

    function bannerHtml(subject) {
        return '<p class="note note-warn mb-2 no-print lock-banner" role="status">' + Dandy.icon('lock') +
            '<span><b>' + Dandy.escapeHtml(subject) + ' is open in another tab, so it is locked here.</b><br>' +
            'It is read-only so the two tabs cannot overwrite each other. It unlocks by itself when the other tab closes or moves on.</span></p>';
    }

    /* Disable every control under root, except those matching keepSelector. */
    function freeze(root, keepSelector) {
        if (!root) return;
        root.classList.add('is-locked');
        Dandy.els('input, select, textarea, button', root).forEach(function (c) {
            if (keepSelector && c.matches(keepSelector)) return;
            c.disabled = true;
        });
    }

    /* --- Telling other tabs the data was replaced (a restored backup) ------------------------ */

    var channel = null;
    try { channel = new BroadcastChannel('dandyapp'); } catch (e) { /* not available: tabs just stay as they are */ }

    function announceReload() { if (channel) channel.postMessage({ type: 'reload' }); }
    function onReload(cb) {
        if (channel) channel.onmessage = function (e) { if (e.data && e.data.type === 'reload') cb(); };
    }

    return {
        supported: supported, names: names,
        acquire: acquire, guard: guard, whenFree: whenFree, heldNames: heldNames, heldElsewhere: heldElsewhere,
        editingElsewhere: editingElsewhere, run: run, tryRun: tryRun,
        bannerHtml: bannerHtml, freeze: freeze, announceReload: announceReload, onReload: onReload
    };
})();
