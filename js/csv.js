/* ==========================================================================
   CSV import for customers - parsing and column mapping. Pure functions.

   Only columns that mean something to this app are read. Everything else is
   reported back by name so the user knows exactly what will be left out.
   ========================================================================== */

var Csv = (function () {
    'use strict';

    var MAX_BYTES = 2 * 1024 * 1024;
    var MAX_ROWS = 5000;

    /* Header names, normalised (lower case, letters and digits only). */
    var SYNONYMS = {
        name:    ['name', 'customer', 'customername', 'client', 'clientname', 'company', 'companyname',
                  'businessname', 'organisation', 'organization', 'fullname', 'displayname'],
        phone:   ['phone', 'phonenumber', 'telephone', 'telephonenumber', 'tel', 'mobile', 'mobilenumber',
                  'cell', 'cellphone', 'cellnumber', 'contactnumber'],
        email:   ['email', 'emailaddress', 'mail'],
        note:    ['note', 'notes', 'comment', 'comments', 'memo', 'remarks'],
        vatNo:   ['vat', 'vatno', 'vatnumber', 'vatnr', 'vatregno', 'vatregistration', 'vatregistrationnumber', 'taxnumber', 'taxno']
    };

    /* Name given as two columns. */
    var FIRST = ['firstname', 'givenname', 'forename'];
    var LAST  = ['lastname', 'surname', 'familyname'];

    /* Address split across several columns is joined into the one Address field. */
    var ADDRESS_PARTS = ['address', 'address1', 'addressline1', 'street', 'streetaddress', 'physicaladdress', 'billingaddress',
                         'address2', 'addressline2', 'suburb', 'city', 'town', 'province', 'state', 'postalcode', 'postcode', 'zip', 'zipcode'];

    var LIMITS = { name: 120, phone: 40, email: 120, note: 1000, address: 300, vatNo: 40 };

    var LABELS = { name: 'Name', phone: 'Phone', email: 'Email', note: 'Note', address: 'Address', vatNo: 'VAT number' };

    function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

    /* --- Parsing ---------------------------------------------------------------
       RFC 4180 style: quoted fields, "" for a quote, newlines allowed inside quotes.
       The delimiter is guessed from the header line, because South African
       spreadsheets exported with a comma decimal separator use semicolons.
       ---------------------------------------------------------------------- */

    function detectDelimiter(text) {
        var first = '', inQuotes = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (ch === '"') inQuotes = !inQuotes;
            if (!inQuotes && (ch === '\n' || ch === '\r')) break;
            first += ch;
        }
        var best = ',', bestCount = -1;
        [',', ';', '\t'].forEach(function (d) {
            var n = first.split(d).length - 1;
            if (n > bestCount) { best = d; bestCount = n; }
        });
        return best;
    }

    function parse(text) {
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);     // BOM from Excel
        var delim = detectDelimiter(text);
        var rows = [], row = [], field = '', inQuotes = false;

        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else inQuotes = false;
                } else field += ch;
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === delim) {
                row.push(field); field = '';
            } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(field); field = '';
                rows.push(row); row = [];
            } else field += ch;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }

        // Blank lines carry nothing.
        return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
    }

    /* --- Column mapping ---------------------------------------------------------- */

    function analyse(text) {
        if (text.length > MAX_BYTES) return { error: 'That file is larger than 2 MB, which is far more than a customer list needs.' };

        var table = parse(text);
        if (table.length < 2) return { error: 'The file needs a header row and at least one customer.' };

        var headers = table[0].map(function (h) { return h.trim(); });
        var keys = headers.map(norm);
        var used = {};                                   // column index -> field label, for the report
        var plan = {};                                   // field -> [column indexes]

        function find(names) {
            for (var i = 0; i < keys.length; i++) {
                if (!used[i] && names.indexOf(keys[i]) !== -1) return i;
            }
            return -1;
        }

        ['name', 'phone', 'email', 'note', 'vatNo'].forEach(function (field) {
            var i = find(SYNONYMS[field]);
            if (i !== -1) { plan[field] = [i]; used[i] = field; }
        });

        // Name from first + last name columns when there is no single name column.
        if (!plan.name) {
            var f = find(FIRST), l = find(LAST);
            if (f !== -1) { used[f] = 'name'; }
            if (l !== -1) { used[l] = 'name'; }
            if (f !== -1 || l !== -1) plan.name = [f, l].filter(function (i) { return i !== -1; });
        }

        var addr = [];
        keys.forEach(function (k, i) {
            if (!used[i] && ADDRESS_PARTS.indexOf(k) !== -1) { addr.push(i); used[i] = 'address'; }
        });
        if (addr.length) plan.address = addr;

        if (!plan.name) {
            return { error: 'No name column found. Add a column called "Name" (or "Company", "Customer" or "Client").', headers: headers };
        }

        var mapping = Object.keys(plan).map(function (field) {
            return { field: field, label: LABELS[field], columns: plan[field].map(function (i) { return headers[i]; }) };
        });

        var ignored = headers.filter(function (h, i) { return !used[i] && h !== ''; });

        var customers = [], noName = 0, truncated = false;
        table.slice(1).forEach(function (r) {
            if (customers.length >= MAX_ROWS) { truncated = true; return; }
            var c = { name: '', phone: '', email: '', note: '', address: '', vatNo: '' };
            Object.keys(plan).forEach(function (field) {
                var parts = plan[field].map(function (i) { return (r[i] || '').trim(); }).filter(Boolean);
                var joined = field === 'address' ? parts.join('\n') : parts.join(' ');
                c[field] = joined.slice(0, LIMITS[field]);
            });
            if (!c.name) noName++; else customers.push(c);
        });

        return { headers: headers, mapping: mapping, ignored: ignored, customers: customers, noName: noName, truncated: truncated, maxRows: MAX_ROWS };
    }

    var TEMPLATE = 'name,phone,email,note,address,vat_no\n' +
        '"Example Customer (Pty) Ltd",011 555 0100,accounts@example.co.za,"Pays on the 25th","12 Rivonia Road\nSandton\n2196",4123456789\n';

    return { parse: parse, analyse: analyse, TEMPLATE: TEMPLATE, MAX_BYTES: MAX_BYTES };
})();
