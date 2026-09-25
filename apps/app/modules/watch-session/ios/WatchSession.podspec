Pod::Spec.new do |s|
  s.name           = 'WatchSession'
  s.version        = '1.0.0'
  s.summary        = 'Mirrors the session token to a shared iCloud keychain item for the watchOS app'
  s.description    = 'Publishes the iPhone session token into an iCloud-synchronizable keychain item the watchOS app can adopt'
  s.author         = ''
  s.homepage       = 'https://chat.moveto.kr'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
