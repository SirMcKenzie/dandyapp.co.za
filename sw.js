/* ==========================================================================
   DANDYAPP service worker - makes the app installable and usable offline.

   Network first: online, you always get the latest files straight from the
   server, so a deploy is never hidden behind a stale cache. The cache is only
   a fallback for when the network is unreachable. Nothing here touches your
   invoices; they live in IndexedDB, not in this cache.
   ========================================================================== */

var CACHE = 'dandyapp-v3';

/* After this long without an answer from the network, a cached copy (if there is one) is used
   instead, so a stalled connection does not hang the app. */
var NETWORK_TIMEOUT = 4000;

/* Fonts the default templates use. The page links only some of them, so list the rest here:
   offline, layout is measured and printed with the real fonts or the pages come out wrong. */
var PRECACHE_FONTS = []
    .concat([300, 400, 500, 600, 700, 800, 900].map(function (w) { return 'poppins-latin-' + w + '-normal.woff2'; }))
    .concat(['inter', 'dm-sans'].reduce(function (all, f) {
        return all.concat([400, 700].map(function (w) { return f + '-latin-' + w + '-normal.woff2'; }));
    }, []))
    .map(function (f) { return '/fonts/' + f; });

/* A plain fetch() may be answered by the browser's HTTP cache, which a host can
   leave "fresh" for days. 'no-cache' makes the browser revalidate with the server
   every time (a cheap conditional request), so online always means up to date.
   `redirect` is passed through because a navigation must not receive a followed redirect. */
function fresh(url, redirect) {
    // Fonts never change under the same name and _headers lets browsers keep them for a month: trust that.
    var cache = new URL(url, self.location.origin).pathname.indexOf('/fonts/') === 0 ? 'default' : 'no-cache';
    return fetch(url, { cache: cache, credentials: 'same-origin', redirect: redirect || 'follow' });
}

/* On install, fetch the page and cache everything it references, so the very
   first offline visit works. Parsing the HTML keeps this list from drifting. */
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return fresh('/').then(function (res) {
                // An error page cached here would become the offline page. Fail the install and retry later.
                if (!res.ok) throw new Error('Could not fetch the home page (' + res.status + ')');
                var copy = res.clone();
                return Promise.all([cache.put('/', copy), res.text()]).then(function (r) {
                    var urls = [];
                    r[1].replace(/(?:src|href)="(\/[^"#?]+)"/g, function (_, u) { if (urls.indexOf(u) === -1) urls.push(u); });
                    PRECACHE_FONTS.forEach(function (u) { if (urls.indexOf(u) === -1) urls.push(u); });
                    return Promise.all(urls.map(function (u) {
                        return fresh(u).then(function (r) { if (r.ok) return cache.put(u, r); })
                            .catch(function () { /* one missing file must not block the rest */ });
                    }));
                });
            });
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var req = event.request;
    var url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/sw.js') return;

    var network = fresh(req.url, req.redirect).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
    });

    var cached = function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
            if (hit) return hit;
            if (req.mode === 'navigate') return caches.match('/');
        });
    };

    // Network first. If it fails, or is too slow and we hold a copy, answer from the cache;
    // the network response still lands in the cache for next time.
    var slow = new Promise(function (resolve) {
        setTimeout(function () { resolve(cached()); }, NETWORK_TIMEOUT);
    });

    event.respondWith(
        Promise.race([network, slow.then(function (hit) { return hit || network; })])
            .catch(function () { return cached().then(function (hit) { return hit || Response.error(); }); })
    );
});
