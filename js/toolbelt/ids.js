/* IDs - UUID v4, UUID v7, ULID, nanoid, and a bulk generator. */

Toolbelt.register({
    id: 'ids',
    name: 'IDs',
    icon: 'shield',
    hint: 'uuid / ulid',
    keywords: 'uuid guid v4 v7 ulid nanoid random id key generate token',

    mount: function (stage) {
        stage.innerHTML =
            Toolbelt.ui.head('ID generator',
                'All of these come from <code>crypto.getRandomValues</code>, so they are cryptographically random rather than <code>Math.random</code> guesses. Click any value to copy it.') +
            '<div class="tool-bar">' +
                '<div class="segmented" id="i-kind">' +
                    '<button type="button" data-kind="uuid4" aria-pressed="true">UUID v4</button>' +
                    '<button type="button" data-kind="uuid7" aria-pressed="false">UUID v7</button>' +
                    '<button type="button" data-kind="ulid" aria-pressed="false">ULID</button>' +
                    '<button type="button" data-kind="nanoid" aria-pressed="false">nanoid</button>' +
                    '<button type="button" data-kind="hex" aria-pressed="false">Hex secret</button>' +
                '</div>' +
                '<label class="check">Count <input type="number" id="i-count" value="5" min="1" max="500" style="width:5rem;margin-left:.5rem"></label>' +
                '<span class="spacer"></span>' +
                '<button class="btn btn-dark btn-sm" id="i-go">' + Dandy.icon('refresh') + 'Generate</button>' +
                '<button class="btn btn-sm" data-copy="i-all">' + Dandy.icon('copy') + 'Copy all</button>' +
            '</div>' +
            '<p class="note note-info mb-2" id="i-about"></p>' +
            '<div class="rows" id="i-out"></div>' +
            '<textarea id="i-all" class="hidden" aria-hidden="true"></textarea>';

        var out = document.getElementById('i-out');
        var all = document.getElementById('i-all');
        var about = document.getElementById('i-about');
        var countInput = document.getElementById('i-count');
        var kind = 'uuid4';

        var BLURB = {
            uuid4: 'Fully random. The safe default when you just need a unique identifier and do not care about ordering.',
            uuid7: 'Time-ordered UUID: the first 48 bits are a millisecond timestamp, so these sort chronologically. Much kinder to database indexes than v4.',
            ulid: '26 characters, Crockford base32, lexicographically sortable by time. URL-safe and case-insensitive.',
            nanoid: '21 characters from a URL-safe alphabet. Shorter than a UUID with comparable collision resistance.',
            hex: '32 random bytes as hex - a sensible shape for a session secret, webhook signing key or API token.'
        };

        function randomBytes(n) {
            var b = new Uint8Array(n);
            crypto.getRandomValues(b);
            return b;
        }

        function toHex(bytes) {
            var s = '';
            for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
            return s;
        }

        function uuid4() {
            if (crypto.randomUUID) return crypto.randomUUID();
            var b = randomBytes(16);
            b[6] = (b[6] & 0x0f) | 0x40;
            b[8] = (b[8] & 0x3f) | 0x80;
            var h = toHex(b);
            return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
                h.slice(16, 20) + '-' + h.slice(20);
        }

        /* A batch of 500 is generated inside one or two milliseconds, so the
           timestamp alone would not order them. Both v7 and ULID define a
           monotonic mode for exactly this: keep a counter that advances while
           the millisecond does not, so a batch sorts in generation order. */
        var lastMs7 = 0, seq7 = 0;

        function uuid7() {
            var b = randomBytes(16);
            var ms = Date.now();

            if (ms === lastMs7) { seq7 = (seq7 + 1) & 0x0fff; }
            else { lastMs7 = ms; seq7 = 0; }

            // 48-bit big-endian millisecond timestamp in the first six bytes.
            b[0] = Math.floor(ms / 1099511627776) & 0xff;
            b[1] = Math.floor(ms / 4294967296) & 0xff;
            b[2] = Math.floor(ms / 16777216) & 0xff;
            b[3] = Math.floor(ms / 65536) & 0xff;
            b[4] = Math.floor(ms / 256) & 0xff;
            b[5] = ms & 0xff;
            b[6] = 0x70 | ((seq7 >> 8) & 0x0f);   // version 7 + high 4 bits of the counter
            b[7] = seq7 & 0xff;                   // low 8 bits of the counter
            b[8] = (b[8] & 0x3f) | 0x80;          // RFC 9562 variant; bytes 8-15 stay random
            var h = toHex(b);
            return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
                h.slice(16, 20) + '-' + h.slice(20);
        }

        var CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

        var lastMsUlid = 0, lastRand = null;

        function ulid() {
            var now = Date.now();
            var ms = now;
            var time = '';
            for (var i = 9; i >= 0; i--) {
                time = CROCKFORD[ms % 32] + time;
                ms = Math.floor(ms / 32);
            }

            if (now === lastMsUlid && lastRand) {
                // Increment the 80 random bits as a base-32 number, carrying left.
                for (var k = 15; k >= 0; k--) {
                    if (lastRand[k] < 31) { lastRand[k]++; break; }
                    lastRand[k] = 0;
                }
            } else {
                lastMsUlid = now;
                lastRand = [];
                var bytes = randomBytes(16);
                // 256 is an exact multiple of 32, so the modulo is unbiased.
                for (var j = 0; j < 16; j++) lastRand.push(bytes[j] % 32);
            }

            var rand = '';
            for (var m = 0; m < 16; m++) rand += CROCKFORD[lastRand[m]];
            return time + rand;
        }

        var NANO = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

        function nanoid() {
            var bytes = randomBytes(21);
            var s = '';
            for (var i = 0; i < 21; i++) s += NANO[bytes[i] & 63];
            return s;
        }

        function make() {
            switch (kind) {
                case 'uuid7':  return uuid7();
                case 'ulid':   return ulid();
                case 'nanoid': return nanoid();
                case 'hex':    return toHex(randomBytes(32));
                default:       return uuid4();
            }
        }

        function generate() {
            var n = Math.min(Math.max(parseInt(countInput.value, 10) || 1, 1), 500);
            countInput.value = n;

            var values = [];
            for (var i = 0; i < n; i++) values.push(make());

            all.value = values.join('\n');
            about.innerHTML = Dandy.icon('info') + '<span>' + BLURB[kind] + '</span>';

            out.innerHTML = values.map(function (v, i) {
                return '<div class="r"><span class="k">' + (i + 1) + '</span>' +
                    '<span class="v" id="i-v' + i + '">' + Dandy.escapeHtml(v) + '</span>' +
                    '<button class="btn btn-sm" data-id="i-v' + i + '">' + Dandy.icon('copy') + '</button></div>';
            }).join('');

            Dandy.hydrateIcons(out);
            Dandy.els('[data-id]', out).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    Dandy.copy(document.getElementById(btn.dataset.id).textContent);
                });
            });
        }

        Dandy.els('#i-kind button').forEach(function (b) {
            b.addEventListener('click', function () {
                kind = b.dataset.kind;
                Dandy.els('#i-kind button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
                generate();
            });
        });

        document.getElementById('i-go').addEventListener('click', generate);
        countInput.addEventListener('change', generate);

        generate();
    }
});
