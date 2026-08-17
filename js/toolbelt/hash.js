/* Hashes - MD5, SHA-1, SHA-256, SHA-384, SHA-512, for text or a local file. */

Toolbelt.register({
    id: 'hash',
    name: 'Hash',
    icon: 'fingerprint',
    hint: 'md5 / sha',
    keywords: 'hash md5 sha1 sha256 sha512 checksum digest fingerprint file',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('Hash',
                'Checksums for a string or a file on your machine. SHA hashes come from the browser\'s own <code>crypto.subtle</code>; MD5 is computed here because the platform deliberately omits it.') +
            '<div class="tool-bar">' +
                '<div class="segmented" id="h-src">' +
                    '<button type="button" data-src="text" aria-pressed="true">Text</button>' +
                    '<button type="button" data-src="file" aria-pressed="false">File</button>' +
                '</div>' +
                '<span class="spacer"></span>' +
                '<label class="check"><input type="checkbox" id="h-upper"> Uppercase</label>' +
            '</div>' +
            '<div class="io" id="h-text-src">' +
                Toolbelt.ui.input('h-in', 'Text', 'Anything at all', 6) +
            '</div>' +
            '<div class="io hidden" id="h-file-src">' +
                '<div class="io-block">' +
                    '<div class="io-label"><span>File</span></div>' +
                    '<input type="file" id="h-file">' +
                    '<p class="muted mt-1" style="font-size:.75rem">The file is read locally and never uploaded. Large files take a moment.</p>' +
                '</div>' +
            '</div>' +
            '<div class="mt-3"><div class="io-label"><span>Digests</span></div>' +
                '<div class="rows" id="h-out"></div></div>' +
            Toolbelt.ui.note('h-note');

        var input = document.getElementById('h-in');
        var fileInput = document.getElementById('h-file');
        var outBox = document.getElementById('h-out');
        var upper = document.getElementById('h-upper');
        var source = 'text';

        input.value = ctx.recall('');

        /* --- MD5 -----------------------------------------------------------
           SubtleCrypto has no MD5 (by design - it is broken for security).
           It is still the checksum plenty of South African bank files, legacy
           APIs and CDN manifests hand you, so it stays. Never use it for
           anything that needs to resist an attacker.
           ----------------------------------------------------------------- */

        var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                     5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                     4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                     6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

        var MD5_K = (function () {
            var k = new Uint32Array(64);
            for (var i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
            return k;
        })();

        function rotl(x, c) { return ((x << c) | (x >>> (32 - c))) >>> 0; }

        function md5(bytes) {
            var len = bytes.length;
            var total = (Math.floor((len + 8) / 64) + 1) * 64;
            var buf = new Uint8Array(total);
            buf.set(bytes);
            buf[len] = 0x80;

            var bitsLo = (len * 8) >>> 0;
            var bitsHi = Math.floor(len / 536870912) >>> 0;   // len * 8 / 2^32
            var view = new DataView(buf.buffer);
            view.setUint32(total - 8, bitsLo, true);
            view.setUint32(total - 4, bitsHi, true);

            var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
            var M = new Uint32Array(16);

            for (var chunk = 0; chunk < total; chunk += 64) {
                for (var j = 0; j < 16; j++) M[j] = view.getUint32(chunk + j * 4, true);

                var A = a0, B = b0, C = c0, D = d0;

                for (var i = 0; i < 64; i++) {
                    var F, g;
                    if (i < 16)      { F = (B & C) | (~B & D);        g = i; }
                    else if (i < 32) { F = (D & B) | (~D & C);        g = (5 * i + 1) & 15; }
                    else if (i < 48) { F = B ^ C ^ D;                 g = (3 * i + 5) & 15; }
                    else             { F = C ^ (B | ~D);              g = (7 * i) & 15; }

                    F = (F + A + MD5_K[i] + M[g]) >>> 0;
                    A = D; D = C; C = B;
                    B = (B + rotl(F, MD5_S[i])) >>> 0;
                }

                a0 = (a0 + A) >>> 0;
                b0 = (b0 + B) >>> 0;
                c0 = (c0 + C) >>> 0;
                d0 = (d0 + D) >>> 0;
            }

            var out = new Uint8Array(16);
            var ov = new DataView(out.buffer);
            ov.setUint32(0, a0, true); ov.setUint32(4, b0, true);
            ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
            return out;
        }

        function hex(bytes) {
            var s = '';
            for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
            return upper.checked ? s.toUpperCase() : s;
        }

        var ALGOS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

        function digestAll(bytes) {
            var jobs = ALGOS.map(function (name) {
                if (name === 'MD5') return Promise.resolve(hex(md5(bytes)));
                if (!(window.crypto && crypto.subtle)) {
                    return Promise.resolve(null);
                }
                return crypto.subtle.digest(name, bytes).then(function (buf) {
                    return hex(new Uint8Array(buf));
                });
            });
            return Promise.all(jobs);
        }

        var token = 0;

        function run(bytes, label) {
            var mine = ++token;

            if (!bytes || !bytes.length) {
                outBox.innerHTML = '';
                Toolbelt.setNote('h-note', '');
                return;
            }

            digestAll(bytes).then(function (results) {
                if (mine !== token) return;   // a newer input already superseded this

                outBox.innerHTML = ALGOS.map(function (name, i) {
                    var value = results[i];
                    var id = 'h-' + name.replace('-', '').toLowerCase();
                    if (value === null) {
                        return '<div class="r"><span class="k">' + name + '</span>' +
                            '<span class="v faint">Needs a secure context (https)</span></div>';
                    }
                    return '<div class="r"><span class="k">' + name + '</span>' +
                        '<span class="v" id="' + id + '">' + Dandy.escapeHtml(value) + '</span>' +
                        '<button class="btn btn-sm" data-copy="' + id + '">' + Dandy.icon('copy') + '</button></div>';
                }).join('');

                Dandy.hydrateIcons(outBox);
                Dandy.els('[data-copy]', outBox).forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        var el = document.getElementById(btn.dataset.copy);
                        if (el) Dandy.copy(el.textContent);
                    });
                });

                Toolbelt.setNote('h-note',
                    label + ' — ' + bytes.length.toLocaleString('en-ZA') + ' bytes hashed.', 'note-ok');
            }).catch(function (e) {
                if (mine !== token) return;
                Toolbelt.setNote('h-note', 'Hashing failed: ' + e.message, 'note-bad');
            });
        }

        function runText() {
            ctx.remember(input.value);
            run(new TextEncoder().encode(input.value), 'Text');
        }

        function runFile() {
            var file = fileInput.files && fileInput.files[0];
            if (!file) { run(null); return; }
            Toolbelt.setNote('h-note', 'Reading ' + file.name + '…', 'note-info');
            file.arrayBuffer().then(function (buf) {
                run(new Uint8Array(buf), file.name);
            });
        }

        Dandy.els('#h-src button').forEach(function (b) {
            b.addEventListener('click', function () {
                source = b.dataset.src;
                Dandy.els('#h-src button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
                document.getElementById('h-text-src').classList.toggle('hidden', source !== 'text');
                document.getElementById('h-file-src').classList.toggle('hidden', source !== 'file');
                source === 'text' ? runText() : runFile();
            });
        });

        input.addEventListener('input', Dandy.debounce(runText, 120));
        fileInput.addEventListener('change', runFile);
        upper.addEventListener('change', function () { source === 'text' ? runText() : runFile(); });

        runText();
    }
});
