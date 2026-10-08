Pod::Spec.new do |s|
  s.name           = 'ForgeCallService'
  s.version        = '1.0.0'
  s.summary        = 'ForgeChat : PBKDF2 et fichiers chiffrés de bout en bout en natif (iOS)'
  s.author         = 'Heiphaistos'
  s.homepage       = 'https://forgechat.heiphaistos.org'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.swift_version  = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
