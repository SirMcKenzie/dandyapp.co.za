/* Base64 / URL encoding, both directions, UTF-8 safe. */

Toolbelt.register({
    id: 'base64',
    name: 'Base64 & URL',
    icon: 'link',
    hint: 'encode / decode',
    keywords: 'base64 b64 url encode decode uri escape percent data uri',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('Base64 & URL',
                'Handles UTF-8 properly (so emoji and accented names survive the trip) and understands URL-safe Base64 with the <code>-</code>/<code>_</code> alphabet.') +
            '<div class="tool-bar">' +
                '<div class="segmented" id="b-alg">' +
                    '<button type="button" data-alg="base64" aria-pressed="true">Base64</button>' +
                    '<button type="button" data-alg="base64url" aria-pressed="false">Base64 URL-safe</button>' +
                    '<button type="button" data-alg="uri" aria-pressed="false">URL component</button>' +
                '</div>' +
                '<div class="segmented" id="b-dir">' +
                    '<button type="button" data-dir="auto" aria-pressed="true">Auto</button>' +
                    '<button type="button" data-dir="encode" aria-pressed="false">Encode</button>' +
                    '<button type="button" data-dir="decode" aria-pressed="false">Decode</button>' +
                '</div>' +
                '<span class="spacer"></span>' +
                '<button class="btn btn-sm" id="b-swap">' + Dandy.icon('refresh') + 'Send output to input</button>' +
            '</div>' +
            '<div class="io split">' +
                Toolbelt.ui.input('b-in', 'Input', 'Paste text or an encoded string', 12) +
                Toolbelt.ui.output('b-out', 'Output', 'Result appears here') +
            '</div>' +
            Toolbelt.ui.note('b-note');

        var input = document.getElementById('b-in');
        var out = document.getElementById('b-out');
        var alg = 'base64';
        var dir = 'auto';

        input.value = ctx.recall('');

        function encodeB64(text, urlSafe) {
            var bytes = new TextEncoder().encode(text);
            var binary = '';
            for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            var b64 = btoa(binary);
            return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
        }

        function decodeB64(text) {
            var s = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
            while (s.length % 4) s += '=';
            var binary = atob(s);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }

        /* Auto mode guesses direction. Base64 is the ambiguous case - plain words
           like "test" are valid Base64 - so we only call it "encoded" when the
           string is long enough and decodes to something printable. */
        function guess(text) {
            var t = text.trim();
            if (alg === 'uri') return /%[0-9A-Fa-f]{2}/.test(t) ? 'decode' : 'encode';
            if (t.length < 8 || !/^[A-Za-z0-9+/\-_\s]+=*$/.test(t)) return 'encode';
            try {
                var decoded = decodeB64(t);
                return /[\x00-\x08\x0e-\x1f]/.test(decoded) ? 'encode' : 'decode';
            } catch (e) {
                return 'encode';
            }
        }

        function render() {
            var text = input.value;
            ctx.remember(text);

            if (!text) {
                out.textContent = '';
                Toolbelt.setNote('b-note', '');
                return;
            }

            var direction = dir === 'auto' ? guess(text) : dir;

            try {
                if (alg === 'uri') {
                    out.textContent = direction === 'encode'
                        ? encodeURIComponent(text)
                        : decodeURIComponent(text.trim());
                } else {
                    out.textContent = direction === 'encode'
                        ? encodeB64(text, alg === 'base64url')
                        : decodeB64(text);
                }
                Toolbelt.setNote('b-note',
                    (direction === 'encode' ? 'Encoded' : 'Decoded') +
                    (dir === 'auto' ? ' (direction detected automatically)' : '') +
                    ' — ' + out.textContent.length.toLocaleString('en-ZA') + ' characters out.', 'note-ok');
            } catch (e) {
                out.textContent = '';
                Toolbelt.setNote('b-note',
                    direction === 'decode'
                        ? 'That is not valid ' + (alg === 'uri' ? 'percent-encoded text' : 'Base64') + '.'
                        : e.message,
                    'note-bad');
            }
        }

        Dandy.els('#b-alg button').forEach(function (b) {
            b.addEventListener('click', function () {
                alg = b.dataset.alg;
                Dandy.els('#b-alg button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
                render();
            });
        });

        Dandy.els('#b-dir button').forEach(function (b) {
            b.addEventListener('click', function () {
                dir = b.dataset.dir;
                Dandy.els('#b-dir button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
                render();
            });
        });

        document.getElementById('b-swap').addEventListener('click', function () {
            if (!out.textContent) { Dandy.toast('Nothing to send'); return; }
            input.value = out.textContent;
            render();
        });

        input.addEventListener('input', render);
        render();
    }
});
