import ShellJS from "@choppu/shelljs";
import { DeviceTypes, TransportTypes } from "@choppu/shelljs";

const shellDevices = [
  {
    vendorId: ShellJS.HIDFraming.shellUSBVendorId,
  },
];

const isSupported = () => Promise.resolve(!!(window.navigator && window.navigator.hid));

const getHID = (): HID => {
  // $FlowFixMe
  const { hid } = navigator;
  if (!hid) throw new ShellJS.ShellError.TransportError("navigator.hid is not supported", "HIDNotSupported");
  return hid;
};

async function requestShellDevices(): Promise<HIDDevice[]> {
  const device = await getHID().requestDevice({
    filters: shellDevices,
  });
  if (Array.isArray(device)) return device;
  return [device];
}

async function getShellDevices(): Promise<HIDDevice[]> {
  const devices = await getHID().getDevices();
  return devices.filter(d => d.vendorId === ShellJS.HIDFraming.shellUSBVendorId);
}

async function getFirstShellDevice(): Promise<HIDDevice> {
  const existingDevices = await getShellDevices();
  if (existingDevices.length > 0) return existingDevices[0];
  const devices = await requestShellDevices();
  return devices[0];
}
/**
 * WebHID Transport implementation
 * @example
 import TransportWebHID from "shelljs-web-hid";
 ...
 let transport: any;
 transport = await TransportWebHID.create();
 */

export default class TransportWebHID extends ShellJS.Transport {
  device: HIDDevice;
  deviceModel: DeviceTypes.DeviceModel | null | undefined;
  channel = Math.floor(Math.random() * 0xffff);
  packetSize = 64;

  constructor(device: HIDDevice) {
    super();
    this.device = device;
    this.deviceModel =
      typeof device.productId === "number" ? ShellJS.ShellDevice.identifyUSBProductId(device.productId) : undefined;
    device.addEventListener("inputreport", this.onInputReport);
  }

  inputs: Buffer[] = [];
  inputCallback: ((arg0: Buffer) => void) | null | undefined;
  read = (): Promise<Buffer> => {
    if (this.inputs.length) {
      return Promise.resolve(this.inputs.shift() as unknown as Buffer);
    }

    return new Promise(success => {
      this.inputCallback = success;
    });
  };
  onInputReport = (e: HIDInputReportEvent) => {
    const buffer = Buffer.from(e.data.buffer);

    if (this.inputCallback) {
      this.inputCallback(buffer);
      this.inputCallback = null;
    } else {
      this.inputs.push(buffer);
    }
  };

  /**
   * Check if WebUSB transport is supported.
   */
  static isSupported = isSupported;

  /**
   * List the WebUSB devices that was previously authorized by the user.
   */
  static list = getShellDevices;

  /**
   * Actively listen to WebUSB devices and emit ONE device
   * that was either accepted before, if not it will trigger the native permission UI.
   *
   * Important: it must be called in the context of a UI click!
   */
  static listen = (observer: TransportTypes.Observer<TransportTypes.DescriptorEvent<HIDDevice>>): TransportTypes.Subscription => {
    let unsubscribed = false;
    getFirstShellDevice().then(
      device => {
        if (!device) {
          observer.error(new ShellJS.ShellError.TransportOpenUserCancelled("Access denied to use Shell device"));
        } else if (!unsubscribed) {
          const deviceModel =
            typeof device.productId === "number"
              ? ShellJS.ShellDevice.identifyUSBProductId(device.productId)
              : undefined;
          observer.next({
            type: "add",
            descriptor: device,
            deviceModel,
          });
          observer.complete();
        }
      },
      error => {
        observer.error(new ShellJS.ShellError.TransportOpenUserCancelled(error.message));
      },
    );

    function unsubscribe() {
      unsubscribed = true;
    }

    return {
      unsubscribe,
    };
  };

  /**
   * Similar to create() except it will always display the device permission (even if some devices are already accepted).
   */
  static async request() {
    const [device] = await requestShellDevices();
    return TransportWebHID.open(device);
  }

  /**
   * Similar to create() except it will never display the device permission (it returns a Promise<?Transport>, null if it fails to find a device).
   */
  static async openConnected() {
    const devices = await getShellDevices();
    if (devices.length === 0) return null;
    return TransportWebHID.open(devices[0]);
  }

  /**
   * Create a Shell transport with a HIDDevice
   */
  static async open(device: HIDDevice) {
    await device.open();
    const transport = new TransportWebHID(device);

    const onDisconnect = (e: any) => {
      if (device === e.device) {
        getHID().removeEventListener("disconnect", onDisconnect);

        transport._emitDisconnect(new ShellJS.ShellError.DisconnectedDevice());
      }
    };

    getHID().addEventListener("disconnect", onDisconnect);
    return transport;
  }

  _disconnectEmitted = false;
  _emitDisconnect = (e: Error) => {
    if (this._disconnectEmitted) return;
    this._disconnectEmitted = true;
    this.emit("disconnect", e);
  };

  /**
   * Release the transport device
   */
  async close(): Promise<void> {
    await this.exchangeBusyPromise;
    this.device.removeEventListener("inputreport", this.onInputReport);
    await this.device.close();
  }

  /**
   * Exchange with the device using APDU protocol.
   * @param apdu
   * @returns a promise of apdu response
   */
  exchange = async (apdu: Buffer): Promise<Buffer> => {
    const b = await this.exchangeAtomicImpl(async () => {
      const { channel, packetSize } = this;
      ShellJS.ShellLogs.log("apdu", "=> " + apdu.toString("hex"));
      const framing = ShellJS.HIDFraming.hidFraming(channel, packetSize);
      // Write...
      const blocks = framing.makeBlocks(apdu);

      for (let i = 0; i < blocks.length; i++) {
        await this.device.sendReport(0, blocks[i] as BufferSource);
      }

      // Read...
      let result;
      let acc;

      while (!(result = framing.getReducedResult(acc))) {
        const buffer = await this.read();
        acc = framing.reduceResponse(acc, buffer);
      }

      ShellJS.ShellLogs.log("apdu", "<= " + result.toString("hex"));
      return result;
    }).catch(e => {
      if (e && e.message && e.message.includes("write")) {
        this._emitDisconnect(e);

        throw new ShellJS.ShellError.DisconnectedDeviceDuringOperation(e.message);
      }

      throw e;
    });
    return b as Buffer;
  };
}