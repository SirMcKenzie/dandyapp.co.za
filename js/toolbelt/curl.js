/* cURL - turn a pasted curl command into fetch(), axios or Python requests. */

Toolbelt.register({
    id: 'curl',
    name: 'cURL',
    icon: 'terminal',
    hint: 'to fetch / python',
    keywords: 'curl fetch axios python requests http convert command',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('cURL converter',
                'Paste the command straight out of your terminal, or out of Chrome DevTools&rsquo; &ldquo;Copy as cURL&rdquo;. Line continuations, quoting and <code>--data-raw</code> are all handled.') +
            '<div class="tool-bar">' +
                '<div class="segmented" id="u-target">' +
                    '<button type="button" data-target="fetch" aria-pressed="true">fetch</button>' +
                    '<button type="button" data-target="axios" aria-pressed="false">axios</button>' +
                    '<button type="button" data-target="python" aria-pressed="false">Python</button>' +
                '</div>' +
                '<span class="spacer"></span>' +
                '<button class="btn btn-sm" id="u-sample">Load sample</button>' +
            '</div>' +
            '<div class="io split">' +
                Toolbelt.ui.input('u-in', 'cURL command', "curl 'https://api.example.co.za/orders' -H 'Authorization: Bearer …'", 10) +
                Toolbelt.ui.output('u-out', 'Code', 'Converted code appears here', 'wrap-none') +
            '</div>' +
            Toolbelt.ui.note('u-note');

        var input = document.getElementById('u-in');
        var out = document.getElementById('u-out');
        var target = 'fetch';

        input.value = ctx.recall('');

        /* Split a shell command into argv, honouring single quotes, double
           quotes and backslash line continuations. */
        function tokenise(command) {
            var text = command.replace(/\\\r?\n/g, ' ').trim();
            var tokens = [];
            var buf = '';
            var quote = null;
            var started = false;

            for (var i = 0; i < text.length; i++) {
                var ch = text[i];

                if (quote) {
                    if (ch === quote) { quote = null; }
                    else if (ch === '\\' && quote === '"' && i + 1 < text.length) { buf += text[++i]; }
                    else { buf += ch; }
                    continue;
                }

                if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
                if (ch === '\\' && i + 1 < text.length) { buf += text[++i]; started = true; continue; }

                if (/\s/.test(ch)) {
                    if (buf || started) { tokens.push(buf); buf = ''; started = false; }
                    continue;
                }
                buf += ch;
                started = true;
            }
            if (buf || started) tokens.push(buf);
            return tokens;
        }

        function parse(command) {
            var tokens = tokenise(command);
            if (!tokens.length || tokens[0] !== 'curl') {
                throw new Error('That does not start with "curl".');
            }

            var req = { method: null, url: null, headers: {}, body: null, insecure: false, form: [] };

            for (var i = 1; i < tokens.length; i++) {
                var t = tokens[i];

                if (t === '-X' || t === '--request') { req.method = tokens[++i]; }
                else if (t === '-H' || t === '--header') {
                    var h = tokens[++i] || '';
                    var split = h.indexOf(':');
                    if (split > 0) req.headers[h.slice(0, split).trim()] = h.slice(split + 1).trim();
                }
                else if (t === '-d' || t === '--data' || t === '--data-raw' ||
                         t === '--data-binary' || t === '--data-ascii') {
                    req.body = (req.body === null ? '' : req.body + '&') + (tokens[++i] || '');
                }
                else if (t === '--data-urlencode') {
                    req.body = (req.body === null ? '' : req.body + '&') + (tokens[++i] || '');
                }
                else if (t === '-F' || t === '--form') { req.form.push(tokens[++i] || ''); }
                else if (t === '-u' || t === '--user') {
                    req.headers['Authorization'] = 'Basic ' + btoa(tokens[++i] || '');
                }
                else if (t === '-b' || t === '--cookie') { req.headers['Cookie'] = tokens[++i] || ''; }
                else if (t === '-A' || t === '--user-agent') { req.headers['User-Agent'] = tokens[++i] || ''; }
                else if (t === '-e' || t === '--referer') { req.headers['Referer'] = tokens[++i] || ''; }
                else if (t === '-k' || t === '--insecure') { req.insecure = true; }
                else if (t === '-I' || t === '--head') { req.method = 'HEAD'; }
                else if (t === '-G' || t === '--get') { req.method = 'GET'; }
                else if (t === '-L' || t === '--location' || t === '-s' || t === '--silent' ||
                         t === '-S' || t === '--show-error' || t === '-v' || t === '--verbose' ||
                         t === '--compressed' || t === '-f' || t === '--fail') { /* no effect on the request */ }
                else if (t === '-o' || t === '--output' || t === '--max-time' || t === '--connect-timeout' ||
                         t === '--retry' || t === '-w' || t === '--write-out') { i++; }
                else if (t.charAt(0) !== '-' && !req.url) { req.url = t; }
            }

            if (!req.url) throw new Error('No URL found in that command.');

            if (!req.method) {
                req.method = (req.body !== null || req.form.length) ? 'POST' : 'GET';
            }
            req.method = req.method.toUpperCase();

            return req;
        }

        function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
        function pyq(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

        /* If the body is JSON, emit it as a real object rather than a string
           literal - that is what you actually want in the editor. */
        function bodyAsJson(req) {
            var type = req.headers['Content-Type'] || req.headers['content-type'] || '';
            if (req.body === null || type.indexOf('json') === -1) return null;
            try { return JSON.parse(req.body); } catch (e) { return null; }
        }

        function toFetch(req) {
            var lines = [];
            var opts = ['  method: ' + q(req.method)];

            var headerKeys = Object.keys(req.headers);
            if (headerKeys.length) {
                opts.push('  headers: {\n' + headerKeys.map(function (k) {
                    return '    ' + q(k) + ': ' + q(req.headers[k]);
                }).join(',\n') + '\n  }');
            }

            var json = bodyAsJson(req);
            if (json !== null) {
                opts.push('  body: JSON.stringify(' + JSON.stringify(json, null, 2).replace(/\n/g, '\n  ') + ')');
            } else if (req.body !== null) {
                opts.push('  body: ' + q(req.body));
            }

            lines.push('const response = await fetch(' + q(req.url) + ', {');
            lines.push(opts.join(',\n'));
            lines.push('});');
            lines.push('');
            lines.push('if (!response.ok) throw new Error(`HTTP ${response.status}`);');
            lines.push('const data = await response.json();');
            return lines.join('\n');
        }

        function toAxios(req) {
            var cfg = ['  method: ' + q(req.method.toLowerCase()), '  url: ' + q(req.url)];

            var headerKeys = Object.keys(req.headers);
            if (headerKeys.length) {
                cfg.push('  headers: {\n' + headerKeys.map(function (k) {
                    return '    ' + q(k) + ': ' + q(req.headers[k]);
                }).join(',\n') + '\n  }');
            }

            var json = bodyAsJson(req);
            if (json !== null) {
                cfg.push('  data: ' + JSON.stringify(json, null, 2).replace(/\n/g, '\n  '));
            } else if (req.body !== null) {
                cfg.push('  data: ' + q(req.body));
            }

            return "import axios from 'axios';\n\nconst { data } = await axios({\n" + cfg.join(',\n') + '\n});';
        }

        function toPython(req) {
            var lines = ['import requests', ''];
            var args = [pyq(req.url)];

            var headerKeys = Object.keys(req.headers);
            if (headerKeys.length) {
                lines.push('headers = {');
                headerKeys.forEach(function (k) {
                    lines.push('    ' + pyq(k) + ': ' + pyq(req.headers[k]) + ',');
                });
                lines.push('}');
                lines.push('');
                args.push('headers=headers');
            }

            var json = bodyAsJson(req);
            if (json !== null) {
                lines.push('payload = ' + JSON.stringify(json, null, 4)
                    .replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None'));
                lines.push('');
                args.push('json=payload');
            } else if (req.body !== null) {
                args.push('data=' + pyq(req.body));
            }

            if (req.insecure) args.push('verify=False');

            lines.push('response = requests.' + req.method.toLowerCase() + '(' + args.join(', ') + ')');
            lines.push('response.raise_for_status()');
            lines.push('data = response.json()');
            return lines.join('\n');
        }

        function render() {
            ctx.remember(input.value);

            if (!input.value.trim()) {
                out.textContent = '';
                Toolbelt.setNote('u-note', '');
                return;
            }

            var req;
            try {
                req = parse(input.value);
            } catch (e) {
                out.textContent = '';
                Toolbelt.setNote('u-note', e.message, 'note-bad');
                return;
            }

            out.textContent = target === 'axios' ? toAxios(req)
                : target === 'python' ? toPython(req)
                : toFetch(req);

            var warnings = [];
            if (req.form.length) warnings.push('multipart -F fields were not converted');
            if (req.insecure && target !== 'python') warnings.push('-k has no equivalent in the browser');

            Toolbelt.setNote('u-note',
                req.method + ' ' + req.url +
                (warnings.length ? ' — note: ' + warnings.join('; ') + '.' : ''),
                warnings.length ? 'note-warn' : 'note-ok');
        }

        Dandy.els('#u-target button').forEach(function (b) {
            b.addEventListener('click', function () {
                target = b.dataset.target;
                Dandy.els('#u-target button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
                render();
            });
        });

        document.getElementById('u-sample').addEventListener('click', function () {
            input.value = "curl 'https://api.example.co.za/v1/invoices' \\\n" +
                "  -X POST \\\n" +
                "  -H 'Content-Type: application/json' \\\n" +
                "  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' \\\n" +
                '  --data-raw \'{"client":"Thandi Mokoena","amount":12247.50,"vat":true}\'';
            render();
        });

        input.addEventListener('input', render);
        render();
    }
});
