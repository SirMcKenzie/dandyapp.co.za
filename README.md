<div align="center">

<br>

# DANDY**APP**

### A private invoicing app for South African businesses

*Design your template. Keep your customers. Send the invoice. See who owes you.*<br>
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
![Dexie](https://img.shields.io/badge/Storage-Dexie%20%2F%20IndexedDB-6b7280?style=flat-square&labelColor=111827)
![Privacy](https://img.shields.io/badge/Data-never%20leaves%20the%20browser-dc2626?style=flat-square&labelColor=111827)

</div>

<br>

---

## What this is

DANDYAPP is a single-page invoicing app at [dandyapp.co.za](https://dandyapp.co.za). There is no backend: everything runs in the visitor's tab and is stored in the browser's IndexedDB through [Dexie](https://dexie.org), so customer names and invoice totals are never transmitted anywhere. Turn off Wi-Fi and it still works.

| Area | What it does |
|---|---|
| **Dashboard** | Invoiced, received, outstanding and overdue totals for this month, this year or all time, per currency, plus who owes you most |
| **Invoices** | Every invoice stored and searchable, filterable by status and date, with mark-as-sent, void, duplicate and delete |
| **Editor** | Live A4 preview, autosave, line items with reusable presets, SARS compliance warnings, and a payments panel |
| **Customers** | A customer book (name, phone, email, note, plus optional address and VAT number). In an invoice you can type any name, or pick from the book. Customers can be imported from a CSV file |
| **Templates** | A drag-and-drop designer with two saved layout slots (A and B) |
| **Settings** | Business details and banking, which template is active, invoice defaults, and JSON backup / restore |

### Accounting

An invoice is stored as **draft**, **sent** or **void**. Everything else is derived, never stored, so it cannot go stale: **part paid** once a payment exists, **paid** when payments cover the total, and **overdue** when a sent invoice passes its due date with a balance. Recording a payment on a draft marks it as sent.

### Invoice numbers

The next number is always one more than the highest number still in use. Deleting your newest invoice hands its number back to the next new invoice (and deleting several from the end hands back several). Deleting one from the middle leaves a gap, because later invoices already exist and the numbers of existing invoices never shift. **Voiding burns a number for good**: it is recorded the moment an invoice is voided and stays used even if the invoice is un-voided and then deleted. The delete confirmation tells you which of these will happen.

### Your data lives in the browser

The bottom of the dashboard carries a slim, collapsed **Important** banner that opens smoothly. It says the data is stored only in this browser and what erases it (clearing cookies and site data, private windows, a reset browser), and its one-click **Download a backup now** remembers when you last took one and turns the status red when it is over 30 days old. It also carries an **I want permanent storage with your app** button. This site has no analytics, so the button simply opens a page or form you own and you count visits or submissions there. Set its address in `js/config.js` (`permanentStorageUrl`); while that is empty the button explains it is not set up instead of opening a dead page.

### Templates

Invoices store no layout. Every invoice, old and new, is drawn from the **active template**, so editing a layout or switching between A and B re-flows all of them at once.

The designer is a free-form canvas, made safe by rules enforced in one place (`Components.validate` in `js/components.js`), which every template passes through on load, save and edit:

- Positions are in millimetres on the A4 safe area (15 mm margin) and snap to a 5 mm grid.
- A component cannot leave the safe area, overlap another component, or go beyond its minimum and maximum size. An illegal drag snaps back.
- **Line items**, **invoice details**, **business**, **customer** and **totals** are required and cannot be deleted, so a tax invoice never loses a SARS field.
- **Line items** is a full-width band that grows with the number of rows. Everything below it is pushed down, long invoices continue on a new page with the header repeated, and the content below the band moves as one piece, never split.
- A box whose content does not fit is flagged in the designer rather than silently cut off in print.
- A corrupt or outdated template is repaired or replaced with a default, so the renderer never sees invalid geometry.

### Typefaces

Each template stores a **body** font and an optional **heading** font (used for the title, names and the grand total), chosen in the designer's Typeface panel.

- **Built-in:** 13 open-licence families (Poppins, Inter, DM Sans, Montserrat, Open Sans, Lato, Nunito, Source Sans 3, Roboto, Merriweather, Playfair Display, Lora, Roboto Mono), self-hosted in `fonts/` as latin-subset woff2. Nothing is requested from a third party, they work offline, and a browser only downloads the ones in use. Their licences are in `fonts/licenses/`.
- **Your own:** upload a `.woff2`, `.woff`, `.ttf` or `.otf` file (up to 1.5 MB). It is checked by actually loading it, stored in the browser database as a data URL, and included in backups. The user is responsible for being licensed to use it.
- A template stores only font ids. If a font has been deleted, the template falls back to Poppins rather than rendering with a missing face.

### Customer CSV import

*Customers > Import CSV* reads only the columns the app has a place for: name (or company, customer, client, or first name + surname), phone (mobile, cell), email, note (notes, comments), address (or street, city, postal code and similar, joined into one) and VAT number. Before anything is saved it lists the columns it will use and **names every column it will leave out**. Existing customers (matched by name) are skipped unless you choose to update them, and empty cells never erase what you already have. Comma, semicolon and tab delimiters are detected, and Excel's BOM is handled.

### SARS VAT

15% VAT inclusive, exclusive or none; the R5 000 full-tax-invoice threshold; and a live panel naming each missing field instead of letting you find out after the customer has the PDF. Money is integer cents throughout.

<br>

## How it's built

No framework, no bundler, no package manager. Plain scripts share a few globals, and Dexie is vendored in `js/vendor/` so the app works offline.

```
.
├── index.html              # App shell: nav + #view, hash-routed
├── invoice/index.html      # Redirect from the old /invoice/ URL
├── css/
│   ├── dandy.css           # Design system: tokens, header, buttons, forms
│   └── app.css             # Views, template components, designer, print
├── js/
│   ├── vendor/dexie.min.js # IndexedDB wrapper
│   ├── config.js           # Site settings you may want to change (the permanent storage link)
│   ├── core.js             # Icons, toast, escaping, mobile nav, legacy localStorage reader
│   ├── fonts.js            # Built-in + uploaded typefaces, CSS font stacks, loading
│   ├── csv.js              # CSV parsing and customer column mapping (pure)
│   ├── billing.js          # Pure model: money, totals, VAT, payments, derived status, compliance
│   ├── components.js       # Template component registry, guard rails, renderers
│   ├── layout.js           # Measures and paginates an invoice into A4 pages
│   ├── db.js               # The only file that touches storage; migration; backup
│   ├── app.js              # Hash router and shared helpers
│   └── views/              # dashboard, invoices, editor, customers, designer, settings
├── fonts/                  # Self-hosted woff2 files and their licences
├── assets/                 # Open Graph image
├── robots.txt
└── sitemap.xml
```

**Design notes worth knowing before editing:**

- `billing.js` is pure data and arithmetic, with no DOM and no storage.
- `layout.js` is the single source of truth for what a page looks like. The preview, the printed PDF and the designer all use the same component renderers, so what you design is what prints.
- A static host may serve a mix of old and new script files for a while after a deploy, because browsers cache subresources heuristically. If you deploy often, add a version query string (`?v=...`) to the script and stylesheet URLs in `index.html`.
- Routes: `#/`, `#/invoices`, `#/invoice/new`, `#/invoice/:id`, `#/customers[/:id|new]`, `#/templates/A|B`, `#/settings`.
- A new invoice is only written to the database once something is edited, and its serial number is a peek that only advances when a higher number is saved, so opening "New invoice" never burns a number.
- Invoices keep a **snapshot** of the customer details they were issued with, so editing a customer never rewrites an invoice you already sent.
- On first run, data from the earlier localStorage version (invoices, customers, presets, profile, counter) is imported once into IndexedDB. Quotes are not carried over.
- IndexedDB can be cleared by the browser, so Settings offers **Export backup** / **Import backup** as a JSON file.

<br>

## Running it locally

There's nothing to install and nothing to build. Serve the folder from its root (the app uses root-relative paths):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>.

### Deploying

Upload the folder to any static host. If the domain changes, update the absolute URLs in `sitemap.xml`, `robots.txt` and the `canonical` / `og:url` tags in `index.html`.

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
