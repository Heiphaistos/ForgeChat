#include "livekit/media_stream_track.h"
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
  enum class TrackState : ::std::int32_t;
  using MediaStreamTrack = ::livekit_ffi::MediaStreamTrack;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$TrackState
#define CXXBRIDGE1_ENUM_livekit_ffi$TrackState
enum class TrackState : ::std::int32_t {
  Live = 0,
  Ended = 1,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$TrackState

extern "C" {
void livekit_ffi$cxxbridge1$202$MediaStreamTrack$kind(::livekit_ffi::MediaStreamTrack const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::MediaStreamTrack::*kind$)() const = &::livekit_ffi::MediaStreamTrack::kind;
  new (return$) ::rust::String((self.*kind$)());
}

void livekit_ffi$cxxbridge1$202$MediaStreamTrack$id(::livekit_ffi::MediaStreamTrack const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::MediaStreamTrack::*id$)() const = &::livekit_ffi::MediaStreamTrack::id;
  new (return$) ::rust::String((self.*id$)());
}

bool livekit_ffi$cxxbridge1$202$MediaStreamTrack$enabled(::livekit_ffi::MediaStreamTrack const &self) noexcept {
  bool (::livekit_ffi::MediaStreamTrack::*enabled$)() const = &::livekit_ffi::MediaStreamTrack::enabled;
  return (self.*enabled$)();
}

bool livekit_ffi$cxxbridge1$202$MediaStreamTrack$set_enabled(::livekit_ffi::MediaStreamTrack const &self, bool enable) noexcept {
  bool (::livekit_ffi::MediaStreamTrack::*set_enabled$)(bool) const = &::livekit_ffi::MediaStreamTrack::set_enabled;
  return (self.*set_enabled$)(enable);
}

::livekit_ffi::TrackState livekit_ffi$cxxbridge1$202$MediaStreamTrack$state(::livekit_ffi::MediaStreamTrack const &self) noexcept {
  ::livekit_ffi::TrackState (::livekit_ffi::MediaStreamTrack::*state$)() const = &::livekit_ffi::MediaStreamTrack::state;
  return (self.*state$)();
}

void livekit_ffi$cxxbridge1$202$_shared_media_stream_track(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::MediaStreamTrack> (*_shared_media_stream_track$)() = ::livekit_ffi::_shared_media_stream_track;
  new (return$) ::std::shared_ptr<::livekit_ffi::MediaStreamTrack>(_shared_media_stream_track$());
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(sizeof(::std::shared_ptr<::livekit_ffi::MediaStreamTrack>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::MediaStreamTrack>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$MediaStreamTrack$null(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::MediaStreamTrack>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$MediaStreamTrack$raw(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *ptr, ::std::shared_ptr<::livekit_ffi::MediaStreamTrack>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::MediaStreamTrack>(raw);
  return ::rust::is_destructible<::livekit_ffi::MediaStreamTrack>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$MediaStreamTrack$clone(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> const &self, ::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::MediaStreamTrack>(self);
}
::std::shared_ptr<::livekit_ffi::MediaStreamTrack>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$MediaStreamTrack$get(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$MediaStreamTrack$drop(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"
