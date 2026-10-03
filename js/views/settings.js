/* Settings - business details, which template is active, defaults, backup. */

var SettingsView = (function () {
    'use strict';

    var esc = App.esc;
    var MAX_LOGO = 200 * 1024;   // a larger logo slows printing and bloats backups

    function thumb(tpl) {
        return '<div class="thumb" style="background:' + esc(tpl.background.color) + '">' + tpl.components.map(function (c) {
            return '<i class="' + c.type + '" style="left:' + (c.x + 15) + 'mm;top:' + (c.y + 15) + 'mm;width:' + c.w + 'mm;height:' + c.h + 'mm"></i>';
        }).join('') + '</div>';
    }

    function mount(el) {
        return Promise.all([DB.getProfile(), DB.getActiveSlot(), DB.getTemplate('A', { bare: true }), DB.getTemplate('B', { bare: true }),
                            DB.getSetting('dueDays', Billing.DEFAULT_DUE_DAYS), DB.getSetting('terms', Billing.DEFAULT_TERMS),
                            Locks.acquire(Locks.names.settings)]).then(function (d) { return Locks.guard(d[6], function () {
            var lock = d[6];
            var profile = d[0], active = d[1], templates = { A: d[2], B: d[3] };
            var dueDays = d[4], terms = d[5];
            var saveTimer = null;

            el.innerHTML =
                '<div class="page-head"><div><p class="eyebrow">Configure</p><h1>SETTINGS</h1></div>' +
                    '<p class="saved-state" id="state" style="font-size:.75rem;color:var(--muted)"></p></div>' +

                '<div class="panel"><h2>Active template</h2>' +
                    '<p class="muted mb-2" style="font-size:.8125rem">Every invoice, old and new, is drawn with the active template. Switch any time; nothing is lost.</p>' +
                    '<div class="slots" id="slots"></div></div>' +

                '<div class="two-col">' +
                    '<div class="panel"><h2>Your business</h2>' +
                        '<label class="field"><span>Business name</span><input type="text" id="p-name" placeholder="Your Company (Pty) Ltd"></label>' +
                        '<div class="field-row two">' +
                            '<label class="field"><span>Company reg. no.</span><input type="text" id="p-regNo" placeholder="2019/123456/07"></label>' +
                            '<label class="field"><span>VAT reg. no.</span><input type="text" id="p-vatNo" placeholder="4123456789"></label>' +
                        '</div>' +
                        '<label class="field"><span>Address</span><textarea id="p-address" rows="3" placeholder="12 Rivonia Road&#10;Sandton&#10;Johannesburg, 2196"></textarea></label>' +
                        '<div class="field-row two">' +
                            '<label class="field"><span>Email</span><input type="email" id="p-email"></label>' +
                            '<label class="field"><span>Phone</span><input type="tel" id="p-phone"></label>' +
                        '</div>' +
                        '<label class="field"><span>Website</span><input type="text" id="p-website"></label>' +
                        '<label class="field"><span>Logo (PNG, JPG, SVG, WebP, GIF, AVIF or BMP, under 200KB)</span><input type="file" id="p-logo" accept="' + DB.LOGO_TYPES.map(function (t) { return 'image/' + t; }).join(',') + '"></label>' +
                        '<div class="row mb-2"><img id="logo-preview" alt="" style="max-height:44px;display:none"><button class="btn btn-sm" id="logo-clear" hidden>Remove logo</button></div>' +
                    '</div>' +

                    '<div>' +
                        '<div class="panel"><h2>Banking details</h2>' +
                            '<div class="field-row two">' +
                                '<label class="field"><span>Bank</span><input type="text" id="p-bankName" placeholder="FNB"></label>' +
                                '<label class="field"><span>Account type</span><input type="text" id="p-bankType" placeholder="Business cheque"></label>' +
                            '</div>' +
                            '<div class="field-row two">' +
                                '<label class="field"><span>Account number</span><input type="text" id="p-bankAccount"></label>' +
                                '<label class="field"><span>Branch code</span><input type="text" id="p-bankBranch"></label>' +
                            '</div></div>' +

                        '<div class="panel"><h2>New invoice defaults</h2>' +
                            '<label class="field"><span>Payment due after (days)</span><input type="number" id="s-days" min="0" max="365" step="1"></label>' +
                            '<label class="field"><span>Default terms</span><textarea id="s-terms" rows="4"></textarea></label>' +
                            '<p class="faint" style="font-size:.6875rem">Used when you create a new invoice. Existing invoices are not changed.</p></div>' +

                        '<div class="panel"><h2>Backup</h2>' +
                            '<p class="note note-info mb-2">' + Dandy.icon('info') + '<span>Everything is stored in this browser only. Clearing site data deletes it, so keep a backup.</span></p>' +
                            '<div class="btn-row">' +
                                '<button class="btn btn-sm" id="b-export">' + Dandy.icon('download') + 'Export backup</button>' +
                                '<button class="btn btn-sm" id="b-import">' + Dandy.icon('upload') + 'Import backup</button>' +
                                '<input type="file" id="b-file" accept="application/json,.json" hidden></div></div>' +
                    '</div>' +
                '</div>';

            function $(id) { return el.querySelector('#' + id); }
            function state(t) { var s = $('state'); if (s) s.textContent = t; }

            /* --- Profile: autosaves as you type --------------------------------------------- */

            function saveProfile() {
                clearTimeout(saveTimer);
                saveTimer = null;
                return DB.saveProfile(profile).then(function () { state('Saved'); });
            }

            ['name', 'regNo', 'vatNo', 'address', 'email', 'phone', 'website', 'bankName', 'bankType', 'bankAccount', 'bankBranch'].forEach(function (k) {
                var input = $('p-' + k);
                input.value = profile[k] || '';
                input.addEventListener('input', function () {
                    profile[k] = input.value;
                    state('Saving...');
                    clearTimeout(saveTimer);
                    saveTimer = setTimeout(saveProfile, 400);
                });
            });

            function drawLogo() {
                var img = $('logo-preview');
                if (profile.logo) { img.src = profile.logo; img.style.display = 'block'; $('logo-clear').hidden = false; }
                else { img.removeAttribute('src'); img.style.display = 'none'; $('logo-clear').hidden = true; }
            }

            $('p-logo').addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                if (!file) return;
                if (DB.LOGO_TYPES.indexOf(file.type.replace(/^image\//, '')) === -1) { Dandy.toast('Use a PNG, JPG, SVG, WebP, GIF, AVIF or BMP logo'); e.target.value = ''; return; }
                if (file.size > MAX_LOGO) { Dandy.toast('Logo must be under 200KB'); e.target.value = ''; return; }
                var reader = new FileReader();
                reader.onload = function () { profile.logo = reader.result; saveProfile(); drawLogo(); };
                reader.readAsDataURL(file);
            });
            $('logo-clear').addEventListener('click', function () { profile.logo = ''; $('p-logo').value = ''; saveProfile(); drawLogo(); });
            drawLogo();

            /* --- Defaults ----------------------------------------------------------------------- */

            $('s-days').value = dueDays;
            $('s-terms').value = terms;
            $('s-days').addEventListener('change', function (e) {
                var n = Math.max(0, Math.min(365, parseInt(e.target.value, 10)));
                if (isNaN(n)) n = Billing.DEFAULT_DUE_DAYS;
                e.target.value = n;
                DB.setSetting('dueDays', n).then(function () { state('Saved'); });
            });
            var termsTimer = null;
            function saveTerms() {
                clearTimeout(termsTimer);
                termsTimer = null;
                return DB.setSetting('terms', $('s-terms').value).then(function () { state('Saved'); });
            }
            $('s-terms').addEventListener('input', function () {
                clearTimeout(termsTimer);
                termsTimer = setTimeout(saveTerms, 400);
            });

            /* --- Template slots ------------------------------------------------------------------ */

            function drawSlots() {
                $('slots').innerHTML = ['A', 'B'].map(function (slot) {
                    var t = templates[slot];
                    var on = slot === active;
                    return '<div class="slot' + (on ? ' active' : '') + '">' +
                        '<h3>Template ' + slot + ' - ' + esc(t.name) + (on ? ' <span class="st st-paid">Active</span>' : '') + '</h3>' +
                        '<div class="thumb-wrap">' + thumb(t) + '</div>' +
                        '<div class="btn-row">' +
                            (on ? '' : '<button class="btn btn-dark btn-sm" data-act="use" data-slot="' + slot + '">Use this template</button>') +
                            '<a class="btn btn-sm" href="#/templates/' + slot + '">' + Dandy.icon('edit') + 'Edit layout</a>' +
                            '<button class="btn btn-sm" data-act="reset" data-slot="' + slot + '">Reset</button>' +
                        '</div></div>';
                }).join('');
                Dandy.hydrateIcons($('slots'));

                Dandy.els('[data-act="use"]', el).forEach(function (b) {
                    b.addEventListener('click', function () {
                        DB.setActiveSlot(b.dataset.slot).then(function () {
                            active = b.dataset.slot;
                            drawSlots();
                            Dandy.toast('Template ' + active + ' is now active');
                        });
                    });
                });
                Dandy.els('[data-act="reset"]', el).forEach(function (b) {
                    b.addEventListener('click', function () {
                        if (!window.confirm('Reset template ' + b.dataset.slot + ' to its original layout? Your changes to the layout will be lost. Its background colour and images are kept.')) return;
                        var slot = b.dataset.slot;
                        Locks.tryRun(Locks.names.template(slot), function () { return DB.resetTemplate(slot); }).then(function (r) {
                            if (!r.ok) { Dandy.toast('Template ' + slot + ' is open in another tab. Close it there first.'); return; }
                            templates[slot] = r.value;
                            drawSlots();
                            Dandy.toast('Template ' + slot + ' reset');
                        });
                    });
                });
            }
            drawSlots();

            /* --- Backup ---------------------------------------------------------------------------- */

            $('b-export').addEventListener('click', function () {
                DB.exportBackup().then(function (json) {
                    Dandy.download('dandyapp-backup-' + Billing.today() + '.json', json, 'application/json');
                    Dandy.toast('Backup downloaded');
                });
            });
            $('b-import').addEventListener('click', function () { $('b-file').click(); });
            $('b-file').addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file) return;
                if (!window.confirm('Importing replaces everything currently stored in this browser with the contents of the backup. Continue?')) return;
                var reader = new FileReader();
                reader.onload = function () {
                    Locks.editingElsewhere().then(function (busy) {
                        if (busy.length) {
                            Dandy.toast('Close your other DANDYAPP tabs first: something is being edited in them.');
                            return null;
                        }
                        return DB.importAll(reader.result);
                    }).then(function (r) {
                        if (!r) return;
                        Locks.announceReload();
                        Dandy.toast('Restored ' + r.count + ' item' + (r.count === 1 ? '' : 's') +
                            (r.skipped ? ' (' + r.skipped + ' damaged item' + (r.skipped === 1 ? '' : 's') + ' skipped)' : ''));
                        setTimeout(function () { location.reload(); }, 700);
                    }).catch(function (err) { Dandy.toast(err.message); });
                };
                reader.readAsText(file);
            });

            Dandy.hydrateIcons(el);

            // Another tab has Settings open: show it read-only (a backup can still be downloaded).
            var cancelWait = null;
            if (!lock) {
                el.insertAdjacentHTML('afterbegin', Locks.bannerHtml('Settings'));
                Dandy.hydrateIcons(el);
                Locks.freeze(el, '#b-export');
                cancelWait = Locks.whenFree(Locks.names.settings, function () { App.reload(); });
            }

            return { destroy: function () {
                if (cancelWait) cancelWait();
                var release = function () { if (lock) lock.release(); };
                return Promise.all([saveTimer ? saveProfile() : null, termsTimer ? saveTerms() : null]).then(release, release);
            } };
        }); });
    }

    return { mount: mount };
})();
