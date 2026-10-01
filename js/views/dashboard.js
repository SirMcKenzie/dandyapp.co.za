/* Dashboard - what has been invoiced, received, and is still owed. */

var DashboardView = (function () {
    'use strict';

    var esc = App.esc;
    var PERIODS = [
        { id: 'month', label: 'This month' },
        { id: 'year',  label: 'This year' },
        { id: 'all',   label: 'All time' }
    ];

    function inPeriod(iso, period) {
        if (period === 'all') return true;
        var today = Billing.today();
        if (period === 'year') return iso.slice(0, 4) === today.slice(0, 4);
        return iso.slice(0, 7) === today.slice(0, 7);
    }

    /* One block of numbers per currency, so amounts in different currencies are never added together. */
    function statsFor(rows, payments, currency, period) {
        var live = rows.filter(function (r) { return r.inv.currency === currency; });
        var issued = live.filter(function (r) { return r.status !== 'draft' && r.status !== 'void'; });
        var ids = {};
        live.forEach(function (r) { ids[r.inv.id] = true; });

        var invoiced = issued.filter(function (r) { return inPeriod(r.inv.date, period); })
            .reduce(function (s, r) { return s + r.total; }, 0);
        var received = payments.filter(function (p) { return ids[p.invoiceId] && inPeriod(p.date, period); })
            .reduce(function (s, p) { return s + p.amountCents; }, 0);

        var open = issued.filter(function (r) { return r.status !== 'paid' && r.balance > 0; });
        var overdue = open.filter(function (r) { return r.status === 'overdue'; });
        var sum = function (list) { return list.reduce(function (s, r) { return s + r.balance; }, 0); };

        return { invoiced: invoiced, received: received, outstanding: sum(open), overdue: sum(overdue),
                 openCount: open.length, overdueCount: overdue.length, open: open };
    }

    function statBlock(s, cur, period) {
        var m = function (c) { return esc(Billing.money(c, cur)); };
        return '<div class="stats">' +
            '<div class="stat"><span class="eyebrow">Invoiced</span><div class="v">' + m(s.invoiced) + '</div><small>Issued ' + esc(periodLabel(period)) + '</small></div>' +
            '<div class="stat ok"><span class="eyebrow">Received</span><div class="v">' + m(s.received) + '</div><small>Payments ' + esc(periodLabel(period)) + '</small></div>' +
            '<div class="stat"><span class="eyebrow">Outstanding</span><div class="v">' + m(s.outstanding) + '</div><small>' + s.openCount + ' unpaid invoice' + (s.openCount === 1 ? '' : 's') + ', all time</small></div>' +
            '<div class="stat ' + (s.overdue > 0 ? 'bad' : '') + '"><span class="eyebrow">Overdue</span><div class="v">' + m(s.overdue) + '</div><small>' + s.overdueCount + ' past due, all time</small></div>' +
        '</div>';
    }

    function periodLabel(id) {
        return PERIODS.filter(function (p) { return p.id === id; })[0].label.toLowerCase();
    }

    function owedTable(rows) {
        var groups = {};
        rows.forEach(function (r) {
            var key = (r.inv.customerId || '') + '|' + r.inv.client.name.trim().toLowerCase() + '|' + r.inv.currency;
            var g = groups[key] = groups[key] || { name: r.inv.client.name || 'No customer', cur: r.inv.currency, balance: 0, n: 0 };
            g.balance += r.balance; g.n++;
        });
        var list = Object.keys(groups).map(function (k) { return groups[k]; })
            .sort(function (a, b) { return b.balance - a.balance; }).slice(0, 5);
        if (!list.length) return '<p class="faint" style="font-size:.8125rem">Nobody owes you anything right now.</p>';
        return '<div class="tbl-wrap" style="border:0"><table class="tbl"><tbody>' + list.map(function (g) {
            return '<tr><td class="strong">' + esc(g.name) + '<br><span class="faint" style="font-weight:400;font-size:.6875rem">' +
                g.n + ' invoice' + (g.n === 1 ? '' : 's') + '</span></td><td class="r strong">' + esc(Billing.money(g.balance, g.cur)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    function recentTable(rows) {
        var list = rows.slice().sort(function (a, b) { return b.inv.updated - a.inv.updated; }).slice(0, 5);
        return '<div class="tbl-wrap" style="border:0"><table class="tbl"><tbody>' + list.map(function (r) {
            return '<tr class="clickable" data-id="' + esc(r.inv.id) + '"><td class="strong">' + esc(r.inv.number) + '</td>' +
                '<td>' + esc(r.inv.client.name || 'No customer') + '</td>' +
                '<td class="r">' + esc(Billing.money(r.total, r.inv.currency)) + '</td>' +
                '<td>' + App.statusPill(r.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    /* --- The "important" notice about where the data lives ------------------------------ */

    var STALE_BACKUP_DAYS = 30;

    /* Second bullet: doubles as the backup status, so it needs no line of its own. */
    function backupBullet(last) {
        if (!last) return '<b style="color:#b91c1c">You have never downloaded a backup.</b> Download one now, and again after important changes.';
        var days = Math.floor((Date.now() - last) / 86400000);
        var when = new Date(last).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
        var ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
        return days >= STALE_BACKUP_DAYS
            ? '<b style="color:#b91c1c">Last backup: ' + esc(when) + ' (' + esc(ago) + ').</b> Download a fresh one.'
            : 'Last backup: <b>' + esc(when) + '</b> (' + esc(ago) + '). Download another after important changes.';
    }

    /* A slim banner, closed until clicked. */
    function importantHtml(state) {
        return '<section class="important' + (state.open ? ' open' : '') + '" aria-label="Important notice about your data">' +
            '<button type="button" class="imp-head" id="imp-toggle" aria-expanded="' + !!state.open + '" aria-controls="imp-body">' +
                Dandy.icon('alert') + '<span class="imp-title">IMPORTANT</span>' + Dandy.icon('chevron-right', 'imp-chev') +
            '</button>' +
            '<div class="imp-body" id="imp-body"><div class="imp-clip"><div class="imp-content">' +
                '<p>Your invoices, customers and templates are saved in this browser on this device only, not on a server. ' +
                    'If the browser deletes that data, it cannot be recovered.</p>' +
                '<ul>' +
                    '<li><b>Clearing cookies and site data</b>, using a private window, or resetting the browser erases it for good. Clearing only history or cached files normally does not.</li>' +
                    '<li id="imp-last">' + backupBullet(state.last) + '</li>' +
                '</ul>' +
                '<div class="btn-row">' +
                    '<button class="btn btn-dark" id="imp-backup">' + Dandy.icon('download') + 'Download a backup now</button>' +
                    '<a class="btn" href="#/settings">Restore from a backup in Settings</a>' +
                    '<a class="btn" id="imp-vote" href="' + esc(Config.permanentStorageUrl || '#') + '" target="_blank" rel="noopener">' +
                        Dandy.icon('shield') + 'I want permanent storage with your app</a>' +
                '</div>' +
            '</div></div></div>' +
        '</section>';
    }

    function wireImportant(el, state) {
        var box = el.querySelector('.important');
        var toggle = el.querySelector('#imp-toggle');
        if (toggle) toggle.addEventListener('click', function () {
            state.open = !state.open;
            box.classList.toggle('open', state.open);
            toggle.setAttribute('aria-expanded', String(state.open));
        });
        var backup = el.querySelector('#imp-backup');
        if (backup) backup.addEventListener('click', function () {
            DB.exportBackup().then(function (json) {
                Dandy.download('dandyapp-backup-' + Billing.today() + '.json', json, 'application/json');
                state.last = Date.now();
                el.querySelector('#imp-last').innerHTML = backupBullet(state.last);
                Dandy.toast('Backup downloaded. Keep the file somewhere safe.');
            });
        });
        var vote = el.querySelector('#imp-vote');
        if (vote && !Config.permanentStorageUrl) {
            // Not configured: do not open a dead page.
            vote.addEventListener('click', function (e) {
                e.preventDefault();
                Dandy.toast('The permanent storage link has not been set up yet (js/config.js)');
            });
        }
    }

    function mount(el) {
        var period = 'year';
        var state = { last: 0, open: false };

        return Promise.all([DB.listInvoices(), DB.allPayments(), DB.getSetting('lastBackup', 0)]).then(function (data) {
            var rows = App.summarise(data[0], data[1]);
            state.last = data[2];

            function draw() {
                if (!rows.length) {
                    el.innerHTML = head() +
                        '<div class="panel empty"><p style="font-size:1.125rem;font-weight:700;color:var(--ink);margin-bottom:.5rem">No invoices yet</p>' +
                        '<p style="margin-bottom:1.25rem">Set up your business details, then create your first invoice.</p>' +
                        '<div class="btn-row" style="justify-content:center">' +
                            '<a class="btn" href="#/settings">Business details</a>' +
                            '<a class="btn btn-dark" href="#/invoice/new">' + Dandy.icon('plus') + 'New invoice</a></div></div>' +
                        importantHtml(state);
                    Dandy.hydrateIcons(el);
                    wireImportant(el, state);
                    bindPeriod();
                    return;
                }

                var currencies = [];
                rows.forEach(function (r) { if (currencies.indexOf(r.inv.currency) === -1) currencies.push(r.inv.currency); });
                currencies.sort();

                var blocks = currencies.map(function (cur) {
                    var s = statsFor(rows, data[1], cur, period);
                    return (currencies.length > 1 ? '<p class="eyebrow mb-1">' + esc(cur) + '</p>' : '') + statBlock(s, cur, period);
                }).join('');

                var open = rows.filter(function (r) {
                    return r.status === 'sent' || r.status === 'partial' || r.status === 'overdue';
                });

                el.innerHTML = head() + blocks +
                    '<div class="two-col">' +
                        '<div class="panel"><h2>Who owes you</h2>' + owedTable(open) + '</div>' +
                        '<div class="panel"><h2>Recent invoices</h2>' + recentTable(rows) + '</div>' +
                    '</div>' + importantHtml(state);
                Dandy.hydrateIcons(el);
                wireImportant(el, state);

                Dandy.els('tr[data-id]', el).forEach(function (tr) {
                    tr.addEventListener('click', function () { App.go('#/invoice/' + tr.dataset.id); });
                });
                bindPeriod();
            }

            function bindPeriod() {
                Dandy.els('[data-period]', el).forEach(function (b) {
                    b.addEventListener('click', function () { period = b.dataset.period; draw(); });
                });
            }

            function head() {
                return '<div class="page-head"><div><p class="eyebrow">Overview</p><h1>DASHBOARD</h1></div>' +
                    '<div class="segmented" role="group" aria-label="Period">' + PERIODS.map(function (p) {
                        return '<button type="button" data-period="' + p.id + '" aria-pressed="' + (p.id === period) + '">' + esc(p.label) + '</button>';
                    }).join('') + '</div></div>';
            }

            draw();
        });
    }

    return { mount: mount };
})();
