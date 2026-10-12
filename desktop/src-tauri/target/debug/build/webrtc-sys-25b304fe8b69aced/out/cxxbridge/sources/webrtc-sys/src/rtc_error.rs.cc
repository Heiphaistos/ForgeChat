#include "livekit/rtc_error.h"
#include <array>
#include <cstdint>
#include <new>
#include <string>
#include <type_traits>

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
} // namespace cxxbridge1
} // namespace rust

#if __cplusplus >= 201402L
#define CXX_DEFAULT_VALUE(value) = value
#else
#define CXX_DEFAULT_VALUE(value)
#endif

namespace livekit_ffi {
  enum class RtcErrorType : ::std::int32_t;
  enum class RtcErrorDetailType : ::std::int32_t;
  struct RtcError;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$RtcErrorType
#define CXXBRIDGE1_ENUM_livekit_ffi$RtcErrorType
enum class RtcErrorType : ::std::int32_t {
  None = 0,
  UnsupportedOperation = 1,
  UnsupportedParameter = 2,
  InvalidParameter = 3,
  InvalidRange = 4,
  SyntaxError = 5,
  InvalidState = 6,
  InvalidModification = 7,
  NetworkError = 8,
  ResourceExhausted = 9,
  InternalError = 10,
  OperationErrorWithData = 11,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$RtcErrorType

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$RtcErrorDetailType
#define CXXBRIDGE1_ENUM_livekit_ffi$RtcErrorDetailType
enum class RtcErrorDetailType : ::std::int32_t {
  None = 0,
  DataChannelFailure = 1,
  DtlsFailure = 2,
  FingerprintFailure = 3,
  SctpFailure = 4,
  SdpSyntaxError = 5,
  HardwareEncoderNotAvailable = 6,
  HardwareEncoderError = 7,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$RtcErrorDetailType

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtcError
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtcError
struct RtcError final {
  ::livekit_ffi::RtcErrorType error_type;
  ::rust::String message;
  ::livekit_ffi::RtcErrorDetailType error_detail;
  bool has_sctp_cause_code CXX_DEFAULT_VALUE(false);
  ::std::uint16_t sctp_cause_code CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtcError

extern "C" {
void livekit_ffi$cxxbridge1$202$serialize_deserialize(::rust::String *return$) noexcept {
  ::rust::String (*serialize_deserialize$)() = ::livekit_ffi::serialize_deserialize;
  new (return$) ::rust::String(serialize_deserialize$());
}
} // extern "C"
} // namespace livekit_ffi
