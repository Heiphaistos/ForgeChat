#pragma once
#include "livekit/rtc_error.h"
#include "livekit/jsep.h"
#include "livekit/jsep.h"
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <type_traits>

#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__

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
} // namespace cxxbridge1
} // namespace rust

namespace livekit_ffi {
  enum class SdpType : ::std::int32_t;
  struct SdpParseError;
  using IceCandidate = ::livekit_ffi::IceCandidate;
  using SessionDescription = ::livekit_ffi::SessionDescription;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$SdpType
#define CXXBRIDGE1_ENUM_livekit_ffi$SdpType
enum class SdpType : ::std::int32_t {
  Offer = 0,
  PrAnswer = 1,
  Answer = 2,
  Rollback = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$SdpType

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$SdpParseError
#define CXXBRIDGE1_STRUCT_livekit_ffi$SdpParseError
struct SdpParseError final {
  ::rust::String line;
  ::rust::String description;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$SdpParseError
} // namespace livekit_ffi

#ifdef __clang__
#pragma clang diagnostic pop
#endif // __clang__
