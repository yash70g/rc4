import { requireNativeModule, EventEmitter, type EventSubscription } from 'expo-modules-core';

// ── Types ──────────────────────────────────────────────────────────────

export interface PeripheralConfig {
  serviceUuid: string;
  deviceName: string;
  metadata: string; // JSON string with page count, hash preview, etc.
}

export interface DataReceivedEvent {
  centralId: string;
  data: string; // raw string payload (a single BLE-level chunk)
}

export interface CentralConnectionEvent {
  centralId: string;
}

// ── Event Map ──────────────────────────────────────────────────────────

type PeripheralEvents = {
  onCentralConnected: (event: CentralConnectionEvent) => void;
  onCentralDisconnected: (event: CentralConnectionEvent) => void;
  onDataReceived: (event: DataReceivedEvent) => void;
};

// ── Native Module Access ────────────────────────────────────────────────

const ExoBlePeripheral = requireNativeModule('ExoBlePeripheral');
const emitter = new EventEmitter<PeripheralEvents>(ExoBlePeripheral);

// ── Functions ──────────────────────────────────────────────────────────

/**
 * Start the GATT server and begin BLE advertising.
 */
export async function startPeripheral(config: PeripheralConfig): Promise<void> {
  return await ExoBlePeripheral.startPeripheral(config);
}

/**
 * Stop advertising and tear down the GATT server.
 */
export async function stopPeripheral(): Promise<void> {
  return await ExoBlePeripheral.stopPeripheral();
}

/**
 * Send a notification (TX) to a connected Central device.
 * `data` is a string chunk (must be <= MTU-safe size, ~500 bytes).
 */
export async function sendNotification(
  centralId: string,
  data: string
): Promise<void> {
  return await ExoBlePeripheral.sendNotification(centralId, data);
}

/**
 * Update the metadata embedded in the advertising data.
 */
export async function updateAdvertisingData(metadata: string): Promise<void> {
  return await ExoBlePeripheral.updateAdvertisingData(metadata);
}

/**
 * Check if the peripheral is currently advertising.
 */
export function isAdvertising(): boolean {
  return ExoBlePeripheral.isAdvertising();
}

/**
 * Get list of connected central device IDs.
 */
export function getConnectedCentrals(): string[] {
  return ExoBlePeripheral.getConnectedCentrals();
}

// ── Events ─────────────────────────────────────────────────────────────

export function addCentralConnectedListener(
  listener: (event: CentralConnectionEvent) => void
): EventSubscription {
  return emitter.addListener("onCentralConnected", listener);
}

export function addCentralDisconnectedListener(
  listener: (event: CentralConnectionEvent) => void
): EventSubscription {
  return emitter.addListener("onCentralDisconnected", listener);
}

export function addDataReceivedListener(
  listener: (event: DataReceivedEvent) => void
): EventSubscription {
  return emitter.addListener("onDataReceived", listener);
}
