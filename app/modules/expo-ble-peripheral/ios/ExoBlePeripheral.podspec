Pod::Spec.new do |s|
  s.name           = 'ExoBlePeripheral'
  s.version        = '1.0.0'
  s.summary        = 'BLE Peripheral GATT Server for Reality Cache'
  s.description    = 'Expo native module providing BLE advertising and GATT server capabilities'
  s.author         = 'Reality Cache'
  s.homepage       = 'https://github.com/example/expo-ble-peripheral'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.module_name = 'ExoBlePeripheral'
  s.swift_version = '5.4'
end
