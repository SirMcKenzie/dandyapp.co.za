/* ==========================================================================
   Billing model - invoices, totals, VAT, payments and derived status.

   Pure data and arithmetic: no DOM, no storage. Everything monetary is an
   integer number of cents, because 0.1 + 0.2 is not 0.3 and an invoice that
   is out by a cent is an invoice you have to reissue.
   ========================================================================== */

var Billing = (function () {
    'use strict';

    var VAT_RATE = 0.15;                 // South Africa, since 1 April 2018
    var FULL_INVOICE_THRESHOLD = 500000; // R5 000 in cents - VAT Act s20(5)

    var CURRENCIES = [
        { code: 'ZAR', label: 'ZAR - South African Rand' },
        { code: 'USD', label: 'USD - US Dollar' },
        { code: 'EUR', label: 'EUR - Euro' },
        { code: 'GBP', label: 'GBP - Pound Sterling' },
        { code: 'AUD', label: 'AUD - Australian Dollar' }
    ];

    var UNITS = ['hours', 'days', 'each', 'units', 'month', 'm²', 'km', 'lot'];
    var METHODS = ['EFT', 'Card', 'Cash', 'Cheque', 'Other'];

    var DEFAULT_TERMS = 'Payment is due by the date shown above. Please use the invoice number as your payment reference.';
    var DEFAULT_DUE_DAYS = 30;

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

    /* --- Dates ------------------------------------------------------------- */

    function today() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function addDays(iso, days) {
        var d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function fmtDate(iso) {
        if (!iso) return '';
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    /* --- Documents --------------------------------------------------------- */

    function newId(prefix) {
        return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function blankLine() {
        return { desc: '', qty: 1, unit: 'each', rate: 0 };
    }

    function blankClient() {
        return { name: '', email: '', phone: '', address: '', vatNo: '' };
    }

    /* The invoice shape with no serial number reserved. `opts` carries the
       user's defaults from Settings (due days, terms). */
    function defaults(opts) {
        opts = opts || {};
        var date = today();
        var days = typeof opts.dueDays === 'number' ? opts.dueDays : DEFAULT_DUE_DAYS;
        return {
            id: newId('inv'),
            number: '',
            status: 'draft',          // draft | sent | void - paid/overdue are derived
            date: date,
            dueDate: addDays(date, days),
            reference: '',
            customerId: null,
            client: blankClient(),
            lines: [blankLine()],
            vatMode: 'exclusive',
            vatRate: VAT_RATE,
            currency: 'ZAR',
            notes: '',
            terms: opts.terms != null ? opts.terms : DEFAULT_TERMS,
            updated: Date.now()
        };
    }

    /* --- Totals ------------------------------------------------------------ */

    function lineAmount(line) {
        var qty = parseFloat(line.qty);
        if (isNaN(qty)) qty = 0;
        return Math.round(qty * toCents(line.rate));
    }

    function calcTotals(inv) {
        var rate = typeof inv.vatRate === 'number' ? inv.vatRate : VAT_RATE;
        var net = inv.lines.reduce(function (sum, l) { return sum + lineAmount(l); }, 0);
        var subtotal, vat, total;

        if (inv.vatMode === 'exclusive') {
            subtotal = net;
            vat = Math.round(net * rate);
            total = subtotal + vat;
        } else if (inv.vatMode === 'inclusive') {
            total = net;
            vat = Math.round(net * rate / (1 + rate));
            subtotal = total - vat;
        } else {
            subtotal = total = net;
            vat = 0;
        }
        return { subtotal: subtotal, vat: vat, total: total, vatRate: rate };
    }

    /* --- Payments and derived status ---------------------------------------
       Status is computed, never stored, so it cannot go stale when a payment
       is added or a date passes. Only draft / sent / void are stored.
       ---------------------------------------------------------------------- */

    function paidTotal(payments) {
        return (payments || []).reduce(function (s, p) { return s + (p.amountCents || 0); }, 0);
    }

    function balance(inv, payments) {
        return calcTotals(inv).total - paidTotal(payments);
    }

    function derivedStatus(inv, payments, asOf) {
        if (inv.status === 'void') return 'void';
        if (inv.status === 'draft') return 'draft';
        var total = calcTotals(inv).total;
        var paid = paidTotal(payments);
        if (total > 0 && paid >= total) return 'paid';
        if (inv.dueDate && inv.dueDate < (asOf || today())) return 'overdue';
        if (paid > 0) return 'partial';
        return 'sent';
    }

    var STATUS_LABEL = {
        draft: 'Draft', sent: 'Sent', partial: 'Part paid',
        paid: 'Paid', overdue: 'Overdue', void: 'Void'
    };

    /* --- SARS compliance ---------------------------------------------------
       A tax invoice missing these fields is not a valid tax invoice, and the
       recipient cannot claim the input VAT.
       ---------------------------------------------------------------------- */

    function compliance(inv, profile) {
        var issues = [];
        if (inv.vatMode === 'none') return issues;

        // The R5 000 limit is in rand, so it only applies to invoices issued in rand.
        var full = (inv.currency || 'ZAR') === 'ZAR' && calcTotals(inv).total >= FULL_INVOICE_THRESHOLD;
        var over = money(FULL_INVOICE_THRESHOLD, 'ZAR');

        if (!profile.vatNo) issues.push('Your VAT registration number is missing - a tax invoice must show it.');
        if (!profile.name) issues.push('Your registered business name is missing.');
        if (!profile.address) issues.push('Your business address is missing - a tax invoice must show it.');
        if (!inv.number) issues.push('This invoice has no serial number.');
        if (!inv.client.name) issues.push('The client name is missing.');
        if (full && !inv.client.address) issues.push('Above ' + over + ' a full tax invoice must show the client\'s address.');
        if (full && !inv.client.vatNo) issues.push('Above ' + over + ' a full tax invoice must show the client\'s VAT number if they are a registered vendor.');
        if (inv.lines.some(function (l) { return !String(l.desc).trim(); })) {
            issues.push('Every line needs a description of the goods or services supplied.');
        }
        return issues;
    }

    function title(inv) {
        return inv.vatMode === 'none' ? 'INVOICE' : 'TAX INVOICE';
    }

    /* --- Serial numbers ----------------------------------------------------- */

    function formatNumber(n) { return 'INV-' + String(n).padStart(4, '0'); }

    /* --- Profile ------------------------------------------------------------ */

    function blankProfile() {
        return {
            name: '', regNo: '', vatNo: '',
            address: '', email: '', phone: '', website: '',
            bankName: '', bankAccount: '', bankBranch: '', bankType: '',
            logo: ''
        };
    }

    function blankCustomer() {
        return { id: newId('cus'), name: '', phone: '', email: '', note: '', address: '', vatNo: '' };
    }

    return {
        VAT_RATE: VAT_RATE,
        FULL_INVOICE_THRESHOLD: FULL_INVOICE_THRESHOLD,
        CURRENCIES: CURRENCIES,
        UNITS: UNITS,
        METHODS: METHODS,
        STATUS_LABEL: STATUS_LABEL,
        DEFAULT_TERMS: DEFAULT_TERMS,
        DEFAULT_DUE_DAYS: DEFAULT_DUE_DAYS,

        toCents: toCents,
        money: money,
        today: today,
        addDays: addDays,
        fmtDate: fmtDate,
        newId: newId,

        defaults: defaults,
        blankLine: blankLine,
        blankClient: blankClient,
        blankProfile: blankProfile,
        blankCustomer: blankCustomer,
        formatNumber: formatNumber,

        lineAmount: lineAmount,
        calcTotals: calcTotals,
        paidTotal: paidTotal,
        balance: balance,
        derivedStatus: derivedStatus,
        compliance: compliance,
        title: title
    };
})();
