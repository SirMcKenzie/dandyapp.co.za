/* Invoices - the stored list, with filters and quick status actions. */

var InvoicesView = (function () {
    'use strict';

    var esc = App.esc;
    var STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'];

    function mount(el, params, query) {
        var filter = { q: query.q || '', status: '', from: '', to: '' };
        var rows = [];

        function load() {
            return Promise.all([DB.listInvoices(), DB.allPayments()]).then(function (d) {
                rows = App.summarise(d[0], d[1]);
            });
        }

        function visible() {
            var q = filter.q.trim().toLowerCase();
            return rows.filter(function (r) {
                if (filter.status && r.status !== filter.status) return false;
                if (filter.from && r.inv.date < filter.from) return false;
                if (filter.to && r.inv.date > filter.to) return false;
                if (q && (r.inv.number + ' ' + r.inv.client.name + ' ' + r.inv.reference).toLowerCase().indexOf(q) === -1) return false;
                return true;
            }).sort(function (a, b) {
                return a.inv.date < b.inv.date ? 1 : a.inv.date > b.inv.date ? -1 : b.inv.number.localeCompare(a.inv.number);
            });
        }

        function shell() {
            el.innerHTML =
                '<div class="page-head"><div><p class="eyebrow">Stored</p><h1>INVOICES</h1></div>' +
                    '<a class="btn btn-dark" href="#/invoice/new">' + Dandy.icon('plus') + 'New invoice</a></div>' +
                '<div class="filters">' +
                    '<input type="search" id="f-q" class="grow" placeholder="Search number, customer or reference" value="' + esc(filter.q) + '">' +
                    '<select id="f-status" aria-label="Status"><option value="">All statuses</option>' +
                        STATUSES.map(function (s) {
                            return '<option value="' + s + '"' + (filter.status === s ? ' selected' : '') + '>' + esc(Billing.STATUS_LABEL[s]) + '</option>';
                        }).join('') + '</select>' +
                    '<label class="row" style="gap:.375rem;font-size:.75rem;color:var(--muted)">From <input type="date" id="f-from" value="' + esc(filter.from) + '"></label>' +
                    '<label class="row" style="gap:.375rem;font-size:.75rem;color:var(--muted)">To <input type="date" id="f-to" value="' + esc(filter.to) + '"></label>' +
                '</div>' +
                '<div id="list"></div>';

            var bind = function (id, key, evt) {
                el.querySelector(id).addEventListener(evt, function (e) { filter[key] = e.target.value; drawList(); });
            };
            bind('#f-q', 'q', 'input');
            bind('#f-status', 'status', 'change');
            bind('#f-from', 'from', 'change');
            bind('#f-to', 'to', 'change');
        }

        function drawList() {
            var list = el.querySelector('#list');
            var shown = visible();

            if (!rows.length) {
                list.innerHTML = '<div class="panel empty">No invoices yet. <a href="#/invoice/new" style="text-decoration:underline">Create your first one.</a></div>';
                return;
            }
            if (!shown.length) {
                list.innerHTML = '<div class="panel empty">No invoices match these filters.</div>';
                return;
            }

            list.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
                '<th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th class="r">Total</th><th class="r">Balance</th><th>Status</th><th></th>' +
                '</tr></thead><tbody>' + shown.map(function (r) {
                    var i = r.inv;
                    return '<tr class="clickable" data-id="' + esc(i.id) + '">' +
                        '<td class="strong">' + esc(i.number) + '</td>' +
                        '<td>' + esc(i.client.name || 'No customer') + '</td>' +
                        '<td class="nowrap">' + esc(Billing.fmtDate(i.date)) + '</td>' +
                        '<td class="nowrap">' + esc(Billing.fmtDate(i.dueDate)) + '</td>' +
                        '<td class="r">' + esc(Billing.money(r.total, i.currency)) + '</td>' +
                        '<td class="r">' + (r.status === 'void' || r.status === 'draft' ? '<span class="faint">-</span>' : esc(Billing.money(r.balance, i.currency))) + '</td>' +
                        '<td>' + App.statusPill(r.status) + '</td>' +
                        '<td class="actions">' +
                            (i.status === 'draft' ? '<button class="btn btn-sm" data-act="send">Mark sent</button> ' : '') +
                            '<button class="btn btn-sm" data-act="void">' + (i.status === 'void' ? 'Reopen' : 'Void') + '</button> ' +
                            '<button class="btn btn-sm" data-act="dup" aria-label="Duplicate" title="Duplicate">' + Dandy.icon('copy') + '</button> ' +
                            '<button class="btn btn-sm btn-danger" data-act="del" aria-label="Delete" title="Delete">' + Dandy.icon('trash') + '</button>' +
                        '</td></tr>';
                }).join('') + '</tbody></table></div>';
            Dandy.hydrateIcons(list);

            Dandy.els('tr[data-id]', list).forEach(function (tr) {
                var id = tr.dataset.id;
                var row = rows.filter(function (r) { return r.inv.id === id; })[0];
                var inv = row.inv;

                tr.addEventListener('click', function (e) {
                    if (e.target.closest('[data-act]')) return;
                    App.go('#/invoice/' + id);
                });

                tr.querySelector('[data-act="void"]').addEventListener('click', function () {
                    inv.status = inv.status === 'void' ? (row.pays.length ? 'sent' : 'draft') : 'void';
                    DB.saveInvoice(inv).then(load).then(drawList);
                });
                var send = tr.querySelector('[data-act="send"]');
                if (send) send.addEventListener('click', function () {
                    inv.status = 'sent';
                    DB.saveInvoice(inv).then(load).then(drawList);
                    Dandy.toast(inv.number + ' marked as sent');
                });
                tr.querySelector('[data-act="dup"]').addEventListener('click', function () {
                    DB.duplicateInvoice(inv).then(function (copy) {
                        Dandy.toast('Duplicated as ' + copy.number);
                        return load();
                    }).then(drawList);
                });
                tr.querySelector('[data-act="del"]').addEventListener('click', function () {
                    DB.numberFate(inv).then(function (fate) {
                        var what = {
                            reuse:  'It is your newest invoice, so ' + inv.number + ' will be used again for the next new invoice.',
                            gap:    'Later invoices already exist, so ' + inv.number + ' stays used and will not be given to another invoice.',
                            burned: 'It has been voided, so ' + inv.number + ' stays used for good and will not be given to another invoice.'
                        }[fate];
                        if (!window.confirm('Delete ' + inv.number + ' and its payments permanently?\n\n' + what)) return;
                        return DB.removeInvoice(id).then(load).then(function () { drawList(); Dandy.toast('Deleted'); });
                    });
                });
            });
        }

        return load().then(function () { shell(); drawList(); Dandy.hydrateIcons(el); });
    }

    return { mount: mount };
})();
