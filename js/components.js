/* ==========================================================================
   Template components - the registry, the guard rails and the renderers.

   A template is a list of boxes positioned in millimetres on the A4 safe
   area. Every rule that keeps a template printable lives in this file and is
   enforced by one function, Components.validate(), which runs when a template
   is loaded, saved, or changed in the designer. A template that fails the
   rules is repaired or replaced by a default, so the renderer never sees
   invalid geometry.

   Coordinates are relative to the safe area (the page minus its margin), so
   x: 0..180 and y: 0..267.
   ========================================================================== */

var Components = (function () {
    'use strict';

    var PAGE = { w: 210, h: 297 };
    var MARGIN = 15;
    var SAFE = { w: PAGE.w - MARGIN * 2, h: PAGE.h - MARGIN * 2 };   // 180 x 267
    var GRID = 5;
    var VERSION = 1;
    var FONT = { min: 7, max: 14, def: 9 };
    var ACCENTS = ['#111827', '#1d4ed8', '#047857', '#b91c1c', '#7c3aed', '#b45309'];
    var ALIGNS = ['left', 'center', 'right'];

    function esc(s) { return Dandy.escapeHtml(s == null ? '' : s); }

    /* --- Registry -----------------------------------------------------------
       required: cannot be removed (keeps SARS fields on the page)
       multi:    more than one allowed
       lockX:    full width, x pinned to 0 (the line-items band)
       lockH:    height is fixed
       ---------------------------------------------------------------------- */

    var TYPES = {
        logo:        { label: 'Logo',            min: { w: 15,  h: 8  }, max: { w: 80,  h: 40  }, def: { w: 45,  h: 18 }, hasText: false, hasLabel: false },
        business:    { label: 'Business details', required: true, min: { w: 40, h: 14 }, max: { w: 110, h: 70 }, def: { w: 90, h: 30 }, labelText: 'From' },
        invoiceMeta: { label: 'Invoice details',  required: true, min: { w: 50, h: 22 }, max: { w: 110, h: 60 }, def: { w: 75, h: 36 }, hasLabel: false },
        customer:    { label: 'Customer',         required: true, min: { w: 40, h: 14 }, max: { w: 110, h: 70 }, def: { w: 85, h: 30 }, labelText: 'Billed to' },
        items:       { label: 'Line items',       required: true, lockX: true, min: { w: 180, h: 30 }, max: { w: 180, h: 220 }, def: { w: 180, h: 90 }, hasLabel: false, hasAlign: false },
        totals:      { label: 'Totals',           required: true, min: { w: 55, h: 20 }, max: { w: 110, h: 60 }, def: { w: 70, h: 34 }, hasLabel: false },
        bank:        { label: 'Banking details',  min: { w: 50, h: 16 }, max: { w: 110, h: 60 }, def: { w: 75, h: 34 }, labelText: 'Banking details' },
        notes:       { label: 'Notes',            min: { w: 30, h: 10 }, max: { w: 180, h: 80 }, def: { w: 90, h: 30 }, labelText: 'Notes' },
        terms:       { label: 'Terms',            min: { w: 30, h: 10 }, max: { w: 180, h: 80 }, def: { w: 90, h: 25 }, labelText: 'Terms' },
        text:        { label: 'Free text',        multi: true, hasText: true, min: { w: 15, h: 6 }, max: { w: 180, h: 60 }, def: { w: 60, h: 10 }, hasLabel: false },
        divider:     { label: 'Divider',          multi: true, lockH: true, min: { w: 10, h: 1 }, max: { w: 180, h: 1 }, def: { w: 180, h: 1 }, hasLabel: false, hasAlign: false, hasFont: false }
    };

    var TYPE_ORDER = ['logo', 'business', 'invoiceMeta', 'customer', 'items', 'totals', 'bank', 'notes', 'terms', 'text', 'divider'];

    /* --- Default templates --------------------------------------------------- */

    function box(type, x, y, w, h, props) {
        return { id: type, type: type, x: x, y: y, w: w, h: h, props: cleanProps(type, props || {}) };
    }

    var PRESETS = {
        A: function () {
            return {
                slot: 'A', name: 'Classic', version: VERSION,
                font: { body: 'poppins', heading: '' },
                components: [
                    box('logo', 0, 0, 50, 18),
                    box('business', 0, 20, 95, 38),
                    box('invoiceMeta', 105, 0, 75, 40, { align: 'right' }),
                    box('divider', 0, 58, 180, 1),
                    box('customer', 0, 64, 85, 32),
                    box('items', 0, 100, 180, 74),
                    box('notes', 0, 178, 100, 30),
                    box('terms', 0, 212, 100, 26),
                    // Five rows once a payment exists (subtotal, VAT, total, paid, balance due).
                    box('totals', 110, 178, 70, 44),
                    box('bank', 105, 226, 75, 36)
                ]
            };
        },
        B: function () {
            var accent = '#1d4ed8';
            return {
                slot: 'B', name: 'Modern', version: VERSION,
                font: { body: 'inter', heading: 'dm-sans' },
                components: [
                    box('logo', 0, 0, 45, 20),
                    box('invoiceMeta', 100, 0, 80, 36, { align: 'right', accent: accent }),
                    box('business', 0, 24, 90, 34, { fontSize: 8.5 }),
                    box('customer', 0, 62, 90, 34, { accent: accent }),
                    box('items', 0, 98, 180, 78),
                    box('notes', 0, 180, 90, 36),
                    box('terms', 0, 220, 90, 30, { fontSize: 8 }),
                    box('totals', 100, 180, 80, 44, { accent: accent }),
                    box('bank', 100, 228, 80, 36)
                ]
            };
        }
    };

    function defaultTemplate(slot) {
        return (PRESETS[slot] || PRESETS.A)();
    }

    /* --- Geometry rules ------------------------------------------------------ */

    function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
    function num(v, fallback) { v = parseFloat(v); return isFinite(v) ? v : fallback; }
    function half(n) { return Math.round(n * 2) / 2; }

    function clampRect(type, r) {
        var t = TYPES[type];
        var w = clamp(num(r.w, t.def.w), t.min.w, t.max.w);
        var h = clamp(num(r.h, t.def.h), t.min.h, t.max.h);
        var x = num(r.x, 0), y = num(r.y, 0);
        if (t.lockX) { x = 0; w = SAFE.w; }
        x = clamp(x, 0, SAFE.w - w);
        y = clamp(y, 0, SAFE.h - h);
        return { x: half(x), y: half(y), w: half(w), h: half(h) };
    }

    function overlaps(a, b) {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    function collides(rect, others) {
        return others.some(function (o) { return overlaps(rect, o); });
    }

    /* Would `rect` be a legal home for `comp` among the other components? */
    function fits(template, comp, rect) {
        var r = clampRect(comp.type, rect);
        if (r.x !== half(rect.x) || r.y !== half(rect.y) || r.w !== half(rect.w) || r.h !== half(rect.h)) return false;
        return !collides(r, template.components.filter(function (c) { return c.id !== comp.id; }));
    }

    function findFree(type, size, others) {
        var t = TYPES[type];
        for (var y = 0; y <= SAFE.h - size.h; y += 1) {
            for (var x = 0; x <= SAFE.w - size.w; x += t.lockX ? SAFE.w : GRID) {
                var r = { x: x, y: y, w: size.w, h: size.h };
                if (!collides(r, others)) return r;
            }
        }
        return null;
    }

    /* --- Props ---------------------------------------------------------------- */

    function cleanProps(type, p) {
        var t = TYPES[type];
        p = p || {};
        var out = {
            fontSize: clamp(num(p.fontSize, FONT.def), FONT.min, FONT.max),
            align: ALIGNS.indexOf(p.align) !== -1 ? p.align : 'left',
            label: p.label === false ? false : true,
            accent: (typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent)) ? p.accent : ACCENTS[0]
        };
        if (t.hasText) out.text = String(p.text == null ? '' : p.text).slice(0, 500);
        return out;
    }

    /* body is required; an empty heading means "same as body". Whether an id
       still exists (an uploaded font can be deleted) is decided at render time. */
    function cleanFont(f) {
        f = f || {};
        return { body: Fonts.cleanId(f.body) || Fonts.DEFAULT, heading: Fonts.cleanId(f.heading) };
    }

    function newId(type) {
        return type + '_' + Math.random().toString(36).slice(2, 7);
    }

    /* --- The one gate every template passes through --------------------------
       Returns a template that is guaranteed to satisfy every rule.
       ---------------------------------------------------------------------- */

    function validate(raw, slot) {
        var fallback = defaultTemplate(slot);
        if (!raw || !Array.isArray(raw.components)) return fallback;

        var seen = {}, list = [];

        raw.components.forEach(function (c) {
            var t = c && TYPES[c.type];
            if (!t) return;                                // unknown type: dropped
            if (!t.multi && seen[c.type]) return;          // duplicate singleton: dropped
            seen[c.type] = true;
            var r = clampRect(c.type, c);
            list.push({
                id: t.multi ? (typeof c.id === 'string' && c.id ? c.id : newId(c.type)) : c.type,
                type: c.type, x: r.x, y: r.y, w: r.w, h: r.h,
                props: cleanProps(c.type, c.props)
            });
        });

        // Missing required components come back at their default position.
        fallback.components.forEach(function (d) {
            if (TYPES[d.type].required && !seen[d.type]) list.push(d);
        });

        // Required components claim space first, so an optional one never displaces them.
        list.sort(function (a, b) {
            return (TYPES[b.type].required ? 1 : 0) - (TYPES[a.type].required ? 1 : 0);
        });

        var placed = [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (collides(c, placed)) {
                var home = fallback.components.filter(function (d) { return d.id === c.id; })[0];
                var r = null;
                if (home && !collides(home, placed)) r = home;
                if (!r) r = findFree(c.type, c, placed);
                if (!r) {
                    if (TYPES[c.type].required) return fallback;   // cannot be repaired
                    continue;                                       // optional: dropped
                }
                c.x = r.x; c.y = r.y; c.w = r.w; c.h = r.h;
            }
            placed.push(c);
        }

        return {
            slot: slot || raw.slot || 'A',
            name: String(raw.name || fallback.name).slice(0, 40),
            version: VERSION,
            font: cleanFont(raw.font),
            components: placed
        };
    }

    /* --- Rendering ------------------------------------------------------------
       ctx = { inv, profile, totals, cur, paid, placeholder }
       Each renderer returns the inner HTML of a component box.
       ---------------------------------------------------------------------- */

    function label(comp, text) {
        var t = TYPES[comp.type];
        return (comp.props.label && t.labelText !== undefined) ? '<p class="c-label">' + esc(text || t.labelText) + '</p>' : '';
    }

    function lines(text, cls) {
        return text ? '<p class="' + (cls || 'c-muted') + ' pre">' + esc(text) + '</p>' : '';
    }

    var RENDER = {
        logo: function (comp, ctx) {
            if (ctx.profile.logo) return '<img class="c-logo" src="' + esc(ctx.profile.logo) + '" alt="">';
            return ctx.placeholder ? '<div class="c-placeholder">Logo</div>' : '';
        },

        business: function (comp, ctx) {
            var p = ctx.profile;
            var contact = [p.email, p.phone, p.website].filter(Boolean).join('  ·  ');
            var regs = [p.regNo ? 'Reg. no. ' + p.regNo : '', p.vatNo ? 'VAT no. ' + p.vatNo : ''].filter(Boolean).join('  ·  ');
            return label(comp) +
                '<p class="c-strong c-big">' + esc(p.name || 'Your business name') + '</p>' +
                lines(p.address) + lines(contact) + lines(regs, 'c-faint');
        },

        invoiceMeta: function (comp, ctx) {
            var inv = ctx.inv;
            return '<p class="c-title">' + esc(Billing.title(inv)) + '</p>' +
                '<p class="c-strong">' + esc(inv.number) + '</p>' +
                '<p class="c-muted">Issued <b>' + esc(Billing.fmtDate(inv.date)) + '</b><br>' +
                    'Due <b>' + esc(Billing.fmtDate(inv.dueDate)) + '</b>' +
                    (inv.reference ? '<br>Ref <b>' + esc(inv.reference) + '</b>' : '') + '</p>';
        },

        customer: function (comp, ctx) {
            var c = ctx.inv.client;
            var contact = [c.email, c.phone].filter(Boolean).join('  ·  ');
            return label(comp) +
                '<p class="c-strong c-big">' + esc(c.name || '-') + '</p>' +
                lines(c.address) + lines(contact) + (c.vatNo ? lines('VAT no. ' + c.vatNo) : '');
        },

        totals: function (comp, ctx) {
            var inv = ctx.inv, t = ctx.totals, cur = ctx.cur, m = Billing.money;
            var pct = Math.round(t.vatRate * 100);
            var rows = '';
            if (inv.vatMode === 'exclusive') {
                rows += '<tr><td>Subtotal</td><td>' + esc(m(t.subtotal, cur)) + '</td></tr>' +
                        '<tr><td>VAT @ ' + pct + '%</td><td>' + esc(m(t.vat, cur)) + '</td></tr>';
            } else if (inv.vatMode === 'inclusive') {
                rows += '<tr><td>Amount excl. VAT</td><td>' + esc(m(t.subtotal, cur)) + '</td></tr>' +
                        '<tr><td>VAT @ ' + pct + '% (incl.)</td><td>' + esc(m(t.vat, cur)) + '</td></tr>';
            }
            rows += '<tr class="grand"><td>Total ' + (inv.vatMode === 'none' ? 'due' : 'incl. VAT') +
                    '</td><td>' + esc(m(t.total, cur)) + '</td></tr>';
            if (ctx.paid > 0) {
                rows += '<tr><td>Paid</td><td>' + esc(m(ctx.paid, cur)) + '</td></tr>' +
                        '<tr class="due"><td>Balance due</td><td>' + esc(m(t.total - ctx.paid, cur)) + '</td></tr>';
            }
            return '<table class="c-totals"><tbody>' + rows + '</tbody></table>';
        },

        bank: function (comp, ctx) {
            var p = ctx.profile;
            var rows = [['Bank', p.bankName], ['Account type', p.bankType], ['Account number', p.bankAccount],
                        ['Branch code', p.bankBranch], ['Reference', ctx.inv.number]]
                .filter(function (r) { return r[1]; });
            if (!p.bankName && !p.bankAccount) return ctx.placeholder ? label(comp) + '<p class="c-faint">Add banking details in Settings.</p>' : '';
            return label(comp) + rows.map(function (r) {
                return '<div class="c-row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
            }).join('');
        },

        notes: function (comp, ctx) {
            if (!ctx.inv.notes && !ctx.placeholder) return '';
            return label(comp) + lines(ctx.inv.notes || 'Notes to the customer appear here.', 'c-body');
        },

        terms: function (comp, ctx) {
            if (!ctx.inv.terms && !ctx.placeholder) return '';
            return label(comp) + lines(ctx.inv.terms, 'c-body');
        },

        text: function (comp) { return lines(comp.props.text, 'c-body'); },

        divider: function () { return '<div class="c-rule"></div>'; }
    };

    function renderBody(comp, ctx) {
        var fn = RENDER[comp.type];
        return fn ? fn(comp, ctx) : '';
    }

    /* --- Line items table (used by the layout engine and the designer) -------- */

    function itemRows(ctx) {
        var cur = ctx.cur;
        var rows = ctx.inv.lines.filter(function (l) {
            return String(l.desc).trim() || Billing.lineAmount(l) > 0;
        });
        if (!rows.length) {
            return ['<tr><td colspan="5" class="c-faint">Add a line item to see it here.</td></tr>'];
        }
        return rows.map(function (l) {
            return '<tr><td class="d">' + esc(l.desc || '-') + '</td>' +
                '<td class="c">' + esc(l.qty) + '</td>' +
                '<td class="c">' + esc(l.unit) + '</td>' +
                '<td class="r">' + esc(Billing.money(Billing.toCents(l.rate), cur)) + '</td>' +
                '<td class="r">' + esc(Billing.money(Billing.lineAmount(l), cur)) + '</td></tr>';
        });
    }

    var ITEMS_HEAD = '<thead><tr><th>Description</th><th class="c">Qty</th><th class="c">Unit</th>' +
        '<th class="r">Rate</th><th class="r">Amount</th></tr></thead>';

    function itemsTable(rowsHtml) {
        return '<table class="c-items">' + ITEMS_HEAD + '<tbody>' + rowsHtml.join('') + '</tbody></table>';
    }

    /* The positioned wrapper shared by the page renderer and the designer. */
    function boxAttrs(comp, y, autoHeight) {
        var p = comp.props;
        return ' style="left:' + comp.x + 'mm;top:' + (y == null ? comp.y : y) + 'mm;width:' + comp.w + 'mm;' +
            (autoHeight ? '' : 'height:' + comp.h + 'mm;') +
            'font-size:' + p.fontSize + 'pt;text-align:' + p.align + ';--accent:' + p.accent + '"';
    }

    /* --- Sample data for the designer ---------------------------------------- */

    function sampleContext(profile) {
        var inv = Billing.defaults();
        inv.number = 'INV-0001';
        inv.client = { name: 'Sample Customer (Pty) Ltd', email: 'accounts@sample.co.za', phone: '+27 82 123 4567',
                       address: '1 Main Road\nCape Town\n8001', vatNo: '4987654321' };
        inv.lines = [
            { desc: 'Website design', qty: 10, unit: 'hours', rate: 850 },
            { desc: 'Hosting (annual)', qty: 1, unit: 'each', rate: 1800 },
            { desc: 'Content updates', qty: 3, unit: 'hours', rate: 650 }
        ];
        inv.notes = 'Thank you for your business.';
        var p = Object.assign(Billing.blankProfile(), profile || {});
        if (!p.name) p.name = 'Your Company (Pty) Ltd';
        if (!p.address) p.address = '12 Rivonia Road\nSandton, 2196';
        if (!p.vatNo) p.vatNo = '4123456789';
        if (!p.bankName) { p.bankName = 'FNB'; p.bankAccount = '62000000000'; p.bankBranch = '250655'; }
        return { inv: inv, profile: p, totals: Billing.calcTotals(inv), cur: inv.currency, paid: 0, placeholder: true };
    }

    return {
        PAGE: PAGE, MARGIN: MARGIN, SAFE: SAFE, GRID: GRID, FONT: FONT,
        ACCENTS: ACCENTS, ALIGNS: ALIGNS, TYPES: TYPES, TYPE_ORDER: TYPE_ORDER,

        defaultTemplate: defaultTemplate,
        validate: validate,
        clampRect: clampRect,
        overlaps: overlaps,
        fits: fits,
        findFree: findFree,
        cleanProps: cleanProps,
        cleanFont: cleanFont,
        newId: newId,

        renderBody: renderBody,
        itemRows: itemRows,
        itemsTable: itemsTable,
        boxAttrs: boxAttrs,
        sampleContext: sampleContext
    };
})();
