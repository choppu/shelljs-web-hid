## KProJS Web HID

KProJS Web HID is based on [@ledgerhq/hw-transport-webhid](@ledgerhq/hw-transport-webhid) and allows to communicate with Keycard Pro using usb HID.

***

### Usage example

```javascript
import TransportWebHID from "kprojs-web-hid";
...
let transport: any;
transport = await TransportWebHID.create();
...
```

### Live Demo

You can check a demo at [KPro Web HID Example Page](https://choppu.github.io/kprojs-example/).

### Support status

WebUSB is currently only supported on Google Chrome / Chromium DEV version and by explicitly enabling `chrome://flags/#enable-experimental-web-platform-features`

## API

#### Table of Contents

*   [TransportWebHID](#transportwebhid)
    *   [Parameters](#parameters)
    *   [close](#close)
    *   [exchange](#exchange)
        *   [Parameters](#parameters-1)
    *   [isSupported](#issupported)
    *   [list](#list)
    *   [listen](#listen)
        *   [Parameters](#parameters-2)
    *   [request](#request)
    *   [openConnected](#openconnected)
    *   [open](#open)
        *   [Parameters](#parameters-3)

### TransportWebHID

**Extends Transport**

WebHID Transport implementation

#### Parameters

*   `device` **HIDDevice**

#### close

Release the transport device

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)\<void>**

#### exchange

Exchange with the device using APDU protocol.

##### Parameters

*   `apdu` **[Buffer](https://nodejs.org/api/buffer.html)**

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[Buffer](https://nodejs.org/api/buffer.html)>** a promise of apdu response

#### isSupported

Check if WebUSB transport is supported.

#### list

List the WebUSB devices that was previously authorized by the user.

#### listen

Actively listen to WebUSB devices and emit ONE device
that was either accepted before, if not it will trigger the native permission UI.

Important: it must be called in the context of a UI click!

##### Parameters

*   `observer` **Observer\<DescriptorEvent\<HIDDevice>>**

Returns **Subscription**

#### request

Similar to create() except it will always display the device permission (even if some devices are already accepted).

#### openConnected

Similar to create() except it will never display the device permission (it returns a Promise\<?Transport>, null if it fails to find a device).

#### open

Create a KPro transport with a HIDDevice

##### Parameters

*   `device` **HIDDevice**