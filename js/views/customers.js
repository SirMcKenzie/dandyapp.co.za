/* Customers - the customer book. Name, phone, email and a note, plus the
   address and VAT number SARS wants on larger tax invoices. */

var CustomersView = (function () {
    'use strict';

    var esc = App.esc;

    function mount(el, params) {
        var selectedId = params[0] || null;     // 'new', an id, or null
        var customers = [], rows = [];
        var search = '';
        var editing = null;                     // working copy of the customer in the form

        function load() {
            return Promise.all([DB.listCustomers(), DB.listInvoices(), DB.allPayments()]).then(function (d) {
                customers = d[0];
                rows = App.summarise(d[1], d[2]);
            });
        }

        function invoicesOf(c) {
            var name = c.name.trim().toLowerCase();
            return rows.filter(function (r) {
                return r.inv.customerId === c.id || (!r.inv.customerId && r.inv.client.name.trim().toLowerCase() === name);
            });
        }

        function owed(c) {
            var by = {};
            invoicesOf(c).forEach(function (r) {
                if (r.status === 'sent' || r.status === 'partial' || r.status === 'overdue') {
                    by[r.inv.currency] = (by[r.inv.currency] || 0) + r.balance;
                }
            });
            var parts = Object.keys(by).filter(function (k) { return by[k] > 0; }).map(function (k) { return Billing.money(by[k], k); });
            return parts.join(', ');
        }

        function shell() {
            el.innerHTML =
                '<div class="page-head"><div><p class="eyebrow">Your book</p><h1>CUSTOMERS</h1></div>' +
                    '<div class="btn-row">' +
                        '<button class="btn" id="import-btn">' + Dandy.icon('upload') + 'Import CSV</button>' +
                        '<input type="file" id="import-file" accept=".csv,text/csv,text/plain" hidden>' +
                        '<a href="#" data-template class="btn" title="A sample CSV showing the columns that are read">Example CSV</a>' +
                        '<a class="btn btn-dark" href="#/customers/new">' + Dandy.icon('plus') + 'New customer</a></div></div>' +
                '<div class="two-col wide-left">' +
                    '<div><div id="import"></div><div class="filters"><input type="search" id="q" class="grow" placeholder="Search customers" value="' + esc(search) + '"></div><div id="list"></div></div>' +
                    '<div id="form"></div>' +
                '</div>';
            el.querySelector('#q').addEventListener('input', function (e) { search = e.target.value; drawList(); });
            wireTemplateLink(el);
            el.querySelector('#import-btn').addEventListener('click', function () { el.querySelector('#import-file').click(); });
            el.querySelector('#import-file').addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > Csv.MAX_BYTES) { drawImport({ error: 'That file is larger than 2 MB, which is far more than a customer list needs.' }, file.name); return; }
                var reader = new FileReader();
                reader.onload = function () { drawImport(Csv.analyse(String(reader.result)), file.name); };
                reader.onerror = function () { drawImport({ error: 'The file could not be read.' }, file.name); };
                reader.readAsText(file);
            });
        }

        /* --- CSV import: show exactly what will and will not be read, then confirm --- */

        function key(name) { return name.trim().toLowerCase(); }

        function drawImport(result, filename) {
            var box = el.querySelector('#import');
            if (!result) { box.innerHTML = ''; return; }

            if (result.error) {
                box.innerHTML = '<div class="panel"><h2>Import customers</h2>' +
                    '<p class="note note-bad mb-2">' + Dandy.icon('alert') + '<span>' + esc(result.error) + '</span></p>' +
                    (result.headers ? '<p class="muted" style="font-size:.8125rem">Columns found: ' + result.headers.map(function (h) { return '<b>' + esc(h) + '</b>'; }).join(', ') + '</p>' : '') +
                    importHelp() + '<div class="btn-row mt-2"><button class="btn" id="imp-cancel">Close</button></div></div>';
                Dandy.hydrateIcons(box);
                box.querySelector('#imp-cancel').addEventListener('click', function () { drawImport(null); });
                wireTemplateLink(box);
                return;
            }

            var existing = {};
            customers.forEach(function (c) { existing[key(c.name)] = c; });
            var seen = {}, fresh = [], matches = [], repeats = 0;
            result.customers.forEach(function (c) {
                var k = key(c.name);
                if (seen[k]) { repeats++; return; }
                seen[k] = true;
                (existing[k] ? matches : fresh).push(c);
            });

            box.innerHTML = '<div class="panel"><h2>Import customers</h2>' +
                '<p style="font-size:.8125rem;margin-bottom:1rem"><b>' + esc(filename) + '</b>: ' + result.customers.length + ' customer' + (result.customers.length === 1 ? '' : 's') + ' found.</p>' +
                '<p class="eyebrow mb-1">Columns that will be imported</p>' +
                '<ul style="list-style:none;padding:0;font-size:.8125rem;margin-bottom:1rem">' + result.mapping.map(function (m) {
                    return '<li style="padding:.1875rem 0"><b>' + esc(m.label) + '</b> <span class="muted">from</span> ' +
                        m.columns.map(function (c) { return '&ldquo;' + esc(c) + '&rdquo;'; }).join(' + ') + '</li>';
                }).join('') + '</ul>' +
                (result.ignored.length
                    ? '<p class="note note-warn mb-2">' + Dandy.icon('alert') + '<span><b>' + result.ignored.length + ' column' + (result.ignored.length === 1 ? '' : 's') +
                        ' will be left out</b> because the invoice app has no place for ' + (result.ignored.length === 1 ? 'it' : 'them') + ':<br>' +
                        result.ignored.map(function (c) { return '&ldquo;' + esc(c) + '&rdquo;'; }).join(', ') + '</span></p>'
                    : '<p class="note note-ok mb-2">' + Dandy.icon('check') + '<span>Every column in the file was recognised.</span></p>') +
                '<p style="font-size:.8125rem;margin-bottom:.5rem"><b>' + fresh.length + '</b> new' +
                    (matches.length ? ', <b>' + matches.length + '</b> already in your list' : '') +
                    (result.noName ? ', <b>' + result.noName + '</b> row' + (result.noName === 1 ? '' : 's') + ' skipped for having no name' : '') +
                    (repeats ? ', <b>' + repeats + '</b> repeated name' + (repeats === 1 ? '' : 's') + ' skipped' : '') +
                    (result.truncated ? ', only the first ' + result.maxRows + ' rows were read' : '') + '.</p>' +
                (matches.length ? '<label class="check mb-2"><input type="checkbox" id="imp-update"> Update the ' + matches.length +
                    ' existing customer' + (matches.length === 1 ? '' : 's') + ' with the file\'s details (empty cells never erase what you have)</label>' : '') +
                '<div class="btn-row"><button class="btn btn-dark" id="imp-go"' + (fresh.length || matches.length ? '' : ' disabled') + '>' + Dandy.icon('check') + 'Import</button>' +
                    '<button class="btn" id="imp-cancel">Cancel</button></div></div>';
            Dandy.hydrateIcons(box);

            box.querySelector('#imp-cancel').addEventListener('click', function () { drawImport(null); });
            box.querySelector('#imp-go').addEventListener('click', function () {
                var update = !!(box.querySelector('#imp-update') && box.querySelector('#imp-update').checked);
                var toSave = fresh.map(function (c) { return Object.assign(Billing.blankCustomer(), c); });
                var updated = 0, busy = 0;
                // A customer open in another tab would be overwritten by that tab's next save, so leave it alone.
                Locks.heldNames().then(function (held) {
                    if (update) {
                        matches.forEach(function (c) {
                            var have = Object.assign({}, existing[key(c.name)]);
                            if (have.id !== selectedId && held.indexOf(Locks.names.customer(have.id)) !== -1) { busy++; return; }
                            ['phone', 'email', 'note', 'address', 'vatNo'].forEach(function (f) { if (c[f]) have[f] = c[f]; });
                            toSave.push(have);
                            updated++;
                        });
                    }
                    return DB.saveCustomers(toSave);
                }).then(load).then(function () {
                    drawImport(null);
                    drawList();
                    Dandy.toast('Imported ' + fresh.length + ' new' + (updated ? ', updated ' + updated : '') +
                        (busy ? ', skipped ' + busy + ' open in another tab' : '') +
                        (matches.length && !update ? ', skipped ' + matches.length + ' existing' : ''));
                }).catch(function (err) { Dandy.toast('Import failed: ' + err.message); });
            });
        }

        function importHelp() {
            return '<p class="muted mt-2" style="font-size:.75rem;line-height:1.7">Recognised columns: Name (or Company, Customer, Client, or First name + Surname), Phone (or Mobile, Cell, Telephone), ' +
                'Email, Note (or Notes, Comments), Address (or Street, City, Postal code...) and VAT number. Anything else is left out. ' +
                '<a href="#" data-template style="text-decoration:underline">Download an example file</a>.</p>';
        }

        function wireTemplateLink(scope) {
            var a = scope.querySelector('[data-template]');
            if (a) a.addEventListener('click', function (e) {
                e.preventDefault();
                Dandy.download('dandyapp-customers-example.csv', Csv.TEMPLATE, 'text/csv;charset=utf-8');
            });
        }

        function drawList() {
            var q = search.trim().toLowerCase();
            var shown = customers.filter(function (c) {
                return !q || (c.name + ' ' + c.email + ' ' + c.phone).toLowerCase().indexOf(q) !== -1;
            });
            var box = el.querySelector('#list');
            if (!customers.length) { box.innerHTML = '<div class="panel empty">No customers yet. Add one, or save one from an invoice.</div>'; return; }
            if (!shown.length) { box.innerHTML = '<div class="panel empty">No customers match.</div>'; return; }

            box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th class="r">Invoices</th><th class="r">Owes you</th></tr></thead><tbody>' +
                shown.map(function (c) {
                    return '<tr class="clickable" data-id="' + esc(c.id) + '"' + (c.id === selectedId ? ' style="background:#f3f4f6"' : '') + '>' +
                        '<td class="strong">' + esc(c.name) + '</td><td class="nowrap">' + esc(c.phone) + '</td><td>' + esc(c.email) + '</td>' +
                        '<td class="r">' + invoicesOf(c).length + '</td><td class="r">' + esc(owed(c) || '-') + '</td></tr>';
                }).join('') + '</tbody></table></div>';

            Dandy.els('tr[data-id]', box).forEach(function (tr) {
                tr.addEventListener('click', function () { App.go('#/customers/' + tr.dataset.id); });
            });
        }

        function drawForm() {
            var box = el.querySelector('#form');
            if (!selectedId) {
                box.innerHTML = '<div class="panel empty">Select a customer to edit, or add a new one.</div>';
                return;
            }

            var existing = selectedId === 'new' ? null : customers.filter(function (c) { return c.id === selectedId; })[0];
            if (selectedId !== 'new' && !existing) {
                box.innerHTML = '<div class="panel empty">That customer no longer exists.</div>';
                return;
            }
            editing = existing ? Object.assign({}, existing) : Billing.blankCustomer();
            var theirs = existing ? invoicesOf(existing) : [];

            box.innerHTML = '<div class="panel"><h2>' + (existing ? 'Edit customer' : 'New customer') + '</h2>' +
                '<label class="field"><span>Name</span><input type="text" id="f-name" required></label>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Phone</span><input type="tel" id="f-phone"></label>' +
                    '<label class="field"><span>Email</span><input type="email" id="f-email"></label>' +
                '</div>' +
                '<label class="field"><span>Note</span><textarea id="f-note" rows="3" placeholder="Anything worth remembering about this customer"></textarea></label>' +
                '<label class="field"><span>Address (optional)</span><textarea id="f-address" rows="3"></textarea></label>' +
                '<label class="field"><span>VAT number (optional)</span><input type="text" id="f-vatNo"></label>' +
                '<p class="note note-info mb-2">' + Dandy.icon('info') + '<span>Invoices keep a copy of the details they were issued with, so editing a customer never rewrites an invoice you already sent.</span></p>' +
                '<div class="btn-row">' +
                    '<button class="btn btn-dark" id="f-save">' + Dandy.icon('save') + 'Save</button>' +
                    (existing ? '<a class="btn" href="#/invoices?q=' + encodeURIComponent(existing.name) + '">Invoices (' + theirs.length + ')</a>' +
                                '<button class="btn btn-danger" id="f-del">' + Dandy.icon('trash') + 'Delete</button>' : '') +
                '</div></div>';
            Dandy.hydrateIcons(box);

            ['name', 'phone', 'email', 'note', 'address', 'vatNo'].forEach(function (k) {
                box.querySelector('#f-' + k).value = editing[k] || '';
            });

            box.querySelector('#f-save').addEventListener('click', function () {
                ['name', 'phone', 'email', 'note', 'address', 'vatNo'].forEach(function (k) {
                    editing[k] = box.querySelector('#f-' + k).value;
                });
                if (!editing.name.trim()) { Dandy.toast('A customer needs a name'); return; }
                DB.saveCustomer(editing).then(load).then(function () {
                    Dandy.toast('Customer saved');
                    if (selectedId === 'new') App.go('#/customers/' + editing.id);
                    else { drawList(); }
                });
            });

            var del = box.querySelector('#f-del');
            if (del) del.addEventListener('click', function () {
                var n = theirs.length;
                var msg = 'Delete ' + existing.name + '?' + (n ? '\n\n' + n + ' invoice' + (n === 1 ? '' : 's') + ' use this customer. They keep their own copy of the details and are not deleted.' : '');
                if (!window.confirm(msg)) return;
                DB.removeCustomer(existing.id).then(function () { App.go('#/customers'); });
            });
        }

        // Only an existing customer needs a lock; a new one is nobody else's yet.
        var needsLock = !!selectedId && selectedId !== 'new';
        var lockStep = needsLock ? Locks.acquire(Locks.names.customer(selectedId)) : Promise.resolve({ release: function () {} });

        return Promise.all([load(), lockStep]).then(function (r) { return Locks.guard(r[1], function () {
            var lock = r[1];
            var cancelWait = null;
            shell(); drawList(); drawForm();
            Dandy.hydrateIcons(el);

            if (needsLock && !lock) {
                var form = el.querySelector('#form');
                form.insertAdjacentHTML('afterbegin', Locks.bannerHtml('This customer'));
                Dandy.hydrateIcons(form);
                Locks.freeze(form, 'a');
                cancelWait = Locks.whenFree(Locks.names.customer(selectedId), function () { App.reload(); });
            }

            return { destroy: function () {
                if (cancelWait) cancelWait();
                if (lock) lock.release();
            } };
        }); });
    }

    return { mount: mount };
})();
