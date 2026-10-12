#include "livekit/audio_device_controller.h"
#include "livekit/peer_connection_factory.h"
#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <string>
#include <type_traits>
#include <utility>

#ifdef __GNUC__
#pragma GCC diagnostic ignored "-Wmissing-declarations"
#ifdef __clang__
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__
#endif // __GNUC__

namespace rust {
inline namespace cxxbridge1 {
// #include "rust/cxx.h"

struct unsafe_bitcopy_t;

#ifndef CXXBRIDGE1_RUST_STRING
#define CXXBRIDGE1_RUST_STRING
class String final {
public:
  String() noexcept;
  String(const String &) noexcept;
  String(String &&) noexcept;
  ~String() noexcept;

  String(const std::string &);
  String(const char *);
  String(const char *, std::size_t);
  String(const char16_t *);
  String(const char16_t *, std::size_t);
#ifdef __cpp_char8_t
  String(const char8_t *s);
  String(const char8_t *s, std::size_t len);
#endif

  static String lossy(const std::string &) noexcept;
  static String lossy(const char *) noexcept;
  static String lossy(const char *, std::size_t) noexcept;
  static String lossy(const char16_t *) noexcept;
  static String lossy(const char16_t *, std::size_t) noexcept;

  String &operator=(const String &) & noexcept;
  String &operator=(String &&) & noexcept;

  explicit operator std::string() const;

  const char *data() const noexcept;
  std::size_t size() const noexcept;
  std::size_t length() const noexcept;
  bool empty() const noexcept;

  const char *c_str() noexcept;

  std::size_t capacity() const noexcept;
  void reserve(size_t new_cap) noexcept;

  using iterator = char *;
  iterator begin() noexcept;
  iterator end() noexcept;

  using const_iterator = const char *;
  const_iterator begin() const noexcept;
  const_iterator end() const noexcept;
  const_iterator cbegin() const noexcept;
  const_iterator cend() const noexcept;

  bool operator==(const String &) const noexcept;
  bool operator!=(const String &) const noexcept;
  bool operator<(const String &) const noexcept;
  bool operator<=(const String &) const noexcept;
  bool operator>(const String &) const noexcept;
  bool operator>=(const String &) const noexcept;

  void swap(String &) noexcept;

  String(unsafe_bitcopy_t, const String &) noexcept;

private:
  struct lossy_t;
  String(lossy_t, const char *, std::size_t) noexcept;
  String(lossy_t, const char16_t *, std::size_t) noexcept;
  friend void swap(String &lhs, String &rhs) noexcept { lhs.swap(rhs); }

  std::array<std::uintptr_t, 3> repr;
};
#endif // CXXBRIDGE1_RUST_STRING

#ifndef CXXBRIDGE1_RUST_BITCOPY_T
#define CXXBRIDGE1_RUST_BITCOPY_T
struct unsafe_bitcopy_t final {
  explicit unsafe_bitcopy_t() = default;
};
#endif // CXXBRIDGE1_RUST_BITCOPY_T

#ifndef CXXBRIDGE1_RUST_BITCOPY
#define CXXBRIDGE1_RUST_BITCOPY
constexpr unsafe_bitcopy_t unsafe_bitcopy{};
#endif // CXXBRIDGE1_RUST_BITCOPY

#ifndef CXXBRIDGE1_IS_COMPLETE
#define CXXBRIDGE1_IS_COMPLETE
namespace detail {
namespace {
template <typename T, typename = std::size_t>
struct is_complete : std::false_type {};
template <typename T>
struct is_complete<T, decltype(sizeof(T))> : std::true_type {};
} // namespace
} // namespace detail
#endif // CXXBRIDGE1_IS_COMPLETE

namespace {
template <typename T, bool = ::rust::detail::is_complete<T>::value>
struct is_destructible : ::std::false_type {};
template <typename T>
struct is_destructible<T, true> : ::std::is_destructible<T> {};
template <typename T>
struct is_destructible<T[], false> : is_destructible<T> {};
template <typename T, bool = ::rust::is_destructible<T>::value>
struct shared_ptr_if_destructible {
  explicit shared_ptr_if_destructible(typename ::std::shared_ptr<T>::element_type *) {}
};
template <typename T>
struct shared_ptr_if_destructible<T, true> : ::std::shared_ptr<T> {
  using ::std::shared_ptr<T>::shared_ptr;
};
} // namespace
} // namespace cxxbridge1
} // namespace rust

namespace livekit_ffi {
  using AudioDeviceController = ::livekit_ffi::AudioDeviceController;
}

namespace livekit_ffi {
extern "C" {
void livekit_ffi$cxxbridge1$202$PeerConnectionFactory$audio_device(::livekit_ffi::PeerConnectionFactory const &self, ::std::shared_ptr<::livekit_ffi::AudioDeviceController> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioDeviceController> (::livekit_ffi::PeerConnectionFactory::*audio_device$)() const = &::livekit_ffi::PeerConnectionFactory::audio_device;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioDeviceController>((self.*audio_device$)());
}

::std::int16_t livekit_ffi$cxxbridge1$202$AudioDeviceController$playout_devices(::livekit_ffi::AudioDeviceController const &self) noexcept {
  ::std::int16_t (::livekit_ffi::AudioDeviceController::*playout_devices$)() const = &::livekit_ffi::AudioDeviceController::playout_devices;
  return (self.*playout_devices$)();
}

::std::int16_t livekit_ffi$cxxbridge1$202$AudioDeviceController$recording_devices(::livekit_ffi::AudioDeviceController const &self) noexcept {
  ::std::int16_t (::livekit_ffi::AudioDeviceController::*recording_devices$)() const = &::livekit_ffi::AudioDeviceController::recording_devices;
  return (self.*recording_devices$)();
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$playout_device_name(::livekit_ffi::AudioDeviceController const &self, ::std::uint16_t index, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::AudioDeviceController::*playout_device_name$)(::std::uint16_t) const = &::livekit_ffi::AudioDeviceController::playout_device_name;
  new (return$) ::rust::String((self.*playout_device_name$)(index));
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$recording_device_name(::livekit_ffi::AudioDeviceController const &self, ::std::uint16_t index, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::AudioDeviceController::*recording_device_name$)(::std::uint16_t) const = &::livekit_ffi::AudioDeviceController::recording_device_name;
  new (return$) ::rust::String((self.*recording_device_name$)(index));
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$playout_device_guid(::livekit_ffi::AudioDeviceController const &self, ::std::uint16_t index, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::AudioDeviceController::*playout_device_guid$)(::std::uint16_t) const = &::livekit_ffi::AudioDeviceController::playout_device_guid;
  new (return$) ::rust::String((self.*playout_device_guid$)(index));
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$recording_device_guid(::livekit_ffi::AudioDeviceController const &self, ::std::uint16_t index, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::AudioDeviceController::*recording_device_guid$)(::std::uint16_t) const = &::livekit_ffi::AudioDeviceController::recording_device_guid;
  new (return$) ::rust::String((self.*recording_device_guid$)(index));
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$set_playout_device(::livekit_ffi::AudioDeviceController const &self, ::std::uint16_t index) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*set_playout_device$)(::std::uint16_t) const = &::livekit_ffi::AudioDeviceController::set_playout_device;
  return (self.*set_playout_device$)(index);
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$set_recording_device(::livekit_ffi::AudioDeviceController const &self, ::std::uint16_t index) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*set_recording_device$)(::std::uint16_t) const = &::livekit_ffi::AudioDeviceController::set_recording_device;
  return (self.*set_recording_device$)(index);
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$set_playout_device_by_guid(::livekit_ffi::AudioDeviceController const &self, ::rust::String const *guid) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*set_playout_device_by_guid$)(::rust::String) const = &::livekit_ffi::AudioDeviceController::set_playout_device_by_guid;
  return (self.*set_playout_device_by_guid$)(::rust::String(::rust::unsafe_bitcopy, *guid));
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$set_recording_device_by_guid(::livekit_ffi::AudioDeviceController const &self, ::rust::String const *guid) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*set_recording_device_by_guid$)(::rust::String) const = &::livekit_ffi::AudioDeviceController::set_recording_device_by_guid;
  return (self.*set_recording_device_by_guid$)(::rust::String(::rust::unsafe_bitcopy, *guid));
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$stop_recording(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*stop_recording$)() const = &::livekit_ffi::AudioDeviceController::stop_recording;
  return (self.*stop_recording$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$init_recording(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*init_recording$)() const = &::livekit_ffi::AudioDeviceController::init_recording;
  return (self.*init_recording$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$start_recording(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*start_recording$)() const = &::livekit_ffi::AudioDeviceController::start_recording;
  return (self.*start_recording$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$recording_is_initialized(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*recording_is_initialized$)() const = &::livekit_ffi::AudioDeviceController::recording_is_initialized;
  return (self.*recording_is_initialized$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$stop_playout(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*stop_playout$)() const = &::livekit_ffi::AudioDeviceController::stop_playout;
  return (self.*stop_playout$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$init_playout(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*init_playout$)() const = &::livekit_ffi::AudioDeviceController::init_playout;
  return (self.*init_playout$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$start_playout(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*start_playout$)() const = &::livekit_ffi::AudioDeviceController::start_playout;
  return (self.*start_playout$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$playout_is_initialized(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*playout_is_initialized$)() const = &::livekit_ffi::AudioDeviceController::playout_is_initialized;
  return (self.*playout_is_initialized$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$builtin_aec_is_available(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*builtin_aec_is_available$)() const = &::livekit_ffi::AudioDeviceController::builtin_aec_is_available;
  return (self.*builtin_aec_is_available$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$builtin_agc_is_available(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*builtin_agc_is_available$)() const = &::livekit_ffi::AudioDeviceController::builtin_agc_is_available;
  return (self.*builtin_agc_is_available$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$builtin_ns_is_available(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*builtin_ns_is_available$)() const = &::livekit_ffi::AudioDeviceController::builtin_ns_is_available;
  return (self.*builtin_ns_is_available$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$enable_builtin_aec(::livekit_ffi::AudioDeviceController const &self, bool enable) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*enable_builtin_aec$)(bool) const = &::livekit_ffi::AudioDeviceController::enable_builtin_aec;
  return (self.*enable_builtin_aec$)(enable);
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$enable_builtin_agc(::livekit_ffi::AudioDeviceController const &self, bool enable) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*enable_builtin_agc$)(bool) const = &::livekit_ffi::AudioDeviceController::enable_builtin_agc;
  return (self.*enable_builtin_agc$)(enable);
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$enable_builtin_ns(::livekit_ffi::AudioDeviceController const &self, bool enable) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*enable_builtin_ns$)(bool) const = &::livekit_ffi::AudioDeviceController::enable_builtin_ns;
  return (self.*enable_builtin_ns$)(enable);
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$set_adm_recording_enabled(::livekit_ffi::AudioDeviceController const &self, bool enabled) noexcept {
  void (::livekit_ffi::AudioDeviceController::*set_adm_recording_enabled$)(bool) const = &::livekit_ffi::AudioDeviceController::set_adm_recording_enabled;
  (self.*set_adm_recording_enabled$)(enabled);
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$adm_recording_enabled(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*adm_recording_enabled$)() const = &::livekit_ffi::AudioDeviceController::adm_recording_enabled;
  return (self.*adm_recording_enabled$)();
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$set_adm_playout_enabled(::livekit_ffi::AudioDeviceController const &self, bool enabled) noexcept {
  void (::livekit_ffi::AudioDeviceController::*set_adm_playout_enabled$)(bool) const = &::livekit_ffi::AudioDeviceController::set_adm_playout_enabled;
  (self.*set_adm_playout_enabled$)(enabled);
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$adm_playout_enabled(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*adm_playout_enabled$)() const = &::livekit_ffi::AudioDeviceController::adm_playout_enabled;
  return (self.*adm_playout_enabled$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$acquire_platform_adm(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*acquire_platform_adm$)() const = &::livekit_ffi::AudioDeviceController::acquire_platform_adm;
  return (self.*acquire_platform_adm$)();
}

void livekit_ffi$cxxbridge1$202$AudioDeviceController$release_platform_adm(::livekit_ffi::AudioDeviceController const &self) noexcept {
  void (::livekit_ffi::AudioDeviceController::*release_platform_adm$)() const = &::livekit_ffi::AudioDeviceController::release_platform_adm;
  (self.*release_platform_adm$)();
}

::std::int32_t livekit_ffi$cxxbridge1$202$AudioDeviceController$platform_adm_ref_count(::livekit_ffi::AudioDeviceController const &self) noexcept {
  ::std::int32_t (::livekit_ffi::AudioDeviceController::*platform_adm_ref_count$)() const = &::livekit_ffi::AudioDeviceController::platform_adm_ref_count;
  return (self.*platform_adm_ref_count$)();
}

bool livekit_ffi$cxxbridge1$202$AudioDeviceController$is_platform_adm_active(::livekit_ffi::AudioDeviceController const &self) noexcept {
  bool (::livekit_ffi::AudioDeviceController::*is_platform_adm_active$)() const = &::livekit_ffi::AudioDeviceController::is_platform_adm_active;
  return (self.*is_platform_adm_active$)();
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(sizeof(::std::shared_ptr<::livekit_ffi::AudioDeviceController>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::AudioDeviceController>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$AudioDeviceController$null(::std::shared_ptr<::livekit_ffi::AudioDeviceController> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::AudioDeviceController>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$AudioDeviceController$raw(::std::shared_ptr<::livekit_ffi::AudioDeviceController> *ptr, ::std::shared_ptr<::livekit_ffi::AudioDeviceController>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::AudioDeviceController>(raw);
  return ::rust::is_destructible<::livekit_ffi::AudioDeviceController>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$AudioDeviceController$clone(::std::shared_ptr<::livekit_ffi::AudioDeviceController> const &self, ::std::shared_ptr<::livekit_ffi::AudioDeviceController> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::AudioDeviceController>(self);
}
::std::shared_ptr<::livekit_ffi::AudioDeviceController>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$AudioDeviceController$get(::std::shared_ptr<::livekit_ffi::AudioDeviceController> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$AudioDeviceController$drop(::std::shared_ptr<::livekit_ffi::AudioDeviceController> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"
