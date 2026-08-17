/* Time - epoch, ISO and human dates, always shown in SAST alongside UTC. */

Toolbelt.register({
    id: 'time',
    name: 'Time',
    icon: 'clock',
    hint: 'epoch / SAST',
    keywords: 'time epoch unix timestamp date iso utc sast timezone convert',

    mount: function (stage, ctx) {
        stage.innerHTML =
            Toolbelt.ui.head('Timestamp converter',
                'Paste an epoch in seconds or milliseconds, an ISO string, or anything <code>Date</code> understands. South Africa has no daylight saving, so SAST is always UTC+2 — which is exactly the offset that trips people up when a log is in UTC.') +
            '<div class="tool-bar">' +
                '<button class="btn btn-dark btn-sm" id="t-now">' + Dandy.icon('clock') + 'Now</button>' +
                '<button class="btn btn-sm" id="t-today">Start of today (SAST)</button>' +
                '<span class="spacer"></span>' +
                '<span class="muted" style="font-size:.75rem" id="t-live"></span>' +
            '</div>' +
            '<div class="field"><span>Input</span>' +
                '<input type="text" id="t-in" placeholder="1755331200   ·   2026-08-16T09:00:00Z   ·   16 Aug 2026" spellcheck="false">' +
            '</div>' +
            '<div class="rows" id="t-out"></div>' +
            Toolbelt.ui.note('t-note');

        var input = document.getElementById('t-in');
        var out = document.getElementById('t-out');
        var live = document.getElementById('t-live');

        input.value = ctx.recall('');

        function parse(text) {
            var t = text.trim();
            if (!t) return null;

            // Bare digits are an epoch. 10 digits is seconds, 13 is milliseconds;
            // anything else we judge by magnitude against a sane date range.
            if (/^-?\d+$/.test(t)) {
                var n = parseInt(t, 10);
                if (t.replace('-', '').length >= 12) return { date: new Date(n), unit: 'milliseconds' };
                return { date: new Date(n * 1000), unit: 'seconds' };
            }
            if (/^-?\d+\.\d+$/.test(t)) {
                return { date: new Date(parseFloat(t) * 1000), unit: 'seconds (fractional)' };
            }

            var d = new Date(t);
            return isNaN(d.getTime()) ? null : { date: d, unit: 'date string' };
        }

        function inZone(date, zone) {
            return date.toLocaleString('en-ZA', {
                timeZone: zone, dateStyle: 'full', timeStyle: 'medium'
            });
        }

        function relative(date) {
            var delta = date.getTime() - Date.now();
            var past = delta < 0;
            var abs = Math.abs(delta);
            var units = [['year', 31557600000], ['month', 2629800000], ['day', 86400000],
                         ['hour', 3600000], ['minute', 60000], ['second', 1000]];
            for (var i = 0; i < units.length; i++) {
                var n = Math.floor(abs / units[i][1]);
                if (n >= 1) {
                    var word = n + ' ' + units[i][0] + (n === 1 ? '' : 's');
                    return past ? word + ' ago' : 'in ' + word;
                }
            }
            return 'right now';
        }

        function row(label, value, id) {
            return '<div class="r"><span class="k">' + Dandy.escapeHtml(label) + '</span>' +
                '<span class="v" id="' + id + '">' + Dandy.escapeHtml(value) + '</span>' +
                '<button class="btn btn-sm" data-id="' + id + '">' + Dandy.icon('copy') + '</button></div>';
        }

        function render() {
            ctx.remember(input.value);
            var parsed = parse(input.value);

            if (!parsed) {
                out.innerHTML = '';
                Toolbelt.setNote('t-note', input.value.trim() ? 'Could not read that as a date or an epoch.' : '',
                    'note-bad');
                return;
            }

            var d = parsed.date;
            if (isNaN(d.getTime())) {
                out.innerHTML = '';
                Toolbelt.setNote('t-note', 'That parses to an invalid date.', 'note-bad');
                return;
            }

            var seconds = Math.floor(d.getTime() / 1000);

            out.innerHTML = [
                row('SAST', inZone(d, 'Africa/Johannesburg') + '  (UTC+2)', 't-sast'),
                row('UTC', inZone(d, 'UTC'), 't-utc'),
                row('Your zone', d.toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'medium' }) +
                    '  (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')', 't-local'),
                row('ISO 8601', d.toISOString(), 't-iso'),
                row('Epoch (s)', String(seconds), 't-secs'),
                row('Epoch (ms)', String(d.getTime()), 't-ms'),
                row('RFC 2822', d.toUTCString(), 't-rfc'),
                row('Relative', relative(d), 't-rel')
            ].join('');

            Dandy.hydrateIcons(out);
            Dandy.els('[data-id]', out).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    Dandy.copy(document.getElementById(btn.dataset.id).textContent.trim());
                });
            });

            Toolbelt.setNote('t-note', 'Read as ' + parsed.unit + '.', 'note-ok');
        }

        document.getElementById('t-now').addEventListener('click', function () {
            input.value = String(Math.floor(Date.now() / 1000));
            render();
        });

        document.getElementById('t-today').addEventListener('click', function () {
            // Midnight SAST expressed as an instant, regardless of where the user is.
            var parts = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
            input.value = parts + 'T00:00:00+02:00';
            render();
        });

        var ticker = setInterval(function () {
            if (!document.body.contains(live)) { clearInterval(ticker); return; }
            live.textContent = 'Now in SAST: ' + new Date().toLocaleTimeString('en-ZA', {
                timeZone: 'Africa/Johannesburg', hour12: false
            });
        }, 1000);

        input.addEventListener('input', render);
        render();
    }
});
