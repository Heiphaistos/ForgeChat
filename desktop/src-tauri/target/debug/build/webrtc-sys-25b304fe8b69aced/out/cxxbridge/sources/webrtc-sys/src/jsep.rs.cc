#include "livekit/rtc_error.h"
#include "livekit/jsep.h"
#include "livekit/jsep.h"
#include <array>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <new>
#include <string>
#include <type_traits>
#include <utility>

#ifdef __GNUC__
#pragma GCC diagnostic ignored "-Wmissing-declarations"
#pragma GCC diagnostic ignored "-Wshadow"
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

namespace repr {
struct PtrLen final {
  void *ptr;
  ::std::size_t len;
};
} // namespace repr

namespace detail {
class Fail final {
  ::rust::repr::PtrLen &throw$;
public:
  Fail(::rust::repr::PtrLen &throw$) noexcept : throw$(throw$) {}
  void operator()(char const *) noexcept;
  void operator()(std::string const &) noexcept;
};
} // namespace detail

namespace {
template <bool> struct deleter_if {
  template <typename T> void operator()(T *) {}
};
template <> struct deleter_if<true> {
  template <typename T> void operator()(T *ptr) { ptr->~T(); }
};

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

namespace behavior {
class missing {};
missing trycatch(...);

template <typename Try, typename Fail>
static typename ::std::enable_if<::std::is_same<
    decltype(trycatch(::std::declval<Try>(), ::std::declval<Fail>())),
    missing>::value>::type
trycatch(Try &&func, Fail &&fail) noexcept try {
  func();
} catch (::std::exception const &e) {
  fail(e.what());
}
} // namespace behavior
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

extern "C" {
void livekit_ffi$cxxbridge1$202$IceCandidate$sdp_mid(::livekit_ffi::IceCandidate const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::IceCandidate::*sdp_mid$)() const = &::livekit_ffi::IceCandidate::sdp_mid;
  new (return$) ::rust::String((self.*sdp_mid$)());
}

::std::int32_t livekit_ffi$cxxbridge1$202$IceCandidate$sdp_mline_index(::livekit_ffi::IceCandidate const &self) noexcept {
  ::std::int32_t (::livekit_ffi::IceCandidate::*sdp_mline_index$)() const = &::livekit_ffi::IceCandidate::sdp_mline_index;
  return (self.*sdp_mline_index$)();
}

void livekit_ffi$cxxbridge1$202$IceCandidate$candidate(::livekit_ffi::IceCandidate const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::IceCandidate::*candidate$)() const = &::livekit_ffi::IceCandidate::candidate;
  new (return$) ::rust::String((self.*candidate$)());
}

void livekit_ffi$cxxbridge1$202$IceCandidate$stringify(::livekit_ffi::IceCandidate const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::IceCandidate::*stringify$)() const = &::livekit_ffi::IceCandidate::stringify;
  new (return$) ::rust::String((self.*stringify$)());
}

::livekit_ffi::SdpType livekit_ffi$cxxbridge1$202$SessionDescription$sdp_type(::livekit_ffi::SessionDescription const &self) noexcept {
  ::livekit_ffi::SdpType (::livekit_ffi::SessionDescription::*sdp_type$)() const = &::livekit_ffi::SessionDescription::sdp_type;
  return (self.*sdp_type$)();
}

void livekit_ffi$cxxbridge1$202$SessionDescription$stringify(::livekit_ffi::SessionDescription const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::SessionDescription::*stringify$)() const = &::livekit_ffi::SessionDescription::stringify;
  new (return$) ::rust::String((self.*stringify$)());
}

::livekit_ffi::SessionDescription *livekit_ffi$cxxbridge1$202$SessionDescription$clone(::livekit_ffi::SessionDescription const &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::SessionDescription> (::livekit_ffi::SessionDescription::*clone$)() const = &::livekit_ffi::SessionDescription::clone;
  return (self.*clone$)().release();
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$create_ice_candidate(::rust::String const *sdp_mid, ::std::int32_t sdp_mline_index, ::rust::String const *sdp, ::std::shared_ptr<::livekit_ffi::IceCandidate> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::IceCandidate> (*create_ice_candidate$)(::rust::String, ::std::int32_t, ::rust::String) = ::livekit_ffi::create_ice_candidate;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        new (return$) ::std::shared_ptr<::livekit_ffi::IceCandidate>(create_ice_candidate$(::rust::String(::rust::unsafe_bitcopy, *sdp_mid), sdp_mline_index, ::rust::String(::rust::unsafe_bitcopy, *sdp)));
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$create_session_description(::livekit_ffi::SdpType sdp_type, ::rust::String const *sdp, ::livekit_ffi::SessionDescription **return$) noexcept {
  ::std::unique_ptr<::livekit_ffi::SessionDescription> (*create_session_description$)(::livekit_ffi::SdpType, ::rust::String) = ::livekit_ffi::create_session_description;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        new (return$) ::livekit_ffi::SessionDescription *(create_session_description$(sdp_type, ::rust::String(::rust::unsafe_bitcopy, *sdp)).release());
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

void livekit_ffi$cxxbridge1$202$_shared_ice_candidate(::std::shared_ptr<::livekit_ffi::IceCandidate> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::IceCandidate> (*_shared_ice_candidate$)() = ::livekit_ffi::_shared_ice_candidate;
  new (return$) ::std::shared_ptr<::livekit_ffi::IceCandidate>(_shared_ice_candidate$());
}

::livekit_ffi::SessionDescription *livekit_ffi$cxxbridge1$202$_unique_session_description() noexcept {
  ::std::unique_ptr<::livekit_ffi::SessionDescription> (*_unique_session_description$)() = ::livekit_ffi::_unique_session_description;
  return _unique_session_description$().release();
}

void livekit_ffi$cxxbridge1$202$serialize_sdp_parse_error_for_test(::rust::String *return$) noexcept {
  ::rust::String (*serialize_sdp_parse_error_for_test$)() = ::livekit_ffi::serialize_sdp_parse_error_for_test;
  new (return$) ::rust::String(serialize_sdp_parse_error_for_test$());
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::SessionDescription>::type>::value, "definition of `::livekit_ffi::SessionDescription` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::SessionDescription>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::SessionDescription>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$SessionDescription$null(::std::unique_ptr<::livekit_ffi::SessionDescription> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::SessionDescription>();
}
void cxxbridge1$unique_ptr$livekit_ffi$SessionDescription$raw(::std::unique_ptr<::livekit_ffi::SessionDescription> *ptr, ::std::unique_ptr<::livekit_ffi::SessionDescription>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::SessionDescription>(raw);
}
::std::unique_ptr<::livekit_ffi::SessionDescription>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$SessionDescription$get(::std::unique_ptr<::livekit_ffi::SessionDescription> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::SessionDescription>::pointer cxxbridge1$unique_ptr$livekit_ffi$SessionDescription$release(::std::unique_ptr<::livekit_ffi::SessionDescription> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$SessionDescription$drop(::std::unique_ptr<::livekit_ffi::SessionDescription> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::SessionDescription>::value>{}(ptr);
}

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::IceCandidate>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::IceCandidate>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$IceCandidate$null(::std::shared_ptr<::livekit_ffi::IceCandidate> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::IceCandidate>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$IceCandidate$raw(::std::shared_ptr<::livekit_ffi::IceCandidate> *ptr, ::std::shared_ptr<::livekit_ffi::IceCandidate>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::IceCandidate>(raw);
  return ::rust::is_destructible<::livekit_ffi::IceCandidate>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$IceCandidate$clone(::std::shared_ptr<::livekit_ffi::IceCandidate> const &self, ::std::shared_ptr<::livekit_ffi::IceCandidate> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::IceCandidate>(self);
}
::std::shared_ptr<::livekit_ffi::IceCandidate>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$IceCandidate$get(::std::shared_ptr<::livekit_ffi::IceCandidate> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$IceCandidate$drop(::std::shared_ptr<::livekit_ffi::IceCandidate> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"
