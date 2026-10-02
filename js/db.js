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

    function writeInvoice(inv) {
        inv.updated = Date.now();
        return db.invoices.put(inv).then(function () {
            // Voiding retires the number permanently, whatever happens to the invoice later.
            return inv.status === 'void' ? burnNumber(inv.number) : null;
        }).then(function () { return inv; });
    }

    /* `opts.autoNumber` is the number this brand-new invoice was offered when it was
       created. Another tab may have used it since, so on the very first save the
       number is checked again inside the numbering lock, one tab at a time. If it
       was taken, the invoice quietly gets the next free one (the caller can see
       inv.number changed). A number the user typed themselves is never touched. */
    function saveInvoice(inv, opts) {
        if (!opts || !opts.autoNumber) return writeInvoice(inv);
        return Locks.run(Locks.names.numbering, function () {
            return db.invoices.get(inv.id).then(function (existing) {
                if (existing) return writeInvoice(inv);
                return numberTaken(inv.number, inv.id).then(function (taken) {
                    if (!taken || inv.number !== opts.autoNumber) return writeInvoice(inv);
                    return peekNumber().then(function (next) { inv.number = next; return writeInvoice(inv); });
                });
            });
        });
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
                return saveInvoice(copy, { autoNumber: number });
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

    /* --- Importing a backup -----------------------------------------------------------------
       A backup is a file from outside, so nothing in it is trusted. Every row is rebuilt
       from known fields with known types and sizes; rows that cannot be repaired are
       dropped and counted. A damaged or hand-edited file therefore cannot crash the app,
       and cannot make it fetch an address, because only data: images and fonts are kept.
       ---------------------------------------------------------------------- */

    var SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
    var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    var FONT_ID = /^u_[a-z0-9]{1,30}$/;
    var FONT_URL = /^data:font\/(woff2|woff|ttf|otf);base64,[A-Za-z0-9+\/]+=*$/;
    var LOGO_TYPES = ['png', 'jpeg', 'gif', 'webp', 'svg+xml', 'avif', 'bmp'];     // the logo upload accepts exactly these
    var IMAGE_URL = new RegExp('^data:image/(' + LOGO_TYPES.map(function (t) { return t.replace('+', '\\+'); }).join('|') + ');base64,[A-Za-z0-9+/]+=*$');

    function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 500) : ''; }
    function num(v, fallback) { v = parseFloat(v); return isFinite(v) ? v : fallback; }
    function oneOf(v, list, fallback) { return list.indexOf(v) !== -1 ? v : fallback; }

    function cleanInvoice(r) {
        if (!r || typeof r !== 'object' || !SAFE_ID.test(r.id)) return null;
        var inv = Billing.defaults();
        var c = r.client && typeof r.client === 'object' ? r.client : {};
        inv.id = r.id;
        inv.number = str(r.number, 40);
        inv.status = oneOf(r.status, ['draft', 'sent', 'void'], 'draft');
        inv.date = DATE_RE.test(r.date) ? r.date : inv.date;
        inv.dueDate = DATE_RE.test(r.dueDate) ? r.dueDate : inv.dueDate;
        inv.reference = str(r.reference, 80);
        inv.customerId = typeof r.customerId === 'string' && SAFE_ID.test(r.customerId) ? r.customerId : null;
        inv.client = { name: str(c.name, 120), email: str(c.email, 120), phone: str(c.phone, 40), address: str(c.address, 300), vatNo: str(c.vatNo, 40) };
        inv.lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, 500).map(function (l) {
            l = l && typeof l === 'object' ? l : {};
            return { desc: str(l.desc, 300), qty: num(l.qty, 0), unit: str(l.unit, 20) || 'each', rate: num(l.rate, 0) };
        });
        if (!inv.lines.length) inv.lines = [Billing.blankLine()];
        inv.vatMode = oneOf(r.vatMode, ['exclusive', 'inclusive', 'none'], 'exclusive');
        inv.vatRate = Math.min(1, Math.max(0, num(r.vatRate, Billing.VAT_RATE)));
        inv.currency = oneOf(r.currency, Billing.CURRENCIES.map(function (c) { return c.code; }), 'ZAR');
        inv.notes = str(r.notes, 2000);
        inv.terms = str(r.terms, 2000);
        inv.updated = num(r.updated, Date.now());
        return inv;
    }

    function cleanCustomer(r) {
        if (!r || typeof r !== 'object' || !SAFE_ID.test(r.id) || !str(r.name, 120).trim()) return null;
        return { id: r.id, name: str(r.name, 120), phone: str(r.phone, 40), email: str(r.email, 120),
                 note: str(r.note, 1000), address: str(r.address, 300), vatNo: str(r.vatNo, 40) };
    }

    function cleanPayment(r) {
        if (!r || typeof r !== 'object' || !SAFE_ID.test(r.id) || !SAFE_ID.test(r.invoiceId)) return null;
        var cents = Math.round(num(r.amountCents, NaN));
        if (!isFinite(cents)) return null;
        return { id: r.id, invoiceId: r.invoiceId, date: DATE_RE.test(r.date) ? r.date : Billing.today(),
                 amountCents: cents, method: str(r.method, 20), note: str(r.note, 200) };
    }

    function cleanTemplateRow(r) {
        if (!r || typeof r !== 'object' || (r.slot !== 'A' && r.slot !== 'B')) return null;
        return Components.validate(r, r.slot);
    }

    function cleanPreset(r) {
        if (!r || typeof r !== 'object' || !str(r.desc, 300).trim()) return null;
        return { desc: str(r.desc, 300), unit: str(r.unit, 20) || 'each', rate: typeof r.rate === 'number' ? r.rate : str(String(r.rate == null ? '' : r.rate), 20) };
    }

    function cleanFontRow(r) {
        if (!r || typeof r !== 'object' || !FONT_ID.test(r.id) || typeof r.dataUrl !== 'string' ||
            r.dataUrl.length > 2200000 || !FONT_URL.test(r.dataUrl)) return null;
        return { id: r.id, name: str(r.name, 40) || 'Uploaded font', dataUrl: r.dataUrl, size: num(r.size, 0), added: num(r.added, Date.now()) };
    }

    function cleanProfile(p) {
        p = p && typeof p === 'object' ? p : {};
        var out = Billing.blankProfile();
        Object.keys(out).forEach(function (k) { if (k !== 'logo') out[k] = str(p[k], k === 'address' ? 300 : 120); });
        out.logo = typeof p.logo === 'string' && p.logo.length < 400000 && IMAGE_URL.test(p.logo) ? p.logo : '';
        return out;
    }

    /* Settings are an allow-list with a type per key; anything else is dropped. */
    function cleanSetting(r) {
        if (!r || typeof r !== 'object' || typeof r.key !== 'string') return null;
        var v = r.value;
        switch (r.key) {
            case 'profile':        return { key: 'profile', value: cleanProfile(v) };
            case 'activeTemplate': return { key: 'activeTemplate', value: v === 'B' ? 'B' : 'A' };
            case 'dueDays':        return { key: 'dueDays', value: Math.min(365, Math.max(0, Math.round(num(v, Billing.DEFAULT_DUE_DAYS)))) };
            case 'terms':          return { key: 'terms', value: str(v, 2000) };
            case 'lastBackup':     return { key: 'lastBackup', value: num(v, 0) };
            case 'burned':         return { key: 'burned', value: (Array.isArray(v) ? v : []).map(function (n) { return Math.round(num(n, 0)); })
                                                                    .filter(function (n) { return n > 0; }).slice(0, 100000) };
            case 'migrated':
            case 'numbering2':     return { key: r.key, value: v === true };
            default:               return null;
        }
    }

    var CLEANERS = {
        invoices: cleanInvoice, customers: cleanCustomer, payments: cleanPayment, templates: cleanTemplateRow,
        settings: cleanSetting, presets: cleanPreset, fonts: cleanFontRow
    };

    /* Turn a first-version backup into the current shape. Its rows still go through the cleaners below. */
    function fromLegacyBackup(old) {
        var rows = legacyRows(function (k, fallback) { return old.data[k] == null ? fallback : old.data[k]; });
        var settings = [{ key: 'burned', value: rows.burned }, { key: 'migrated', value: true }, { key: 'numbering2', value: true }];
        if (rows.profile) settings.push({ key: 'profile', value: rows.profile });
        return {
            _format: BACKUP_FORMAT,
            data: {
                invoices: rows.invoices, customers: rows.customers, presets: rows.presets, payments: [], fonts: [],
                templates: ['A', 'B'].map(Components.defaultTemplate), settings: settings
            }
        };
    }

    /* Resolves to { count, skipped }. */
    function importAll(json) {
        var parsed;
        try { parsed = JSON.parse(json); } catch (e) { return Promise.reject(new Error('Not a DANDYAPP backup file')); }
        if (parsed && parsed._format === 'dandyapp-backup' && parsed.data && typeof parsed.data === 'object') {
            parsed = fromLegacyBackup(parsed);        // a file saved by the first version of the app
        }
        if (!parsed || parsed._format !== BACKUP_FORMAT || !parsed.data || typeof parsed.data !== 'object') {
            return Promise.reject(new Error('Not a DANDYAPP backup file'));
        }

        var clean = {}, count = 0, skipped = 0;
        TABLES.forEach(function (t) {
            var raw = Array.isArray(parsed.data[t]) ? parsed.data[t] : [];
            clean[t] = raw.map(CLEANERS[t]).filter(Boolean);
            count += clean[t].length;
            skipped += raw.length - clean[t].length;
        });
        // A logo of a type we cannot keep is dropped from the business profile; say so.
        (parsed.data.settings || []).forEach(function (r) {
            var logo = r && r.key === 'profile' && r.value && r.value.logo;
            var kept = clean.settings.filter(function (c) { return c.key === 'profile'; })[0];
            if (logo && kept && !kept.value.logo) skipped++;
        });

        // A payment for an invoice that is not in the file would be an orphan.
        var invoiceIds = {};
        clean.invoices.forEach(function (i) { invoiceIds[i.id] = true; });
        var before = clean.payments.length;
        clean.payments = clean.payments.filter(function (p) { return invoiceIds[p.invoiceId]; });
        count -= before - clean.payments.length;
        skipped += before - clean.payments.length;

        var tables = TABLES.map(function (t) { return db[t]; });
        return db.transaction('rw', tables, function () {
            TABLES.forEach(function (t) { db[t].clear(); db[t].bulkPut(clean[t]); });
        }).then(function () { return { count: count, skipped: skipped }; });
    }

    /* --- The pre-Dexie (localStorage) data ------------------------------------------------
       The first version of the app kept everything in localStorage and could export it as a
       "dandyapp-backup" file. Both the one-time migration below and the import of such a
       file use legacyRows(), which turns that shape into rows for the current tables.
       `get(key, fallback)` reads one key of the old data.
       ---------------------------------------------------------------------- */

    function legacyRows(get) {
        var oldDocs = (get('docs', []) || []).filter(function (d) { return d && d.kind === 'invoice'; });
        var oldClients = get('clients', []) || [];
        var oldProfile = get('profile', null);
        var oldPresets = get('presets', []) || [];
        var counters = get('counters', { invoice: 0 }) || {};

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

        // The earlier app never reused a number, so every number it issued stays used.
        var burned = [];
        for (var n = 1; n <= Math.min(counters.invoice || 0, 100000); n++) burned.push(n);

        return {
            invoices: invoices,
            customers: customers,
            presets: oldPresets.filter(Boolean).map(function (p) { return { desc: p.desc, unit: p.unit, rate: p.rate }; }),
            profile: oldProfile ? Object.assign(Billing.blankProfile(), oldProfile) : null,
            burned: burned
        };
    }

    function migrateLegacy() {
        return getSetting('migrated', false).then(function (done) {
            if (done) return;
            var rows = legacyRows(Dandy.Store.get);       // localStorage is left untouched, so the old data stays as a fallback

            return db.transaction('rw', db.invoices, db.customers, db.settings, db.presets, function () {
                if (rows.invoices.length) db.invoices.bulkPut(rows.invoices);
                if (rows.customers.length) db.customers.bulkPut(rows.customers);
                if (rows.presets.length) db.presets.bulkAdd(rows.presets);
                if (rows.profile) db.settings.put({ key: 'profile', value: rows.profile });
                if (rows.burned.length) db.settings.put({ key: 'burned', value: rows.burned });
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
        exportAll: exportAll, exportBackup: exportBackup, importAll: importAll, LOGO_TYPES: LOGO_TYPES
    };
})();
