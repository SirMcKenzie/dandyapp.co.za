/* JWT - decode header/payload/signature and humanise the time claims. */

Toolbelt.register({
    id: 'jwt',
    name: 'JWT',
    icon: 'key',
    hint: 'decode token',
    keywords: 'jwt json web token decode bearer auth claims exp',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('JWT decoder',
                'Paste a token (with or without the <code>Bearer</code> prefix). Time claims are shown in SAST and as plain English, so you can see at a glance whether it is still alive.') +
            '<p class="note note-warn mb-2"><i data-icon="alert"></i><span>This decodes only — it does not verify the signature, which would need your secret or public key. Never trust an unverified token server-side.</span></p>' +
            '<div class="io">' +
                Toolbelt.ui.input('w-in', 'Token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…', 4) +
            '</div>' +
            '<div id="w-status" class="mt-2"></div>' +
            '<div class="io split mt-2">' +
                Toolbelt.ui.output('w-head', 'Header', 'Header appears here') +
                Toolbelt.ui.output('w-body', 'Payload', 'Payload appears here') +
            '</div>' +
            '<div class="mt-3" id="w-claims"></div>' +
            '<div class="io mt-3">' +
                Toolbelt.ui.output('w-sig', 'Signature (base64url, not verified)', 'Signature appears here') +
            '</div>' +
            Toolbelt.ui.note('w-note');

        var input = document.getElementById('w-in');
        var status = document.getElementById('w-status');
        var claimsBox = document.getElementById('w-claims');

        input.value = ctx.recall('');

        function b64urlDecode(segment) {
            var s = segment.replace(/-/g, '+').replace(/_/g, '/');
            while (s.length % 4) s += '=';
            var binary = atob(s);
            // atob gives bytes; re-read them as UTF-8 so non-ASCII claims survive.
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder('utf-8').decode(bytes);
        }

        function sast(seconds) {
            return new Date(seconds * 1000).toLocaleString('en-ZA', {
                timeZone: 'Africa/Johannesburg',
                dateStyle: 'medium', timeStyle: 'medium'
            });
        }

        function relative(seconds) {
            var delta = seconds * 1000 - Date.now();
            var past = delta < 0;
            var abs = Math.abs(delta);
            var units = [['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]];
            for (var i = 0; i < units.length; i++) {
                var n = Math.floor(abs / units[i][1]);
                if (n >= 1) {
                    var word = n + ' ' + units[i][0] + (n === 1 ? '' : 's');
                    return past ? word + ' ago' : 'in ' + word;
                }
            }
            return past ? 'just now' : 'in under a second';
        }

        var TIME_CLAIMS = { exp: 'Expires', iat: 'Issued at', nbf: 'Not before', auth_time: 'Authenticated' };
        var NAMED = {
            iss: 'Issuer', sub: 'Subject', aud: 'Audience', jti: 'JWT ID',
            scope: 'Scope', azp: 'Authorised party', typ: 'Type', role: 'Role', roles: 'Roles'
        };

        function renderClaims(payload) {
            var keys = Object.keys(payload);
            if (!keys.length) { claimsBox.innerHTML = ''; return; }

            var rows = keys.map(function (k) {
                var v = payload[k];
                var label = TIME_CLAIMS[k] || NAMED[k] || k;
                var value;

                if (TIME_CLAIMS[k] && typeof v === 'number') {
                    value = Dandy.escapeHtml(sast(v)) + ' SAST <span class="faint">· ' +
                        Dandy.escapeHtml(relative(v)) + '</span>';
                } else if (v !== null && typeof v === 'object') {
                    value = Dandy.escapeHtml(JSON.stringify(v));
                } else {
                    value = Dandy.escapeHtml(String(v));
                }

                return '<div class="r"><span class="k">' + Dandy.escapeHtml(label) + '</span>' +
                    '<span class="v multi">' + value + '</span></div>';
            }).join('');

            claimsBox.innerHTML = '<div class="io-label"><span>Claims</span></div><div class="rows">' + rows + '</div>';
        }

        function render() {
            var raw = input.value.trim().replace(/^Bearer\s+/i, '');
            ctx.remember(input.value);

            var head = document.getElementById('w-head');
            var body = document.getElementById('w-body');
            var sig = document.getElementById('w-sig');

            head.textContent = body.textContent = sig.textContent = '';
            status.innerHTML = '';
            claimsBox.innerHTML = '';

            if (!raw) { Toolbelt.setNote('w-note', ''); return; }

            var parts = raw.split('.');
            if (parts.length !== 3) {
                Toolbelt.setNote('w-note',
                    'A JWT has three dot-separated parts. This one has ' + parts.length + '.', 'note-bad');
                return;
            }

            var header, payload;
            try {
                header = JSON.parse(b64urlDecode(parts[0]));
                payload = JSON.parse(b64urlDecode(parts[1]));
            } catch (e) {
                Toolbelt.setNote('w-note', 'Could not decode that token: ' + e.message, 'note-bad');
                return;
            }

            head.textContent = JSON.stringify(header, null, 2);
            body.textContent = JSON.stringify(payload, null, 2);
            sig.textContent = parts[2];

            renderClaims(payload);

            var chips = [];
            if (header.alg) chips.push('<span class="tag tag-neutral">alg ' + Dandy.escapeHtml(header.alg) + '</span>');
            if (header.kid) chips.push('<span class="tag tag-neutral">kid ' + Dandy.escapeHtml(String(header.kid)) + '</span>');

            if (typeof payload.exp === 'number') {
                var expired = payload.exp * 1000 <= Date.now();
                chips.push('<span class="tag ' + (expired ? 'tag-bad' : 'tag-ok') + '">' +
                    (expired ? 'Expired ' : 'Valid, expires ') + Dandy.escapeHtml(relative(payload.exp)) + '</span>');
            } else {
                chips.push('<span class="tag tag-neutral">No expiry claim</span>');
            }

            if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) {
                chips.push('<span class="tag tag-bad">Not valid yet, starts ' + Dandy.escapeHtml(relative(payload.nbf)) + '</span>');
            }

            if (header.alg === 'none') {
                chips.push('<span class="tag tag-bad">alg: none — unsigned</span>');
            }

            status.innerHTML = '<div class="row">' + chips.join('') + '</div>';
            Toolbelt.setNote('w-note', '');
        }

        input.addEventListener('input', render);
        render();
    }
});
