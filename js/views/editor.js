/* Invoice editor - form on the left, live A4 preview on the right.

   Changes autosave. A brand-new invoice is only written to the database once
   something has been edited, so opening "New invoice" and walking away leaves
   no empty record behind. */

var EditorView = (function () {
    'use strict';

    var esc = App.esc;

    function mount(el, params) {
        var routeId = params[0];

        return Promise.all([
            routeId === 'new' ? DB.newInvoice() : DB.getInvoice(routeId),
            DB.getProfile(), DB.listCustomers(), DB.getActiveTemplate(), DB.listPresets()
        ]).then(function (d) {
            if (!d[0]) {
                el.innerHTML = '<div class="panel empty">That invoice no longer exists. <a href="#/invoices" style="text-decoration:underline">Back to invoices</a></div>';
                return null;
            }
            return DB.paymentsFor(d[0].id).then(function (pays) {
                return run(el, d[0], routeId !== 'new', pays, d[1], d[2], d[3], d[4]);
            });
        });
    }

    function run(el, inv, persisted, payments, profile, customers, template, presets) {
        var dirty = false;
        var active = true;
        var saveTimer = null, previewTimer = null;
        var chain = Promise.resolve();
        var amountTouched = false;
        var pickerIndex = -1;
        var bindings = [];

        function $(sel) { return el.querySelector(sel); }
        function byId(id) { return document.getElementById(id); }

        /* --- Saving ------------------------------------------------------------ */

        function setState(text) { var s = byId('saved-state'); if (s) s.textContent = text; }

        function markDirty() {
            dirty = true;
            setState('Unsaved changes');
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveNow, 500);
        }

        function saveNow() {
            clearTimeout(saveTimer);
            chain = chain.then(function () {
                if (!dirty) return;
                dirty = false;
                return DB.saveInvoice(inv).then(function () {
                    if (!persisted) {
                        persisted = true;
                        // Same page, real id - no re-render, no history entry.
                        // Skipped if the user already navigated away during the save.
                        if (active) history.replaceState(null, '', '#/invoice/' + inv.id);
                    }
                    setState('Saved');
                });
            }).catch(function (err) {
                dirty = true;
                setState('Could not save');
                Dandy.toast('Could not save: ' + err.message);
            });
            return chain;
        }

        function changed() {
            markDirty();
            schedulePreview();
            updateMeta();
        }

        /* --- Derived bits around the form ----------------------------------------- */

        function updateMeta() {
            var status = Billing.derivedStatus(inv, payments);
            byId('pill').innerHTML = App.statusPill(status);
            var send = byId('t-send');
            var sent = inv.status === 'sent';
            send.hidden = inv.status === 'void';
            send.classList.toggle('btn-ok', sent);
            send.innerHTML = Dandy.icon('check') + (sent ? 'Sent' : 'Mark as sent');
            send.title = sent ? (payments.length ? 'Payments are recorded, so this stays sent' : 'Click to move back to draft') : '';

            var issues = Billing.compliance(inv, profile);
            var box = byId('compliance');
            box.hidden = !issues.length;
            if (issues.length) {
                box.innerHTML = Dandy.icon('alert') + '<span><b>This is not yet a valid tax invoice.</b><br>' + issues.map(esc).join('<br>') + '</span>';
            }
            byId('client-sub').textContent = inv.client.name || '';
            byId('lines-sub').textContent = inv.lines.length + ' line' + (inv.lines.length === 1 ? '' : 's');
            renderLink();
            renderBalance();
        }

        function schedulePreview() {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(renderPreview, 60);
        }

        function renderPreview() {
            var pane = byId('preview');
            if (!pane) return;
            Layout.mount(pane, Layout.render(inv, template, profile, payments));
        }

        /* --- Form bindings ---------------------------------------------------------- */

        function bind(id, owner, key, after) {
            var input = byId(id);
            if (!input) return;
            bindings.push({ input: input, owner: owner, key: key });
            var handler = function () {
                owner()[key] = input.value;
                if (after) after();
                changed();
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        }

        function fill() {
            bindings.forEach(function (b) {
                var v = b.owner()[b.key];
                b.input.value = v == null ? '' : v;
            });
        }

        var theInv = function () { return inv; };
        var theClient = function () { return inv.client; };

        /* --- Markup ------------------------------------------------------------------- */

        el.innerHTML =
            '<div class="toolbar no-print">' +
                '<a class="btn btn-sm" href="#/invoices">' + Dandy.icon('arrow-right', 'flip') + 'Invoices</a>' +
                '<span id="pill"></span>' +
                '<span class="spacer"></span>' +
                '<span class="saved-state" id="saved-state">' + (persisted ? 'Saved' : 'New invoice') + '</span>' +
                '<button class="btn btn-sm" id="t-send">' + Dandy.icon('check') + 'Mark as sent</button>' +
                '<button class="btn btn-sm" id="t-dup">' + Dandy.icon('copy') + 'Duplicate</button>' +
                '<button class="btn btn-dark btn-sm" id="t-print">' + Dandy.icon('printer') + 'Download PDF</button>' +
            '</div>' +
            '<p class="note note-warn mb-2 no-print" id="compliance" hidden></p>' +
            (profile.name ? '' : '<p class="note note-info mb-2 no-print">' + Dandy.icon('info') +
                '<span>Your business details are empty. <a href="#/settings" style="text-decoration:underline">Add them in Settings</a> so they appear on every invoice.</span></p>') +
            '<div class="editor"><div class="form-pane no-print" id="form">' + formMarkup() + '</div>' +
            '<div class="preview-pane" id="preview" data-fit-height="1"></div></div>' +
            '<p class="muted no-print mt-3" style="font-size:.75rem;max-width:46rem"><b>Saving as PDF:</b> Download PDF opens your browser\'s print dialog. ' +
                'Choose &ldquo;Save as PDF&rdquo; and leave margins on default. The result is a real A4 document with selectable text.</p>';

        function formMarkup() {
            return '' +
            '<details class="fold" open id="fold-client"><summary>' + Dandy.icon('user') + 'Customer<span class="sub" id="client-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
                '<div class="fold-body">' +
                    '<label class="field picker"><span>Customer name</span>' +
                        '<input type="text" id="c-name" autocomplete="off" placeholder="Type a name, or pick from your customers" role="combobox" aria-expanded="false" aria-controls="picker">' +
                        '<div class="picker-list" id="picker" role="listbox" hidden></div></label>' +
                    '<p class="faint" style="font-size:.6875rem;margin:-.5rem 0 1rem" id="c-link"></p>' +
                    '<div class="field-row two">' +
                        '<label class="field"><span>Email</span><input type="email" id="c-email"></label>' +
                        '<label class="field"><span>Phone</span><input type="tel" id="c-phone"></label>' +
                    '</div>' +
                    '<label class="field"><span>Address</span><textarea id="c-address" rows="3"></textarea></label>' +
                    '<label class="field"><span>Customer VAT no.</span><input type="text" id="c-vatno"></label>' +
                    '<div class="btn-row"><button class="btn btn-sm" id="c-save"></button></div>' +
                '</div></details>' +

            '<details class="fold" open id="fold-doc"><summary>' + Dandy.icon('file-text') + 'Invoice details' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
                '<div class="fold-body">' +
                    '<div class="field-row two">' +
                        '<label class="field"><span>Invoice number</span><input type="text" id="d-number"></label>' +
                        '<label class="field"><span>Date</span><input type="date" id="d-date"></label>' +
                    '</div>' +
                    '<p class="note note-warn mb-2" id="number-warn" hidden>' + Dandy.icon('alert') + '<span>Another invoice already uses this number.</span></p>' +
                    '<div class="field-row two">' +
                        '<label class="field"><span>Due date</span><input type="date" id="d-duedate"></label>' +
                        '<label class="field"><span>Your reference</span><input type="text" id="d-reference" placeholder="PO number, project name"></label>' +
                    '</div>' +
                    '<div class="field-row two">' +
                        '<label class="field"><span>Currency</span><select id="d-currency">' + Billing.CURRENCIES.map(function (c) {
                            return '<option value="' + c.code + '">' + esc(c.label) + '</option>'; }).join('') + '</select></label>' +
                        '<label class="field"><span>VAT treatment</span><select id="d-vatmode">' +
                            '<option value="exclusive">Add 15% VAT to the total</option>' +
                            '<option value="inclusive">Prices already include 15% VAT</option>' +
                            '<option value="none">No VAT - not registered</option></select></label>' +
                    '</div>' +
                    '<label class="field"><span>Status</span><select id="d-status">' +
                        '<option value="draft">Draft</option><option value="sent">Sent</option><option value="void">Void</option></select></label>' +
                '</div></details>' +

            '<details class="fold" open id="fold-lines"><summary>' + Dandy.icon('receipt') + 'Line items<span class="sub" id="lines-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
                '<div class="fold-body">' +
                    '<p class="eyebrow mb-1">Saved items - click to insert</p>' +
                    '<div class="presets-bar" id="presets"></div>' +
                    '<div class="lines" id="lines"></div>' +
                    '<div class="btn-row mt-2"><button class="btn btn-dark btn-sm" id="l-add">' + Dandy.icon('plus') + 'Add line</button></div>' +
                '</div></details>' +

            '<details class="fold" id="fold-notes"><summary>' + Dandy.icon('file-text') + 'Notes &amp; terms' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
                '<div class="fold-body">' +
                    '<label class="field"><span>Notes to the customer</span><textarea id="d-notes" rows="3"></textarea></label>' +
                    '<label class="field"><span>Terms</span><textarea id="d-terms" rows="4"></textarea></label>' +
                '</div></details>' +

            '<details class="fold" open id="fold-pay"><summary>' + Dandy.icon('credit-card') + 'Payments<span class="sub" id="pay-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
                '<div class="fold-body">' +
                    '<div class="pay-list" id="pay-list"></div>' +
                    '<div class="field-row two">' +
                        '<label class="field"><span>Date</span><input type="date" id="p-date"></label>' +
                        '<label class="field"><span>Amount</span><input type="number" id="p-amount" step="0.01" min="0"></label>' +
                    '</div>' +
                    '<div class="field-row two">' +
                        '<label class="field"><span>Method</span><select id="p-method">' + Billing.METHODS.map(function (m) {
                            return '<option>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
                        '<label class="field"><span>Note</span><input type="text" id="p-note" placeholder="Optional"></label>' +
                    '</div>' +
                    '<button class="btn btn-dark btn-sm" id="p-add">' + Dandy.icon('plus') + 'Record payment</button>' +
                    '<div class="balance-line mt-2" id="balance"></div>' +
                '</div></details>';
        }

        /* --- Customer picker ------------------------------------------------------------ */

        function findCustomer(id) {
            return customers.filter(function (c) { return c.id === id; })[0] || null;
        }

        /* `all` ignores what is typed: focusing a field that already holds a name
           must still offer every customer, or you cannot switch to another one. */
        function matches(all) {
            var q = all ? '' : (inv.client.name || '').trim().toLowerCase();
            return customers.filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 50);
        }

        function showPicker(all) {
            var list = matches(all);
            var box = byId('picker');
            var typed = (inv.client.name || '').trim().toLowerCase();
            // While typing, a single exact match needs no suggestion.
            var exact = !all && list.length === 1 && list[0].name.toLowerCase() === typed;
            if (!list.length || exact) { hidePicker(); return; }
            pickerIndex = -1;
            box.innerHTML = list.map(function (c, i) {
                return '<button type="button" role="option" data-i="' + i + '"' + (c.id === inv.customerId ? ' aria-selected="true" style="font-weight:700"' : '') + '>' + esc(c.name) +
                    (c.email || c.phone ? '<small>' + esc([c.email, c.phone].filter(Boolean).join('  ·  ')) + '</small>' : '') + '</button>';
            }).join('');
            box.hidden = false;
            byId('c-name').setAttribute('aria-expanded', 'true');
            Dandy.els('button', box).forEach(function (b) {
                b.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    pickCustomer(list[parseInt(b.dataset.i, 10)]);
                });
            });
        }

        function hidePicker() {
            var box = byId('picker');
            if (box) box.hidden = true;
            var input = byId('c-name');
            if (input) input.setAttribute('aria-expanded', 'false');
        }

        function pickCustomer(c) {
            inv.customerId = c.id;
            inv.client = { name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '', vatNo: c.vatNo || '' };
            fill();
            hidePicker();
            changed();
        }

        function renderLink() {
            var c = inv.customerId && findCustomer(inv.customerId);
            byId('c-link').textContent = c ? 'Linked to your customer list.' : (inv.client.name.trim() ? 'Typed by hand - not in your customer list.' : '');
            byId('c-save').innerHTML = Dandy.icon('save') + (c ? 'Update customer record' : 'Save to customers');
        }

        function onNameInput() {
            var value = byId('c-name').value;
            inv.client.name = value;
            if (inv.customerId) {
                var c = findCustomer(inv.customerId);
                if (!c || c.name.toLowerCase() !== value.trim().toLowerCase()) inv.customerId = null;
            }
            showPicker(false);
            changed();
        }

        /* Typing a name that exactly matches a saved customer links it and fills the blanks. */
        function onNameCommit() {
            hidePicker();
            if (inv.customerId) return;
            var typed = (inv.client.name || '').trim().toLowerCase();
            var c = typed && customers.filter(function (x) { return x.name.toLowerCase() === typed; })[0];
            if (!c) return;
            inv.customerId = c.id;
            ['email', 'phone', 'address', 'vatNo'].forEach(function (f) { if (!inv.client[f]) inv.client[f] = c[f] || ''; });
            fill();
            changed();
        }

        function saveToCustomers() {
            if (!inv.client.name.trim()) { Dandy.toast('Enter a customer name first'); return; }
            var c = (inv.customerId && findCustomer(inv.customerId)) || Billing.blankCustomer();
            ['name', 'email', 'phone', 'address', 'vatNo'].forEach(function (f) { c[f] = inv.client[f]; });
            DB.saveCustomer(c).then(function () { return DB.listCustomers(); }).then(function (list) {
                customers = list;
                inv.customerId = c.id;
                changed();
                Dandy.toast('Customer saved');
            });
        }

        /* --- Line items ------------------------------------------------------------------ */

        function renderLines() {
            var box = byId('lines');
            box.innerHTML = inv.lines.map(function (line, i) {
                return '<div class="line" data-i="' + i + '">' +
                    '<div class="desc"><input type="text" data-f="desc" placeholder="What are you charging for?" value="' + esc(line.desc) + '"></div>' +
                    '<div class="trio">' +
                        '<input type="number" data-f="qty" step="0.01" min="0" value="' + esc(line.qty) + '" aria-label="Quantity">' +
                        '<select data-f="unit" aria-label="Unit">' + Billing.UNITS.map(function (u) {
                            return '<option value="' + esc(u) + '"' + (u === line.unit ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') + '</select>' +
                        '<input type="number" data-f="rate" step="0.01" min="0" value="' + esc(line.rate) + '" aria-label="Rate">' +
                    '</div>' +
                    '<div class="foot"><span class="faint" style="font-size:.6875rem">Qty · unit · rate</span>' +
                        '<span class="row" style="gap:.5rem"><span class="amount" data-amount>' + esc(Billing.money(Billing.lineAmount(line), inv.currency)) + '</span>' +
                        '<button class="btn btn-sm" data-act="preset" title="Save as a reusable item">' + Dandy.icon('save') + '</button>' +
                        '<button class="btn btn-sm btn-danger" data-act="remove" title="Remove line">' + Dandy.icon('trash') + '</button></span></div>' +
                '</div>';
            }).join('');

            Dandy.els('.line', box).forEach(function (row) {
                var i = parseInt(row.dataset.i, 10);
                Dandy.els('[data-f]', row).forEach(function (input) {
                    var handler = function () {
                        inv.lines[i][input.dataset.f] = input.value;
                        row.querySelector('[data-amount]').textContent = Billing.money(Billing.lineAmount(inv.lines[i]), inv.currency);
                        changed();
                    };
                    input.addEventListener('input', handler);
                    input.addEventListener('change', handler);
                });
                row.querySelector('[data-act="remove"]').addEventListener('click', function () {
                    inv.lines.splice(i, 1);
                    if (!inv.lines.length) inv.lines.push(Billing.blankLine());
                    renderLines(); changed();
                });
                row.querySelector('[data-act="preset"]').addEventListener('click', function () {
                    var line = inv.lines[i];
                    if (!String(line.desc).trim()) { Dandy.toast('Give the line a description first'); return; }
                    DB.addPreset(line).then(loadPresets).then(function () { Dandy.toast('Saved as a reusable item'); });
                });
            });
        }

        function loadPresets() {
            return DB.listPresets().then(function (list) { presets = list; renderPresets(); });
        }

        function renderPresets() {
            var box = byId('presets');
            if (!presets.length) {
                box.innerHTML = '<span class="faint" style="font-size:.75rem">Save a line with the disk icon and it appears here for next time.</span>';
                return;
            }
            box.innerHTML = presets.map(function (p) {
                return '<span class="preset" data-id="' + p.id + '"><button type="button" data-act="use" style="all:unset;cursor:pointer">' +
                    esc(p.desc) + ' · ' + esc(Billing.money(Billing.toCents(p.rate), inv.currency)) + '</button>' +
                    '<button type="button" class="kill" data-act="kill" aria-label="Delete this saved item">&times;</button></span>';
            }).join('');
            Dandy.els('.preset', box).forEach(function (chip) {
                var p = presets.filter(function (x) { return String(x.id) === chip.dataset.id; })[0];
                chip.querySelector('[data-act="use"]').addEventListener('click', function () {
                    var line = Billing.blankLine();
                    line.desc = p.desc; line.unit = p.unit; line.rate = p.rate;
                    if (inv.lines.length === 1 && !String(inv.lines[0].desc).trim()) inv.lines = [];
                    inv.lines.push(line);
                    renderLines(); changed();
                });
                chip.querySelector('[data-act="kill"]').addEventListener('click', function () {
                    DB.removePreset(p.id).then(loadPresets);
                });
            });
        }

        /* --- Payments ------------------------------------------------------------------------ */

        function renderBalance() {
            var t = Billing.calcTotals(inv).total;
            var paid = Billing.paidTotal(payments);
            var bal = t - paid;
            byId('balance').innerHTML = '<span>Balance due</span><span>' + esc(Billing.money(bal, inv.currency)) + '</span>';
            byId('pay-sub').textContent = payments.length ? Billing.money(paid, inv.currency) + ' received' : '';
            if (!amountTouched) byId('p-amount').value = bal > 0 ? (bal / 100).toFixed(2) : '';
        }

        function renderPayments() {
            var box = byId('pay-list');
            box.innerHTML = payments.length ? payments.map(function (p) {
                return '<div class="item" data-id="' + esc(p.id) + '"><b>' + esc(Billing.money(p.amountCents, inv.currency)) + '</b>' +
                    '<span class="nowrap">' + esc(Billing.fmtDate(p.date)) + '</span>' +
                    '<span class="grow">' + esc([p.method, p.note].filter(Boolean).join(' - ')) + '</span>' +
                    '<button class="btn btn-sm btn-danger" data-act="del" aria-label="Delete payment">' + Dandy.icon('trash') + '</button></div>';
            }).join('') : '<p class="faint" style="font-size:.8125rem">No payments recorded yet.</p>';
            Dandy.els('.item', box).forEach(function (row) {
                row.querySelector('[data-act="del"]').addEventListener('click', function () {
                    if (!window.confirm('Delete this payment?')) return;
                    DB.removePayment(row.dataset.id).then(reloadPayments);
                });
            });
        }

        function reloadPayments() {
            return DB.paymentsFor(inv.id).then(function (list) {
                payments = list;
                amountTouched = false;
                renderPayments(); updateMeta(); schedulePreview();
            });
        }

        function recordPayment() {
            var cents = Billing.toCents(byId('p-amount').value);
            if (cents <= 0) { Dandy.toast('Enter an amount'); return; }
            dirty = true;                       // a payment needs the invoice row to exist
            saveNow().then(function () {
                return DB.addPayment({
                    invoiceId: inv.id, date: byId('p-date').value || Billing.today(),
                    amountCents: cents, method: byId('p-method').value, note: byId('p-note').value.trim()
                });
            }).then(function () {
                byId('p-note').value = '';
                // Money received means the invoice has been issued.
                if (inv.status === 'draft') {
                    inv.status = 'sent';
                    byId('d-status').value = 'sent';
                    dirty = true;
                    return saveNow();
                }
            }).then(reloadPayments).then(function () { Dandy.toast('Payment recorded'); });
        }

        /* --- Wiring ---------------------------------------------------------------------------- */

        bind('c-email', theClient, 'email');
        bind('c-phone', theClient, 'phone');
        bind('c-address', theClient, 'address');
        bind('c-vatno', theClient, 'vatNo');
        bind('d-number', theInv, 'number', checkNumber);
        bind('d-date', theInv, 'date');
        bind('d-duedate', theInv, 'dueDate');
        bind('d-reference', theInv, 'reference');
        bind('d-currency', theInv, 'currency', function () { renderLines(); renderPresets(); });
        bind('d-vatmode', theInv, 'vatMode');
        bind('d-status', theInv, 'status');
        bind('d-notes', theInv, 'notes');
        bind('d-terms', theInv, 'terms');

        function checkNumber() {
            DB.numberTaken(inv.number, inv.id).then(function (taken) { byId('number-warn').hidden = !taken; });
        }

        var nameInput = byId('c-name');
        nameInput.value = inv.client.name;
        nameInput.addEventListener('input', onNameInput);
        nameInput.addEventListener('focus', function () { showPicker(true); });
        // Already focused (e.g. just picked someone): a click should reopen the list too.
        nameInput.addEventListener('click', function () { showPicker(true); });
        nameInput.addEventListener('blur', onNameCommit);
        nameInput.addEventListener('keydown', function (e) {
            var box = byId('picker');
            if (box.hidden) return;
            var items = Dandy.els('button', box);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                pickerIndex = (pickerIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items.forEach(function (b, i) { b.classList.toggle('active', i === pickerIndex); });
            } else if (e.key === 'Enter' && pickerIndex >= 0) {
                e.preventDefault();
                items[pickerIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            } else if (e.key === 'Escape') {
                hidePicker();
            }
        });

        byId('c-save').addEventListener('click', saveToCustomers);
        byId('l-add').addEventListener('click', function () { inv.lines.push(Billing.blankLine()); renderLines(); changed(); });
        byId('p-add').addEventListener('click', recordPayment);
        byId('p-amount').addEventListener('input', function () { amountTouched = true; });
        byId('p-date').value = Billing.today();

        byId('t-send').addEventListener('click', function () {
            var btn = byId('t-send');
            if (inv.status === 'sent') {
                // Undo, unless money has been received against it.
                if (payments.length) { Dandy.toast('Payments are recorded against this invoice, so it stays sent'); return; }
                inv.status = 'draft';
                byId('d-status').value = 'draft';
                changed();
                return;
            }
            // Only turn green once the change has actually been saved.
            inv.status = 'sent';
            byId('d-status').value = 'sent';
            dirty = true;
            btn.disabled = true;
            saveNow().then(function () {
                btn.disabled = false;
                if (dirty) {                      // the save failed
                    inv.status = 'draft';
                    byId('d-status').value = 'draft';
                    updateMeta();
                    Dandy.toast('Could not mark ' + inv.number + ' as sent');
                    return;
                }
                updateMeta();
                schedulePreview();
                Dandy.toast(inv.number + ' marked as sent');
            });
        });

        byId('t-dup').addEventListener('click', function () {
            dirty = true;
            saveNow().then(function () { return DB.duplicateInvoice(inv); }).then(function (copy) {
                Dandy.toast('Duplicated as ' + copy.number);
                App.go('#/invoice/' + copy.id);
            });
        });

        byId('t-print').addEventListener('click', function () {
            renderPreview();
            saveNow();
            var original = document.title;
            document.title = inv.number || 'Invoice';     // becomes the suggested PDF file name
            var restore = function () { document.title = original; window.removeEventListener('afterprint', restore); };
            window.addEventListener('afterprint', restore);
            window.print();
        });

        function onKey(e) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                dirty = true;
                saveNow().then(function () { Dandy.toast(inv.number + ' saved'); });
            }
        }
        document.addEventListener('keydown', onKey);

        fill();
        renderLines();
        renderPresets();
        renderPayments();
        updateMeta();
        renderPreview();
        Fonts.load(template.font).then(function () { if (active) renderPreview(); });
        Dandy.hydrateIcons(el);

        return {
            destroy: function () {
                active = false;
                document.removeEventListener('keydown', onKey);
                clearTimeout(previewTimer);
                return dirty ? saveNow() : chain;
            },
            refresh: renderPreview
        };
    }

    return { mount: mount };
})();
