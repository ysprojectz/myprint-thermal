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

## Studio templates (new)

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
js/templates.js         the nine Studio templates (form schema + block builders)
js/clipart.js, sketch.js  clipart gallery and doodle pad
js/printer.js           BLE, USB, Serial, SPP and virtual transports
js/store.js             settings (localStorage) + jobs/templates (IndexedDB)
js/vendor/              qrcode-generator 1.4.4, JsBarcode 3.11.6 (MIT, bundled so it works offline)
sw.js, manifest.webmanifest, icons/
```

After changing any file, bump `CACHE` in `sw.js` (currently `myprint-v2`) so installed copies pick up the update.

## Status of testing

Verified here: ESC/POS byte output (Node unit tests), preview and print pipeline, graphic mode with Unicode, QR / barcode, image dithering, offline queue, offline reload with the server stopped, mobile layout, and the Bluetooth code path against a **simulated** BLE device (service discovery, chunking, retry, reconnect).
**Not verified:** real hardware — I had no access to your printer. The first real-device run (Test page, Ruler, Darkness steps) is the calibration step; the speed profile and darkness mapping are the two settings most likely to need adjusting.
