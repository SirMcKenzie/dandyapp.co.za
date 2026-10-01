/* ==========================================================================
   Typefaces for invoices - a built-in list shipped with the app, plus fonts
   the user uploads.

   Built-in fonts live in /fonts as self-hosted woff2 (latin subset), so
   nothing is requested from a third party and they work offline. They are
   declared up front but the browser only downloads the ones actually used.

   Uploaded fonts are stored by db.js as data URLs and registered here with
   the FontFace API. A template stores only font ids; this module turns an id
   into a CSS font stack and falls back to the default if the id is unknown
   (for example a font that has since been deleted), so a template can never
   render with a missing face.
   ========================================================================== */

var Fonts = (function () {
    'use strict';

    var DEFAULT = 'poppins';
    var MAX_UPLOAD = 1.5 * 1024 * 1024;
    var UPLOAD_TYPES = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

    var GROUPS = [
        { id: 'sans',  label: 'Sans-serif', fallback: 'sans-serif' },
        { id: 'serif', label: 'Serif',      fallback: 'serif' },
        { id: 'mono',  label: 'Monospace',  fallback: 'monospace' }
    ];

    /* Poppins ships four weights because the invoice already uses them; the rest ship regular and bold. */
    var BUILTIN = [
        { id: 'poppins',          label: 'Poppins',          group: 'sans',  weights: [400, 600, 700, 900] },
        { id: 'inter',            label: 'Inter',            group: 'sans',  weights: [400, 700] },
        { id: 'dm-sans',          label: 'DM Sans',          group: 'sans',  weights: [400, 700] },
        { id: 'montserrat',       label: 'Montserrat',       group: 'sans',  weights: [400, 700] },
        { id: 'open-sans',        label: 'Open Sans',        group: 'sans',  weights: [400, 700] },
        { id: 'lato',             label: 'Lato',             group: 'sans',  weights: [400, 700] },
        { id: 'nunito',           label: 'Nunito',           group: 'sans',  weights: [400, 700] },
        { id: 'source-sans-3',    label: 'Source Sans 3',    group: 'sans',  weights: [400, 700] },
        { id: 'roboto',           label: 'Roboto',           group: 'sans',  weights: [400, 700] },
        { id: 'merriweather',     label: 'Merriweather',     group: 'serif', weights: [400, 700] },
        { id: 'playfair-display', label: 'Playfair Display', group: 'serif', weights: [400, 700] },
        { id: 'lora',             label: 'Lora',             group: 'serif', weights: [400, 700] },
        { id: 'roboto-mono',      label: 'Roboto Mono',      group: 'mono',  weights: [400, 700] }
    ];

    var custom = {};     // id -> { id, name }

    function builtin(id) { return BUILTIN.filter(function (f) { return f.id === id; })[0] || null; }
    function groupOf(f) { return GROUPS.filter(function (g) { return g.id === f.group; })[0]; }
    function exists(id) { return !!(id && (builtin(id) || custom[id])); }

    /* Ids are used in CSS family names, so they are kept to a safe alphabet. */
    function cleanId(id) { return (typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id)) ? id : ''; }

    function stack(id) {
        var b = builtin(id);
        if (b) return '"Inv ' + b.id + '", ' + groupOf(b).fallback;
        if (custom[id]) return '"Custom ' + id + '", sans-serif';
        return stack(DEFAULT);
    }

    function label(id) {
        var b = builtin(id);
        if (b) return b.label;
        return custom[id] ? custom[id].name : builtin(DEFAULT).label;
    }

    /* --- Built-in faces ---------------------------------------------------------- */

    function injectBuiltins() {
        if (document.getElementById('dandy-fonts')) return;
        var css = BUILTIN.map(function (f) {
            return f.weights.map(function (w) {
                return '@font-face{font-family:"Inv ' + f.id + '";font-style:normal;font-weight:' + w + ';font-display:swap;' +
                    'src:url("/fonts/' + f.id + '-latin-' + w + '-normal.woff2") format("woff2");}';
            }).join('');
        }).join('');
        var style = document.createElement('style');
        style.id = 'dandy-fonts';
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* --- Uploaded faces ----------------------------------------------------------- */

    function registerCustom(rows) {
        rows.forEach(function (row) {
            if (custom[row.id]) return;
            custom[row.id] = { id: row.id, name: row.name };
            try {
                var face = new FontFace('Custom ' + row.id, 'url(' + row.dataUrl + ')');
                document.fonts.add(face);
                face.load().catch(function () { /* a broken stored font falls back to the default stack */ });
            } catch (e) { /* FontFace unsupported or data unusable: the fallback stack is used */ }
        });
    }

    function unregisterCustom(id) {
        delete custom[id];
        var doomed = [];
        document.fonts.forEach(function (face) {
            if (face.family.replace(/["']/g, '') === 'Custom ' + id) doomed.push(face);
        });
        doomed.forEach(function (face) { document.fonts.delete(face); });
    }

    function customList() {
        return Object.keys(custom).map(function (k) { return custom[k]; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function extOf(filename) {
        var m = /\.([a-z0-9]+)$/i.exec(filename || '');
        return m ? m[1].toLowerCase() : '';
    }

    /* Read and check an uploaded file. Resolves to a row ready for the database. */
    function readUpload(file) {
        var ext = extOf(file.name);
        if (!UPLOAD_TYPES[ext]) return Promise.reject(new Error('Use a .woff2, .woff, .ttf or .otf font file.'));
        if (file.size > MAX_UPLOAD) return Promise.reject(new Error('That font file is over 1.5 MB.'));

        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('The file could not be read.')); };
            reader.onload = function () {
                var base64 = String(reader.result).split(',')[1] || '';
                var dataUrl = 'data:' + UPLOAD_TYPES[ext] + ';base64,' + base64;
                // Loading it is the real test: a renamed or damaged file fails here.
                new FontFace('Check', 'url(' + dataUrl + ')').load().then(function () {
                    resolve({
                        id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 40) || 'Uploaded font',
                        dataUrl: dataUrl, size: file.size, added: Date.now()
                    });
                }, function () { reject(new Error('That file is not a usable font.')); });
            };
            reader.readAsDataURL(file);
        });
    }

    /* --- Using a template's choice ------------------------------------------------------- */

    function headingId(font) { return font && font.heading ? font.heading : (font && font.body) || DEFAULT; }

    function idsOf(font) {
        var ids = [(font && font.body) || DEFAULT, headingId(font)];
        return ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    }

    /* Sets the CSS variables the stylesheet reads. */
    function apply(el, font) {
        el.style.setProperty('--font-body', stack((font && font.body) || DEFAULT));
        el.style.setProperty('--font-heading', stack(headingId(font)));
    }

    /* Resolves once the faces for a template are usable, so text can be measured
       against the real font. Never rejects: a failure just means the fallback is used. */
    function load(font) {
        if (!document.fonts || !document.fonts.load) return Promise.resolve();
        var jobs = [];
        idsOf(font).forEach(function (id) {
            var fam = stack(id).split(',')[0];
            jobs.push(document.fonts.load('400 14px ' + fam), document.fonts.load('700 14px ' + fam));
        });
        return Promise.all(jobs.map(function (p) { return p.catch(function () {}); }));
    }

    injectBuiltins();

    return {
        DEFAULT: DEFAULT, MAX_UPLOAD: MAX_UPLOAD, GROUPS: GROUPS, BUILTIN: BUILTIN,
        exists: exists, cleanId: cleanId, stack: stack, label: label, headingId: headingId, idsOf: idsOf,
        registerCustom: registerCustom, unregisterCustom: unregisterCustom, customList: customList,
        readUpload: readUpload, apply: apply, load: load
    };
})();
