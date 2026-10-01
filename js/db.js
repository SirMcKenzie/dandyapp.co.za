/* ==========================================================================
   Data layer - Dexie (IndexedDB). The only file that touches storage.

   Tables
     invoices   one row per invoice; `client` is a snapshot, `customerId` a link
     customers  the customer book
     payments   money received against an invoice
     templates  the two layout slots, 'A' and 'B'
     settings   key/value: profile, activeTemplate, burned, dueDays, terms
     presets    reusable line items

   Invoices hold no layout. Rendering always reads the active template, so a
   template edit re-flows every invoice, old and new.
   ========================================================================== */

var DB = (function () {
    'use strict';

    var db = new Dexie('dandyapp');

    db.version(1).stores({
        invoices:  'id, number, status, customerId, date, dueDate, updated',
        customers: 'id, name',
        payments:  'id, invoiceId, date',
        templates: 'slot',
        settings:  'key',
        presets:   '++id'
    });

    // Added later: uploaded typefaces, kept as data URLs so they survive JSON backups.
    db.version(2).stores({ fonts: 'id' });

    var BACKUP_FORMAT = 'dandyapp-backup-v2';
    var TABLES = ['invoices', 'customers', 'payments', 'templates', 'settings', 'presets', 'fonts'];

    /* --- Settings ------------------------------------------------------------ */

    function getSetting(key, fallback) {
        return db.settings.get(key).then(function (row) {
            return row ? row.value : fallback;
        });
    }

    function setSetting(key, value) {
        return db.settings.put({ key: key, value: value });
    }

    function getProfile() {
        return getSetting('profile', null).then(function (p) {
            return Object.assign(Billing.blankProfile(), p || {});
        });
    }

    function saveProfile(p) { return setSetting('profile', p); }

    /* --- Numbering ------------------------------------------------------------
       The next number is the highest number still in use, plus one. "In use" is:
         - every invoice that exists, and
         - every number that was ever voided ("burned"), because a voided invoice
           keeps its number for good, even if it is un-voided and then deleted.

       So deleting the newest invoice hands its number back to the next new one
       (and deleting several from the end hands back several), while deleting an
       invoice from the middle leaves a gap: a later invoice already exists, and
       numbers of invoices that exist are never shifted.

       The result is a peek, not a reservation, so opening "New invoice" and
       walking away never uses a number up.
       ---------------------------------------------------------------------- */

    function numOf(number) {
        var m = /(\d+)\s*$/.exec(number || '');
        return m ? parseInt(m[1], 10) : 0;
    }

    function getBurned() { return getSetting('burned', []); }

    /* Highest number in use, ignoring one invoice (the one about to be deleted). */
    function highestInUse(exceptId) {
        return Promise.all([db.invoices.toArray(), getBurned()]).then(function (r) {
            var max = 0;
            r[0].forEach(function (i) { if (i.id !== exceptId) max = Math.max(max, numOf(i.number)); });
            r[1].forEach(function (n) { max = Math.max(max, n); });
            return max;
        });
    }

    function peekNumber() {
        return highestInUse(null).then(function (max) { return Billing.formatNumber(max + 1); });
    }

    /* Permanently retire a number. */
    function burnNumber(number) {
        var n = numOf(number);
        if (!n) return Promise.resolve();
        return getBurned().then(function (list) {
            if (list.indexOf(n) === -1) { list.push(n); return setSetting('burned', list); }
        });
    }

    /* What deleting this invoice does to the numbering:
         'reuse'  - it is the newest, so its number goes to the next new invoice
         'burned' - it was voided at some point, so its number stays used for good
         'gap'    - later invoices exist, so its number stays used and a gap is left */
    function numberFate(inv) {
        var n = numOf(inv.number);
        return Promise.all([getBurned(), highestInUse(inv.id)]).then(function (r) {
            if (r[0].indexOf(n) !== -1) return 'burned';
            return n === r[1] + 1 ? 'reuse' : 'gap';
        });
    }

    /* --- Invoices -------------------------------------------------------------- */

    function listInvoices() {
        return db.invoices.orderBy('updated').reverse().toArray();
    }

    function getInvoice(id) { return db.invoices.get(id).then(function (r) { return r || null; }); }

    function saveInvoice(inv) {
        inv.updated = Date.now();
        return db.invoices.put(inv).then(function () {
            // Voiding retires the number permanently, whatever happens to the invoice later.
            return inv.status === 'void' ? burnNumber(inv.number) : null;
        }).then(function () { return inv; });
    }

    /* True when a different invoice already uses this number. */
    function numberTaken(number, exceptId) {
        return db.invoices.where('number').equals(number).toArray().then(function (rows) {
            return rows.some(function (r) { return r.id !== exceptId; });
        });
    }

    function removeInvoice(id) {
        return db.transaction('rw', db.invoices, db.payments, function () {
            db.payments.where('invoiceId').equals(id).delete();
            db.invoices.delete(id);
        });
    }

    function duplicateInvoice(inv) {
        return getSetting('dueDays', Billing.DEFAULT_DUE_DAYS).then(function (days) {
            return peekNumber().then(function (number) {
                var copy = JSON.parse(JSON.stringify(inv));
                copy.id = Billing.newId('inv');
                copy.number = number;
                copy.status = 'draft';
                copy.date = Billing.today();
                copy.dueDate = Billing.addDays(copy.date, days);
                return saveInvoice(copy);
            });
        });
    }

    function newInvoice() {
        return Promise.all([getSetting('dueDays', Billing.DEFAULT_DUE_DAYS), getSetting('terms', Billing.DEFAULT_TERMS), peekNumber()])
            .then(function (r) {
                var inv = Billing.defaults({ dueDays: r[0], terms: r[1] });
                inv.number = r[2];
                return inv;
            });
    }

    /* --- Payments ---------------------------------------------------------------- */

    function paymentsFor(invoiceId) {
        return db.payments.where('invoiceId').equals(invoiceId).sortBy('date');
    }

    function allPayments() { return db.payments.toArray(); }

    function addPayment(p) {
        p.id = p.id || Billing.newId('pay');
        return db.payments.put(p).then(function () { return p; });
    }

    function removePayment(id) { return db.payments.delete(id); }

    /* --- Customers ---------------------------------------------------------------- */

    function listCustomers() { return db.customers.orderBy('name').toArray(); }
    function getCustomer(id) { return db.customers.get(id).then(function (r) { return r || null; }); }

    function saveCustomer(c) {
        c.name = (c.name || '').trim();
        return db.customers.put(c).then(function () { return c; });
    }

    function removeCustomer(id) { return db.customers.delete(id); }

    function saveCustomers(list) { return db.customers.bulkPut(list); }

    /* --- Templates ------------------------------------------------------------------ */

    /* Always returns a template that has passed Components.validate(). */
    function getTemplate(slot) {
        return db.templates.get(slot).then(function (row) {
            return Components.validate(row, slot);
        });
    }

    function saveTemplate(tpl) {
        var clean = Components.validate(tpl, tpl.slot);
        return db.templates.put(clean).then(function () { return clean; });
    }

    function resetTemplate(slot) {
        return saveTemplate(Components.defaultTemplate(slot));
    }

    function getActiveSlot() {
        return getSetting('activeTemplate', 'A').then(function (s) { return s === 'B' ? 'B' : 'A'; });
    }

    function setActiveSlot(slot) { return setSetting('activeTemplate', slot === 'B' ? 'B' : 'A'); }

    function getActiveTemplate() {
        return getActiveSlot().then(getTemplate);
    }

    /* --- Presets ---------------------------------------------------------------------- */

    function listPresets() { return db.presets.toArray(); }
    function addPreset(line) { return db.presets.add({ desc: line.desc, unit: line.unit, rate: line.rate }); }
    function removePreset(id) { return db.presets.delete(id); }

    /* --- Uploaded fonts --------------------------------------------------------------- */

    function listFonts() { return db.fonts.toArray(); }
    function saveFont(row) { return db.fonts.put(row).then(function () { return row; }); }
    function removeFont(id) { return db.fonts.delete(id); }

    /* --- Backup ------------------------------------------------------------------------ */

    function exportAll() {
        return Promise.all(TABLES.map(function (t) { return db[t].toArray(); })).then(function (rows) {
            var dump = { _format: BACKUP_FORMAT, _exported: new Date().toISOString(), data: {} };
            TABLES.forEach(function (t, i) { dump.data[t] = rows[i]; });
            return JSON.stringify(dump, null, 2);
        });
    }

    /* A backup the user is actually taking: remembers when, so the dashboard can say so. */
    function exportBackup() {
        return exportAll().then(function (json) {
            return setSetting('lastBackup', Date.now()).then(function () { return json; });
        });
    }

    function importAll(json) {
        var parsed;
        try { parsed = JSON.parse(json); } catch (e) { return Promise.reject(new Error('Not a DANDYAPP backup file')); }
        if (!parsed || parsed._format !== BACKUP_FORMAT || !parsed.data) {
            return Promise.reject(new Error('Not a DANDYAPP backup file'));
        }
        var tables = TABLES.map(function (t) { return db[t]; });
        return db.transaction('rw', tables, function () {
            var count = 0;
            TABLES.forEach(function (t) {
                var rows = Array.isArray(parsed.data[t]) ? parsed.data[t] : [];
                db[t].clear();
                db[t].bulkPut(rows);
                count += rows.length;
            });
            return count;
        }).then(function () {
            return TABLES.reduce(function (n, t) { return n + (Array.isArray(parsed.data[t]) ? parsed.data[t].length : 0); }, 0);
        });
    }

    /* --- One-time import of the pre-Dexie localStorage data ------------------------------
       localStorage is left untouched, so the old data stays as a fallback.
       ---------------------------------------------------------------------- */

    function migrateLegacy() {
        return getSetting('migrated', false).then(function (done) {
            if (done) return;

            var S = Dandy.Store;
            var oldDocs = (S.get('docs', []) || []).filter(function (d) { return d && d.kind === 'invoice'; });
            var oldClients = S.get('clients', []) || [];
            var oldProfile = S.get('profile', null);
            var oldPresets = S.get('presets', []) || [];
            var counters = S.get('counters', { invoice: 0 }) || {};

            var invoices = oldDocs.map(function (d) {
                var inv = Object.assign(Billing.defaults(), d);
                delete inv.kind; delete inv.ref; delete inv.depositPct;
                inv.lines = (d.lines || []).filter(function (l) { return !l.optional || l.included; }).map(function (l) {
                    return { desc: l.desc || '', qty: l.qty, unit: l.unit, rate: l.rate };
                });
                if (!inv.lines.length) inv.lines = [Billing.blankLine()];
                inv.client = Object.assign(Billing.blankClient(), d.client || {});
                inv.status = 'draft';
                inv.customerId = null;
                return inv;
            });

            var customers = oldClients.filter(function (c) { return c && c.name; }).map(function (c) {
                return { id: Billing.newId('cus'), name: c.name, phone: c.phone || '', email: c.email || '',
                         note: '', address: c.address || '', vatNo: c.vatNo || '' };
            });

            return db.transaction('rw', db.invoices, db.customers, db.settings, db.presets, function () {
                if (invoices.length) db.invoices.bulkPut(invoices);
                if (customers.length) db.customers.bulkPut(customers);
                if (oldPresets.length) db.presets.bulkAdd(oldPresets.map(function (p) { return { desc: p.desc, unit: p.unit, rate: p.rate }; }));
                if (oldProfile) db.settings.put({ key: 'profile', value: Object.assign(Billing.blankProfile(), oldProfile) });
                // The earlier app never reused a number, so every number it issued stays used.
                var issued = [];
                for (var n = 1; n <= (counters.invoice || 0); n++) issued.push(n);
                if (issued.length) db.settings.put({ key: 'burned', value: issued });
                db.settings.put({ key: 'migrated', value: true });
            });
        });
    }

    /* Databases from before this rule kept a running counter. Replace it with the
       burned list: only numbers of invoices that were already voided stay retired. */
    function upgradeNumbering() {
        return getSetting('numbering2', false).then(function (done) {
            if (done) return;
            return db.invoices.toArray().then(function (all) {
                var burned = all.filter(function (i) { return i.status === 'void'; })
                    .map(function (i) { return numOf(i.number); }).filter(Boolean);
                return getBurned().then(function (existing) {
                    existing.forEach(function (n) { if (burned.indexOf(n) === -1) burned.push(n); });
                    return setSetting('burned', burned);
                });
            }).then(function () { return db.settings.delete('counter'); })
              .then(function () { return setSetting('numbering2', true); });
        });
    }

    /* Open, migrate, and make sure both template slots exist. */
    function init() {
        return db.open()
            .then(migrateLegacy)
            .then(upgradeNumbering)
            .then(function () {
                return Promise.all(['A', 'B'].map(function (slot) {
                    return db.templates.get(slot).then(function (row) {
                        if (!row) return db.templates.put(Components.defaultTemplate(slot));
                    });
                }));
            });
    }

    return {
        init: init,
        getSetting: getSetting, setSetting: setSetting,
        getProfile: getProfile, saveProfile: saveProfile,
        peekNumber: peekNumber, numberFate: numberFate,
        listInvoices: listInvoices, getInvoice: getInvoice, saveInvoice: saveInvoice,
        removeInvoice: removeInvoice, numberTaken: numberTaken, duplicateInvoice: duplicateInvoice, newInvoice: newInvoice,
        paymentsFor: paymentsFor, allPayments: allPayments, addPayment: addPayment, removePayment: removePayment,
        listCustomers: listCustomers, getCustomer: getCustomer, saveCustomer: saveCustomer, saveCustomers: saveCustomers, removeCustomer: removeCustomer,
        getTemplate: getTemplate, saveTemplate: saveTemplate, resetTemplate: resetTemplate,
        getActiveSlot: getActiveSlot, setActiveSlot: setActiveSlot, getActiveTemplate: getActiveTemplate,
        listFonts: listFonts, saveFont: saveFont, removeFont: removeFont,
        listPresets: listPresets, addPreset: addPreset, removePreset: removePreset,
        exportAll: exportAll, exportBackup: exportBackup, importAll: importAll
    };
})();
