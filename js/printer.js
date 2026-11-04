// Printer transports: Bluetooth LE (Web Bluetooth), USB (WebUSB), Serial / Bluetooth-classic SPP (Web Serial)
// and a virtual printer for demos. All expose the same write(bytes) API.

const BT = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;

// Vendor services used by the common generic ESC/POS BLE printers. Web Bluetooth only exposes services listed here.
const BLE_SERVICES = [
  BT('18f0'), BT('ffe0'), BT('ff00'), BT('fff0'), BT('fee7'), BT('ae30'), BT('af30'), BT('1101'), BT('1800'),
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // common 58mm printers
  '0000fe59-0000-1000-8000-00805f9b34fb',
];
const PREFERRED_CHARS = [
  BT('2af1'), BT('ffe1'), BT('ff02'), BT('ae01'),
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', '49535343-8841-43f4-a8d4-ecbe34729bb3',
];
const SKIP_SERVICES = [BT('1800'), BT('1801'), BT('180a'), BT('180f')];
const SPP = '00001101-0000-1000-8000-00805f9b34fb';

export const LINK_PROFILES = {
  safe: { label: 'Safe — 20 B / 20 ms (any printer)', chunk: 20, delay: 20 },
  balanced: { label: 'Balanced — 100 B / 12 ms', chunk: 100, delay: 12 },
  fast: { label: 'Fast — 180 B / 8 ms', chunk: 180, delay: 8 },
  max: { label: 'Max — 500 B / 5 ms (newer phones)', chunk: 500, delay: 5 },
  custom: { label: 'Custom', chunk: 100, delay: 12 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

export function support() {
  return {
    secure: window.isSecureContext,
    ble: !!navigator.bluetooth,
    usb: !!navigator.usb,
    serial: !!navigator.serial,
  };
}

export class Printer extends EventTarget {
  constructor() {
    super();
    this.state = 'disconnected'; // disconnected | connecting | connected
    this.kind = null; // ble | usb | serial | spp | sim
    this.name = '';
    this.link = { chunk: 100, delay: 12, ack: false, baud: 115200 };
    this.sim = [];
    this._manual = false;
    this._lock = Promise.resolve();
  }

  get connected() { return this.state === 'connected'; }

  log(msg, dir = 'info') { this.dispatchEvent(new CustomEvent('log', { detail: { msg, dir, t: Date.now() } })); }
  _set(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: { state, kind: this.kind, name: this.name } }));
  }

  // ------------------------------------------------------------ connect

  async connectBLE() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available in this browser');
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    this._manual = false;
    await this._attachBLE(device);
  }

  async _attachBLE(device) {
    this.kind = 'ble';
    this.name = device.name || 'BLE printer';
    this._set('connecting');
    this.log(`Connecting to ${this.name}…`);
    try {
      if (this._bleDevice && this._bleDevice !== device) this._bleDevice.removeEventListener('gattserverdisconnected', this._onDrop);
      this._bleDevice = device;
      this._onDrop = () => this._dropped();
      device.removeEventListener('gattserverdisconnected', this._onDrop);
      device.addEventListener('gattserverdisconnected', this._onDrop);
      const server = await withTimeout(device.gatt.connect(), 15000, 'Timed out connecting — is the printer on and in range?');
      const services = await server.getPrimaryServices();
      const candidates = [];
      const notify = [];
      for (const svc of services) {
        if (SKIP_SERVICES.includes(svc.uuid)) continue;
        for (const c of await svc.getCharacteristics()) {
          const p = c.properties;
          this.log(`  service ${svc.uuid.slice(4, 8)} · char ${c.uuid.slice(4, 8)} [${['write', 'writeWithoutResponse', 'notify'].filter((k) => p[k]).join(',')}]`);
          if (p.write || p.writeWithoutResponse) candidates.push(c);
          if (p.notify) notify.push(c);
        }
      }
      const char = PREFERRED_CHARS.map((u) => candidates.find((c) => c.uuid === u)).find(Boolean) || candidates[0];
      if (!char) throw new Error('No writable characteristic found. This printer may only support Bluetooth Classic (SPP) — see the Printer tab help.');
      this._char = char;
      for (const n of notify.slice(0, 2)) {
        try {
          await n.startNotifications();
          n.addEventListener('characteristicvaluechanged', (e) => this.log(`← ${hex(new Uint8Array(e.target.value.buffer))}`, 'rx'));
        } catch { /* notifications are optional */ }
      }
      this.log(`Using characteristic ${char.uuid}`);
      this._set('connected');
    } catch (err) {
      this.kind = null;
      this._set('disconnected');
      throw err;
    }
  }

  async connectUSB() {
    if (!navigator.usb) throw new Error('WebUSB is not available in this browser');
    const dev = await navigator.usb.requestDevice({ filters: [] });
    await this._attachUSB(dev);
  }

  async _attachUSB(dev) {
    this.kind = 'usb';
    this.name = dev.productName || `USB ${dev.vendorId.toString(16)}:${dev.productId.toString(16)}`;
    this._set('connecting');
    try {
      await dev.open();
      if (!dev.configuration) await dev.selectConfiguration(1);
      let pick = null;
      for (const itf of dev.configuration.interfaces)
        for (const alt of itf.alternates) {
          const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
          if (ep && (!pick || alt.interfaceClass === 7)) pick = { itf, alt, ep };
        }
      if (!pick) throw new Error('No bulk-out endpoint on this USB device');
      await dev.claimInterface(pick.itf.interfaceNumber);
      if (pick.alt.alternateSetting) await dev.selectAlternateInterface(pick.itf.interfaceNumber, pick.alt.alternateSetting);
      this._usb = { dev, ep: pick.ep.endpointNumber, itf: pick.itf.interfaceNumber };
      this._usbOnDisc = (e) => { if (e.device === dev) this._dropped(); };
      navigator.usb.addEventListener('disconnect', this._usbOnDisc);
      this.log(`USB endpoint ${pick.ep.endpointNumber} on interface ${pick.itf.interfaceNumber}`);
      this._set('connected');
    } catch (err) {
      this.kind = null;
      this._set('disconnected');
      throw err;
    }
  }

  /** kind: 'serial' (USB-serial) or 'spp' (Bluetooth classic, desktop Chrome) */
  async connectSerial(kind = 'serial') {
    if (!navigator.serial) throw new Error('Web Serial is not available in this browser');
    const opts = kind === 'spp' ? { allowedBluetoothServiceClassIds: [SPP], filters: [{ bluetoothServiceClassId: SPP }] } : {};
    const port = await navigator.serial.requestPort(opts);
    await this._attachSerial(port, kind);
  }

  async _attachSerial(port, kind) {
    this.kind = kind;
    this.name = kind === 'spp' ? 'Bluetooth SPP printer' : 'Serial printer';
    this._set('connecting');
    try {
      await port.open({ baudRate: this.link.baud || 115200, bufferSize: 8192 });
      this._port = port;
      this._writer = port.writable.getWriter();
      this._serOnDisc = (e) => { if (e.target === port) this._dropped(); };
      navigator.serial.addEventListener('disconnect', this._serOnDisc);
      this.log(`Serial opened at ${this.link.baud} baud`);
      this._set('connected');
    } catch (err) {
      this.kind = null;
      this._set('disconnected');
      throw err;
    }
  }

  connectSim() {
    this.kind = 'sim';
    this.name = 'Virtual printer (demo)';
    this._manual = false;
    this._set('connected');
    this.log('Virtual printer ready — bytes are captured, not printed');
  }

  /** Re-open a previously permitted device without a picker. Returns true on success. */
  async reconnect(last) {
    if (!last || this.state !== 'disconnected') return false;
    this._manual = false;
    try {
      if (last.kind === 'ble' && navigator.bluetooth?.getDevices) {
        const dev = (await navigator.bluetooth.getDevices()).find((d) => d.id === last.id);
        if (dev) { await this._attachBLE(dev); return true; }
      } else if (last.kind === 'usb' && navigator.usb) {
        const dev = (await navigator.usb.getDevices()).find((d) => d.vendorId === last.vid && d.productId === last.pid);
        if (dev) { await this._attachUSB(dev); return true; }
      } else if ((last.kind === 'serial' || last.kind === 'spp') && navigator.serial) {
        const ports = await navigator.serial.getPorts();
        if (ports.length) { await this._attachSerial(ports[0], last.kind); return true; }
      }
    } catch (err) {
      this.log(`Reconnect failed: ${err.message}`, 'err');
    }
    return false;
  }

  identity() {
    if (this.kind === 'ble') return { kind: 'ble', id: this._bleDevice?.id, name: this.name };
    if (this.kind === 'usb') return { kind: 'usb', vid: this._usb?.dev.vendorId, pid: this._usb?.dev.productId, name: this.name };
    if (this.kind === 'serial' || this.kind === 'spp') return { kind: this.kind, name: this.name };
    return null;
  }

  // ------------------------------------------------------------ disconnect

  async disconnect() {
    this._manual = true;
    await this._teardown();
    this.log('Disconnected');
    this.kind = null;
    this._set('disconnected');
  }

  async _teardown() {
    try {
      if (this.kind === 'ble') this._bleDevice?.gatt?.connected && this._bleDevice.gatt.disconnect();
      if (this.kind === 'usb' && this._usb) {
        navigator.usb.removeEventListener('disconnect', this._usbOnDisc);
        await this._usb.dev.close().catch(() => {});
      }
      if ((this.kind === 'serial' || this.kind === 'spp') && this._port) {
        navigator.serial.removeEventListener('disconnect', this._serOnDisc);
        this._writer?.releaseLock();
        await this._port.close().catch(() => {});
      }
    } catch { /* ignore */ }
    this._char = this._usb = this._port = this._writer = null;
  }

  async _dropped() {
    if (this.state === 'disconnected') return;
    const wasBle = this.kind === 'ble';
    this.log('Connection lost', 'err');
    if (!wasBle) await this._teardown();
    this._set('disconnected');
    if (wasBle && !this._manual && this._bleDevice) {
      for (const wait of [1500, 3000, 6000]) {
        await sleep(wait);
        if (this._manual || this.state !== 'disconnected') return;
        try { await this._attachBLE(this._bleDevice); this.log('Reconnected'); return; } catch (e) { this.log(`Reconnect attempt failed: ${e.message}`, 'err'); }
      }
    }
  }

  // ------------------------------------------------------------ write

  async _send(part) {
    switch (this.kind) {
      case 'ble': {
        const c = this._char;
        if (c.properties.writeWithoutResponse && !this.link.ack && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(part);
        else if (c.properties.write && c.writeValueWithResponse) await c.writeValueWithResponse(part);
        else await c.writeValue(part);
        break;
      }
      case 'usb': await this._usb.dev.transferOut(this._usb.ep, part); break;
      case 'serial': case 'spp': await this._writer.write(part); break;
      case 'sim': this.sim.push(part.slice()); break;
    }
  }

  /** Sends bytes in paced chunks. Jobs are serialised so two prints never interleave. */
  write(data, { onProgress, signal } = {}) {
    const run = async () => {
      if (!this.connected) throw new Error('Printer is not connected');
      const usbSerial = this.kind === 'usb' || this.kind === 'serial' || this.kind === 'spp';
      let size = this.kind === 'sim' ? 4096 : usbSerial ? 4096 : this.link.chunk;
      const delay = usbSerial || this.kind === 'sim' ? 0 : this.link.delay;
      if (this.kind === 'sim') this.sim = [];
      let i = 0, shrinks = 0;
      this.log(`→ sending ${data.length} bytes (${this.kind}, ${size} B chunks)`, 'tx');
      while (i < data.length) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const part = data.subarray(i, i + size);
        try {
          await this._send(part);
          i += part.length;
          onProgress?.(i / data.length);
          if (delay) await sleep(delay);
        } catch (err) {
          if (this.kind === 'ble' && size > 20 && shrinks < 4) {
            size = Math.max(20, size >> 1);
            shrinks++;
            this.log(`Write failed (${err.message}); retrying with ${size} B chunks`, 'err');
            await sleep(80);
            continue;
          }
          throw err;
        }
      }
      this.log('✓ sent', 'tx');
    };
    const p = this._lock.then(run, run);
    this._lock = p.catch(() => {});
    return p;
  }
}
