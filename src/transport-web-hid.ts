import KProJS from "kprojs";
import { DeviceTypes, TransportTypes } from "kprojs";

const kproDevices = [
  {
    vendorId: KProJS.HIDFraming.kproUSBVendorId,
  },
];

const isSupported = () => Promise.resolve(!!(window.navigator && window.navigator.hid));

const getHID = (): HID => {
  // $FlowFixMe
  const { hid } = navigator;
  if (!hid) throw new KProJS.KProError.TransportError("navigator.hid is not supported", "HIDNotSupported");
  return hid;
};

async function requestKProDevices(): Promise<HIDDevice[]> {
  const device = await getHID().requestDevice({
    filters: kproDevices,
  });
  if (Array.isArray(device)) return device;
  return [device];
}

async function getKProDevices(): Promise<HIDDevice[]> {
  const devices = await getHID().getDevices();
  return devices.filter(d => d.vendorId === KProJS.HIDFraming.kproUSBVendorId);
}

async function getFirstKProDevice(): Promise<HIDDevice> {
  const existingDevices = await getKProDevices();
  if (existingDevices.length > 0) return existingDevices[0];
  const devices = await requestKProDevices();
  return devices[0];
}
/**
 * WebHID Transport implementation
 * @example
 * import TransportWebHID from "transport-webhid";
 * ...
 * TransportWebHID.create().then(transport => ...)
 */

export default class TransportWebHID extends KProJS.Transport {
  device: HIDDevice;
  deviceModel: DeviceTypes.DeviceModel | null | undefined;
  channel = Math.floor(Math.random() * 0xffff);
  packetSize = 64;

  constructor(device: HIDDevice) {
    super();
    this.device = device;
    this.deviceModel =
      typeof device.productId === "number" ? KProJS.KProDevice.identifyUSBProductId(device.productId) : undefined;
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
  static list = getKProDevices;

  /**
   * Actively listen to WebUSB devices and emit ONE device
   * that was either accepted before, if not it will trigger the native permission UI.
   *
   * Important: it must be called in the context of a UI click!
   */
  static listen = (observer: TransportTypes.Observer<TransportTypes.DescriptorEvent<HIDDevice>>): TransportTypes.Subscription => {
    let unsubscribed = false;
    getFirstKProDevice().then(
      device => {
        if (!device) {
          observer.error(new KProJS.KProError.TransportOpenUserCancelled("Access denied to use KPro device"));
        } else if (!unsubscribed) {
          const deviceModel =
            typeof device.productId === "number"
              ? KProJS.KProDevice.identifyUSBProductId(device.productId)
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
        observer.error(new KProJS.KProError.TransportOpenUserCancelled(error.message));
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
    const [device] = await requestKProDevices();
    return TransportWebHID.open(device);
  }

  /**
   * Similar to create() except it will never display the device permission (it returns a Promise<?Transport>, null if it fails to find a device).
   */
  static async openConnected() {
    const devices = await getKProDevices();
    if (devices.length === 0) return null;
    return TransportWebHID.open(devices[0]);
  }

  /**
   * Create a KPro transport with a HIDDevice
   */
  static async open(device: HIDDevice) {
    await device.open();
    const transport = new TransportWebHID(device);

    const onDisconnect = (e: any) => {
      if (device === e.device) {
        getHID().removeEventListener("disconnect", onDisconnect);

        transport._emitDisconnect(new KProJS.KProError.DisconnectedDevice());
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
      KProJS.KProLogs.log("apdu", "=> " + apdu.toString("hex"));
      const framing = KProJS.HIDFraming.hidFraming(channel, packetSize);
      // Write...
      const blocks = framing.makeBlocks(apdu);

      for (let i = 0; i < blocks.length; i++) {
        await this.device.sendReport(0, blocks[i]);
      }

      // Read...
      let result;
      let acc;

      while (!(result = framing.getReducedResult(acc))) {
        const buffer = await this.read();
        acc = framing.reduceResponse(acc, buffer);
      }

      KProJS.KProLogs.log("apdu", "<= " + result.toString("hex"));
      return result;
    }).catch(e => {
      if (e && e.message && e.message.includes("write")) {
        this._emitDisconnect(e);

        throw new KProJS.KProError.DisconnectedDeviceDuringOperation(e.message);
      }

      throw e;
    });
    return b as Buffer;
  };
}