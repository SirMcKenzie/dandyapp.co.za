/* ==========================================================================
   Layout engine - turns (invoice, template, profile, payments) into A4 pages.

   The preview, the printed PDF and the designer all read this output, so
   what you design is what prints.

   Rules (the template validator guarantees the geometry they depend on):
   - Components above the line-items band are placed exactly as designed.
   - The line-items band is full width. Its rows are measured, not guessed.
   - Rows that do not fit continue on a new page with the header repeated.
   - Everything below the band keeps its relative offsets and follows the
     last row. If it will not fit on that page it moves, whole, to the next.
   ========================================================================== */

var Layout = (function () {
    'use strict';

    var PX_TO_MM = 25.4 / 96;
    var SAFE = Components.SAFE;

    function esc(s) { return Dandy.escapeHtml(s == null ? '' : s); }

    /* Measure the table in the same CSS the real pages use, in millimetres. */
    function measure(rowsHtml, itemsComp, font) {
        var holder = document.createElement('div');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
        holder.innerHTML = '<div class="cmp" style="position:static;width:' + SAFE.w + 'mm;' +
            'font-size:' + itemsComp.props.fontSize + 'pt">' + Components.itemsTable(rowsHtml) + '</div>';
        // Set through the DOM: a font stack contains double quotes.
        holder.firstChild.style.fontFamily = Fonts.stack((font && font.body) || Fonts.DEFAULT);
        document.body.appendChild(holder);

        var head = holder.querySelector('thead').getBoundingClientRect().height * PX_TO_MM;
        var rows = Array.prototype.map.call(holder.querySelectorAll('tbody tr'), function (tr) {
            return tr.getBoundingClientRect().height * PX_TO_MM;
        });
        document.body.removeChild(holder);
        return { head: head, rows: rows };
    }

    /* Decide what goes on which page. Returns plain data, no DOM. */
    function paginate(template, rowsHtml, m) {
        var comps = template.components;
        var items = comps.filter(function (c) { return c.type === 'items'; })[0];
        var above = comps.filter(function (c) { return c !== items && c.y + c.h <= items.y + 0.001; });
        var below = comps.filter(function (c) { return c !== items && above.indexOf(c) === -1; });

        var page = { placed: above.map(function (c) { return { c: c, y: c.y }; }), table: { y: items.y, rows: [] } };
        var pages = [page];
        var cursor = items.y + m.head;

        rowsHtml.forEach(function (html, i) {
            var h = m.rows[i] || 0;
            if (cursor + h > SAFE.h && page.table.rows.length > 0) {
                page = { placed: [], table: { y: 0, rows: [] } };
                pages.push(page);
                cursor = m.head;
            }
            page.table.rows.push(html);
            cursor += h;
        });

        // A short table keeps the space the designer gave it, so a sparse
        // invoice looks exactly like the template. A long one pushes down.
        var tableEnd = pages.length === 1 ? Math.max(cursor, items.y + items.h) : cursor;

        if (below.length) {
            var belowTop = items.y + items.h;
            var groupTop = Math.min.apply(null, below.map(function (c) { return c.y; }));
            var groupBottom = Math.max.apply(null, below.map(function (c) { return c.y + c.h; }));
            var start = tableEnd + (groupTop - belowTop);

            if (start + (groupBottom - groupTop) <= SAFE.h + 0.001) {
                below.forEach(function (c) { page.placed.push({ c: c, y: start + (c.y - groupTop) }); });
            } else {
                page = { placed: [], table: null };
                pages.push(page);
                below.forEach(function (c) { page.placed.push({ c: c, y: c.y - groupTop }); });
            }
        }
        return { pages: pages, items: items };
    }

    function pageHtml(plan, ctx, index, count) {
        var cmps = plan.placed.map(function (p) {
            return '<div class="cmp cmp-' + p.c.type + '"' + Components.boxAttrs(p.c, p.y) + '>' +
                Components.renderBody(p.c, ctx) + '</div>';
        }).join('');
        return cmps;
    }

    /* Build the .pages element for an invoice. */
    function render(inv, template, profile, payments) {
        var ctx = {
            inv: inv, profile: profile, totals: Billing.calcTotals(inv),
            cur: inv.currency, paid: Billing.paidTotal(payments), placeholder: false
        };

        var rowsHtml = Components.itemRows(ctx);
        var items = template.components.filter(function (c) { return c.type === 'items'; })[0];
        var plan = paginate(template, rowsHtml, measure(rowsHtml, items, template.font));
        var count = plan.pages.length;

        var root = document.createElement('div');
        root.className = 'pages';
        Fonts.apply(root, template.font);

        var background = Components.backgroundHtml(template.background);

        root.innerHTML = plan.pages.map(function (pg, i) {
            var table = '';
            if (pg.table) {
                table = '<div class="cmp cmp-items"' + Components.boxAttrs(plan.items, pg.table.y, true) + '>' +
                    Components.itemsTable(pg.table.rows) + '</div>';
            }
            return '<section class="page" aria-label="Page ' + (i + 1) + ' of ' + count + '">' +
                background +
                '<div class="safe">' + pageHtml(pg, ctx, i, count) + table + '</div>' +
                (count > 1
                    ? '<div class="page-foot"><span>' + esc(inv.number) + '</span><span>Page ' + (i + 1) + ' of ' + count + '</span></div>'
                    : '') +
                '</section>';
        }).join('');

        return root;
    }

    /* Show the pages in a container, scaled down on narrow screens so the
       physical page proportions are kept. Print ignores the scale. */
    function mount(container, pagesEl) {
        container.innerHTML = '';
        var wrap = document.createElement('div');
        wrap.className = 'pages-scale';
        wrap.appendChild(pagesEl);
        container.appendChild(wrap);
        fit(container);
    }

    function fit(container) {
        var wrap = container.querySelector('.pages-scale');
        if (!wrap) return;
        var pagesEl = wrap.firstChild;
        var pageWidthPx = Components.PAGE.w / PX_TO_MM;
        var scale = container.clientWidth > 0 ? Math.min(1, container.clientWidth / pageWidthPx) : 1;
        // A sticky preview that is taller than the window would be cut off, so a
        // one-page invoice is also scaled to the window height.
        if (container.dataset.fitHeight && window.innerWidth >= 1180 && pagesEl.children.length === 1) {
            var pageHeightPx = Components.PAGE.h / PX_TO_MM;
            scale = Math.min(scale, Math.max(0.5, (window.innerHeight - 56) / pageHeightPx));
        }
        pagesEl.style.transformOrigin = 'top left';
        pagesEl.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
        wrap.style.width = Math.ceil(pageWidthPx * scale) + 'px';
        wrap.style.height = Math.ceil(pagesEl.offsetHeight * scale) + 'px';
    }

    return { render: render, mount: mount, fit: fit, paginate: paginate, measure: measure };
})();
