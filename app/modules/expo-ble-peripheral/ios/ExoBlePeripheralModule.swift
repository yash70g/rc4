import ExpoModulesCore
import CoreBluetooth

// ── Constants ──────────────────────────────────────────────────────────
private let SERVICE_UUID_DEFAULT     = CBUUID(string: "CAFE0001-C0DE-FACE-B00C-CAFE01234567")
private let RX_CHAR_UUID             = CBUUID(string: "CAFE0002-C0DE-FACE-B00C-CAFE01234567")
private let TX_CHAR_UUID             = CBUUID(string: "CAFE0003-C0DE-FACE-B00C-CAFE01234567")

public class ExoBlePeripheralModule: Module {
    private var peripheralManager: CBPeripheralManager?
    private var delegate: PeripheralDelegate?
    private var serviceUuid: CBUUID = SERVICE_UUID_DEFAULT
    private var txCharacteristic: CBMutableCharacteristic?
    private var connectedCentrals: [String: CBCentral] = [:]
    private var advertising = false
    private var metadata: String = "{}"
    private var deviceName: String = "RC-Device"
    private var pendingStartAfterPoweredOn = false

    public func definition() -> ModuleDefinition {
        Name("ExoBlePeripheral")

        Events("onCentralConnected", "onCentralDisconnected", "onDataReceived")

        AsyncFunction("startPeripheral") { (config: [String: Any]) in
            if let sUuid = config["serviceUuid"] as? String {
                self.serviceUuid = CBUUID(string: sUuid)
            }
            self.deviceName = config["deviceName"] as? String ?? "RC-Device"
            self.metadata = config["metadata"] as? String ?? "{}"

            self.setupAndStart()
        }

        AsyncFunction("stopPeripheral") {
            self.tearDown()
        }

        AsyncFunction("sendNotification") { (centralId: String, data: String) in
            self.sendNotificationTo(centralId: centralId, data: data)
        }

        AsyncFunction("updateAdvertisingData") { (newMetadata: String) in
            self.metadata = newMetadata
            // Restart advertising with updated data
            if self.advertising {
                self.peripheralManager?.stopAdvertising()
                self.startAdvertising()
            }
        }

        Function("isAdvertising") {
            return self.advertising
        }

        Function("getConnectedCentrals") {
            return Array(self.connectedCentrals.keys)
        }
    }

    // ── Setup / Teardown ─────────────────────────────────────────

    private func setupAndStart() {
        let del = PeripheralDelegate(module: self)
        self.delegate = del
        self.peripheralManager = CBPeripheralManager(delegate: del, queue: nil)
        self.pendingStartAfterPoweredOn = true
    }

    fileprivate func onPoweredOn() {
        guard pendingStartAfterPoweredOn else { return }
        pendingStartAfterPoweredOn = false
        addService()
    }

    private func addService() {
        guard let pm = peripheralManager else { return }

        let rxChar = CBMutableCharacteristic(
            type: RX_CHAR_UUID,
            properties: [.write, .writeWithoutResponse],
            value: nil,
            permissions: [.writeable]
        )

        let txChar = CBMutableCharacteristic(
            type: TX_CHAR_UUID,
            properties: [.notify, .read],
            value: nil,
            permissions: [.readable]
        )
        self.txCharacteristic = txChar

        let service = CBMutableService(type: serviceUuid, primary: true)
        service.characteristics = [rxChar, txChar]
        pm.add(service)
    }

    fileprivate func onServiceAdded() {
        startAdvertising()
    }

    private func startAdvertising() {
        guard let pm = peripheralManager else { return }
        let adData: [String: Any] = [
            CBAdvertisementDataLocalNameKey: deviceName,
            CBAdvertisementDataServiceUUIDsKey: [serviceUuid]
        ]
        pm.startAdvertising(adData)
        advertising = true
    }

    private func tearDown() {
        peripheralManager?.stopAdvertising()
        peripheralManager?.removeAllServices()
        connectedCentrals.removeAll()
        advertising = false
        peripheralManager = nil
        delegate = nil
    }

    // ── Incoming connections / writes ────────────────────────────

    fileprivate func handleCentralSubscribed(central: CBCentral) {
        let centralId = central.identifier.uuidString
        connectedCentrals[centralId] = central
        sendEvent("onCentralConnected", ["centralId": centralId])
    }

    fileprivate func handleCentralUnsubscribed(central: CBCentral) {
        let centralId = central.identifier.uuidString
        connectedCentrals.removeValue(forKey: centralId)
        sendEvent("onCentralDisconnected", ["centralId": centralId])
    }

    fileprivate func handleWriteRequest(centralId: String, data: String) {
        sendEvent("onDataReceived", [
            "centralId": centralId,
            "data": data
        ])
    }

    fileprivate func handleReadRequest(_ request: CBATTRequest) {
        let data = metadata.data(using: .utf8) ?? Data()
        let offset = request.offset
        if offset > data.count {
            peripheralManager?.respond(to: request, withResult: .invalidOffset)
            return
        }
        request.value = data.subdata(in: offset..<data.count)
        peripheralManager?.respond(to: request, withResult: .success)
    }

    // ── Notification sending ─────────────────────────────────────

    private func sendNotificationTo(centralId: String, data: String) {
        guard let central = connectedCentrals[centralId],
              let txChar = txCharacteristic,
              let pm = peripheralManager else {
            return
        }

        let bytes = data.data(using: .utf8) ?? Data()
        txChar.value = bytes
        let sent = pm.updateValue(bytes, for: txChar, onSubscribedCentrals: [central])
        if !sent {
            // Queue is full — iOS will call peripheralManagerIsReady(toUpdateSubscribers:)
            // For simplicity, we log and retry would need a queue. Fine for prototype.
            NSLog("[ExoBlePeripheral] TX queue full for \(centralId), data may be lost")
        }
    }
}

// ── CBPeripheralManagerDelegate ──────────────────────────────────────

private class PeripheralDelegate: NSObject, CBPeripheralManagerDelegate {
    weak var module: ExoBlePeripheralModule?

    init(module: ExoBlePeripheralModule) {
        self.module = module
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            NSLog("[ExoBlePeripheral] Bluetooth powered on")
            module?.onPoweredOn()
        case .poweredOff:
            NSLog("[ExoBlePeripheral] Bluetooth powered off")
        case .unsupported:
            NSLog("[ExoBlePeripheral] BLE peripheral unsupported")
        case .unauthorized:
            NSLog("[ExoBlePeripheral] BLE peripheral unauthorized")
        default:
            NSLog("[ExoBlePeripheral] BLE state: \(peripheral.state.rawValue)")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            NSLog("[ExoBlePeripheral] Failed to add service: \(error.localizedDescription)")
            return
        }
        NSLog("[ExoBlePeripheral] Service added: \(service.uuid)")
        module?.onServiceAdded()
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            NSLog("[ExoBlePeripheral] Advertising failed: \(error.localizedDescription)")
        } else {
            NSLog("[ExoBlePeripheral] Advertising started")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           central: CBCentral,
                           didSubscribeTo characteristic: CBCharacteristic) {
        NSLog("[ExoBlePeripheral] Central subscribed: \(central.identifier)")
        module?.handleCentralSubscribed(central: central)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           central: CBCentral,
                           didUnsubscribeFrom characteristic: CBCharacteristic) {
        NSLog("[ExoBlePeripheral] Central unsubscribed: \(central.identifier)")
        module?.handleCentralUnsubscribed(central: central)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            if request.characteristic.uuid == CBUUID(string: "CAFE0002-C0DE-FACE-B00C-CAFE01234567") {
                let centralId = request.central.identifier.uuidString
                let data = request.value.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                module?.handleWriteRequest(centralId: centralId, data: data)
                peripheral.respond(to: request, withResult: .success)
            } else {
                peripheral.respond(to: request, withResult: .requestNotSupported)
            }
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           didReceiveRead request: CBATTRequest) {
        if request.characteristic.uuid == CBUUID(string: "CAFE0003-C0DE-FACE-B00C-CAFE01234567") {
            module?.handleReadRequest(request)
        } else {
            peripheral.respond(to: request, withResult: .requestNotSupported)
        }
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        // Called when the TX queue has space again after updateValue returned false.
        NSLog("[ExoBlePeripheral] Ready to update subscribers again")
    }
}
