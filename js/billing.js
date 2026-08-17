/* ==========================================================================
   Billing model - one document type serving both quotes and invoices.

   Pure data and arithmetic: no DOM, no rendering. Everything monetary is an
   integer number of cents, because 0.1 + 0.2 is not 0.3 and an invoice that
   is out by a cent is an invoice you have to reissue.
   ========================================================================== */

var Billing = (function () {
    'use strict';

    var VAT_RATE = 0.15;                 // South Africa, since 1 April 2018
    var FULL_INVOICE_THRESHOLD = 500000; // R5 000 in cents - VAT Act s20(5)

    var CURRENCIES = [
        { code: 'ZAR', label: 'ZAR — South African Rand' },
        { code: 'USD', label: 'USD — US Dollar' },
        { code: 'EUR', label: 'EUR — Euro' },
        { code: 'GBP', label: 'GBP — Pound Sterling' },
        { code: 'AUD', label: 'AUD — Australian Dollar' }
    ];

    var UNITS = ['hours', 'days', 'each', 'units', 'month', 'm²', 'km', 'lot'];

    /* --- Money ------------------------------------------------------------- */

    function toCents(value) {
        var n = parseFloat(String(value).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? 0 : Math.round(n * 100);
    }

    function money(cents, currency) {
        var value = (cents || 0) / 100;
        try {
            return new Intl.NumberFormat('en-ZA', {
                style: 'currency', currency: currency || 'ZAR',
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(value);
        } catch (e) {
            return (currency || 'ZAR') + ' ' + value.toFixed(2);
        }
    }

    /* --- Documents --------------------------------------------------------- */

    function today() { return new Date().toISOString().slice(0, 10); }

    function addDays(iso, days) {
        var d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    }

    function blankLine() {
        return { desc: '', qty: 1, unit: 'each', rate: 0, optional: false, included: true };
    }

    function newId() {
        return 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* The document shape with no serial number reserved. Used to fill gaps in
       an older stored draft without burning a number on every page load. */
    function defaults(kind) {
        var date = today();
        return {
            id: newId(),
            kind: kind,
            number: '',
            date: date,
            dueDate: addDays(date, kind === 'quote' ? 14 : 30),
            reference: '',
            ref: '',
            client: { name: '', email: '', phone: '', address: '', vatNo: '' },
            lines: [blankLine()],
            vatMode: 'exclusive',
            vatRate: VAT_RATE,
            currency: 'ZAR',
            depositPct: 0,
            notes: '',
            terms: kind === 'quote'
                ? 'This quotation is valid until the date shown above. Work begins once the quote is accepted in writing and any deposit reflects.'
                : 'Payment is due by the date shown above. Please use the invoice number as your payment reference.',
            updated: Date.now()
        };
    }

    /* A genuinely new document — this one does reserve the next serial number. */
    function blankDoc(kind) {
        var d = defaults(kind);
        d.number = nextNumber(kind);
        return d;
    }

    /* --- Totals ------------------------------------------------------------
       Optional lines are quoted but not counted until the client ticks them.
       ---------------------------------------------------------------------- */

    function lineAmount(line) {
        var qty = parseFloat(line.qty);
        if (isNaN(qty)) qty = 0;
        return Math.round(qty * toCents(line.rate));
    }

    function counts(line) {
        return !line.optional || line.included;
    }

    function calcTotals(doc) {
        var rate = typeof doc.vatRate === 'number' ? doc.vatRate : VAT_RATE;

        var net = doc.lines.reduce(function (sum, line) {
            return counts(line) ? sum + lineAmount(line) : sum;
        }, 0);

        var excluded = doc.lines.reduce(function (sum, line) {
            return counts(line) ? sum : sum + lineAmount(line);
        }, 0);

        var subtotal, vat, total;

        if (doc.vatMode === 'exclusive') {
            subtotal = net;
            vat = Math.round(net * rate);
            total = subtotal + vat;
        } else if (doc.vatMode === 'inclusive') {
            total = net;
            vat = Math.round(net * rate / (1 + rate));
            subtotal = total - vat;
        } else {
            subtotal = total = net;
            vat = 0;
        }

        var pct = parseFloat(doc.depositPct);
        if (isNaN(pct) || pct <= 0) pct = 0;
        var deposit = Math.round(total * pct / 100);

        return {
            subtotal: subtotal,
            vat: vat,
            total: total,
            deposit: deposit,
            depositPct: pct,
            balance: total - deposit,
            optionalTotal: excluded,
            vatRate: rate
        };
    }

    /* --- SARS compliance ---------------------------------------------------
       A tax invoice that is missing these fields is not a valid tax invoice,
       and the recipient cannot claim the input VAT. Generic invoice tools do
       not check any of this - which is the main reason this one exists.
       ---------------------------------------------------------------------- */

    function compliance(doc, profile) {
        var issues = [];
        if (doc.kind !== 'invoice' || doc.vatMode === 'none') return issues;

        var totals = calcTotals(doc);
        var full = totals.total >= FULL_INVOICE_THRESHOLD;

        if (!profile.vatNo) {
            issues.push('Your VAT registration number is missing — a tax invoice must show it.');
        }
        if (!profile.name) {
            issues.push('Your registered business name is missing.');
        }
        if (!profile.address) {
            issues.push('Your business address is missing — a tax invoice must show it.');
        }
        if (!doc.number) {
            issues.push('This invoice has no serial number.');
        }
        if (!doc.client.name) {
            issues.push('The client name is missing.');
        }
        if (full && !doc.client.address) {
            issues.push('Above ' + money(FULL_INVOICE_THRESHOLD, doc.currency) +
                ' a full tax invoice must show the client\'s address.');
        }
        if (full && !doc.client.vatNo) {
            issues.push('Above ' + money(FULL_INVOICE_THRESHOLD, doc.currency) +
                ' a full tax invoice must show the client\'s VAT number if they are a registered vendor.');
        }
        if (doc.lines.filter(counts).some(function (l) { return !l.desc.trim(); })) {
            issues.push('Every line needs a description of the goods or services supplied.');
        }

        return issues;
    }

    function title(doc) {
        if (doc.kind === 'quote') return 'QUOTATION';
        return doc.vatMode === 'none' ? 'INVOICE' : 'TAX INVOICE';
    }

    /* --- Persistence -------------------------------------------------------- */

    function counters() { return Dandy.Store.get('counters', { invoice: 0, quote: 0 }); }

    /* Reserves the number. Call once per new document, not on every render. */
    function nextNumber(kind) {
        var c = counters();
        c[kind] = (c[kind] || 0) + 1;
        Dandy.Store.set('counters', c);
        return (kind === 'quote' ? 'Q-' : 'INV-') + String(c[kind]).padStart(4, '0');
    }

    function listDocs(kind) {
        return Dandy.Store.get('docs', []).filter(function (d) {
            return !kind || d.kind === kind;
        }).sort(function (a, b) { return b.updated - a.updated; });
    }

    function saveDoc(doc) {
        var all = Dandy.Store.get('docs', []);
        doc.updated = Date.now();
        var i = all.findIndex(function (d) { return d.id === doc.id; });
        if (i === -1) all.push(doc); else all[i] = doc;
        Dandy.Store.set('docs', all);
        return doc;
    }

    function loadDoc(id) {
        return Dandy.Store.get('docs', []).find(function (d) { return d.id === id; }) || null;
    }

    function removeDoc(id) {
        Dandy.Store.set('docs', Dandy.Store.get('docs', []).filter(function (d) { return d.id !== id; }));
    }

    function duplicate(doc) {
        var copy = JSON.parse(JSON.stringify(doc));
        copy.id = newId();
        copy.number = nextNumber(doc.kind);
        copy.date = today();
        copy.dueDate = addDays(copy.date, doc.kind === 'quote' ? 14 : 30);
        copy.updated = Date.now();
        return copy;
    }

    /* Quote accepted → invoice, carrying a reference back to the quote. */
    function convert(doc, kind) {
        var copy = JSON.parse(JSON.stringify(doc));
        copy.id = newId();
        copy.kind = kind;
        copy.number = nextNumber(kind);
        copy.date = today();
        copy.dueDate = addDays(copy.date, kind === 'quote' ? 14 : 30);
        copy.ref = doc.number;

        // Optional extras the client declined should not silently become billable.
        copy.lines = copy.lines.filter(counts).map(function (l) {
            l.optional = false; l.included = true;
            return l;
        });

        // Deposit is a quote-side concept and the invoice form has no control
        // for it. Carrying it over would leave an uneditable line altering the
        // amount due, so it is dropped on the way in.
        if (kind === 'invoice') copy.depositPct = 0;
        copy.updated = Date.now();
        return copy;
    }

    /* --- Profile, clients, presets ------------------------------------------ */

    function blankProfile() {
        return {
            name: '', trading: '', regNo: '', vatNo: '',
            address: '', email: '', phone: '', website: '',
            bankName: '', bankAccount: '', bankBranch: '', bankType: '',
            logo: ''
        };
    }

    function getProfile() {
        var stored = Dandy.Store.get('profile', null);
        return stored ? Object.assign(blankProfile(), stored) : blankProfile();
    }

    function saveProfile(p) { return Dandy.Store.set('profile', p); }

    function getClients() { return Dandy.Store.get('clients', []); }

    function rememberClient(client) {
        if (!client.name || !client.name.trim()) return;
        var all = getClients();
        var i = all.findIndex(function (c) {
            return c.name.trim().toLowerCase() === client.name.trim().toLowerCase();
        });
        var copy = JSON.parse(JSON.stringify(client));
        if (i === -1) all.push(copy); else all[i] = copy;
        Dandy.Store.set('clients', all);
    }

    function getPresets() { return Dandy.Store.get('presets', []); }

    function addPreset(line) {
        var all = getPresets();
        all.push({ desc: line.desc, unit: line.unit, rate: line.rate });
        Dandy.Store.set('presets', all);
    }

    function removePreset(index) {
        var all = getPresets();
        all.splice(index, 1);
        Dandy.Store.set('presets', all);
    }

    return {
        VAT_RATE: VAT_RATE,
        FULL_INVOICE_THRESHOLD: FULL_INVOICE_THRESHOLD,
        CURRENCIES: CURRENCIES,
        UNITS: UNITS,

        toCents: toCents,
        money: money,
        today: today,
        addDays: addDays,

        defaults: defaults,
        blankDoc: blankDoc,
        blankLine: blankLine,
        lineAmount: lineAmount,
        counts: counts,
        calcTotals: calcTotals,
        compliance: compliance,
        title: title,

        nextNumber: nextNumber,
        listDocs: listDocs,
        saveDoc: saveDoc,
        loadDoc: loadDoc,
        removeDoc: removeDoc,
        duplicate: duplicate,
        convert: convert,

        getProfile: getProfile,
        saveProfile: saveProfile,
        getClients: getClients,
        rememberClient: rememberClient,
        getPresets: getPresets,
        addPreset: addPreset,
        removePreset: removePreset
    };
})();
