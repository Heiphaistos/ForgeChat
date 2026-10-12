Pod::Spec.new do |s|
  s.name           = 'ForgeAppIcon'
  s.version        = '1.0.0'
  s.summary        = 'ForgeChat : icônes d’application alternatives (iOS)'
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
