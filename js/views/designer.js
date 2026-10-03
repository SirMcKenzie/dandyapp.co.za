/* Template designer - drag, resize and style the components of a template.

   Everything here is a thin interaction layer. The rules that keep a template
   printable (safe area, size limits, no overlap, required components) live in
   Components, and every change is checked against them before it is kept. */

var DesignerView = (function () {
    'use strict';

    var esc = App.esc;
    var T = Components.TYPES;
    var GRID = Components.GRID;
    var SAFE = Components.SAFE;
    var UNDO_LIMIT = 20;
    var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function snap(v) { return Math.round(v / GRID) * GRID; }
    function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

    function mount(el, params) {
        var slot = params[0];
        return Promise.all([DB.getTemplate(slot), DB.getProfile(), DB.getActiveSlot(), Locks.acquire(Locks.names.template(slot))]).then(function (d) {
            return Locks.guard(d[3], function () { return run(el, slot, d[0], d[1], d[2], d[3]); });
        });
    }

    /* `lock` is null when another tab has this template open: it is then shown read-only. */
    function run(el, slot, saved, profile, activeSlot, lock) {
        var locked = !lock;
        var cancelWait = null;
        var tpl = clone(saved);
        var savedJson = JSON.stringify(saved);
        var ctx = Components.sampleContext(profile);
        var selectedId = null;
        var undoStack = [];
        var drag = null;
        var propUndoPending = false;
        var alive = true;
        var bgMode = false;              // working on the page background; the layout steps back
        var selectedLayer = null;
        var pending = {};                // pictures added here but not stored until the template is saved
        var contrastRows = [];
        var contrastToken = 0, contrastTimer = null;

        function $(id) { return el.querySelector('#' + id); }
        function find(id) { return tpl.components.filter(function (c) { return c.id === id; })[0] || null; }
        function isDirty() { return JSON.stringify(tpl) !== savedJson; }

        /* --- Shell ------------------------------------------------------------------ */

        el.innerHTML =
            '<div class="page-head"><div><p class="eyebrow">Design</p><h1>TEMPLATE ' + slot + '</h1></div>' +
                '<div class="segmented" role="group" aria-label="Template slot">' +
                    ['A', 'B'].map(function (s) {
                        return '<button type="button" data-slot="' + s + '" aria-pressed="' + (s === slot) + '">Template ' + s + '</button>';
                    }).join('') + '</div></div>' +
            '<div class="toolbar">' +
                '<label class="row" style="gap:.5rem;font-size:.75rem;font-weight:600">Name ' +
                    '<input type="text" id="t-name" maxlength="40" style="width:12rem;padding:.375rem .75rem"></label>' +
                '<span id="active-tag"></span>' +
                '<span class="spacer"></span><span class="saved-state" id="state"></span>' +
                '<button class="btn btn-sm" id="b-bg" aria-pressed="false" title="Work on the page colour and background images">' + Dandy.icon('image') + 'Background</button>' +
                '<button class="btn btn-sm" id="b-undo">' + Dandy.icon('undo') + 'Undo</button>' +
                '<button class="btn btn-sm" id="b-reset">Reset layout</button>' +
                '<a class="btn btn-sm" href="#/settings">Close</a>' +
                '<button class="btn btn-dark btn-sm" id="b-save">' + Dandy.icon('save') + 'Save template</button>' +
            '</div>' +
            '<input type="file" id="bg-file" accept="' + Images.ACCEPT.map(function (t) { return 'image/' + t; }).join(',') + '" hidden>' +
            '<p class="note note-info narrow-note">' + Dandy.icon('info') + '<span>Designing is easiest on a larger screen.</span></p>' +
            '<div class="designer">' +
                '<aside><div class="panel"><h2>Components</h2><div class="palette" id="palette"></div></div>' +
                    '<div class="panel" id="typeface"></div></aside>' +
                '<div class="d-stage" id="stage"><div id="cw"><div class="d-canvas" id="canvas"></div></div></div>' +
                '<aside><div class="panel props" id="props"></div></aside>' +
            '</div>';

        $('t-name').value = tpl.name;

        /* --- Undo ---------------------------------------------------------------------- */

        function pushUndo() {
            undoStack.push(JSON.stringify(tpl));
            if (undoStack.length > UNDO_LIMIT) undoStack.shift();
            updateChrome();
        }

        function undo() {
            if (!undoStack.length) return;
            tpl = JSON.parse(undoStack.pop());
            if (selectedId && !find(selectedId)) selectedId = null;
            if (selectedLayer && !layerById(selectedLayer)) selectedLayer = null;
            $('t-name').value = tpl.name;
            redraw();
        }

        /* --- Rendering -------------------------------------------------------------------- */

        function redraw() {
            drawCanvas();
            drawPalette();
            drawProps();
            drawTypeface();
            updateChrome();
            reflowWhenFontsLoad();
        }

        /* Fonts download on first use. Whether text fits depends on the real
           font, so the canvas is drawn again once it has arrived. */
        function reflowWhenFontsLoad() {
            Fonts.load(tpl.font).then(function () { if (alive) drawCanvas(); });
        }

        function updateChrome() {
            $('state').textContent = isDirty() ? 'Unsaved changes' : 'Saved';
            $('b-undo').disabled = !undoStack.length;
            $('b-bg').setAttribute('aria-pressed', String(bgMode));
            $('b-bg').classList.toggle('btn-dark', bgMode);
            $('active-tag').innerHTML = slot === activeSlot
                ? '<span class="st st-paid">Active template</span>'
                : '<button class="btn btn-sm" id="b-activate">Make this the active template</button>';
            var act = $('b-activate');
            if (act) act.addEventListener('click', function () {
                DB.setActiveSlot(slot).then(function () { activeSlot = slot; updateChrome(); Dandy.toast('Template ' + slot + ' is now active'); });
            });
        }

        function boxBody(c) {
            if (c.type === 'items') return Components.itemsTable(Components.itemRows(ctx));
            return Components.renderBody(c, ctx);
        }

        function drawCanvas() {
            var canvas = $('canvas');
            Fonts.apply(canvas, tpl.font);
            canvas.classList.toggle('bg-mode', bgMode);
            canvas.innerHTML = Components.backgroundHtml(tpl.background) + '<div class="d-safe" id="safe">' + tpl.components.map(function (c) {
                var t = T[c.type];
                return '<div class="d-box cmp cmp-' + c.type + (c.id === selectedId ? ' sel' : '') +
                    (t.lockX ? ' lockx' : '') + (t.lockH ? ' lockh' : '') + '" data-id="' + esc(c.id) + '"' + Components.boxAttrs(c) + '>' +
                    '<div class="d-in">' + boxBody(c) + '</div>' +
                    (c.type === 'items' ? '<div class="grow-hint">Grows with line items, pushes content below it down</div>' : '') +
                    HANDLES.map(function (h) { return '<span class="h" data-h="' + h + '"></span>'; }).join('') +
                '</div>';
            }).join('') + '</div>' + (bgMode ? layerOverlay() : '');

            // Flag boxes whose content does not fit, so nothing is silently cut off when printed.
            Dandy.els('.d-box', canvas).forEach(function (box) {
                var type = find(box.dataset.id).type;
                if (type === 'items' || type === 'divider' || type === 'logo') return;
                var inner = box.firstChild;
                if (inner.scrollHeight > inner.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1) {
                    box.insertAdjacentHTML('beforeend', '<span class="ovf" title="Content is cut off. Make the box bigger or the text smaller.">Too small</span>');
                }
            });
            fit();
            scheduleContrast();
        }

        function fit() {
            var stage = $('stage'), canvas = $('canvas'), cw = $('cw');
            var avail = stage.clientWidth - 32;
            var w = canvas.offsetWidth, h = canvas.offsetHeight;
            var scale = avail > 0 ? Math.min(1, avail / w) : 1;
            canvas.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
            cw.style.width = Math.ceil(w * scale) + 'px';
            cw.style.height = Math.ceil(h * scale) + 'px';
        }

        function drawPalette() {
            var present = {};
            tpl.components.forEach(function (c) { present[c.type] = true; });
            $('palette').innerHTML = Components.TYPE_ORDER.map(function (type) {
                var t = T[type];
                var disabled = bgMode || (!t.multi && present[type]);
                return '<div class="chip" data-type="' + type + '" aria-disabled="' + (disabled ? 'true' : 'false') + '"' +
                    (disabled ? ' title="' + (bgMode ? 'Finish the background first' : 'Already on the page') + '"' : '') + '>' + esc(t.label) +
                    (t.required ? '<span class="req" title="Required">' + Dandy.icon('lock') + '</span>' : '') + '</div>';
            }).join('');
            Dandy.hydrateIcons($('palette'));
        }

        function drawProps() {
            var box = $('props');
            if (bgMode) { drawBgPanel(); return; }
            var c = selectedId && find(selectedId);
            if (!c) {
                box.innerHTML = '<h2>Properties</h2><p class="muted" style="font-size:.8125rem;line-height:1.7">' +
                    'Drag a component onto the page, or click it in the list to place it. Click a box to style it.<br><br>' +
                    'The dashed blue line is the printable area. Boxes cannot leave it or overlap each other.<br><br>' +
                    '<b>Line items</b> runs the full width and grows downward. Everything below it moves down to make room, and long invoices continue on a new page.</p>' +
                    '<h3 class="mt-3" style="font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-bottom:.5rem">Background</h3>' +
                    '<div class="btn-row"><button class="btn btn-sm" id="p-bg">' + Dandy.icon('image') + 'Colour and images</button></div>';
                box.querySelector('#p-bg').addEventListener('click', function () { setBgMode(true); });
                Dandy.hydrateIcons(box);
                return;
            }
            var t = T[c.type];
            var p = c.props;
            var hasFont = t.hasFont !== false && c.type !== 'logo';
            var hasAlign = t.hasAlign !== false && c.type !== 'logo';
            var hasLabel = t.labelText !== undefined;
            var hasAccent = c.type !== 'logo';

            box.innerHTML = '<h2>' + esc(t.label) + '</h2>' +
                '<div class="coords"><span>X ' + c.x + ' mm</span><span>Y ' + c.y + ' mm</span><span>W ' + c.w + ' mm</span><span>H ' + c.h + ' mm</span></div>' +
                (hasFont ? '<label class="field"><span>Text size (' + p.fontSize + ' pt)</span>' +
                    '<input type="range" id="p-font" min="' + Components.FONT.min + '" max="' + Components.FONT.max + '" step="0.5" value="' + p.fontSize + '"></label>' : '') +
                (hasAlign ? '<div class="field"><span>Align</span><div class="seg">' + Components.ALIGNS.map(function (a) {
                    return '<button type="button" data-align="' + a + '" aria-pressed="' + (p.align === a) + '">' + a + '</button>';
                }).join('') + '</div></div>' : '') +
                (hasAccent ? '<div class="field"><span>Colour</span><div class="swatches">' + Components.ACCENTS.map(function (a) {
                    return '<button type="button" data-accent="' + a + '" style="background:' + a + '" aria-label="' + a + '" aria-pressed="' + (p.accent.toLowerCase() === a) + '"></button>';
                }).join('') + '</div></div>' : '') +
                (hasLabel ? '<label class="check mb-2"><input type="checkbox" id="p-label"' + (p.label ? ' checked' : '') + '> Show heading</label>' : '') +
                (t.hasText ? '<label class="field"><span>Text</span><textarea id="p-text" rows="4" maxlength="500">' + esc(p.text) + '</textarea></label>' : '') +
                (c.type !== 'logo' && c.type !== 'divider' ? '<div class="field"><span>Contrast on the background</span><div id="cx-one"></div></div>' : '') +
                (t.required
                    ? '<p class="note note-info mt-2">' + Dandy.icon('lock') + '<span>Required. A tax invoice needs this.</span></p>'
                    : '<button class="btn btn-danger btn-sm mt-2" id="p-del">' + Dandy.icon('trash') + 'Remove</button>');
            Dandy.hydrateIcons(box);

            // Numeric/colour changes arrive as a stream; one undo step per gesture.
            function change(fn, isStream) {
                if (!isStream || !propUndoPending) { pushUndo(); propUndoPending = !!isStream; }
                fn();
                drawCanvas();
                updateChrome();
            }

            var font = box.querySelector('#p-font');
            if (font) {
                font.addEventListener('input', function () {
                    change(function () { p.fontSize = Components.cleanProps(c.type, { fontSize: font.value }).fontSize; }, true);
                    font.previousElementSibling.textContent = 'Text size (' + p.fontSize + ' pt)';
                });
                font.addEventListener('change', function () { propUndoPending = false; });
            }
            Dandy.els('[data-align]', box).forEach(function (b) {
                b.addEventListener('click', function () { change(function () { p.align = b.dataset.align; }); drawProps(); });
            });
            Dandy.els('[data-accent]', box).forEach(function (b) {
                b.addEventListener('click', function () { change(function () { p.accent = b.dataset.accent; }); drawProps(); });
            });
            var label = box.querySelector('#p-label');
            if (label) label.addEventListener('change', function () { change(function () { p.label = label.checked; }); });
            var text = box.querySelector('#p-text');
            if (text) {
                text.addEventListener('input', function () { change(function () { p.text = text.value; }, true); });
                text.addEventListener('change', function () { propUndoPending = false; });
            }
            var del = box.querySelector('#p-del');
            if (del) del.addEventListener('click', removeSelected);
            paintContrast();
        }

        /* --- Typeface -------------------------------------------------------------------- */

        function fontOptions(selected, allowSame) {
            var html = allowSame ? '<option value=""' + (!selected ? ' selected' : '') + '>Same as body</option>' : '';
            Fonts.GROUPS.forEach(function (g) {
                var list = Fonts.BUILTIN.filter(function (f) { return f.group === g.id; });
                html += '<optgroup label="' + esc(g.label) + '">' + list.map(function (f) {
                    return '<option value="' + f.id + '"' + (f.id === selected ? ' selected' : '') + '>' + esc(f.label) + '</option>';
                }).join('') + '</optgroup>';
            });
            var mine = Fonts.customList();
            if (mine.length) {
                html += '<optgroup label="Your fonts">' + mine.map(function (f) {
                    return '<option value="' + esc(f.id) + '"' + (f.id === selected ? ' selected' : '') + '>' + esc(f.name) + '</option>';
                }).join('') + '</optgroup>';
            }
            return html;
        }

        function drawTypeface() {
            var box = $('typeface');
            var body = Fonts.exists(tpl.font.body) ? tpl.font.body : Fonts.DEFAULT;
            var heading = tpl.font.heading && Fonts.exists(tpl.font.heading) ? tpl.font.heading : '';
            var mine = Fonts.customList();

            box.innerHTML = '<h2>Typeface</h2>' +
                '<label class="field"><span>Body font</span><select id="f-body">' + fontOptions(body, false) + '</select></label>' +
                '<label class="field"><span>Heading font</span><select id="f-heading">' + fontOptions(heading, true) + '</select></label>' +
                '<div class="f-sample"><p id="f-s1">TAX INVOICE</p><p id="f-s2">The quick brown fox. R 12 345,67</p></div>' +
                '<button class="btn btn-sm" id="f-upload">' + Dandy.icon('upload') + 'Upload your own</button>' +
                '<input type="file" id="f-file" accept=".woff2,.woff,.ttf,.otf" hidden>' +
                '<p class="faint mt-1" style="font-size:.6875rem;line-height:1.6">.woff2, .woff, .ttf or .otf, up to 1.5 MB. Only use fonts you are licensed to use. ' +
                    'Upload a regular weight; bold is faked by the browser, so a real bold file works best as its own font used for headings.</p>' +
                (mine.length ? '<div class="pay-list mt-2">' + mine.map(function (f) {
                    return '<div class="item" data-id="' + esc(f.id) + '"><span class="grow" style="color:var(--ink)">' + esc(f.name) + '</span>' +
                        '<button class="btn btn-sm btn-danger" data-act="rm" aria-label="Remove ' + esc(f.name) + '">' + Dandy.icon('trash') + '</button></div>';
                }).join('') + '</div>' : '');
            Dandy.hydrateIcons(box);

            $('f-s1').style.fontFamily = Fonts.stack(Fonts.headingId({ body: body, heading: heading }));
            $('f-s2').style.fontFamily = Fonts.stack(body);

            $('f-body').addEventListener('change', function (e) { setFont('body', e.target.value); });
            $('f-heading').addEventListener('change', function (e) { setFont('heading', e.target.value); });
            $('f-upload').addEventListener('click', function () { $('f-file').click(); });
            $('f-file').addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                e.target.value = '';
                if (!file) return;
                Fonts.readUpload(file).then(DB.saveFont).then(function (row) {
                    Fonts.registerCustom([row]);
                    drawTypeface();
                    Dandy.toast('Added ' + row.name + '. Choose it from the lists above.');
                }).catch(function (err) { Dandy.toast(err.message); });
            });
            Dandy.els('[data-act="rm"]', box).forEach(function (b) {
                b.addEventListener('click', function () { removeFont(b.closest('.item').dataset.id); });
            });
        }

        function setFont(which, value) {
            pushUndo();
            tpl.font[which] = value;
            Fonts.apply($('canvas'), tpl.font);
            drawCanvas();
            drawTypeface();
            updateChrome();
            reflowWhenFontsLoad();
        }

        function removeFont(id) {
            var name = Fonts.label(id);
            Promise.all([DB.getTemplate('A', { bare: true }), DB.getTemplate('B', { bare: true })]).then(function (saved) {
                var users = [saved[0], saved[1]].filter(function (t) { return t.font.body === id || t.font.heading === id; })
                    .map(function (t) { return t.slot; });
                var msg = 'Remove the font "' + name + '"?' + (users.length ? '\n\nTemplate ' + users.join(' and ') +
                    ' uses it and will fall back to ' + Fonts.label(Fonts.DEFAULT) + '.' : '');
                if (!window.confirm(msg)) return;
                return DB.removeFont(id).then(function () {
                    Fonts.unregisterCustom(id);
                    drawTypeface();
                    drawCanvas();
                    Dandy.toast('Removed ' + name);
                });
            });
        }

        function select(id) {
            if (id && bgMode) { setBgMode(false); }
            selectedId = id;
            Dandy.els('.d-box', $('canvas')).forEach(function (b) { b.classList.toggle('sel', b.dataset.id === id); });
            propUndoPending = false;
            drawProps();
        }

        /* --- Background: colour, pictures, size budget, contrast -------------------------------- */

        function layerById(id) { return tpl.background.layers.filter(function (l) { return l.id === id; })[0] || null; }

        function clampLayer(l) {
            return Components.cleanBackground({ color: tpl.background.color, layers: [l] }).layers[0];
        }

        function setBgMode(on) {
            if (bgMode === on) return;
            bgMode = on;
            selectedLayer = null;
            if (on) selectedId = null;
            redraw();
        }

        function layerOverlay() {
            return '<div class="d-layers">' + tpl.background.layers.map(function (l) {
                return '<div class="d-layer' + (l.id === selectedLayer ? ' sel' : '') + '" data-layer="' + esc(l.id) + '" style="left:' + l.x +
                    'mm;top:' + l.y + 'mm;width:' + l.w + 'mm;height:' + l.h + 'mm">' +
                    HANDLES.map(function (h) { return '<span class="h" data-h="' + h + '"></span>'; }).join('') + '</div>';
            }).join('') + '</div>';
        }

        /* A new picture starts as large as the page allows, keeping its shape, centred. */
        function startRect(row) {
            var P = Components.PAGE, ratio = row.w / row.h;
            var w = ratio >= P.w / P.h ? P.w : P.h * ratio;
            var h = ratio >= P.w / P.h ? P.w / ratio : P.h;
            return { x: (P.w - w) / 2, y: (P.h - h) / 2, w: w, h: h };
        }

        function bgChange(fn, isStream) {
            if (!isStream || !propUndoPending) { pushUndo(); propUndoPending = !!isStream; }
            fn();
            drawCanvas();
            updateChrome();
        }

        function removeLayer(id) {
            pushUndo();
            tpl.background.layers = tpl.background.layers.filter(function (l) { return l.id !== id; });
            if (selectedLayer === id) selectedLayer = null;
            drawCanvas();
            drawBgPanel();
            updateChrome();
        }

        function addImage(file) {
            if (locked) return;
            if (tpl.background.layers.length >= Components.LAYER_MAX) { Dandy.toast('A template can have up to ' + Components.LAYER_MAX + ' images.'); return; }
            Dandy.toast('Optimising ' + file.name + '...');
            Images.optimise(file).then(function (row) {
                if (!alive) return;
                Images.remember(row);
                pending[row.id] = row;
                pushUndo();
                var r = startRect(row);
                var layer = clampLayer({ id: Components.newId('layer'), imageId: row.id, x: r.x, y: r.y, w: r.w, h: r.h, opacity: 1, fit: 'cover' });
                tpl.background.layers.push(layer);
                selectedLayer = layer.id;
                if (!bgMode) { bgMode = true; selectedId = null; }
                redraw();
                Dandy.toast('Added ' + row.name + ': ' + Images.formatBytes(file.size) + ' became ' + Images.formatBytes(row.bytes) + '.');
            }).catch(function (err) { Dandy.toast(err.message); });
        }

        var FIT_LABEL = { cover: 'Fill box', contain: 'Whole image' };

        function drawBgPanel() {
            var box = $('props');
            var bg = tpl.background;
            var layers = bg.layers;
            var sel = selectedLayer && layerById(selectedLayer);
            var used = Images.usage(bg);
            var b = Images.budget(used);
            var pct = Math.min(100, used / b.hard * 100);
            var msg = { ok: '', warn: 'Heavy: this template will load more slowly and use more storage. You can still save it.',
                        block: 'Too large to save. Remove an image, or use a smaller one.' }[b.level];

            box.innerHTML = '<div class="bg-panel"><h2>Page background</h2>' +
                '<div class="field"><span>Page colour</span><div class="swatches">' + Components.BG_SWATCHES.map(function (c) {
                    return '<button type="button" data-bgc="' + c + '" style="background:' + c + '" aria-label="' + c + '" aria-pressed="' + (bg.color === c) + '"></button>';
                }).join('') + '</div>' +
                '<div class="color-row"><input type="color" id="bg-color" value="' + bg.color + '" aria-label="Pick a colour">' +
                    '<input type="text" id="bg-hex" maxlength="7" value="' + bg.color + '" aria-label="Colour code" spellcheck="false"></div></div>' +

                '<h3>Images (' + layers.length + ' of ' + Components.LAYER_MAX + ')</h3>' +
                '<button class="btn btn-sm" id="bg-add"' + (layers.length >= Components.LAYER_MAX ? ' disabled' : '') + '>' + Dandy.icon('plus') + 'Add image</button>' +
                '<p class="faint mt-1" style="font-size:.6875rem;line-height:1.6">Images sit on the colour and under all the text. They are shrunk and compressed when you add them.</p>' +
                '<div class="layer-list">' + layers.slice().reverse().map(function (l) {
                    var row = Images.get(l.imageId) || {};
                    return '<div class="layer-row' + (l.id === selectedLayer ? ' sel' : '') + '" data-layer="' + esc(l.id) + '">' +
                        '<img src="' + esc(Images.url(l.imageId)) + '" alt=""><span class="grow">' + esc(row.name || 'Image') +
                        '<small>' + esc(Images.formatBytes(row.bytes || 0)) + '</small></span></div>';
                }).join('') + '</div>' +
                (sel ? '<h3>Selected image</h3>' +
                    '<div class="field"><span>Fit</span><div class="seg">' + ['cover', 'contain'].map(function (f) {
                        return '<button type="button" data-fit="' + f + '" aria-pressed="' + (sel.fit === f) + '">' + FIT_LABEL[f] + '</button>';
                    }).join('') + '</div></div>' +
                    '<label class="field"><span>Opacity (' + Math.round(sel.opacity * 100) + '%)</span>' +
                        '<input type="range" id="bg-op" min="5" max="100" step="5" value="' + Math.round(sel.opacity * 100) + '"></label>' +
                    '<div class="btn-row"><button class="btn btn-sm" id="bg-full">Fill page</button>' +
                        '<button class="btn btn-sm" id="bg-fwd">Forward</button><button class="btn btn-sm" id="bg-back">Back</button>' +
                        '<button class="btn btn-sm btn-danger" id="bg-del">' + Dandy.icon('trash') + 'Remove</button></div>' : '') +

                '<h3>Size</h3><div class="meter ' + b.level + '"><i style="width:' + pct + '%"></i><b style="left:' + (b.soft / b.hard * 100) + '%"></b></div>' +
                '<p style="font-size:.75rem;line-height:1.6">' + esc(Images.formatBytes(used)) + ' used. Warning above ' + esc(Images.formatBytes(b.soft)) +
                    ', limit ' + esc(Images.formatBytes(b.hard)) + '.</p>' +
                (msg ? '<p class="note ' + (b.level === 'block' ? 'note-bad' : 'note-warn') + ' mt-1">' + Dandy.icon('alert') + '<span>' + esc(msg) + '</span></p>' : '') +

                '<h3>Text contrast</h3><div id="cx-list"></div>' +
                '<p class="faint" style="font-size:.6875rem;line-height:1.6">Each box\'s main text colour against the average colour behind it.</p>' +
                '<button class="btn btn-dark btn-sm mt-3" id="bg-done">Back to layout</button></div>';
            Dandy.hydrateIcons(box);

            Dandy.els('[data-bgc]', box).forEach(function (b2) {
                b2.addEventListener('click', function () { bgChange(function () { tpl.background.color = b2.dataset.bgc; }); drawBgPanel(); });
            });
            var color = box.querySelector('#bg-color'), hex = box.querySelector('#bg-hex');
            color.addEventListener('input', function () {
                bgChange(function () { tpl.background.color = color.value.toLowerCase(); }, true);
                hex.value = tpl.background.color;
            });
            color.addEventListener('change', function () { propUndoPending = false; drawBgPanel(); });
            hex.addEventListener('change', function () {
                var v = hex.value.trim();
                if (v.charAt(0) !== '#') v = '#' + v;
                if (!/^#[0-9a-f]{6}$/i.test(v)) { hex.value = tpl.background.color; Dandy.toast('Use a colour code like #f3f4f6'); return; }
                bgChange(function () { tpl.background.color = v.toLowerCase(); });
                drawBgPanel();
            });
            box.querySelector('#bg-add').addEventListener('click', function () { $('bg-file').click(); });
            Dandy.els('.layer-row', box).forEach(function (row) {
                row.addEventListener('click', function () { selectedLayer = row.dataset.layer; drawCanvas(); drawBgPanel(); });
            });
            Dandy.els('[data-fit]', box).forEach(function (b2) {
                b2.addEventListener('click', function () { bgChange(function () { sel.fit = b2.dataset.fit; }); drawBgPanel(); });
            });
            var op = box.querySelector('#bg-op');
            if (op) {
                op.addEventListener('input', function () {
                    bgChange(function () { sel.opacity = clampLayer(Object.assign({}, sel, { opacity: op.value / 100 })).opacity; }, true);
                    op.previousElementSibling.textContent = 'Opacity (' + Math.round(sel.opacity * 100) + '%)';
                });
                op.addEventListener('change', function () { propUndoPending = false; });
            }
            var full = box.querySelector('#bg-full');
            if (full) full.addEventListener('click', function () {
                bgChange(function () { var P = Components.PAGE; Object.assign(sel, clampLayer(Object.assign({}, sel, { x: 0, y: 0, w: P.w, h: P.h, fit: 'cover' }))); });
                drawBgPanel();
            });
            function reorder(by) {
                var list = tpl.background.layers, i = list.indexOf(sel), j = i + by;
                if (j < 0 || j >= list.length) return;
                bgChange(function () { list.splice(j, 0, list.splice(i, 1)[0]); });
                drawBgPanel();
            }
            var fwd = box.querySelector('#bg-fwd'), back = box.querySelector('#bg-back'), del = box.querySelector('#bg-del');
            if (fwd) fwd.addEventListener('click', function () { reorder(1); });
            if (back) back.addEventListener('click', function () { reorder(-1); });
            if (del) del.addEventListener('click', function () { removeLayer(sel.id); });
            box.querySelector('#bg-done').addEventListener('click', function () { setBgMode(false); });
            paintContrast();
        }

        /* Contrast: the main text colour of each box against the average colour behind it, judged
           with the WCAG ratio. Advice only; it never stops a save. */
        function scheduleContrast() {
            clearTimeout(contrastTimer);
            contrastTimer = setTimeout(refreshContrast, 150);
        }

        function refreshContrast() {
            var token = ++contrastToken;
            Images.sampler(tpl.background).then(function (sample) {
                if (!alive || token !== contrastToken) return;
                var m = Components.MARGIN;
                contrastRows = tpl.components.filter(function (c) { return c.type !== 'logo' && c.type !== 'divider'; }).map(function (c) {
                    var r = Images.ratio(Images.parseHex(c.props.accent), sample({ x: c.x + m, y: c.y + m, w: c.w, h: c.h }));
                    return { id: c.id, label: T[c.type].label, ratio: r, level: Images.level(r) };
                });
                paintContrast();
            });
        }

        var LEVEL_TEXT = { good: 'Easy to read', close: 'Borderline: check it by eye', bad: 'Hard to read' };

        function mark(level) {
            return '<span class="mark ' + level + '" role="img" aria-label="' + LEVEL_TEXT[level] + '">' +
                (level === 'good' ? Dandy.icon('check') : level === 'bad' ? Dandy.icon('x') : '-') + '</span>';
        }

        function paintContrast() {
            var list = $('cx-list'), one = $('cx-one');
            if (list) {
                list.innerHTML = contrastRows.map(function (r) {
                    return '<div class="cx">' + mark(r.level) + '<span class="grow">' + esc(r.label) + '</span><span class="num">' + r.ratio.toFixed(1) + ':1</span></div>';
                }).join('');
            }
            if (one) {
                var r = contrastRows.filter(function (x) { return x.id === selectedId; })[0];
                one.innerHTML = r ? '<div class="cx">' + mark(r.level) + '<span class="grow">' + esc(LEVEL_TEXT[r.level]) + '</span><span class="num">' + r.ratio.toFixed(1) + ':1</span></div>' : '';
            }
        }

        /* --- Pointer: moving and resizing background pictures ---------------------------------- */

        function resizeLayer(o, h, dx, dy) {
            var MIN = Components.LAYER_MIN, P = Components.PAGE;
            var L = o.x, R = o.x + o.w, Tp = o.y, B = o.y + o.h;
            if (h.indexOf('e') !== -1) R = clamp(R + dx, L + MIN, P.w);
            if (h.indexOf('w') !== -1) L = clamp(L + dx, 0, R - MIN);
            if (h.indexOf('s') !== -1) B = clamp(B + dy, Tp + MIN, P.h);
            if (h.indexOf('n') !== -1) Tp = clamp(Tp + dy, 0, B - MIN);
            return { x: L, y: Tp, w: R - L, h: B - Tp };
        }

        function paintLayer(d, r) {
            var set = function (n) {
                if (!n) return;
                n.style.left = r.x + 'mm'; n.style.top = r.y + 'mm'; n.style.width = r.w + 'mm'; n.style.height = r.h + 'mm';
            };
            set(d.node);
            // Only layers with a picture have a .bg-l element, so count among those.
            var shown = tpl.background.layers.filter(function (l) { return Images.url(l.imageId); });
            set($('canvas').querySelectorAll('.bg-l')[shown.indexOf(d.layer)]);     // the picture follows the frame
        }

        function onLayerDown(e) {
            var node = e.target.closest('.d-layer');
            if (!node) {
                if (selectedLayer) { selectedLayer = null; drawCanvas(); drawBgPanel(); }
                return;
            }
            var l = layerById(node.dataset.layer);
            if (!l) return;
            e.preventDefault();
            var handle = e.target.closest('.h');
            if (selectedLayer !== l.id) {
                selectedLayer = l.id;
                drawCanvas();
                drawBgPanel();
                node = $('canvas').querySelector('.d-layer[data-layer="' + l.id + '"]');
            }
            var rc = $('canvas').getBoundingClientRect();
            drag = {
                kind: 'layer', layer: l, node: node, mode: handle ? 'resize' : 'move', h: handle && handle.dataset.h,
                sx: e.clientX, sy: e.clientY, orig: { x: l.x, y: l.y, w: l.w, h: l.h }, ppm: rc.width / Components.PAGE.w, rect: null, moved: false
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        }

        function moveLayer(e) {
            var dx = (e.clientX - drag.sx) / drag.ppm, dy = (e.clientY - drag.sy) / drag.ppm;
            if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 3) return;
            drag.moved = true;
            var o = drag.orig;
            var raw = drag.mode === 'move' ? { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h } : resizeLayer(o, drag.h, dx, dy);
            drag.rect = clampLayer(Object.assign({}, drag.layer, raw));
            paintLayer(drag, drag.rect);
        }

        function finishLayer(d) {
            if (!d.moved || !d.rect) return;
            var r = d.rect, o = d.orig;
            if (r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h) return;
            pushUndo();
            d.layer.x = r.x; d.layer.y = r.y; d.layer.w = r.w; d.layer.h = r.h;
            drawCanvas();
            drawBgPanel();
            updateChrome();
        }

        /* --- Adding and removing ------------------------------------------------------------- */

        function addComponent(type, atMm) {
            var t = T[type];
            if (!t.multi && tpl.components.some(function (c) { return c.type === type; })) return;

            var rect;
            if (atMm) {
                rect = Components.clampRect(type, { x: snap(atMm.x - t.def.w / 2), y: snap(atMm.y - t.def.h / 2), w: t.def.w, h: t.def.h });
                if (tpl.components.some(function (o) { return Components.overlaps(rect, o); })) {
                    Dandy.toast('No room there. Drop it on an empty area.');
                    return;
                }
            } else {
                rect = Components.findFree(type, t.def, tpl.components);
                if (!rect) { Dandy.toast('There is no room left on the page.'); return; }
            }

            pushUndo();
            var props = Components.cleanProps(type, type === 'text' ? { text: 'Your text' } : {});
            var c = { id: t.multi ? Components.newId(type) : type, type: type, x: rect.x, y: rect.y, w: rect.w, h: rect.h, props: props };
            tpl.components.push(c);
            selectedId = c.id;
            redraw();
        }

        function removeSelected() {
            var c = selectedId && find(selectedId);
            if (!c || T[c.type].required) return;
            pushUndo();
            tpl.components = tpl.components.filter(function (x) { return x !== c; });
            selectedId = null;
            redraw();
        }

        /* --- Pointer: geometry helpers -------------------------------------------------------- */

        function safeMetrics() {
            var r = $('safe').getBoundingClientRect();
            return { left: r.left, top: r.top, ppm: r.width / SAFE.w, width: r.width, height: r.height };
        }

        function resizeRect(o, h, dx, dy, type) {
            var t = T[type];
            var L = o.x, R = o.x + o.w, Tp = o.y, B = o.y + o.h;
            if (h.indexOf('e') !== -1 && !t.lockX) R = clamp(snap(R + dx), L + t.min.w, Math.min(SAFE.w, L + t.max.w));
            if (h.indexOf('w') !== -1 && !t.lockX) L = clamp(snap(L + dx), Math.max(0, R - t.max.w), R - t.min.w);
            if (h.indexOf('s') !== -1 && !t.lockH) B = clamp(snap(B + dy), Tp + t.min.h, Math.min(SAFE.h, Tp + t.max.h));
            if (h.indexOf('n') !== -1 && !t.lockH) Tp = clamp(snap(Tp + dy), Math.max(0, B - t.max.h), B - t.min.h);
            return { x: L, y: Tp, w: R - L, h: B - Tp };
        }

        function collides(rect, selfId) {
            return tpl.components.some(function (o) { return o.id !== selfId && Components.overlaps(rect, o); });
        }

        function paintBox(box, r, bad) {
            box.style.left = r.x + 'mm'; box.style.top = r.y + 'mm';
            box.style.width = r.w + 'mm'; box.style.height = r.h + 'mm';
            box.classList.toggle('bad', !!bad);
        }

        /* --- Pointer: moving and resizing boxes ----------------------------------------------- */

        function onCanvasDown(e) {
            if (locked) return;
            if (e.button !== undefined && e.button !== 0) return;
            if (bgMode) { onLayerDown(e); return; }
            var box = e.target.closest('.d-box');
            if (!box) { select(null); return; }
            var c = find(box.dataset.id);
            if (!c) return;
            e.preventDefault();
            if (selectedId !== c.id) select(c.id);

            var handle = e.target.closest('.h');
            var m = safeMetrics();
            drag = {
                kind: 'box', comp: c, box: box, mode: handle ? 'resize' : 'move', h: handle && handle.dataset.h,
                sx: e.clientX, sy: e.clientY, orig: { x: c.x, y: c.y, w: c.w, h: c.h }, ppm: m.ppm, rect: null, moved: false
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        }

        function onMove(e) {
            if (!drag) return;
            if (drag.kind === 'chip') { moveChip(e); return; }
            if (drag.kind === 'layer') { moveLayer(e); return; }

            var dx = (e.clientX - drag.sx) / drag.ppm, dy = (e.clientY - drag.sy) / drag.ppm;
            if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 3) return;
            drag.moved = true;

            var o = drag.orig, raw;
            if (drag.mode === 'move') raw = { x: snap(o.x + dx), y: snap(o.y + dy), w: o.w, h: o.h };
            else raw = resizeRect(o, drag.h, dx, dy, drag.comp.type);

            var r = Components.clampRect(drag.comp.type, raw);
            drag.rect = r;
            paintBox(drag.box, r, collides(r, drag.comp.id));
        }

        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            var d = drag;
            drag = null;
            if (!d) return;

            if (d.kind === 'chip') { finishChip(d); return; }
            if (d.kind === 'layer') { finishLayer(d); return; }
            if (!d.moved || !d.rect) return;

            var r = d.rect, o = d.orig;
            if (r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h) { drawCanvas(); return; }
            if (collides(r, d.comp.id)) {
                Dandy.toast('That would overlap another component.');
                drawCanvas();                   // snaps back to the last valid position
                return;
            }
            pushUndo();
            d.comp.x = r.x; d.comp.y = r.y; d.comp.w = r.w; d.comp.h = r.h;
            drawCanvas();
            drawProps();
            updateChrome();
        }

        /* --- Pointer: dragging a component in from the palette -------------------------------- */

        function onPaletteDown(e) {
            if (locked || bgMode) return;
            var chip = e.target.closest('.chip');
            if (!chip || chip.getAttribute('aria-disabled') === 'true') return;
            e.preventDefault();
            drag = { kind: 'chip', type: chip.dataset.type, sx: e.clientX, sy: e.clientY, ghost: null, moved: false };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        }

        function moveChip(e) {
            if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 4) return;
            drag.moved = true;
            if (!drag.ghost) {
                drag.ghost = document.createElement('div');
                drag.ghost.className = 'd-ghost-chip';
                drag.ghost.textContent = T[drag.type].label;
                document.body.appendChild(drag.ghost);
            }
            drag.ghost.style.left = (e.clientX + 12) + 'px';
            drag.ghost.style.top = (e.clientY + 12) + 'px';
            drag.last = { x: e.clientX, y: e.clientY };
        }

        function finishChip(d) {
            if (d.ghost) document.body.removeChild(d.ghost);
            if (!d.moved) { addComponent(d.type, null); return; }     // a click places it in the first free spot
            var m = safeMetrics();
            var x = (d.last.x - m.left) / m.ppm, y = (d.last.y - m.top) / m.ppm;
            if (x < 0 || y < 0 || x > SAFE.w || y > SAFE.h) return;    // dropped outside the page: cancelled
            addComponent(d.type, { x: x, y: y });
        }

        /* --- Keyboard ------------------------------------------------------------------------------ */

        function onKey(e) {
            if (locked) return;
            var tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
            if (bgMode) {
                var layer = selectedLayer && layerById(selectedLayer);
                if (!layer) return;
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(layer.id); return; }
                if (e.key === 'Escape') { selectedLayer = null; drawCanvas(); drawBgPanel(); return; }
                var nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
                if (!nudge) return;
                e.preventDefault();
                var k = e.shiftKey ? 5 : 1;
                var moved = clampLayer(Object.assign({}, layer, { x: layer.x + nudge[0] * k, y: layer.y + nudge[1] * k }));
                if (moved.x === layer.x && moved.y === layer.y) return;
                pushUndo();
                layer.x = moved.x; layer.y = moved.y;
                drawCanvas(); drawBgPanel(); updateChrome();
                return;
            }
            var c = selectedId && find(selectedId);
            if (!c) return;

            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
            if (e.key === 'Escape') { select(null); return; }

            var step = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key];
            if (!step) return;
            e.preventDefault();
            var r = { x: c.x + step[0], y: c.y + step[1], w: c.w, h: c.h };
            if (!Components.fits(tpl, c, r)) return;     // would leave the page or overlap: stay put
            pushUndo();
            c.x = r.x; c.y = r.y;
            drawCanvas();
            drawProps();
            updateChrome();
        }

        /* --- Toolbar ----------------------------------------------------------------------------------- */

        $('canvas').addEventListener('pointerdown', onCanvasDown);
        $('palette').addEventListener('pointerdown', onPaletteDown);
        document.addEventListener('keydown', onKey);

        $('t-name').addEventListener('input', function (e) {
            tpl.name = e.target.value.slice(0, 40);
            updateChrome();
        });
        $('b-undo').addEventListener('click', undo);
        $('b-bg').addEventListener('click', function () { setBgMode(!bgMode); });
        $('bg-file').addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) addImage(file);
        });

        $('b-reset').addEventListener('click', function () {
            if (!window.confirm('Reset this layout to the original template? Your background is kept. You can undo this before saving.')) return;
            pushUndo();
            var keepBackground = tpl.background;
            tpl = Components.defaultTemplate(slot);
            tpl.background = keepBackground;
            selectedId = null;
            $('t-name').value = tpl.name;
            redraw();
        });

        $('b-save').addEventListener('click', function () {
            // Pictures cost storage and load time, so the template's total is checked before it is kept.
            var used = Images.usage(tpl.background);
            var b = Images.budget(used);
            if (b.level === 'block') {
                Dandy.toast('The images add up to ' + Images.formatBytes(used) + ', over the ' + Images.formatBytes(b.hard) + ' limit. Remove or replace one to save.');
                setBgMode(true);
                return;
            }
            if (b.level === 'warn' && !window.confirm('The images in this template add up to ' + Images.formatBytes(used) +
                '. That is heavy: invoices will load more slowly and it uses more storage and backup space.\n\nSave anyway?')) return;

            var inUse = Components.imageIds(tpl.background);
            var fresh = inUse.filter(function (id) { return pending[id]; }).map(function (id) { return pending[id]; });
            DB.saveTemplate(tpl, fresh).then(function (clean) {
                tpl = clone(clean);
                savedJson = JSON.stringify(clean);
                undoStack = [];
                pending = {};
                redraw();
                Dandy.toast('Template ' + slot + ' saved. Every invoice now uses this layout.');
            }).catch(function (err) { Dandy.toast('Could not save: ' + err.message); });
        });

        Dandy.els('[data-slot]', el).forEach(function (b) {
            b.addEventListener('click', function () { if (b.dataset.slot !== slot) App.go('#/templates/' + b.dataset.slot); });
        });

        redraw();

        if (locked) {
            el.insertAdjacentHTML('afterbegin', Locks.bannerHtml('Template ' + slot));
            Dandy.hydrateIcons(el);
            Locks.freeze(el.querySelector('.designer'));
            Locks.freeze(el.querySelector('.toolbar'));
            Dandy.els('[data-slot]', el).forEach(function (b) { b.disabled = false; });   // switching to the other slot is fine
            cancelWait = Locks.whenFree(Locks.names.template(slot), function () { if (alive) App.reload(); });
        }

        return {
            isDirty: isDirty,
            refresh: fit,
            destroy: function () {
                alive = false;
                clearTimeout(contrastTimer);
                if (cancelWait) cancelWait();
                if (lock) lock.release();
                document.removeEventListener('keydown', onKey);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
            }
        };
    }

    return { mount: mount };
})();
