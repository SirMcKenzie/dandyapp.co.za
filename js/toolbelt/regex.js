/* Regex - live highlighting, capture groups, and South African presets. */

Toolbelt.register({
    id: 'regex',
    name: 'Regex',
    icon: 'regex',
    hint: 'test / match',
    keywords: 'regex regexp pattern match test capture group replace',

    mount: function (stage, ctx) {
        var FLAGS = [
            ['g', 'global'], ['i', 'ignore case'], ['m', 'multiline'],
            ['s', 'dot matches newline'], ['u', 'unicode'], ['y', 'sticky']
        ];

        var PRESETS = [
            { name: 'SA ID number', pattern: '\\b(\\d{2})(\\d{2})(\\d{2})\\d{4}[01]\\d\\d\\b',
              sample: 'Applicant 9202204720082 was verified. Spouse 0801015009087 pending.' },
            { name: 'SA mobile', pattern: '(?:\\+27|0)(6|7|8)\\d{8}\\b',
              sample: 'Call me on 0821234567 or +27833334444, the office is 011 555 0100.' },
            { name: 'SA VAT number', pattern: '\\b4\\d{9}\\b',
              sample: 'Supplier VAT 4123456789, our own is 4987654321. Ref 1234567890 is not a VAT no.' },
            { name: 'SA postal code', pattern: '\\b\\d{4}\\b',
              sample: 'Sandton 2196, Cape Town 8001, Durban 4001.' },
            { name: 'Email', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+',
              sample: 'Mail hello@example.co.za or accounts@studio.co.za for invoices.' },
            { name: 'URL', pattern: 'https?://[^\\s<>"]+',
              sample: 'See https://dandyapp.co.za/toolbelt/ and http://example.co.za for more.' },
            { name: 'ISO date', pattern: '\\d{4}-\\d{2}-\\d{2}(?:T[\\d:.]+(?:Z|[+-]\\d{2}:\\d{2})?)?',
              sample: 'Created 2026-08-16T09:14:22+02:00, due 2026-09-15.' },
            { name: 'Hex colour', pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b',
              sample: 'Ink #111827, slab #f8fafc, accent #fff.' }
        ];

        stage.innerHTML =
            Toolbelt.ui.head('Regex tester',
                'Matches highlight as you type, alternating colours so adjacent matches stay distinguishable. The presets are the patterns worth having on hand in South Africa.') +
            '<div class="tool-bar">' +
                '<div class="chips presets" id="r-presets">' +
                    PRESETS.map(function (p, i) {
                        return '<button type="button" data-preset="' + i + '">' + Dandy.escapeHtml(p.name) + '</button>';
                    }).join('') +
                '</div>' +
            '</div>' +
            '<div class="field"><span>Pattern</span>' +
                '<div class="row" style="gap:.5rem;flex-wrap:nowrap">' +
                    '<span class="mono faint">/</span>' +
                    '<input type="text" id="r-pat" class="grow mono" spellcheck="false" autocomplete="off" placeholder="\\b\\w+@\\w+\\.\\w+\\b">' +
                    '<span class="mono faint">/</span>' +
                '</div>' +
            '</div>' +
            '<div class="chips mb-2" id="r-flags">' +
                FLAGS.map(function (f) {
                    return '<button type="button" data-flag="' + f[0] + '" title="' + f[1] + '" aria-pressed="' +
                        (f[0] === 'g' ? 'true' : 'false') + '">' + f[0] + '</button>';
                }).join('') +
            '</div>' +
            '<div class="io split">' +
                Toolbelt.ui.input('r-txt', 'Test string', 'Paste the text to search', 10) +
                '<div class="io-block"><div class="io-label"><span>Matches</span></div>' +
                    '<div class="hl" id="r-hl"></div></div>' +
            '</div>' +
            Toolbelt.ui.note('r-note') +
            '<div class="mt-3" id="r-table"></div>';

        var pat = document.getElementById('r-pat');
        var txt = document.getElementById('r-txt');
        var hl = document.getElementById('r-hl');
        var table = document.getElementById('r-table');

        var saved = ctx.recall(null);
        if (saved) { pat.value = saved.pattern || ''; txt.value = saved.text || ''; }

        function flags() {
            return Dandy.els('#r-flags button')
                .filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })
                .map(function (b) { return b.dataset.flag; })
                .join('');
        }

        function render() {
            ctx.remember({ pattern: pat.value, text: txt.value });

            var source = pat.value;
            var text = txt.value;

            hl.textContent = text;
            table.innerHTML = '';

            if (!source) { Toolbelt.setNote('r-note', ''); return; }

            var re;
            try {
                re = new RegExp(source, flags());
            } catch (e) {
                Toolbelt.setNote('r-note', 'Invalid pattern: ' + e.message, 'note-bad');
                return;
            }

            if (!text) { Toolbelt.setNote('r-note', 'Pattern is valid. Add a test string.', 'note-info'); return; }

            var matches = [];
            if (re.global || re.sticky) {
                var m, guard = 0;
                re.lastIndex = 0;
                while ((m = re.exec(text)) !== null && guard++ < 10000) {
                    matches.push(m);
                    if (m[0] === '') re.lastIndex++;   // zero-length match would loop forever
                }
            } else {
                var single = re.exec(text);
                if (single) matches.push(single);
            }

            if (!matches.length) {
                Toolbelt.setNote('r-note', 'Valid pattern, but no matches in the test string.', 'note-warn');
                return;
            }

            // Rebuild the text with <mark> around each match.
            var html = '';
            var cursor = 0;
            matches.forEach(function (m, i) {
                html += Dandy.escapeHtml(text.slice(cursor, m.index));
                html += '<mark' + (i % 2 ? ' class="alt"' : '') + '>' + Dandy.escapeHtml(m[0]) + '</mark>';
                cursor = m.index + m[0].length;
            });
            html += Dandy.escapeHtml(text.slice(cursor));
            hl.innerHTML = html;

            var groupCount = matches[0].length - 1;
            var names = matches[0].groups ? Object.keys(matches[0].groups) : [];

            var header = '<tr><th class="n">#</th><th>Match</th><th>At</th>' +
                Array.from({ length: groupCount }, function (_, g) {
                    return '<th>$' + (g + 1) + (names[g] ? ' <span class="faint">' + Dandy.escapeHtml(names[g]) + '</span>' : '') + '</th>';
                }).join('') + '</tr>';

            var body = matches.map(function (m, i) {
                return '<tr><td class="n">' + (i + 1) + '</td>' +
                    '<td>' + Dandy.escapeHtml(m[0]) + '</td>' +
                    '<td class="n">' + m.index + '</td>' +
                    Array.from({ length: groupCount }, function (_, g) {
                        return '<td>' + (m[g + 1] === undefined ? '<span class="faint">—</span>' : Dandy.escapeHtml(m[g + 1])) + '</td>';
                    }).join('') + '</tr>';
            }).join('');

            table.innerHTML = '<div style="overflow-x:auto"><table class="matches"><thead>' +
                header + '</thead><tbody>' + body + '</tbody></table></div>';

            Toolbelt.setNote('r-note',
                matches.length + ' match' + (matches.length === 1 ? '' : 'es') +
                (groupCount ? ', ' + groupCount + ' capture group' + (groupCount === 1 ? '' : 's') : '') + '.',
                'note-ok');
        }

        Dandy.els('#r-flags button').forEach(function (b) {
            b.addEventListener('click', function () {
                b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
                render();
            });
        });

        Dandy.els('#r-presets button').forEach(function (b) {
            b.addEventListener('click', function () {
                var p = PRESETS[parseInt(b.dataset.preset, 10)];
                pat.value = p.pattern;
                if (!txt.value.trim()) txt.value = p.sample;
                render();
            });
        });

        pat.addEventListener('input', render);
        txt.addEventListener('input', render);
        render();
    }
});
