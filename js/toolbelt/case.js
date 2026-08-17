/* Case - slugs and every casing convention, from one input. */

Toolbelt.register({
    id: 'case',
    name: 'Case & Slug',
    icon: 'type',
    hint: 'kebab / camel',
    keywords: 'case slug kebab snake camel pascal constant title upper lower convert',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('Case & slug converter',
                'Splits on spaces, hyphens, underscores and existing camelCase boundaries, then strips accents — so "Café Münster (2026)" becomes a clean <code>cafe-munster-2026</code>.') +
            '<div class="field"><span>Input</span>' +
                '<input type="text" id="c-in" placeholder="Checkers Sixty60 Order Tracker" spellcheck="false" autocomplete="off">' +
            '</div>' +
            '<div class="rows" id="c-out"></div>';

        var input = document.getElementById('c-in');
        var out = document.getElementById('c-out');

        input.value = ctx.recall('');

        /* Decomposing to NFD lets us drop the combining accent marks, which is
           what makes é → e rather than é → '' or a mangled byte. */
        function deburr(s) {
            return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }

        function words(s) {
            return deburr(s)
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')      // camelCase boundary
                .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')   // HTTPServer → HTTP Server
                .split(/[^a-zA-Z0-9]+/)
                .filter(Boolean);
        }

        var SMALL = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs'];

        var FORMS = [
            ['kebab-case',   function (w) { return w.map(lower).join('-'); }],
            ['snake_case',   function (w) { return w.map(lower).join('_'); }],
            ['camelCase',    function (w) { return w.map(function (x, i) { return i ? cap(x) : lower(x); }).join(''); }],
            ['PascalCase',   function (w) { return w.map(cap).join(''); }],
            ['CONSTANT',     function (w) { return w.map(function (x) { return x.toUpperCase(); }).join('_'); }],
            ['Title Case',   function (w) { return w.map(function (x, i) {
                                 return i && SMALL.indexOf(lower(x)) !== -1 ? lower(x) : cap(x);
                             }).join(' '); }],
            ['Sentence case', function (w) { return w.map(function (x, i) { return i ? lower(x) : cap(x); }).join(' '); }],
            ['lower case',   function (w) { return w.map(lower).join(' '); }],
            ['UPPER CASE',   function (w) { return w.map(function (x) { return x.toUpperCase(); }).join(' '); }],
            ['dot.case',     function (w) { return w.map(lower).join('.'); }],
            ['path/case',    function (w) { return w.map(lower).join('/'); }]
        ];

        function lower(s) { return s.toLowerCase(); }
        function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

        function render() {
            ctx.remember(input.value);
            var w = words(input.value);

            if (!w.length) { out.innerHTML = ''; return; }

            out.innerHTML = FORMS.map(function (f, i) {
                var value = f[1](w);
                return '<div class="r"><span class="k">' + Dandy.escapeHtml(f[0]) + '</span>' +
                    '<span class="v" id="c-v' + i + '">' + Dandy.escapeHtml(value) + '</span>' +
                    '<button class="btn btn-sm" data-id="c-v' + i + '">' + Dandy.icon('copy') + '</button></div>';
            }).join('');

            Dandy.hydrateIcons(out);
            Dandy.els('[data-id]', out).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    Dandy.copy(document.getElementById(btn.dataset.id).textContent);
                });
            });
        }

        input.addEventListener('input', render);
        render();
    }
});
