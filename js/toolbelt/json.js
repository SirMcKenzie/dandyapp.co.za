/* JSON - format, minify, validate, sort keys, collapsible tree. */

Toolbelt.register({
    id: 'json',
    name: 'JSON',
    icon: 'braces',
    hint: 'format / tree',
    keywords: 'json format pretty minify validate tree parse',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('JSON', 'Paste anything. It formats as you type, tells you exactly where a syntax error is, and gives you a collapsible tree for the big responses.') +
            '<div class="tool-bar">' +
                '<div class="segmented" id="j-mode">' +
                    '<button type="button" data-mode="pretty" aria-pressed="true">Pretty</button>' +
                    '<button type="button" data-mode="minify" aria-pressed="false">Minify</button>' +
                    '<button type="button" data-mode="tree" aria-pressed="false">Tree</button>' +
                '</div>' +
                '<div class="segmented" id="j-indent">' +
                    '<button type="button" data-indent="2" aria-pressed="true">2 sp</button>' +
                    '<button type="button" data-indent="4" aria-pressed="false">4 sp</button>' +
                    '<button type="button" data-indent="\t" aria-pressed="false">Tab</button>' +
                '</div>' +
                '<label class="check"><input type="checkbox" id="j-sort"> Sort keys</label>' +
                '<span class="spacer"></span>' +
                '<button class="btn btn-sm" id="j-sample">Load sample</button>' +
            '</div>' +
            '<div class="io split">' +
                Toolbelt.ui.input('j-in', 'Input', '{ "hello": "world" }', 14) +
                '<div class="io-block">' +
                    '<div class="io-label"><span>Output</span>' +
                    '<button class="btn btn-sm" data-copy="j-out">' + Dandy.icon('copy') + 'Copy</button></div>' +
                    '<pre class="out wrap-none" id="j-out" data-empty="Formatted JSON appears here"></pre>' +
                    '<div class="out tree hidden" id="j-tree"></div>' +
                '</div>' +
            '</div>' +
            Toolbelt.ui.note('j-note');

        var input = document.getElementById('j-in');
        var out = document.getElementById('j-out');
        var tree = document.getElementById('j-tree');
        var sortBox = document.getElementById('j-sort');
        var mode = 'pretty';
        var indent = 2;

        input.value = ctx.recall('');

        function sortDeep(value) {
            if (Array.isArray(value)) return value.map(sortDeep);
            if (value && typeof value === 'object') {
                var out = {};
                Object.keys(value).sort().forEach(function (k) { out[k] = sortDeep(value[k]); });
                return out;
            }
            return value;
        }

        /* JSON.parse error messages differ per engine and recent V8 dropped the
           character offset entirely, so we do our own single pass to find where
           the document actually goes wrong. Pointing at the line is the whole
           reason to use this over a console one-liner. */
        function scan(text) {
            var i = 0;
            var n = text.length;

            function fail(message) { throw { at: i, message: message }; }
            function ws() { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; }
            function lit(word) { return text.substr(i, word.length) === word; }

            function str() {
                i++;                                   // opening quote
                for (;;) {
                    if (i >= n) fail('Unterminated string');
                    var c = text[i];
                    if (c === '\\') { i += 2; continue; }
                    if (c === '"') { i++; return; }
                    if (c === '\n') fail('Unterminated string — a newline inside a string must be written as \\n');
                    i++;
                }
            }

            function num() {
                var start = i;
                if (text[i] === '-') i++;
                while (i < n && text[i] >= '0' && text[i] <= '9') i++;
                if (text[i] === '.') { i++; while (i < n && text[i] >= '0' && text[i] <= '9') i++; }
                if (text[i] === 'e' || text[i] === 'E') {
                    i++;
                    if (text[i] === '+' || text[i] === '-') i++;
                    while (i < n && text[i] >= '0' && text[i] <= '9') i++;
                }
                if (i === start) fail('Invalid number');
            }

            function object() {
                i++;                                   // {
                ws();
                if (text[i] === '}') { i++; return; }
                for (;;) {
                    ws();
                    if (text[i] === '}') fail('Trailing comma before "}"');
                    if (text[i] !== '"') fail('Expected a key in double quotes');
                    str();
                    ws();
                    if (text[i] !== ':') fail('Expected ":" after the key');
                    i++;
                    value();
                    ws();
                    if (text[i] === ',') { i++; continue; }
                    if (text[i] === '}') { i++; return; }
                    fail(i >= n ? 'Unclosed object — "}" is missing' : 'Expected "," or "}"');
                }
            }

            function array() {
                i++;                                   // [
                ws();
                if (text[i] === ']') { i++; return; }
                for (;;) {
                    ws();
                    if (text[i] === ']') fail('Trailing comma before "]"');
                    value();
                    ws();
                    if (text[i] === ',') { i++; continue; }
                    if (text[i] === ']') { i++; return; }
                    fail(i >= n ? 'Unclosed array — "]" is missing' : 'Expected "," or "]"');
                }
            }

            function value() {
                ws();
                if (i >= n) fail('Unexpected end of input');
                var c = text[i];
                if (c === '{') return object();
                if (c === '[') return array();
                if (c === '"') return str();
                if (c === '-' || (c >= '0' && c <= '9')) return num();
                if (lit('true')) { i += 4; return; }
                if (lit('false')) { i += 5; return; }
                if (lit('null')) { i += 4; return; }
                if (c === "'") fail('JSON strings use double quotes, not single quotes');
                fail('Unexpected character ' + JSON.stringify(c));
            }

            value();
            ws();
            if (i < n) fail('Unexpected content after the end of the JSON value');
        }

        function locate(err, text) {
            try {
                scan(text);
            } catch (found) {
                if (found && typeof found.at === 'number') {
                    var upto = text.slice(0, found.at);
                    var line = upto.split('\n').length;
                    var col = found.at - upto.lastIndexOf('\n');
                    return found.message + ' — line ' + line + ', column ' + col + '.';
                }
            }
            // The scanner found nothing JSON.parse objected to; report verbatim.
            return err.message;
        }

        function render() {
            var text = input.value;
            ctx.remember(text);

            if (!text.trim()) {
                out.textContent = '';
                tree.innerHTML = '';
                Toolbelt.setNote('j-note', '');
                return;
            }

            var data;
            try {
                data = JSON.parse(text);
            } catch (err) {
                out.textContent = '';
                tree.innerHTML = '';
                Toolbelt.setNote('j-note', locate(err, text), 'note-bad');
                return;
            }

            if (sortBox.checked) data = sortDeep(data);

            var bytes = new Blob([text]).size;
            var keys = countKeys(data);
            Toolbelt.setNote('j-note',
                'Valid JSON — ' + keys.nodes + ' nodes, ' + keys.depth + ' levels deep, ' +
                bytes.toLocaleString('en-ZA') + ' bytes in.', 'note-ok');

            if (mode === 'tree') {
                out.classList.add('hidden');
                tree.classList.remove('hidden');
                tree.innerHTML = renderTree(data);
                wireTwisties();
                out.textContent = JSON.stringify(data, null, indent);   // keeps Copy useful
            } else {
                tree.classList.add('hidden');
                out.classList.remove('hidden');
                out.textContent = mode === 'minify'
                    ? JSON.stringify(data)
                    : JSON.stringify(data, null, indent);
            }
        }

        function countKeys(value, depth) {
            depth = depth || 1;
            var nodes = 1, deepest = depth;
            if (value && typeof value === 'object') {
                Object.keys(value).forEach(function (k) {
                    var sub = countKeys(value[k], depth + 1);
                    nodes += sub.nodes;
                    if (sub.depth > deepest) deepest = sub.depth;
                });
            }
            return { nodes: nodes, depth: deepest };
        }

        function leaf(value) {
            if (value === null) return '<span class="null">null</span>';
            if (typeof value === 'string') return '<span class="str">"' + Dandy.escapeHtml(value) + '"</span>';
            if (typeof value === 'number') return '<span class="num">' + value + '</span>';
            if (typeof value === 'boolean') return '<span class="bool">' + value + '</span>';
            return Dandy.escapeHtml(String(value));
        }

        function renderTree(value, key) {
            var label = key === undefined ? '' : '<span class="key">' + Dandy.escapeHtml(key) + '</span>: ';

            if (value === null || typeof value !== 'object') {
                return '<li><span class="tw" style="visibility:hidden"></span>' + label + leaf(value) + '</li>';
            }

            var isArray = Array.isArray(value);
            var entries = isArray
                ? value.map(function (v, i) { return [String(i), v]; })
                : Object.keys(value).map(function (k) { return [k, value[k]]; });

            var summary = isArray
                ? '[ ] <span class="meta">' + entries.length + ' items</span>'
                : '{ } <span class="meta">' + entries.length + ' keys</span>';

            var children = entries.map(function (pair) {
                return renderTree(pair[1], pair[0]);
            }).join('');

            var body = '<span class="tw"></span>' + label + summary + '<ul>' + children + '</ul>';
            return key === undefined ? '<ul><li>' + body + '</li></ul>' : '<li>' + body + '</li>';
        }

        function wireTwisties() {
            Dandy.els('.tw', tree).forEach(function (tw) {
                tw.addEventListener('click', function () {
                    tw.parentNode.classList.toggle('collapsed');
                });
            });
        }

        Dandy.els('#j-mode button').forEach(function (b) {
            b.addEventListener('click', function () {
                mode = b.dataset.mode;
                Dandy.els('#j-mode button').forEach(function (o) {
                    o.setAttribute('aria-pressed', String(o === b));
                });
                render();
            });
        });

        Dandy.els('#j-indent button').forEach(function (b) {
            b.addEventListener('click', function () {
                indent = b.dataset.indent === '\t' ? '\t' : parseInt(b.dataset.indent, 10);
                Dandy.els('#j-indent button').forEach(function (o) {
                    o.setAttribute('aria-pressed', String(o === b));
                });
                render();
            });
        });

        sortBox.addEventListener('change', render);
        input.addEventListener('input', render);

        document.getElementById('j-sample').addEventListener('click', function () {
            input.value = JSON.stringify({
                order: 'SO-10428',
                placed: '2026-08-16T09:14:22+02:00',
                customer: { name: 'Thandi Mokoena', vatNo: '4123456789', city: 'Johannesburg' },
                lines: [
                    { sku: 'DEV-HR', description: 'Development, hourly', qty: 12, rate: 850 },
                    { sku: 'HOST-M', description: 'Managed hosting, monthly', qty: 1, rate: 450 }
                ],
                totals: { excl: 10650, vat: 1597.5, incl: 12247.5 },
                paid: false
            }, null, 2);
            render();
        });

        render();
    }
});
