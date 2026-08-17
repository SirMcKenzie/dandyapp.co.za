<div align="center">

<br>

# DANDY**APP**

### Fast, private, browser-only tools for South African developers

*Decode a token. Quote a job. Send the invoice.*<br>
No accounts, no ads, no uploads, no build step.

<br>

<a href="https://www.matthewmckenzie.co.za">
  <img src="https://img.shields.io/badge/PORTFOLIO-Matthew%20McKenzie-111827?style=for-the-badge&labelColor=09090b&logoColor=white" alt="Matthew McKenzie - Portfolio">
</a>
&nbsp;&nbsp;
<a href="https://www.strkr.co.za">
  <img src="https://img.shields.io/badge/BUILT%20BY-STRKR%20Studio-f8fafc?style=for-the-badge&labelColor=27272a&logoColor=white" alt="STRKR Studio - Web Design Agency">
</a>

<br><br>

**[dandyapp.co.za](https://dandyapp.co.za)** &nbsp;·&nbsp; **[Portfolio](https://www.matthewmckenzie.co.za)** &nbsp;·&nbsp; **[STRKR Studio](https://www.strkr.co.za)**

<br>

![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-no%20framework-f7df1e?style=flat-square&labelColor=111827)
![No build step](https://img.shields.io/badge/Build%20step-none-16a34a?style=flat-square&labelColor=111827)
![Zero dependencies](https://img.shields.io/badge/Dependencies-zero-6b7280?style=flat-square&labelColor=111827)
![Privacy](https://img.shields.io/badge/Data-never%20leaves%20the%20browser-dc2626?style=flat-square&labelColor=111827)

</div>

<br>

---

## What this is

DANDYAPP is a three-tool static site at [dandyapp.co.za](https://dandyapp.co.za). Each tool exists because the free alternative is slower, buried in ads, or quietly posts your data to a server you don't control.

There is no backend. Every tool is JavaScript running in the visitor's tab, so pasted tokens, client names and invoice totals are never transmitted anywhere. Turn off Wi-Fi and the whole site still works.

| | Tool | What it does |
|---|---|---|
| **01** | [Dev Toolbelt](https://dandyapp.co.za/toolbelt/) | Ten everyday utilities behind one keystroke |
| **02** | [Quote Builder](https://dandyapp.co.za/quote/) | Quote a job in under a minute, then convert it to an invoice |
| **03** | [Invoice Generator](https://dandyapp.co.za/invoice/) | A SARS-compliant South African tax invoice with a print-perfect A4 PDF |

<br>

## Why it was built

Three separate itches, one codebase:

**The daily dev tools were scattered.** Formatting JSON, decoding a JWT, generating a UUID and converting an epoch each meant a different ad-heavy site, and every one of them took a paste of data that shouldn't leave the machine. The toolbelt puts all ten on one page behind `Cmd+K`, with nothing leaving the tab.

**Invoicing tools don't understand South Africa.** Generic invoice generators produce a document that looks like an invoice but isn't a valid *tax* invoice, which means the recipient can't claim the input VAT. DANDYAPP models the VAT Act's requirements directly: 15% VAT inclusive or exclusive, the R5 000 full-tax-invoice threshold, and a live compliance panel that names each missing field rather than letting you discover the problem after the client has the PDF.

**Quoting and invoicing are the same document twice.** A quote that's accepted should become an invoice without retyping it. One quote-to-invoice conversion carries the lines across, drops the extras the client declined, and references the original quote number.

<br>

## Tool detail

### 01 - Dev Toolbelt

Ten tools, one page, hash-routed (`/toolbelt/#jwt`). `Cmd/Ctrl+K` opens the command palette; `/` focuses the filter. Every tool's input is remembered in local storage, so a stray reload doesn't cost you a half-built regex.

| Tool | Notes |
|---|---|
| **JSON** | Format, minify, validate with the exact error position, sort keys, collapsible tree |
| **JWT** | Decode header, payload and signature, with the time claims humanised |
| **Base64 & URL** | Both encodings, both directions, UTF-8 safe |
| **Hash** | MD5, SHA-1, SHA-256, SHA-384, SHA-512, for text or a local file |
| **IDs** | UUID v4, UUID v7, ULID, nanoid, plus a bulk generator |
| **Time** | Epoch, ISO and human dates, always shown in SAST alongside UTC |
| **Regex** | Live highlighting, capture groups, and South African presets (ID number, mobile, VAT number, postal code) |
| **Diff** | Line-level LCS comparison of two blocks of text |
| **Case & Slug** | camel, kebab, snake, title, slug, from one input |
| **cURL** | Turn a pasted cURL command into `fetch`, axios or Python `requests` |

### 02 - Quote Builder

Reusable service presets, optional line items the client can accept or decline, a deposit percentage on acceptance, valid-until dates, and one-click conversion into an invoice.

### 03 - Invoice Generator

SARS tax-invoice fields, 15% VAT (inclusive, exclusive, or none), a saved business profile with logo and banking details, a client book that remembers who you've billed, ZAR / USD / EUR / GBP / AUD, and a print stylesheet that turns the live preview into a clean A4 PDF via the browser's own print dialog. Money is stored and calculated as integer cents throughout, because an invoice that's out by a cent is an invoice you have to reissue.

<br>

## How it's built

No framework, no bundler, no package manager, no CSS pipeline, no icon font, no analytics. Just HTML, one design-system stylesheet, and a handful of scripts. Pages paint immediately, even on a bad mobile connection. The only render-blocking external request is the Poppins webfont.

```
.
├── index.html              # Landing page
├── toolbelt/index.html     # Tool 01
├── quote/index.html        # Tool 02
├── invoice/index.html      # Tool 03
├── css/
│   ├── dandy.css           # Design system - tokens, layout, header, footer
│   ├── toolbelt.css        # Toolbelt rail, stage, command palette
│   └── doc.css             # Document editor + the A4 print stylesheet
├── js/
│   ├── core.js             # Storage, inline SVG icons, toast, copy, reveal, mobile nav
│   ├── billing.js          # Pure billing model - money, totals, VAT, compliance
│   ├── doc-editor.js       # Shared editor driving both /quote/ and /invoice/
│   └── toolbelt/
│       ├── index.js        # Registry, hash routing, filter, Cmd+K palette
│       └── *.js            # One self-contained module per tool
├── assets/                 # Favicon + hero background
├── robots.txt
└── sitemap.xml
```

**Design notes worth knowing before editing:**

- `js/core.js` exposes a single `Dandy` global (storage, icons, toast, copy, download, escaping). It loads on every page and hydrates `<i data-icon="name">` into inline SVG, which is why there's no icon font.
- `Dandy.Store` namespaces everything under `dandy.v1.` and degrades to an in-memory object when local storage is unavailable (Safari private browsing) or full. Because that storage is volatile, every document page offers **Export backup** / **Import backup** as a JSON file.
- `js/billing.js` is pure data and arithmetic - no DOM, no rendering. All money is integer cents.
- `js/doc-editor.js` is one implementation serving both `/quote/` and `/invoice/`. The `kind` decides labels, which panels show, and which actions are offered; the line engine, totals, client book and printed sheet are shared.
- Each toolbelt module calls `Toolbelt.register()` and knows nothing about the rail, the palette or persistence. It receives a DOM node to fill and a namespaced `remember`/`recall` pair.
- The mobile drawer is generated at runtime from each page's own `.pill-nav`, so the two navigations can't drift apart.

<br>

## Running it locally

There's nothing to install and nothing to build. Clone it and serve the folder:

```bash
git clone <repo-url> dandyapp-website
cd dandyapp-website

python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>.

Opening `index.html` straight off the filesystem mostly works too, but `file://` isn't a secure context, so the clipboard falls back to the legacy copy path and hashing needs `crypto.subtle` over http(s).

### Deploying

Upload the folder to any static host. There is no server-side component, no environment configuration and no database. If the domain changes, update the absolute URLs in `sitemap.xml`, `robots.txt` and the `canonical` / `og:url` tags in each page's `<head>`.

<br>

## Disclaimer

DANDYAPP does not provide financial, tax or legal advice. The invoice and quote templates aim to reflect the South African VAT Act's tax-invoice requirements, but you remain responsible for confirming that any document you issue is correct and complete for your circumstances.

<br>

---

<div align="center">

<br>

**Designed and built by [Matthew McKenzie](https://www.matthewmckenzie.co.za)**<br>
through **[STRKR Studio](https://www.strkr.co.za)**, a South African web design agency.

<br>

<a href="https://www.matthewmckenzie.co.za">
  <img src="https://img.shields.io/badge/matthewmckenzie.co.za-111827?style=for-the-badge&labelColor=09090b" alt="matthewmckenzie.co.za">
</a>
&nbsp;
<a href="https://www.strkr.co.za">
  <img src="https://img.shields.io/badge/strkr.co.za-27272a?style=for-the-badge&labelColor=09090b" alt="strkr.co.za">
</a>

<br><br>

Copyright © 2026 DANDYAPP. All rights reserved.

</div>
