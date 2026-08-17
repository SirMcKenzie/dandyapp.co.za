/* Diff - line-level LCS comparison of two blocks of text. */

Toolbelt.register({
    id: 'diff',
    name: 'Diff',
    icon: 'diff',
    hint: 'compare text',
    keywords: 'diff compare difference text change patch',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('Diff',
                'A line-by-line comparison using the same longest-common-subsequence approach <code>git diff</code> uses, so a single inserted line does not cascade into a wall of false changes.') +
            '<div class="tool-bar">' +
                '<label class="check"><input type="checkbox" id="d-ws"> Ignore whitespace</label>' +
                '<label class="check"><input type="checkbox" id="d-case"> Ignore case</label>' +
                '<label class="check"><input type="checkbox" id="d-context"> Changes only</label>' +
                '<span class="spacer"></span>' +
                '<button class="btn btn-sm" id="d-swap">' + Dandy.icon('refresh') + 'Swap sides</button>' +
            '</div>' +
            '<div class="io split">' +
                Toolbelt.ui.input('d-a', 'Original', 'Paste the original', 10) +
                Toolbelt.ui.input('d-b', 'Changed', 'Paste the new version', 10) +
            '</div>' +
            Toolbelt.ui.note('d-note') +
            '<div class="mt-3"><div class="io-label"><span>Result</span>' +
                '<button class="btn btn-sm" data-copy="d-patch">' + Dandy.icon('copy') + 'Copy as patch</button></div>' +
                '<div class="diff" id="d-out"></div>' +
                '<textarea id="d-patch" class="hidden" aria-hidden="true"></textarea></div>';

        var a = document.getElementById('d-a');
        var b = document.getElementById('d-b');
        var out = document.getElementById('d-out');
        var patch = document.getElementById('d-patch');
        var ignoreWs = document.getElementById('d-ws');
        var ignoreCase = document.getElementById('d-case');
        var changesOnly = document.getElementById('d-context');

        var saved = ctx.recall(null);
        if (saved) { a.value = saved.a || ''; b.value = saved.b || ''; }

        // The LCS table is O(n*m) cells of 4 bytes. 1500 lines a side is ~9MB,
        // which stays instant; an order of magnitude more would not.
        var MAX_LINES = 1500;

        function normalise(line) {
            var s = line;
            if (ignoreWs.checked) s = s.replace(/\s+/g, ' ').trim();
            if (ignoreCase.checked) s = s.toLowerCase();
            return s;
        }

        /* Standard LCS table, then walk it backwards into an edit script. */
        function diffLines(left, right) {
            var n = left.length, m = right.length;
            var L = left.map(normalise), R = right.map(normalise);

            var width = m + 1;
            var table = new Uint32Array((n + 1) * width);

            for (var i = n - 1; i >= 0; i--) {
                for (var j = m - 1; j >= 0; j--) {
                    table[i * width + j] = L[i] === R[j]
                        ? table[(i + 1) * width + (j + 1)] + 1
                        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
                }
            }

            var script = [];
            var x = 0, y = 0;
            while (x < n && y < m) {
                if (L[x] === R[y]) {
                    script.push({ type: 'same', text: right[y], a: x + 1, b: y + 1 });
                    x++; y++;
                } else if (table[(x + 1) * width + y] >= table[x * width + (y + 1)]) {
                    script.push({ type: 'del', text: left[x], a: x + 1 });
                    x++;
                } else {
                    script.push({ type: 'add', text: right[y], b: y + 1 });
                    y++;
                }
            }
            while (x < n) { script.push({ type: 'del', text: left[x], a: x + 1 }); x++; }
            while (y < m) { script.push({ type: 'add', text: right[y], b: y + 1 }); y++; }

            return script;
        }

        function render() {
            ctx.remember({ a: a.value, b: b.value });

            if (!a.value && !b.value) {
                out.innerHTML = '';
                patch.value = '';
                Toolbelt.setNote('d-note', '');
                return;
            }

            var left = a.value.split('\n');
            var right = b.value.split('\n');

            if (left.length > MAX_LINES || right.length > MAX_LINES) {
                out.innerHTML = '';
                Toolbelt.setNote('d-note',
                    'Too large to diff in the browser — ' + Math.max(left.length, right.length).toLocaleString('en-ZA') +
                    ' lines against a ' + MAX_LINES.toLocaleString('en-ZA') + ' line limit. Use git diff for something this size.',
                    'note-bad');
                return;
            }

            var script = diffLines(left, right);
            var adds = 0, dels = 0;
            script.forEach(function (s) {
                if (s.type === 'add') adds++;
                if (s.type === 'del') dels++;
            });

            var rows = script;
            if (changesOnly.checked) {
                // Keep two lines of context either side of each change, like diff -U2.
                var keep = new Array(script.length).fill(false);
                script.forEach(function (s, i) {
                    if (s.type === 'same') return;
                    for (var k = Math.max(0, i - 2); k <= Math.min(script.length - 1, i + 2); k++) keep[k] = true;
                });
                rows = script.filter(function (_, i) { return keep[i]; });
            }

            out.innerHTML = rows.map(function (s) {
                var gutter = s.type === 'add' ? '+' + s.b : s.type === 'del' ? '-' + s.a : String(s.a);
                return '<div class="dl ' + s.type + '"><span class="g">' + gutter + '</span>' +
                    '<span class="t">' + Dandy.escapeHtml(s.text) + '</span></div>';
            }).join('');

            patch.value = script.map(function (s) {
                return (s.type === 'add' ? '+' : s.type === 'del' ? '-' : ' ') + s.text;
            }).join('\n');

            if (!adds && !dels) {
                Toolbelt.setNote('d-note', 'The two sides are identical' +
                    (ignoreWs.checked || ignoreCase.checked ? ' under the current comparison rules.' : '.'), 'note-ok');
            } else {
                Toolbelt.setNote('d-note',
                    adds + ' line' + (adds === 1 ? '' : 's') + ' added, ' +
                    dels + ' line' + (dels === 1 ? '' : 's') + ' removed.', 'note-info');
            }
        }

        document.getElementById('d-swap').addEventListener('click', function () {
            var tmp = a.value; a.value = b.value; b.value = tmp;
            render();
        });

        [a, b].forEach(function (el) { el.addEventListener('input', Dandy.debounce(render, 200)); });
        [ignoreWs, ignoreCase, changesOnly].forEach(function (el) { el.addEventListener('change', render); });

        render();
    }
});
