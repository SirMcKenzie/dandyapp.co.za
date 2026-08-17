/* ==========================================================================
   Toolbelt registry, routing and keyboard shortcuts.

   Every tool is an independent module that calls Toolbelt.register(). It
   knows nothing about the rail, the palette or persistence - it only gets a
   DOM node to fill and a namespaced remember/recall pair.
   ========================================================================== */

var Toolbelt = (function () {
    'use strict';

    var tools = [];
    var byId = {};
    var current = null;

    var rail, stage, filterInput, palette, paletteInput, paletteList;
    var paletteMatches = [], paletteIndex = 0;

    /* --- Registration ------------------------------------------------------ */

    function register(tool) {
        if (byId[tool.id]) throw new Error('Duplicate tool id: ' + tool.id);
        tools.push(tool);
        byId[tool.id] = tool;
    }

    /* --- Per-tool helpers passed into mount() ------------------------------ */

    function contextFor(tool) {
        var key = 'tool.' + tool.id;
        return {
            /* Inputs survive a reload - losing a half-built regex to a stray
               Cmd+R is the fastest way to make a tool feel hostile. */
            remember: Dandy.debounce(function (value) {
                Dandy.Store.set(key, value);
            }, 400),
            recall: function (fallback) {
                return Dandy.Store.get(key, fallback);
            },
            forget: function () { Dandy.Store.remove(key); }
        };
    }

    /* --- Shared markup helpers --------------------------------------------- */

    var ui = {
        head: function (title, desc) {
            return '<div class="tool-head"><h2>' + Dandy.escapeHtml(title) + '</h2>' +
                '<p>' + desc + '</p></div>';
        },

        /* An output block with a copy button wired by data-copy="<target id>" */
        output: function (id, label, empty, extraClass) {
            return '<div class="io-block">' +
                '<div class="io-label"><span>' + Dandy.escapeHtml(label) + '</span>' +
                '<button class="btn btn-sm" data-copy="' + id + '">' +
                Dandy.icon('copy') + 'Copy</button></div>' +
                '<pre class="out ' + (extraClass || '') + '" id="' + id + '" data-empty="' +
                Dandy.escapeHtml(empty || 'Output appears here') + '"></pre></div>';
        },

        input: function (id, label, placeholder, rows) {
            return '<div class="io-block">' +
                '<div class="io-label"><span>' + Dandy.escapeHtml(label) + '</span>' +
                '<button class="btn btn-sm" data-clear="' + id + '">Clear</button></div>' +
                '<textarea class="code-area" id="' + id + '" spellcheck="false" rows="' + (rows || 10) +
                '" placeholder="' + Dandy.escapeHtml(placeholder || '') + '"></textarea></div>';
        },

        note: function (id, cls) {
            return '<p class="note ' + (cls || 'note-info') + ' mt-2" id="' + id + '" hidden></p>';
        }
    };

    /* Show or hide one of the ui.note() blocks. */
    function setNote(id, message, cls) {
        var n = document.getElementById(id);
        if (!n) return;
        if (!message) { n.hidden = true; return; }
        n.className = 'note ' + (cls || 'note-info') + ' mt-2';
        n.innerHTML = Dandy.icon(cls === 'note-bad' ? 'alert' : cls === 'note-ok' ? 'check' : 'info') +
            '<span>' + Dandy.escapeHtml(message) + '</span>';
        n.hidden = false;
    }

    /* --- Activation --------------------------------------------------------- */

    function activate(id, pushHash) {
        var tool = byId[id];
        if (!tool) return;

        current = tool;
        stage.innerHTML = '';
        stage.setAttribute('aria-label', tool.name);

        Dandy.els('button', rail).forEach(function (b) {
            b.setAttribute('aria-selected', String(b.dataset.tool === id));
        });

        tool.mount(stage, contextFor(tool));
        Dandy.hydrateIcons(stage);
        wireStage();

        if (pushHash !== false && location.hash.slice(1) !== id) {
            history.replaceState(null, '', '#' + id);
        }
    }

    /* Generic behaviours every tool gets for free. */
    function wireStage() {
        Dandy.els('[data-copy]', stage).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = document.getElementById(btn.dataset.copy);
                if (!target) return;
                var text = target.value !== undefined ? target.value : target.textContent;
                if (!text) { Dandy.toast('Nothing to copy'); return; }
                Dandy.copy(text);
            });
        });

        Dandy.els('[data-clear]', stage).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = document.getElementById(btn.dataset.clear);
                if (!target) return;
                target.value = '';
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.focus();
            });
        });
    }

    /* --- Rail --------------------------------------------------------------- */

    function buildRail() {
        rail.innerHTML = tools.map(function (t) {
            return '<button type="button" role="tab" data-tool="' + t.id + '" ' +
                'aria-selected="false" data-search="' +
                Dandy.escapeHtml((t.name + ' ' + (t.keywords || '')).toLowerCase()) + '">' +
                Dandy.icon(t.icon) + Dandy.escapeHtml(t.name) + '</button>';
        }).join('');

        Dandy.els('button', rail).forEach(function (b) {
            b.addEventListener('click', function () { activate(b.dataset.tool); });
        });
    }

    function applyFilter(term) {
        var q = term.trim().toLowerCase();
        Dandy.els('button', rail).forEach(function (b) {
            b.hidden = q ? b.dataset.search.indexOf(q) === -1 : false;
        });
    }

    /* --- Command palette ----------------------------------------------------- */

    function openPalette() {
        palette.hidden = false;
        paletteInput.value = '';
        renderPalette('');
        paletteInput.focus();
    }

    function closePalette() {
        palette.hidden = true;
    }

    function renderPalette(term) {
        var q = term.trim().toLowerCase();
        paletteMatches = tools.filter(function (t) {
            return !q || (t.name + ' ' + (t.keywords || '')).toLowerCase().indexOf(q) !== -1;
        });
        paletteIndex = 0;
        paintPalette();
    }

    function paintPalette() {
        if (!paletteMatches.length) {
            paletteList.innerHTML = '<li aria-disabled="true" class="muted">No tool matches that</li>';
            return;
        }
        paletteList.innerHTML = paletteMatches.map(function (t, i) {
            return '<li role="option" data-tool="' + t.id + '" aria-selected="' + (i === paletteIndex) + '">' +
                Dandy.icon(t.icon) + '<span>' + Dandy.escapeHtml(t.name) + '</span>' +
                '<span class="hint">' + Dandy.escapeHtml(t.hint || '') + '</span></li>';
        }).join('');

        Dandy.els('li[data-tool]', paletteList).forEach(function (li) {
            li.addEventListener('click', function () {
                activate(li.dataset.tool);
                closePalette();
            });
        });
    }

    function movePalette(delta) {
        if (!paletteMatches.length) return;
        paletteIndex = (paletteIndex + delta + paletteMatches.length) % paletteMatches.length;
        paintPalette();
    }

    /* --- Keyboard ------------------------------------------------------------ */

    function isTyping(target) {
        var tag = target && target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
            (target && target.isContentEditable);
    }

    function wireKeys() {
        document.addEventListener('keydown', function (e) {
            var meta = e.metaKey || e.ctrlKey;

            if (meta && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                palette.hidden ? openPalette() : closePalette();
                return;
            }

            if (!palette.hidden) {
                if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
                else if (e.key === 'Enter') {
                    e.preventDefault();
                    var pick = paletteMatches[paletteIndex];
                    if (pick) { activate(pick.id); closePalette(); }
                }
                return;
            }

            if (e.key === '/' && !isTyping(e.target)) {
                e.preventDefault();
                filterInput.focus();
                filterInput.select();
            }
        });

        paletteInput.addEventListener('input', function () { renderPalette(paletteInput.value); });
        palette.addEventListener('mousedown', function (e) {
            if (e.target === palette) closePalette();
        });
    }

    /* --- Boot ---------------------------------------------------------------- */

    function start() {
        rail = document.getElementById('tb-rail');
        stage = document.getElementById('tb-stage');
        filterInput = document.getElementById('tb-filter');
        palette = document.getElementById('palette');
        paletteInput = document.getElementById('palette-input');
        paletteList = document.getElementById('palette-list');

        buildRail();
        wireKeys();

        filterInput.addEventListener('input', function () { applyFilter(filterInput.value); });
        filterInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { filterInput.value = ''; applyFilter(''); filterInput.blur(); }
            if (e.key === 'Enter') {
                var first = Dandy.els('button:not([hidden])', rail)[0];
                if (first) { activate(first.dataset.tool); filterInput.blur(); }
            }
        });

        window.addEventListener('hashchange', function () {
            var id = location.hash.slice(1);
            if (byId[id] && (!current || current.id !== id)) activate(id, false);
        });

        var initial = location.hash.slice(1);
        activate(byId[initial] ? initial : tools[0].id, false);
    }

    return {
        register: register,
        start: start,
        activate: activate,
        ui: ui,
        setNote: setNote
    };
})();
