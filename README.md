# DANDYAPP

A free, private invoicing app for South African businesses. Live at **[www.dandyapp.co.za](https://www.dandyapp.co.za)**.

![DANDYAPP](assets/social-preview.jpg)

## What it does

- **Tax invoices**: 15% VAT added on top, already included, or none. Titled TAX INVOICE or INVOICE to match.
- **SARS checks**: warns while you type if a required detail is missing.
- **Template designer**: drag, resize and recolour every part of the A4 page. Two saved layouts, one active.
- **Fonts**: 13 built-in, or upload your own (.woff2, .woff, .ttf, .otf).
- **Customers**: a customer book with CSV import.
- **Payments**: record part or full payments. Status (draft, sent, part paid, paid, overdue, void) updates itself.
- **Dashboard**: invoiced, received, outstanding and overdue totals, and who owes you.
- **PDF**: Download PDF opens the print dialog, then choose Save as PDF.
- **Currencies**: ZAR, USD, EUR, GBP, AUD.
- **Backup and restore**: one JSON file, from Settings.
- **Works offline**, installs to your home screen, and is laid out for phones.
- **Quick tour** for first-time visitors, shown once. Reopen it from the footer.

## Get started

1. **Settings**: add your business details, banking and logo.
2. **Customers**: add them, or import a CSV.
3. **New invoice**: pick a customer, add lines, click **Download PDF**.
4. **Dashboard**: download a backup now and then.

> [!IMPORTANT]
> Your data lives in your browser, on your device, and is never uploaded. Clearing site data or switching browser or device starts you empty, so back up regularly.

## Limits

Single user, single device. No accounts, no sync, no emailing invoices. English only.

## Run locally

No install and no build step.

```bash
git clone https://github.com/SirMcKenzie/dandyapp.co.za.git
cd dandyapp.co.za
python3 -m http.server 8000   # open http://localhost:8000
```

Deploys to Cloudflare Pages on push to `main`.

## How it is built

Vanilla JS, no framework or bundler. Data is stored in IndexedDB through a vendored copy of Dexie.

```
index.html      App shell
css/            dandy.css (design system), app.css (views, designer, tour, print)
js/billing.js   Money in integer cents, VAT, payments, compliance
js/layout.js    Paginates an invoice into A4 pages
js/components.js  Template boxes and the rules that keep them printable
js/db.js        The only file that touches storage, plus migration and backup
js/locks.js     Cross-tab locks so two tabs never edit the same thing
js/tour.js      First-visit quick tour
js/app.js       Hash router
js/views/       One file per page
sw.js           Service worker (offline, network first)
```

The preview, the PDF and the designer all render through `layout.js`, so what you design is what prints.

---

DANDYAPP does not provide financial, tax or legal advice. You are responsible for confirming every invoice you issue is correct.

Built by [Matthew McKenzie](https://www.matthewmckenzie.co.za) through [STRKR Studio](https://www.strkr.co.za). Copyright 2026 DANDYAPP. All rights reserved.
