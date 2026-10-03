/* ==========================================================================
   Images - template background images.

   - optimise(): shrinks an upload so it costs little to store and print.
   - A small in-memory cache, so the (synchronous) page renderer can find an
     image by id. DB fills it when a template is loaded.
   - The size budget, and the colour maths behind the designer's contrast check.

   Images are kept as data URLs in their own table (see db.js) so they survive
   JSON backups, the same way uploaded fonts do.
   ========================================================================== */

var Images = (function () {
    'use strict';

    var MAX_EDGE = 1600;                    // px on the long side: about 190 dpi on A4
    var QUALITY = 0.8;
    var MAX_UPLOAD = 10 * 1024 * 1024;      // refuse anything bigger before even trying
    var SVG_MAX = 200 * 1024;
    var SOFT = 750 * 1024;                  // above this a template gets a warning
    var HARD = 3 * 1024 * 1024;             // above this it cannot be saved
    var ACCEPT = ['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg+xml'];
    var PAGE = { w: 210, h: 297 };

    var cache = {};
    var urls = {};          // id -> blob: address of the picture

    /* The page markup refers to a picture by a short blob: address, not by its multi-megabyte
       data URL, so redrawing the preview on every keystroke stays cheap. */
    function blobUrl(dataUrl) {
        var mime = /^data:([^;,]+)/.exec(dataUrl)[1];
        var bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
    }

    function remember(row) {
        if (!row || !row.id) return;
        if (cache[row.id] && cache[row.id].dataUrl === row.dataUrl) return;
        forget(row.id);
        cache[row.id] = row;
        try { urls[row.id] = blobUrl(row.dataUrl); } catch (e) { /* unreadable picture: it simply does not render */ }
    }

    function forget(id) {
        if (urls[id]) URL.revokeObjectURL(urls[id]);
        delete urls[id];
        delete cache[id];
    }

    /* After a backup replaced the stored pictures, nothing in memory can be trusted. */
    function clear() { Object.keys(cache).forEach(forget); }

    function get(id) { return cache[id] || null; }
    function url(id) { return urls[id] || ''; }

    function newId() { return 'img_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

    /* Bytes the file would take if saved, from a base64 data URL. */
    function bytesOf(dataUrl) {
        var i = dataUrl.indexOf(',');
        var len = dataUrl.length - i - 1;
        var pad = dataUrl.slice(-2) === '==' ? 2 : dataUrl.slice(-1) === '=' ? 1 : 0;
        return Math.max(0, (len / 4) * 3 - pad);
    }

    /* --- Upload and optimise --------------------------------------------------------------- */

    function readAsDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(new Error('Could not read that file.')); };
            r.readAsDataURL(blob);
        });
    }

    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('That file is not an image this browser can open.')); };
            img.src = src;
        });
    }

    function toBlob(canvas, type, quality) {
        return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
    }

    function hasTransparency(ctx, w, h) {
        var data = ctx.getImageData(0, 0, w, h).data;
        for (var i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
        return false;
    }

    /* Resolves to a row for the images table: { id, dataUrl, bytes, w, h, name }. */
    function optimise(file) {
        var kind = (file.type || '').replace(/^image\//, '');
        if (ACCEPT.indexOf(kind) === -1) return Promise.reject(new Error('Use a PNG, JPG, WebP, GIF, AVIF, BMP or SVG image.'));
        if (file.size > MAX_UPLOAD) return Promise.reject(new Error('That image is over 10 MB. Use a smaller one.'));
        var name = (file.name || 'Image').replace(/\.[^.]+$/, '').slice(0, 60);

        if (kind === 'svg+xml') {
            if (file.size > SVG_MAX) return Promise.reject(new Error('That SVG is over 200 KB. Export it as a PNG or JPG instead.'));
            return readAsDataUrl(file).then(function (dataUrl) {
                return loadImage(dataUrl).then(function (img) {
                    return { id: newId(), dataUrl: dataUrl, bytes: bytesOf(dataUrl), w: img.naturalWidth || 300, h: img.naturalHeight || 300, name: name };
                });
            });
        }

        var objectUrl = URL.createObjectURL(file);
        return loadImage(objectUrl).then(function (img) {
            var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
            var w = Math.max(1, Math.round(img.naturalWidth * scale));
            var h = Math.max(1, Math.round(img.naturalHeight * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var transparent = kind !== 'jpeg' && hasTransparency(ctx, w, h);

            return toBlob(canvas, 'image/webp', QUALITY).then(function (blob) {
                // Some browsers cannot write WebP and hand back a PNG instead.
                if (!blob || blob.type !== 'image/webp') {
                    return transparent ? toBlob(canvas, 'image/png') : toBlob(canvas, 'image/jpeg', 0.82);
                }
                return blob;
            }).then(function (blob) {
                // Never make a small, untouched file bigger.
                var keep = scale === 1 && file.size <= blob.size && /^image\/(png|jpeg|webp)$/.test(file.type);
                return readAsDataUrl(keep ? file : blob).then(function (dataUrl) {
                    return { id: newId(), dataUrl: dataUrl, bytes: bytesOf(dataUrl), w: w, h: h, name: name };
                });
            });
        }).then(function (row) {
            URL.revokeObjectURL(objectUrl);
            return row;
        }, function (err) {
            URL.revokeObjectURL(objectUrl);
            throw err;
        });
    }

    /* --- The size budget ------------------------------------------------------------------- */

    /* Bytes of every distinct image a background uses. */
    function usage(bg) {
        var seen = {}, total = 0;
        ((bg && bg.layers) || []).forEach(function (l) {
            if (seen[l.imageId]) return;
            seen[l.imageId] = true;
            if (cache[l.imageId]) total += cache[l.imageId].bytes;
        });
        return total;
    }

    function budget(bytes) {
        return { bytes: bytes, soft: SOFT, hard: HARD, level: bytes > HARD ? 'block' : bytes > SOFT ? 'warn' : 'ok' };
    }

    function formatBytes(n) {
        if (n < 1024) return Math.round(n) + ' B';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    /* --- Colour and contrast ---------------------------------------------------------------- */

    function parseHex(hex) {
        var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
        return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 255, b: 255 };
    }

    function channel(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

    function luminance(c) { return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b); }

    /* WCAG contrast ratio, 1 to 21. */
    function ratio(a, b) {
        var la = luminance(a), lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    /* good: comfortably readable. close: near the 4.5:1 line, so check it by eye. bad: hard to read. */
    function level(r) { return r >= 5 ? 'good' : r >= 4 ? 'close' : 'bad'; }

    /* Where a layer's picture lands inside its box (object-fit, centred). */
    function fitRect(iw, ih, l) {
        var s = l.fit === 'contain' ? Math.min(l.w / iw, l.h / ih) : Math.max(l.w / iw, l.h / ih);
        var dw = iw * s, dh = ih * s;
        return { x: l.x + (l.w - dw) / 2, y: l.y + (l.h - dh) / 2, w: dw, h: dh };
    }

    /* Paint the page background at 1 pixel per millimetre, then answer "what is the average
       colour behind this box?" for any rectangle in page millimetres. */
    function sampler(bg) {
        var base = parseHex(bg.color);
        var flat = function () { return base; };
        if (!bg.layers.length) return Promise.resolve(flat);

        return Promise.all(bg.layers.map(function (l) {
            var src = url(l.imageId);
            return src ? loadImage(src).catch(function () { return null; }) : Promise.resolve(null);
        })).then(function (imgs) {
            var canvas = document.createElement('canvas');
            canvas.width = PAGE.w; canvas.height = PAGE.h;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = bg.color;
            ctx.fillRect(0, 0, PAGE.w, PAGE.h);
            bg.layers.forEach(function (l, i) {
                var img = imgs[i];
                if (!img) return;
                var d = fitRect(img.naturalWidth || l.w, img.naturalHeight || l.h, l);
                ctx.save();
                ctx.globalAlpha = l.opacity;
                ctx.beginPath(); ctx.rect(l.x, l.y, l.w, l.h); ctx.clip();
                ctx.drawImage(img, d.x, d.y, d.w, d.h);
                ctx.restore();
            });
            return function (rect) {
                try {
                    var x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
                    var w = Math.max(1, Math.min(PAGE.w - x, Math.ceil(rect.w)));
                    var h = Math.max(1, Math.min(PAGE.h - y, Math.ceil(rect.h)));
                    var data = ctx.getImageData(x, y, w, h).data;
                    var r = 0, g = 0, b = 0, n = 0;
                    for (var i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
                    return n ? { r: r / n, g: g / n, b: b / n } : base;
                } catch (e) {
                    return base;        // a picture the browser will not let us read: judge by the colour alone
                }
            };
        });
    }

    return {
        ACCEPT: ACCEPT, SOFT: SOFT, HARD: HARD,
        remember: remember, forget: forget, clear: clear, get: get, url: url,
        optimise: optimise, bytesOf: bytesOf, usage: usage, budget: budget, formatBytes: formatBytes,
        parseHex: parseHex, ratio: ratio, level: level, sampler: sampler
    };
})();
