/* ==========================================================================
   Document editor - the form, the live A4 sheet, and the actions.

   One implementation serves /invoice/ and /quote/. The kind decides labels,
   which panels appear, and which actions are offered; everything else - the
   line engine, the totals, the client book, the printed sheet - is shared.
   ========================================================================== */

var DocEditor = (function () {
    'use strict';

    var kind, doc, profile;
    var elForm, elPreview, elLines, elPresets, elSaved, elCompliance;

    var LABELS = {
        invoice: { one: 'Invoice', due: 'Due date', dueShort: 'Due', list: 'Saved invoices' },
        quote:   { one: 'Quote',   due: 'Valid until', dueShort: 'Valid until', list: 'Saved quotes' }
    };

    function L() { return LABELS[kind]; }

    /* --- Small helpers ------------------------------------------------------ */

    function esc(s) { return Dandy.escapeHtml(s == null ? '' : s); }
    function byId(id) { return document.getElementById(id); }

    function draftKey() { return 'draft.' + kind; }

    function saveDraft() {
        doc.updated = Date.now();
        Dandy.Store.set(draftKey(), doc);
    }

    function fmtDate(iso) {
        if (!iso) return '';
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    /* Bind a control to a field, resolving the owning object lazily.
       `doc` is replaced wholesale when a saved document is opened, so a
       listener that captured the object directly would keep writing into the
       document the user just navigated away from. Binding happens once; the
       values are refilled separately by fillForm(). */
    var bindings = [];

    function bind(id, owner, key, after) {
        var el = byId(id);
        if (!el) return;
        bindings.push({ el: el, owner: owner, key: key });

        var handler = function () {
            owner()[key] = el.value;
            if (after) after();
            saveDraft();
            renderPreview();
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    }

    function fillForm() {
        bindings.forEach(function (b) {
            var value = b.owner()[b.key];
            b.el.value = value == null ? '' : value;
        });
        updateLogoPreview();
    }

    var theDoc    = function () { return doc; };
    var theClient = function () { return doc.client; };
    var theProfile = function () { return profile; };

    /* ======================================================================
       FORM
       ====================================================================== */

    function formMarkup() {
        var isQuote = kind === 'quote';

        return '' +
        /* --- Your business ------------------------------------------------ */
        '<details class="fold" id="fold-profile">' +
            '<summary>' + Dandy.icon('user') + 'Your business' +
                '<span class="sub" id="profile-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
            '<div class="fold-body">' +
                '<p class="muted mb-2" style="font-size:.75rem">Saved once in this browser and filled in on every document from now on.</p>' +
                '<label class="field"><span>Business name</span><input type="text" id="p-name" placeholder="Your Company (Pty) Ltd"></label>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Company reg. no.</span><input type="text" id="p-regno" placeholder="2019/123456/07"></label>' +
                    '<label class="field"><span>VAT reg. no.</span><input type="text" id="p-vatno" placeholder="4123456789"></label>' +
                '</div>' +
                '<label class="field"><span>Address</span><textarea id="p-address" rows="3" placeholder="12 Rivonia Road&#10;Sandton&#10;Johannesburg, 2196"></textarea></label>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Email</span><input type="email" id="p-email" placeholder="accounts@yourcompany.co.za"></label>' +
                    '<label class="field"><span>Phone</span><input type="tel" id="p-phone" placeholder="+27 82 123 4567"></label>' +
                '</div>' +
                '<label class="field"><span>Website</span><input type="text" id="p-website" placeholder="yourcompany.co.za"></label>' +
                '<label class="field"><span>Logo</span><input type="file" id="p-logo" accept="image/*"></label>' +
                '<div class="row mb-2"><img id="p-logo-preview" alt="" style="max-height:44px;display:none">' +
                    '<button class="btn btn-sm" id="p-logo-clear" hidden>Remove logo</button></div>' +
                '<p class="eyebrow mt-3 mb-1">Banking details</p>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Bank</span><input type="text" id="p-bankname" placeholder="FNB"></label>' +
                    '<label class="field"><span>Account type</span><input type="text" id="p-banktype" placeholder="Business cheque"></label>' +
                '</div>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Account number</span><input type="text" id="p-bankaccount" placeholder="62xxxxxxxxx"></label>' +
                    '<label class="field"><span>Branch code</span><input type="text" id="p-bankbranch" placeholder="250655"></label>' +
                '</div>' +
                '<button class="btn btn-dark" id="p-save">' + Dandy.icon('save') + 'Save business details</button>' +
            '</div>' +
        '</details>' +

        /* --- Client -------------------------------------------------------- */
        '<details class="fold" open id="fold-client">' +
            '<summary>' + Dandy.icon('user') + 'Client' +
                '<span class="sub" id="client-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
            '<div class="fold-body">' +
                '<label class="field"><span>Client name</span>' +
                    '<input type="text" id="c-name" list="client-book" autocomplete="off" placeholder="Start typing — saved clients autofill">' +
                    '<datalist id="client-book"></datalist></label>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Email</span><input type="email" id="c-email"></label>' +
                    '<label class="field"><span>Phone</span><input type="tel" id="c-phone"></label>' +
                '</div>' +
                '<label class="field"><span>Address</span><textarea id="c-address" rows="3"></textarea></label>' +
                '<label class="field"><span>Client VAT no.</span><input type="text" id="c-vatno"></label>' +
                '<div class="btn-row">' +
                    '<button class="btn btn-sm" id="c-save">' + Dandy.icon('save') + 'Save to client book</button>' +
                    '<button class="btn btn-sm" id="c-clear">Clear</button>' +
                '</div>' +
            '</div>' +
        '</details>' +

        /* --- Document ------------------------------------------------------- */
        '<details class="fold" open id="fold-doc">' +
            '<summary>' + Dandy.icon('file-text') + L().one + ' details' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
            '<div class="fold-body">' +
                '<div class="field-row two">' +
                    '<label class="field"><span>' + L().one + ' number</span><input type="text" id="d-number"></label>' +
                    '<label class="field"><span>Date</span><input type="date" id="d-date"></label>' +
                '</div>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>' + L().due + '</span><input type="date" id="d-duedate"></label>' +
                    '<label class="field"><span>Your reference</span><input type="text" id="d-reference" placeholder="PO number, project name"></label>' +
                '</div>' +
                '<div class="field-row two">' +
                    '<label class="field"><span>Currency</span><select id="d-currency">' +
                        Billing.CURRENCIES.map(function (c) {
                            return '<option value="' + c.code + '">' + esc(c.label) + '</option>';
                        }).join('') + '</select></label>' +
                    '<label class="field"><span>VAT treatment</span><select id="d-vatmode">' +
                        '<option value="exclusive">Add 15% VAT to the total</option>' +
                        '<option value="inclusive">Prices already include 15% VAT</option>' +
                        '<option value="none">No VAT — not registered</option>' +
                    '</select></label>' +
                '</div>' +
                (isQuote
                    ? '<label class="field"><span>Deposit on acceptance (%)</span>' +
                      '<input type="number" id="d-deposit" min="0" max="100" step="5" placeholder="0"></label>'
                    : '') +
            '</div>' +
        '</details>' +

        /* --- Lines ---------------------------------------------------------- */
        '<details class="fold" open id="fold-lines">' +
            '<summary>' + Dandy.icon('receipt') + 'Line items' +
                '<span class="sub" id="lines-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
            '<div class="fold-body">' +
                '<p class="eyebrow mb-1">Saved items — click to insert</p>' +
                '<div class="presets-bar" id="presets"></div>' +
                '<div class="lines" id="lines"></div>' +
                '<div class="btn-row mt-2">' +
                    '<button class="btn btn-dark btn-sm" id="l-add">' + Dandy.icon('plus') + 'Add line</button>' +
                    (isQuote ? '<button class="btn btn-sm" id="l-add-opt">' + Dandy.icon('plus') + 'Add optional line</button>' : '') +
                '</div>' +
            '</div>' +
        '</details>' +

        /* --- Notes ----------------------------------------------------------- */
        '<details class="fold" id="fold-notes">' +
            '<summary>' + Dandy.icon('file-text') + 'Notes &amp; terms' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
            '<div class="fold-body">' +
                '<label class="field"><span>Notes to the client</span><textarea id="d-notes" rows="3" placeholder="Thanks for the work — anything you want said on the document."></textarea></label>' +
                '<label class="field"><span>Terms</span><textarea id="d-terms" rows="4"></textarea></label>' +
            '</div>' +
        '</details>' +

        /* --- Saved ------------------------------------------------------------ */
        '<details class="fold" id="fold-saved">' +
            '<summary>' + Dandy.icon('save') + L().list +
                '<span class="sub" id="saved-sub"></span>' + Dandy.icon('chevron-right', 'chev') + '</summary>' +
            '<div class="fold-body">' +
                '<div class="saved" id="saved"></div>' +
                '<p class="note note-info mt-2">' + Dandy.icon('info') +
                    '<span>Everything is stored in this browser only. Clearing site data deletes it, so keep a backup.</span></p>' +
                '<div class="btn-row mt-2">' +
                    '<button class="btn btn-sm" id="b-export">' + Dandy.icon('download') + 'Export backup</button>' +
                    '<button class="btn btn-sm" id="b-import">' + Dandy.icon('upload') + 'Import backup</button>' +
                    '<input type="file" id="b-import-file" accept="application/json,.json" hidden>' +
                '</div>' +
            '</div>' +
        '</details>';
    }

    /* --- Line rows ---------------------------------------------------------- */

    function renderLines() {
        elLines.innerHTML = doc.lines.map(function (line, i) {
            return '<div class="line' + (line.optional && !line.included ? ' excluded' : '') + '" data-i="' + i + '">' +
                '<div class="desc"><input type="text" data-f="desc" placeholder="What are you charging for?" value="' + esc(line.desc) + '"></div>' +
                '<div class="trio">' +
                    '<input type="number" data-f="qty" step="0.01" min="0" value="' + esc(line.qty) + '" aria-label="Quantity">' +
                    '<select data-f="unit" aria-label="Unit">' +
                        Billing.UNITS.map(function (u) {
                            return '<option value="' + esc(u) + '"' + (u === line.unit ? ' selected' : '') + '>' + esc(u) + '</option>';
                        }).join('') +
                    '</select>' +
                    '<input type="number" data-f="rate" step="0.01" min="0" value="' + esc(line.rate) + '" aria-label="Rate">' +
                '</div>' +
                '<div class="foot">' +
                    (line.optional
                        ? '<label class="check"><input type="checkbox" data-f="included"' + (line.included ? ' checked' : '') + '> Optional — include in total</label>'
                        : '<span class="faint" style="font-size:.6875rem">Qty · unit · rate</span>') +
                    '<span class="row" style="gap:.5rem">' +
                        '<span class="amount" data-amount>' + esc(Billing.money(Billing.lineAmount(line), doc.currency)) + '</span>' +
                        '<button class="btn btn-sm" data-act="preset" title="Save as a reusable item">' + Dandy.icon('save') + '</button>' +
                        '<button class="btn btn-sm btn-danger" data-act="remove" title="Remove line">' + Dandy.icon('trash') + '</button>' +
                    '</span>' +
                '</div>' +
            '</div>';
        }).join('');

        Dandy.hydrateIcons(elLines);

        Dandy.els('.line', elLines).forEach(function (row) {
            var i = parseInt(row.dataset.i, 10);

            Dandy.els('[data-f]', row).forEach(function (input) {
                var field = input.dataset.f;
                var handler = function () {
                    doc.lines[i][field] = input.type === 'checkbox' ? input.checked : input.value;
                    row.querySelector('[data-amount]').textContent =
                        Billing.money(Billing.lineAmount(doc.lines[i]), doc.currency);
                    row.classList.toggle('excluded', !!doc.lines[i].optional && !doc.lines[i].included);
                    saveDraft();
                    renderPreview();
                };
                input.addEventListener('input', handler);
                input.addEventListener('change', handler);
            });

            row.querySelector('[data-act="remove"]').addEventListener('click', function () {
                doc.lines.splice(i, 1);
                if (!doc.lines.length) doc.lines.push(Billing.blankLine());
                saveDraft();
                renderLines();
                renderPreview();
            });

            row.querySelector('[data-act="preset"]').addEventListener('click', function () {
                var line = doc.lines[i];
                if (!line.desc.trim()) { Dandy.toast('Give the line a description first'); return; }
                Billing.addPreset(line);
                renderPresets();
                Dandy.toast('Saved as a reusable item');
            });
        });

        byId('lines-sub').textContent = doc.lines.length + ' line' + (doc.lines.length === 1 ? '' : 's');
    }

    function renderPresets() {
        var presets = Billing.getPresets();
        if (!presets.length) {
            elPresets.innerHTML = '<span class="faint" style="font-size:.75rem">Save a line with the disk icon and it appears here for next time.</span>';
            return;
        }
        elPresets.innerHTML = presets.map(function (p, i) {
            return '<span class="preset" data-i="' + i + '">' +
                '<button type="button" data-act="use" style="all:unset;cursor:pointer">' +
                    esc(p.desc) + ' · ' + esc(Billing.money(Billing.toCents(p.rate), doc.currency)) +
                '</button>' +
                '<button type="button" class="kill" data-act="kill" aria-label="Delete this saved item">&times;</button>' +
            '</span>';
        }).join('');

        Dandy.els('.preset', elPresets).forEach(function (chip) {
            var i = parseInt(chip.dataset.i, 10);
            chip.querySelector('[data-act="use"]').addEventListener('click', function () {
                var p = Billing.getPresets()[i];
                var line = Billing.blankLine();
                line.desc = p.desc; line.unit = p.unit; line.rate = p.rate;
                // Drop a single untouched blank line rather than stacking on top of it.
                if (doc.lines.length === 1 && !doc.lines[0].desc.trim()) doc.lines = [];
                doc.lines.push(line);
                saveDraft();
                renderLines();
                renderPreview();
            });
            chip.querySelector('[data-act="kill"]').addEventListener('click', function () {
                Billing.removePreset(i);
                renderPresets();
            });
        });
    }

    /* --- Saved documents ----------------------------------------------------- */

    function renderSaved() {
        var docs = Billing.listDocs(kind);
        byId('saved-sub').textContent = docs.length ? docs.length + ' saved' : '';

        if (!docs.length) {
            elSaved.innerHTML = '<p class="faint" style="font-size:.8125rem">Nothing saved yet. Use Save in the toolbar.</p>';
            return;
        }

        elSaved.innerHTML = docs.map(function (d) {
            var t = Billing.calcTotals(d);
            return '<div class="item" data-id="' + esc(d.id) + '">' +
                '<span class="n">' + esc(d.number) + '</span>' +
                '<span class="who">' + esc(d.client.name || 'No client') + '</span>' +
                '<span class="nowrap">' + esc(Billing.money(t.total, d.currency)) + '</span>' +
                '<button class="btn btn-sm" data-act="load">Open</button>' +
                '<button class="btn btn-sm btn-danger" data-act="del" aria-label="Delete">' + Dandy.icon('trash') + '</button>' +
            '</div>';
        }).join('');

        Dandy.hydrateIcons(elSaved);

        Dandy.els('.item', elSaved).forEach(function (item) {
            var id = item.dataset.id;
            item.querySelector('[data-act="load"]').addEventListener('click', function () {
                var loaded = Billing.loadDoc(id);
                if (!loaded) return;
                doc = loaded;
                saveDraft();
                fillForm();
                renderLines();
                renderPreview();
                Dandy.toast('Opened ' + doc.number);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            item.querySelector('[data-act="del"]').addEventListener('click', function () {
                if (!window.confirm('Delete this ' + kind + ' permanently?')) return;
                Billing.removeDoc(id);
                renderSaved();
                Dandy.toast('Deleted');
            });
        });
    }

    /* --- Client book ---------------------------------------------------------- */

    function renderClientBook() {
        var list = byId('client-book');
        list.innerHTML = Billing.getClients().map(function (c) {
            return '<option value="' + esc(c.name) + '"></option>';
        }).join('');
    }

    /* ======================================================================
       PREVIEW - this node is exactly what gets printed
       ====================================================================== */

    function partyBlock(label, name, lines, extra) {
        return '<div><p class="label">' + esc(label) + '</p>' +
            '<p class="who">' + esc(name || '—') + '</p>' +
            (lines ? '<span class="lines">' + esc(lines) + '</span>' : '') +
            (extra ? '<span class="lines">' + esc(extra) + '</span>' : '') + '</div>';
    }

    function renderPreview() {
        var t = Billing.calcTotals(doc);
        var cur = doc.currency;
        var vatPct = Math.round(t.vatRate * 100);
        var isQuote = kind === 'quote';

        var contact = [profile.email, profile.phone, profile.website].filter(Boolean).join('  ·  ');
        var regs = [
            profile.regNo ? 'Reg. no. ' + profile.regNo : '',
            profile.vatNo ? 'VAT no. ' + profile.vatNo : ''
        ].filter(Boolean).join('   ·   ');

        var rows = doc.lines.filter(function (l) {
            return l.desc.trim() || Billing.lineAmount(l) > 0;
        });

        var body = rows.length
            ? rows.map(function (line) {
                var counted = Billing.counts(line);
                return '<tr class="' + (counted ? '' : 'optional') + '">' +
                    '<td><span class="d">' + esc(line.desc || '—') + '</span>' +
                        (counted ? '' : '<span class="opt-tag">Optional</span>') + '</td>' +
                    '<td class="c">' + esc(line.qty) + '</td>' +
                    '<td class="c">' + esc(line.unit) + '</td>' +
                    '<td class="r">' + esc(Billing.money(Billing.toCents(line.rate), cur)) + '</td>' +
                    '<td class="r">' + esc(Billing.money(Billing.lineAmount(line), cur)) + '</td>' +
                '</tr>';
            }).join('')
            : '<tr><td colspan="5" style="color:#9ca3af">Add a line item to see it here.</td></tr>';

        var totalRows = '';
        if (doc.vatMode === 'exclusive') {
            totalRows =
                '<tr><td>Subtotal</td><td class="r">' + esc(Billing.money(t.subtotal, cur)) + '</td></tr>' +
                '<tr><td>VAT @ ' + vatPct + '%</td><td class="r">' + esc(Billing.money(t.vat, cur)) + '</td></tr>';
        } else if (doc.vatMode === 'inclusive') {
            totalRows =
                '<tr><td>Amount excl. VAT</td><td class="r">' + esc(Billing.money(t.subtotal, cur)) + '</td></tr>' +
                '<tr><td>VAT @ ' + vatPct + '% (included)</td><td class="r">' + esc(Billing.money(t.vat, cur)) + '</td></tr>';
        }

        totalRows += '<tr class="grand"><td>Total ' + (doc.vatMode === 'none' ? 'due' : 'incl. VAT') +
            '</td><td class="r">' + esc(Billing.money(t.total, cur)) + '</td></tr>';

        if (t.deposit > 0) {
            totalRows += '<tr class="deposit due"><td>Deposit on acceptance (' + t.depositPct + '%)</td>' +
                '<td class="r">' + esc(Billing.money(t.deposit, cur)) + '</td></tr>' +
                '<tr class="deposit"><td>Balance on completion</td>' +
                '<td class="r">' + esc(Billing.money(t.balance, cur)) + '</td></tr>';
        }

        var bank = (profile.bankName || profile.bankAccount)
            ? '<div class="sheet-block bank"><p class="label">Banking details</p>' +
                [['Bank', profile.bankName], ['Account type', profile.bankType],
                 ['Account number', profile.bankAccount], ['Branch code', profile.bankBranch],
                 ['Reference', doc.number]]
                    .filter(function (p) { return p[1]; })
                    .map(function (p) {
                        return '<div class="row"><span>' + esc(p[0]) + '</span><span>' + esc(p[1]) + '</span></div>';
                    }).join('') +
              '</div>'
            : '';

        elPreview.innerHTML =
            '<div class="sheet" id="sheet">' +
                '<div class="sheet-top">' +
                    '<div class="sheet-brand">' +
                        (profile.logo ? '<img src="' + esc(profile.logo) + '" alt="">' : '') +
                        '<p class="name">' + esc(profile.name || 'Your business name') + '</p>' +
                        (profile.address ? '<p class="meta">' + esc(profile.address) + '</p>' : '') +
                        (contact ? '<p class="meta">' + esc(contact) + '</p>' : '') +
                        (regs ? '<p class="regs">' + esc(regs) + '</p>' : '') +
                    '</div>' +
                    '<div class="sheet-title">' +
                        '<h2>' + esc(Billing.title(doc)) + '</h2>' +
                        '<p class="num">' + esc(doc.number) + '</p>' +
                        '<p class="dates">Issued <b>' + esc(fmtDate(doc.date)) + '</b><br>' +
                            esc(L().dueShort) + ' <b>' + esc(fmtDate(doc.dueDate)) + '</b>' +
                            (doc.reference ? '<br>Ref <b>' + esc(doc.reference) + '</b>' : '') +
                            (doc.ref ? '<br>From quote <b>' + esc(doc.ref) + '</b>' : '') +
                        '</p>' +
                    '</div>' +
                '</div>' +

                '<div class="sheet-parties">' +
                    partyBlock(isQuote ? 'Prepared for' : 'Billed to',
                        doc.client.name,
                        doc.client.address,
                        [doc.client.email, doc.client.phone].filter(Boolean).join('  ·  ') +
                        (doc.client.vatNo ? '\nVAT no. ' + doc.client.vatNo : '')) +
                    partyBlock(isQuote ? 'Quotation from' : 'Supplied by',
                        profile.name, profile.address,
                        profile.vatNo ? 'VAT no. ' + profile.vatNo : '') +
                '</div>' +

                '<table class="sheet-lines"><thead><tr>' +
                    '<th>Description</th><th class="c">Qty</th><th class="c">Unit</th>' +
                    '<th class="r">Rate</th><th class="r">Amount</th>' +
                '</tr></thead><tbody>' + body + '</tbody></table>' +

                '<div class="sheet-totals"><table><tbody>' + totalRows + '</tbody></table></div>' +

                (t.optionalTotal > 0
                    ? '<p class="vat-line">Optional items not included above total ' +
                      esc(Billing.money(t.optionalTotal, cur)) + '.</p>'
                    : '') +

                '<div class="sheet-blocks">' +
                    '<div class="sheet-block">' +
                        (doc.notes ? '<p class="label">Notes</p><p class="body">' + esc(doc.notes) + '</p>' : '') +
                        (doc.terms ? '<p class="label" style="margin-top:1rem">Terms</p><p class="body">' + esc(doc.terms) + '</p>' : '') +
                    '</div>' +
                    (isQuote ? '' : bank) +
                '</div>' +

                (isQuote && bank ? '<div class="sheet-blocks">' + bank + '</div>' : '') +

                '<div class="sheet-foot">' +
                    '<span>' + esc(Billing.title(doc)) + ' ' + esc(doc.number) + '</span>' +
                    '<span>' + esc(profile.name || '') + '</span>' +
                '</div>' +
            '</div>';

        renderCompliance();
        byId('client-sub').textContent = doc.client.name || '';
        byId('profile-sub').textContent = profile.name || 'Not set up yet';
    }

    function renderCompliance() {
        var issues = Billing.compliance(doc, profile);
        if (!issues.length) {
            elCompliance.hidden = true;
            return;
        }
        elCompliance.hidden = false;
        elCompliance.className = 'note note-warn mb-2 no-print';
        elCompliance.innerHTML = Dandy.icon('alert') +
            '<span><b>This is not yet a valid tax invoice.</b><br>' +
            issues.map(esc).join('<br>') + '</span>';
    }

    /* ======================================================================
       WIRING
       ====================================================================== */

    function bindAll() {
        bind('p-name', theProfile, 'name');
        bind('p-regno', theProfile, 'regNo');
        bind('p-vatno', theProfile, 'vatNo');
        bind('p-address', theProfile, 'address');
        bind('p-email', theProfile, 'email');
        bind('p-phone', theProfile, 'phone');
        bind('p-website', theProfile, 'website');
        bind('p-bankname', theProfile, 'bankName');
        bind('p-banktype', theProfile, 'bankType');
        bind('p-bankaccount', theProfile, 'bankAccount');
        bind('p-bankbranch', theProfile, 'bankBranch');

        bind('c-name', theClient, 'name', autofillClient);
        bind('c-email', theClient, 'email');
        bind('c-phone', theClient, 'phone');
        bind('c-address', theClient, 'address');
        bind('c-vatno', theClient, 'vatNo');

        bind('d-number', theDoc, 'number');
        bind('d-date', theDoc, 'date');
        bind('d-duedate', theDoc, 'dueDate');
        bind('d-reference', theDoc, 'reference');
        bind('d-currency', theDoc, 'currency', function () { renderLines(); renderPresets(); });
        bind('d-vatmode', theDoc, 'vatMode');
        bind('d-notes', theDoc, 'notes');
        bind('d-terms', theDoc, 'terms');
        if (byId('d-deposit')) bind('d-deposit', theDoc, 'depositPct');
    }

    function autofillClient() {
        var match = Billing.getClients().find(function (c) {
            return c.name.trim().toLowerCase() === (doc.client.name || '').trim().toLowerCase();
        });
        if (!match) return;
        ['email', 'phone', 'address', 'vatNo'].forEach(function (f) {
            doc.client[f] = match[f] || '';
            var el = byId('c-' + f.toLowerCase());
            if (el) el.value = doc.client[f];
        });
    }

    function updateLogoPreview() {
        var img = byId('p-logo-preview');
        var clear = byId('p-logo-clear');
        if (profile.logo) {
            img.src = profile.logo;
            img.style.display = 'block';
            clear.hidden = false;
        } else {
            img.removeAttribute('src');
            img.style.display = 'none';
            clear.hidden = true;
        }
    }

    function wireActions() {
        byId('p-save').addEventListener('click', function () {
            Billing.saveProfile(profile);
            Dandy.toast('Business details saved');
        });

        byId('p-logo').addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            // localStorage is a few megabytes total; a big logo would evict everything else.
            if (file.size > 200 * 1024) {
                Dandy.toast('Logo must be under 200KB');
                e.target.value = '';
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                profile.logo = reader.result;
                Billing.saveProfile(profile);
                updateLogoPreview();
                renderPreview();
            };
            reader.readAsDataURL(file);
        });

        byId('p-logo-clear').addEventListener('click', function () {
            profile.logo = '';
            Billing.saveProfile(profile);
            byId('p-logo').value = '';
            updateLogoPreview();
            renderPreview();
        });

        byId('c-save').addEventListener('click', function () {
            if (!doc.client.name.trim()) { Dandy.toast('Enter a client name first'); return; }
            Billing.rememberClient(doc.client);
            renderClientBook();
            Dandy.toast('Client saved');
        });

        byId('c-clear').addEventListener('click', function () {
            doc.client = { name: '', email: '', phone: '', address: '', vatNo: '' };
            ['name', 'email', 'phone', 'address', 'vatno'].forEach(function (f) { byId('c-' + f).value = ''; });
            fillForm();
            saveDraft();
            renderPreview();
        });

        byId('l-add').addEventListener('click', function () {
            doc.lines.push(Billing.blankLine());
            saveDraft(); renderLines(); renderPreview();
        });

        if (byId('l-add-opt')) {
            byId('l-add-opt').addEventListener('click', function () {
                var line = Billing.blankLine();
                line.optional = true;
                line.included = false;
                doc.lines.push(line);
                saveDraft(); renderLines(); renderPreview();
            });
        }

        byId('t-new').addEventListener('click', function () {
            if (!window.confirm('Start a new ' + kind + '? Save the current one first if you need it.')) return;
            doc = Billing.blankDoc(kind);
            saveDraft(); fillForm(); renderLines(); renderPreview();
            Dandy.toast('New ' + kind + ' ' + doc.number);
        });

        byId('t-save').addEventListener('click', function () {
            Billing.saveDoc(doc);
            Billing.rememberClient(doc.client);
            renderSaved(); renderClientBook();
            Dandy.toast(doc.number + ' saved');
        });

        byId('t-dup').addEventListener('click', function () {
            doc = Billing.duplicate(doc);
            saveDraft(); fillForm(); renderLines(); renderPreview();
            Dandy.toast('Duplicated as ' + doc.number);
        });

        byId('t-print').addEventListener('click', function () { window.print(); });

        if (byId('t-convert')) {
            byId('t-convert').addEventListener('click', function () {
                if (!doc.client.name.trim()) { Dandy.toast('Add a client before converting'); return; }
                Billing.saveDoc(doc);
                var invoice = Billing.convert(doc, 'invoice');
                Billing.saveDoc(invoice);
                Dandy.Store.set('draft.invoice', invoice);
                window.location.href = '../invoice/';
            });
        }

        byId('b-export').addEventListener('click', function () {
            Dandy.download('dandyapp-backup-' + Billing.today() + '.json',
                Dandy.Store.exportAll(), 'application/json');
            Dandy.toast('Backup downloaded');
        });

        byId('b-import').addEventListener('click', function () { byId('b-import-file').click(); });

        byId('b-import-file').addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var n = Dandy.Store.importAll(reader.result);
                    Dandy.toast('Restored ' + n + ' item' + (n === 1 ? '' : 's'));
                    setTimeout(function () { window.location.reload(); }, 700);
                } catch (err) {
                    Dandy.toast(err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        // Cmd/Ctrl+S saves, Cmd/Ctrl+P prints the sheet rather than the whole page.
        document.addEventListener('keydown', function (e) {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key.toLowerCase() === 's') {
                e.preventDefault();
                byId('t-save').click();
            }
        });
    }

    /* --- Boot ---------------------------------------------------------------- */

    function start(k) {
        kind = k;
        profile = Billing.getProfile();

        // Resume the draft if there is one, so a reload never loses work.
        // Merging over defaults() fills fields a stored draft predates without
        // reserving a serial number every time the page loads.
        var draft = Dandy.Store.get('draft.' + kind, null);
        doc = (draft && Array.isArray(draft.lines))
            ? Object.assign(Billing.defaults(kind), draft)
            : Billing.blankDoc(kind);
        if (!doc.number) doc.number = Billing.nextNumber(kind);

        elForm = byId('doc-form');
        elPreview = byId('doc-preview');
        elCompliance = byId('compliance');

        elForm.innerHTML = formMarkup();
        Dandy.hydrateIcons(elForm);

        elLines = byId('lines');
        elPresets = byId('presets');
        elSaved = byId('saved');

        bindAll();
        fillForm();
        renderClientBook();
        renderPresets();
        renderLines();
        renderSaved();
        renderPreview();
        wireActions();
    }

    return { start: start };
})();
