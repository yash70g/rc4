package expo.modules.bleperipheral

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class ExoBlePeripheralModule : Module() {
    companion object {
        private const val TAG = "ExoBlePeripheral"

        // Default UUIDs — can be overridden from JS
        val DEFAULT_SERVICE_UUID: UUID = UUID.fromString("CAFE0001-C0DE-FACE-B00C-CAFE01234567")
        val RX_CHAR_UUID: UUID = UUID.fromString("CAFE0002-C0DE-FACE-B00C-CAFE01234567")
        val TX_CHAR_UUID: UUID = UUID.fromString("CAFE0003-C0DE-FACE-B00C-CAFE01234567")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var gattServer: BluetoothGattServer? = null
    private var serviceUuid: UUID = DEFAULT_SERVICE_UUID

    private var advertising = false
    private var metadata: String = "{}"
    private var deviceName: String = "RC-Device"

    // Track connected centrals and their notification-subscription state
    private val connectedCentrals = ConcurrentHashMap<String, BluetoothDevice>()
    private val subscribedCentrals = ConcurrentHashMap<String, BluetoothDevice>()

    override fun definition() = ModuleDefinition {
        Name("ExoBlePeripheral")

        Events("onCentralConnected", "onCentralDisconnected", "onDataReceived")

        AsyncFunction("startPeripheral") { config: Map<String, Any?> ->
            val sUuid = config["serviceUuid"] as? String
            deviceName = config["deviceName"] as? String ?: "RC-Device"
            metadata = config["metadata"] as? String ?: "{}"

            if (sUuid != null) {
                serviceUuid = UUID.fromString(sUuid)
            }

            startGattAndAdvertise()
        }

        AsyncFunction("stopPeripheral") {
            stopAdvertising()
            stopGattServer()
        }

        AsyncFunction("sendNotification") { centralId: String, data: String ->
            sendNotificationToDevice(centralId, data)
        }

        AsyncFunction("updateAdvertisingData") { newMetadata: String ->
            metadata = newMetadata
            // Restart advertising with updated metadata
            if (advertising) {
                stopAdvertising()
                startAdvertising()
            }
        }

        Function("isAdvertising") {
            advertising
        }

        Function("getConnectedCentrals") {
            connectedCentrals.keys().toList()
        }
    }

    // ── GATT Server ──────────────────────────────────────────────

    private fun startGattAndAdvertise() {
        val ctx = appContext.reactContext ?: run {
            Log.e(TAG, "No react context available")
            return
        }

        bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter

        if (bluetoothAdapter == null || bluetoothAdapter?.isEnabled != true) {
            Log.e(TAG, "Bluetooth is not available or not enabled")
            return
        }

        // Check permissions for Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val perms = listOf(
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            )
            val allGranted = perms.all {
                ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED
            }
            if (!allGranted) {
                Log.e(TAG, "BLE permissions not granted (BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT)")
                return
            }
        }

        // Set device name
        try {
            bluetoothAdapter?.name = deviceName
        } catch (e: SecurityException) {
            Log.w(TAG, "Cannot set device name: ${e.message}")
        }

        // Open GATT server
        try {
            gattServer = bluetoothManager?.openGattServer(ctx, gattServerCallback)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException opening GATT server: ${e.message}")
            return
        }

        if (gattServer == null) {
            Log.e(TAG, "Failed to open GATT server")
            return
        }

        // Build the service
        val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // RX characteristic — Central writes data here
        val rxChar = BluetoothGattCharacteristic(
            RX_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        // TX characteristic — Server notifies Central with responses
        val txChar = BluetoothGattCharacteristic(
            TX_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        // CCCD descriptor for notifications
        val cccd = BluetoothGattDescriptor(
            CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ
        )
        txChar.addDescriptor(cccd)

        service.addCharacteristic(rxChar)
        service.addCharacteristic(txChar)

        try {
            gattServer?.addService(service)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException adding service: ${e.message}")
            return
        }

        startAdvertising()
        Log.i(TAG, "GATT server started with service $serviceUuid")
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val deviceId = device.address
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedCentrals[deviceId] = device
                Log.i(TAG, "Central connected: $deviceId")
                sendEvent("onCentralConnected", mapOf("centralId" to deviceId))
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedCentrals.remove(deviceId)
                subscribedCentrals.remove(deviceId)
                Log.i(TAG, "Central disconnected: $deviceId")
                sendEvent("onCentralDisconnected", mapOf("centralId" to deviceId))
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (characteristic.uuid == RX_CHAR_UUID) {
                val data = value?.toString(Charsets.UTF_8) ?: ""
                Log.d(TAG, "Received write from ${device.address}: ${data.take(100)}...")
                sendEvent("onDataReceived", mapOf(
                    "centralId" to device.address,
                    "data" to data
                ))

                if (responseNeeded) {
                    try {
                        gattServer?.sendResponse(device, requestId,
                            BluetoothGatt.GATT_SUCCESS, 0, null)
                    } catch (e: SecurityException) {
                        Log.w(TAG, "SecurityException sending response: ${e.message}")
                    }
                }
            } else {
                if (responseNeeded) {
                    try {
                        gattServer?.sendResponse(device, requestId,
                            BluetoothGatt.GATT_FAILURE, 0, null)
                    } catch (e: SecurityException) {
                        Log.w(TAG, "SecurityException sending response: ${e.message}")
                    }
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (descriptor.uuid == CCCD_UUID) {
                val deviceId = device.address
                if (value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
                    subscribedCentrals[deviceId] = device
                    Log.i(TAG, "Central subscribed to notifications: $deviceId")
                } else {
                    subscribedCentrals.remove(deviceId)
                    Log.i(TAG, "Central unsubscribed from notifications: $deviceId")
                }

                if (responseNeeded) {
                    try {
                        gattServer?.sendResponse(device, requestId,
                            BluetoothGatt.GATT_SUCCESS, 0, null)
                    } catch (e: SecurityException) {
                        Log.w(TAG, "SecurityException sending response: ${e.message}")
                    }
                }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == TX_CHAR_UUID) {
                val data = metadata.toByteArray(Charsets.UTF_8)
                try {
                    gattServer?.sendResponse(device, requestId,
                        BluetoothGatt.GATT_SUCCESS, offset,
                        data.sliceArray(offset until data.size))
                } catch (e: SecurityException) {
                    Log.w(TAG, "SecurityException sending response: ${e.message}")
                }
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            Log.i(TAG, "MTU changed for ${device.address}: $mtu")
        }
    }

    // ── Advertising ──────────────────────────────────────────────

    private fun startAdvertising() {
        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        if (advertiser == null) {
            Log.e(TAG, "BLE advertising not supported on this device")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(serviceUuid))
            .build()

        // Scan response can contain additional data
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()

        try {
            advertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException starting advertising: ${e.message}")
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            advertising = true
            Log.i(TAG, "BLE advertising started successfully")
        }

        override fun onStartFailure(errorCode: Int) {
            advertising = false
            val reason = when (errorCode) {
                ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "UNSUPPORTED"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                else -> "UNKNOWN ($errorCode)"
            }
            Log.e(TAG, "BLE advertising failed: $reason")
        }
    }

    private fun stopAdvertising() {
        if (advertiser != null && advertising) {
            try {
                advertiser?.stopAdvertising(advertiseCallback)
            } catch (e: SecurityException) {
                Log.w(TAG, "SecurityException stopping advertising: ${e.message}")
            }
        }
        advertising = false
    }

    // ── Notification sending ─────────────────────────────────────

    private fun sendNotificationToDevice(centralId: String, data: String) {
        val device = subscribedCentrals[centralId] ?: connectedCentrals[centralId]
        if (device == null) {
            Log.w(TAG, "Cannot send notification — device $centralId not connected/subscribed")
            return
        }

        val service = gattServer?.getService(serviceUuid) ?: return
        val txChar = service.getCharacteristic(TX_CHAR_UUID) ?: return

        val bytes = data.toByteArray(Charsets.UTF_8)
        txChar.value = bytes

        try {
            val sent = gattServer?.notifyCharacteristicChanged(device, txChar, false)
            if (sent == true) {
                Log.d(TAG, "Notification sent to $centralId (${bytes.size} bytes)")
            } else {
                Log.w(TAG, "Notification not sent to $centralId")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException sending notification: ${e.message}")
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────

    private fun stopGattServer() {
        try {
            gattServer?.close()
        } catch (e: SecurityException) {
            Log.w(TAG, "SecurityException closing GATT server: ${e.message}")
        }
        gattServer = null
        connectedCentrals.clear()
        subscribedCentrals.clear()
    }
}
