# MyPrint Thermal

Offline-first web app (PWA) for 58 mm ESC/POS thermal printers, tuned to the self-test sheet of your printer
(`5806-6605`, codepage PC850, ESC command set, 115200 baud, USB + Bluetooth).
No build step, no server code — plain HTML / CSS / ES modules.

## Run it

```bash
cd /Users/ys/Desktop/Cdx/Myprint
python3 -m http.server 8080
```

Open <http://localhost:8080> in **Chrome or Edge**. `localhost` counts as a secure context, so Bluetooth works on this computer straight away.

### Using it from a phone (needs HTTPS)

Browsers only allow Bluetooth / USB on **HTTPS** pages. Pick one:

| Option | How |
| --- | --- |
| **Host it (recommended)** | Upload this folder to any static host with HTTPS — GitHub Pages, Netlify Drop, Cloudflare Pages, Vercel. Open the URL once on the phone, then *Install* (or “Add to Home screen”). After that it works with no internet. |
| Android + USB cable, no hosting | Run the server above, enable USB debugging, then `adb reverse tcp:8080 tcp:8080` and open `http://localhost:8080` in Chrome on the phone. |

**iPhone / iPad:** Safari has no Web Bluetooth. Install the free **Bluefy** browser and open the hosted URL there.

## Connect your printer

1. Turn the printer on. Do **not** pair it in the phone's Bluetooth settings first.
2. *Printer* tab → **Bluetooth (BLE)** → choose the printer in the browser picker (names like `MPT-II`, `PT-210`, `MHT-P…`, `BlueTooth Printer`).
3. *Printer* tab → **Diagnostics → Test page**, then **Ruler** to confirm the 48 mm print width.

Other ways in, all on the same tab: **USB** (WebUSB), **USB serial**, **Bluetooth classic (desktop Chrome, SPP)**, and a **Virtual demo printer** that captures bytes so you can try everything with no hardware.

> **Important:** Web Bluetooth talks to *Bluetooth LE* only. Your self-test says “USB & Bluetooth”, which on these printers is normally dual-mode (BLE + classic) — but if the printer never appears in the picker it is classic-only. Then use the desktop *Bluetooth classic* button, USB, or the RawBT bridge (Raw tab, Android).

## What's inside

**Printing**
- Receipt builder (items, discount %, GST/VAT added or included, payment, change / balance due, QR, barcode, auto-numbering) with saved templates
- Text tab with quick markup (`# title`, `---`, `Left | Right`, `[qr:…]`, `[bar:…]`, `[feed:n]`, `[cut]`)
- QR codes and Code 128 / Code 39 / EAN-13 / UPC-A / ITF barcodes
- Images and logos with Atkinson, Floyd–Steinberg, halftone or threshold dithering
- Raw ESC/POS terminal (hex + quoted text), `.bin` download

**Printer configuration (Printer tab)**
- Paper: 58 mm (384 dots), 76 mm, 80 mm (576 dots) or custom; side margins; font A (32 cols) / B (42 cols)
- Codepage (PC850 default, PC858 with €, Windows-1252), feed lines, cutter, cash drawer, darkness (`ESC 7`)
- **Print mode:** *Auto* sends fast native text, and switches to **graphic mode** only when the text can't be encoded (₹, Tamil, Hindi, Malayalam, Telugu, Arabic, CJK, emoji…). The preview always shows what will print.
- Image command (`GS v 0` or legacy `ESC *`), raster band height, black level
- Transfer-speed profiles (Safe / Balanced / Fast / Max / custom), per-chunk acknowledgement, serial baud

**Reliability**
- Works fully offline (service worker caches the app; data lives in the browser)
- If the printer is off or out of range, jobs go to a **queue** (IndexedDB) and print when you reconnect; every printed job is kept in **History** for reprint
- Auto-reconnect after a dropped Bluetooth link, adaptive chunk size when the printer rejects large writes
- Settings export / import, light / dark theme, installable

## Canva-style designing (new)

**New design** opens a two-step screen: first the **size of your area** (label length × height, or a roll length — with a live proportional preview), then a **template gallery** whose previews are drawn at *your* size. Twenty-eight original templates in seven categories (Retail, Shipping, Name & badge, Home & kitchen, QR & contact, Gift & paper, Office) lay themselves out for any size — text shrinks to fit, content centres — so the same design works on a 25 × 50 mm sticker and on a roll. Or start blank.

The canvas then works like a design tool: **zoom** with the − / + buttons, Ctrl + scroll or a two-finger pinch; **pan** by dragging empty space; add text (7 fonts incl. heavy, rounded, script, narrow; letter spacing), images, **icons** (22 built-in vector icons), QR codes, barcodes, lines, boxes with rounded corners and dashed borders, circles and pen drawing.

> The templates are original designs in common label styles. I did not copy artwork from other apps — it is copyrighted — so if you want a specific look, describe it and I will add it.

## MyPrint 2.0 — guided flow

**Setup** (two steps) → **Design** → **Jobs**.

1. **Connect your printer.** After connecting, MyPrint asks the printer what it is — Bluetooth Device Information and battery, ESC/POS `GS I` identification and `DLE EOT` paper/online status — and configures head width, codepage and baud rate automatically. Each fact is tagged *read*, *self-test*, *inferred* or *default*, so you can see what is real. Many mobile printers answer none of these queries; then paste the values from the self-test sheet (hold FEED while powering on) and MyPrint reads model, codepage, baud rate and darkness from it.
2. **Paper & print type.** *Roll* (continuous) or *Label* with **Length × Height** in mm — length runs across the label (the print-head direction), height runs along the feed. So 50 × 25 means 50 mm long, 25 mm high. A 58 mm head prints 48 mm across, so a 50 mm length prints 48 mm wide; narrower labels are centred on the head. Then choose what you are printing: receipt, label, slips, photo, free canvas or text.
3. **Design.** The **Canvas** is drawn at exactly the paper size (8 dots = 1 mm) with mm rulers; zoom to *Actual size* to see it at true physical size. Add text, images, QR codes, barcodes, lines, boxes and circles, or draw with the pen/eraser. Drag to move, drag a corner to resize, drag the round knob to rotate; snapping guides, align buttons, front/back, duplicate, undo/redo, keyboard nudging (Shift = 1 mm). Images can be rotated 90° either way, flipped, auto-optimised, dithered and inverted. Rolls trim the empty paper; labels keep their fixed size. *Starters* give a product label, address label, QR + caption, name tag or price tag. Receipt, Studio, Text and Raw remain as document types, with the same rulers and exact-size preview.

> Not verified on real hardware: the printer queries (many printers ignore them), beep, label-gap advance and darkness commands. The Bluetooth path was tested against a simulated device only.

## Studio templates

The **Studio** tab on the Print page has nine ready-made slips, ported from the Thermal Print Studio you shared and rebuilt on this app's offline engine:
Daily To-Do · Pocket Digest (article + QR) · Vacation & Trip · Home Labels (pantry / cable / box / 50×25 mm spec sticker with barcode) · Mini Photo (clipart or your own photo, 1-bit dithering, Polaroid frame) · Mini Doc Print (boxed notes) · Smart QR Hub (Wi-Fi, vCard, link, luggage tag) · Doodle & Memo (finger / pen sketch pad) · Test & Bookmark (printer spec sheet + ruler, ex-libris slip).
Each template can be saved / loaded as a JSON preset, archived in History without printing, and re-opened for editing from the Jobs tab.

**Paper & label formats:** 58 mm roll (your printer), **50 × 25 mm label (length 50, height 25)**, a **custom label size (width × height in mm)**, 80 / 76 / 50 / 38 mm rolls, die-cut and black-mark media, label-height guide with an overflow warning, line spacing (`ESC 3`), top / tear feed, a 1000-label roll counter and a “Calibrate gap” button (`GS FF`). A 58 mm head prints at most 48 mm (384 dots), so a 50 mm-wide label prints 48 mm across.

**Telemetry under the preview:** payload size, estimated paper length and head duty (share of black dots; warns above 35%).
**Other tools:** Save PNG, OS print, hex-bytes viewer, hardware macros (feed / beep / cut / reset), darkness presets (Eco 25 / Standard 38 / Dark 45), raster QR/barcode option, “keep text native” (₹ → Rs.) option.

> **Unverified on real hardware:** the beep byte (`0x1E`), the label-gap advance (`FF` / `GS FF`) and the `ESC 7` darkness command are taken from the Studio file / common practice and may be ignored or behave differently on your model. The codepage is selected with `ESC t 2` (PC850 in Epson numbering); the Studio file used `ESC t 3`, which is PC860 — switch the codepage in settings if accented letters look wrong.
> Raster images are now sent in **24-row bands** (1,152 bytes on 58 mm) so a ~4 KB printer buffer cannot overflow; change it under *Text & quality → Raster band height*.

## If something looks wrong

| Symptom | Fix |
| --- | --- |
| Garbage characters / output cut off | *Printer → Transfer speed → Safe* (20-byte chunks). Older Android phones silently truncate large BLE writes. |
| Accented letters wrong | Check *Codepage* = PC850 (what your self-test reports); or set *Print mode* to *Graphic*. |
| Too light / too dark | *Darkness* slider with “Send darkness command” on, or *Black level* for graphic mode. Use *Darkness steps* to compare. |
| Images print as noise | Switch *Image command* to *ESC \** and reprint. |
| Nothing in the Bluetooth picker | Printer is probably classic-only — see the note above. Also close any other app holding the connection (“BT Mul Conn”). |
| Browser says Bluetooth unavailable | Not HTTPS, or not Chrome/Edge (Bluefy on iPhone). |

## Files

```
index.html              UI shell (Print / Printer / Jobs)
css/app.css             styles (mobile first, light + dark)
js/app.js               UI wiring, print pipeline, queue, templates
js/engine.js            blocks -> preview canvas + bytes, native/graphic mode choice
js/escpos.js            ESC/POS command builder, codepages, native layout (pure JS)
js/render.js            canvas renderer, dithering, QR / barcode drawing, bit packing
js/doc.js               receipt / text / QR / test-page block builders
js/gallery.js           28 adaptive label/tag templates
js/icons.js             built-in vector icons
js/designer.js          interactive canvas editor (objects, rulers, snapping, pen layer)
js/detect.js            printer identification + automatic configuration
js/templates.js         the nine Studio templates (form schema + block builders)
js/clipart.js, sketch.js  clipart gallery and doodle pad
js/printer.js           BLE, USB, Serial, SPP and virtual transports
js/store.js             settings (localStorage) + jobs/templates (IndexedDB)
js/vendor/              qrcode-generator 1.4.4, JsBarcode 3.11.6 (MIT, bundled so it works offline)
sw.js, manifest.webmanifest, icons/
```

After changing any file, bump `CACHE` in `sw.js` (currently `myprint-v4`) so installed copies pick up the update.

## Status of testing

Verified here: ESC/POS byte output (Node unit tests), preview and print pipeline, graphic mode with Unicode, QR / barcode, image dithering, offline queue, offline reload with the server stopped, mobile layout, and the Bluetooth code path against a **simulated** BLE device (service discovery, chunking, retry, reconnect).
**Not verified:** real hardware — I had no access to your printer. The first real-device run (Test page, Ruler, Darkness steps) is the calibration step; the speed profile and darkness mapping are the two settings most likely to need adjusting.
