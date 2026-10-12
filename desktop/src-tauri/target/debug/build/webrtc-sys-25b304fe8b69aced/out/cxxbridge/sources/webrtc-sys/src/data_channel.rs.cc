#include "livekit/data_channel.h"
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

#ifndef CXXBRIDGE1_RUST_BOX
#define CXXBRIDGE1_RUST_BOX
template <typename T>
class Box final {
public:
  using element_type = T;
  using const_pointer =
      typename std::add_pointer<typename std::add_const<T>::type>::type;
  using pointer = typename std::add_pointer<T>::type;

  Box() = delete;
  Box(Box &&) noexcept;
  ~Box() noexcept;

  explicit Box(const T &);
  explicit Box(T &&);

  Box &operator=(Box &&) & noexcept;

  const T *operator->() const noexcept;
  const T &operator*() const noexcept;
  T *operator->() noexcept;
  T &operator*() noexcept;

  template <typename... Fields>
  static Box in_place(Fields &&...);

  void swap(Box &) noexcept;

  static Box from_raw(T *) noexcept;

  T *into_raw() noexcept;

  /* Deprecated */ using value_type = element_type;

private:
  class uninit;
  class allocation;
  Box(uninit) noexcept;
  void drop() noexcept;

  friend void swap(Box &lhs, Box &rhs) noexcept { lhs.swap(rhs); }

  T *ptr;
};

template <typename T>
class Box<T>::uninit {};

template <typename T>
class Box<T>::allocation {
  static T *alloc() noexcept;
  static void dealloc(T *) noexcept;

public:
  allocation() noexcept : ptr(alloc()) {}
  ~allocation() noexcept {
    if (this->ptr) {
      dealloc(this->ptr);
    }
  }
  T *ptr;
};

template <typename T>
Box<T>::Box(Box &&other) noexcept : ptr(other.ptr) {
  other.ptr = nullptr;
}

template <typename T>
Box<T>::Box(const T &val) {
  allocation alloc;
  ::new (alloc.ptr) T(val);
  this->ptr = alloc.ptr;
  alloc.ptr = nullptr;
}

template <typename T>
Box<T>::Box(T &&val) {
  allocation alloc;
  ::new (alloc.ptr) T(std::move(val));
  this->ptr = alloc.ptr;
  alloc.ptr = nullptr;
}

template <typename T>
Box<T>::~Box() noexcept {
  if (this->ptr) {
    this->drop();
  }
}

template <typename T>
Box<T> &Box<T>::operator=(Box &&other) & noexcept {
  if (this->ptr) {
    this->drop();
  }
  this->ptr = other.ptr;
  other.ptr = nullptr;
  return *this;
}

template <typename T>
const T *Box<T>::operator->() const noexcept {
  return this->ptr;
}

template <typename T>
const T &Box<T>::operator*() const noexcept {
  return *this->ptr;
}

template <typename T>
T *Box<T>::operator->() noexcept {
  return this->ptr;
}

template <typename T>
T &Box<T>::operator*() noexcept {
  return *this->ptr;
}

template <typename T>
template <typename... Fields>
Box<T> Box<T>::in_place(Fields &&...fields) {
  allocation alloc;
  auto ptr = alloc.ptr;
  ::new (ptr) T{std::forward<Fields>(fields)...};
  alloc.ptr = nullptr;
  return from_raw(ptr);
}

template <typename T>
void Box<T>::swap(Box &rhs) noexcept {
  using std::swap;
  swap(this->ptr, rhs.ptr);
}

template <typename T>
Box<T> Box<T>::from_raw(T *raw) noexcept {
  Box box = uninit{};
  box.ptr = raw;
  return box;
}

template <typename T>
T *Box<T>::into_raw() noexcept {
  T *raw = this->ptr;
  this->ptr = nullptr;
  return raw;
}

template <typename T>
Box<T>::Box(uninit) noexcept {}
#endif // CXXBRIDGE1_RUST_BOX

#ifndef CXXBRIDGE1_RUST_OPAQUE
#define CXXBRIDGE1_RUST_OPAQUE
class Opaque {
public:
  Opaque() = delete;
  Opaque(const Opaque &) = delete;
  ~Opaque() = delete;
};
#endif // CXXBRIDGE1_RUST_OPAQUE

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

#ifndef CXXBRIDGE1_LAYOUT
#define CXXBRIDGE1_LAYOUT
class layout {
  template <typename T>
  friend std::size_t size_of();
  template <typename T>
  friend std::size_t align_of();
  template <typename T>
  static typename std::enable_if<std::is_base_of<Opaque, T>::value,
                                 std::size_t>::type
  do_size_of() {
    return T::layout::size();
  }
  template <typename T>
  static typename std::enable_if<!std::is_base_of<Opaque, T>::value,
                                 std::size_t>::type
  do_size_of() {
    return sizeof(T);
  }
  template <typename T>
  static
      typename std::enable_if<detail::is_complete<T>::value, std::size_t>::type
      size_of() {
    return do_size_of<T>();
  }
  template <typename T>
  static typename std::enable_if<std::is_base_of<Opaque, T>::value,
                                 std::size_t>::type
  do_align_of() {
    return T::layout::align();
  }
  template <typename T>
  static typename std::enable_if<!std::is_base_of<Opaque, T>::value,
                                 std::size_t>::type
  do_align_of() {
    return alignof(T);
  }
  template <typename T>
  static
      typename std::enable_if<detail::is_complete<T>::value, std::size_t>::type
      align_of() {
    return do_align_of<T>();
  }
};

template <typename T>
std::size_t size_of() {
  return layout::size_of<T>();
}

template <typename T>
std::size_t align_of() {
  return layout::align_of<T>();
}
#endif // CXXBRIDGE1_LAYOUT

template <typename T>
union ManuallyDrop {
  T value;
  ManuallyDrop(T &&value) : value(::std::move(value)) {}
  ~ManuallyDrop() {}
};

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

#if __cplusplus >= 201402L
#define CXX_DEFAULT_VALUE(value) = value
#else
#define CXX_DEFAULT_VALUE(value)
#endif

namespace livekit_ffi {
  enum class Priority : ::std::int32_t;
  struct DataChannelInit;
  struct DataBuffer;
  enum class DataState : ::std::int32_t;
  using DataChannel = ::livekit_ffi::DataChannel;
  struct DataChannelObserverWrapper;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$Priority
#define CXXBRIDGE1_ENUM_livekit_ffi$Priority
enum class Priority : ::std::int32_t {
  VeryLow = 0,
  Low = 1,
  Medium = 2,
  High = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$Priority

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$DataChannelInit
#define CXXBRIDGE1_STRUCT_livekit_ffi$DataChannelInit
struct DataChannelInit final {
  bool ordered CXX_DEFAULT_VALUE(false);
  bool has_max_retransmit_time CXX_DEFAULT_VALUE(false);
  ::std::int32_t max_retransmit_time CXX_DEFAULT_VALUE(0);
  bool has_max_retransmits CXX_DEFAULT_VALUE(false);
  ::std::int32_t max_retransmits CXX_DEFAULT_VALUE(0);
  ::rust::String protocol;
  bool negotiated CXX_DEFAULT_VALUE(false);
  ::std::int32_t id CXX_DEFAULT_VALUE(0);
  bool has_priority CXX_DEFAULT_VALUE(false);
  ::livekit_ffi::Priority priority;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$DataChannelInit

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$DataBuffer
#define CXXBRIDGE1_STRUCT_livekit_ffi$DataBuffer
struct DataBuffer final {
  ::std::uint8_t const *ptr CXX_DEFAULT_VALUE(nullptr);
  ::std::size_t len CXX_DEFAULT_VALUE(0);
  bool binary CXX_DEFAULT_VALUE(false);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$DataBuffer

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$DataState
#define CXXBRIDGE1_ENUM_livekit_ffi$DataState
enum class DataState : ::std::int32_t {
  Connecting = 0,
  Open = 1,
  Closing = 2,
  Closed = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$DataState

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$DataChannelObserverWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$DataChannelObserverWrapper
struct DataChannelObserverWrapper final : public ::rust::Opaque {
  void on_state_change(::livekit_ffi::DataState state) const noexcept;
  void on_message(::livekit_ffi::DataBuffer buffer) const noexcept;
  void on_buffered_amount_change(::std::uint64_t sent_data_size) const noexcept;
  ~DataChannelObserverWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$DataChannelObserverWrapper

extern "C" {
void livekit_ffi$cxxbridge1$202$DataChannel$register_observer(::livekit_ffi::DataChannel const &self, ::livekit_ffi::DataChannelObserverWrapper *observer) noexcept {
  void (::livekit_ffi::DataChannel::*register_observer$)(::rust::Box<::livekit_ffi::DataChannelObserverWrapper>) const = &::livekit_ffi::DataChannel::register_observer;
  (self.*register_observer$)(::rust::Box<::livekit_ffi::DataChannelObserverWrapper>::from_raw(observer));
}

void livekit_ffi$cxxbridge1$202$DataChannel$unregister_observer(::livekit_ffi::DataChannel const &self) noexcept {
  void (::livekit_ffi::DataChannel::*unregister_observer$)() const = &::livekit_ffi::DataChannel::unregister_observer;
  (self.*unregister_observer$)();
}

bool livekit_ffi$cxxbridge1$202$DataChannel$send(::livekit_ffi::DataChannel const &self, ::livekit_ffi::DataBuffer const &data) noexcept {
  bool (::livekit_ffi::DataChannel::*send$)(::livekit_ffi::DataBuffer const &) const = &::livekit_ffi::DataChannel::send;
  return (self.*send$)(data);
}

::std::int32_t livekit_ffi$cxxbridge1$202$DataChannel$id(::livekit_ffi::DataChannel const &self) noexcept {
  ::std::int32_t (::livekit_ffi::DataChannel::*id$)() const = &::livekit_ffi::DataChannel::id;
  return (self.*id$)();
}

void livekit_ffi$cxxbridge1$202$DataChannel$label(::livekit_ffi::DataChannel const &self, ::rust::String *return$) noexcept {
  ::rust::String (::livekit_ffi::DataChannel::*label$)() const = &::livekit_ffi::DataChannel::label;
  new (return$) ::rust::String((self.*label$)());
}

::livekit_ffi::DataState livekit_ffi$cxxbridge1$202$DataChannel$state(::livekit_ffi::DataChannel const &self) noexcept {
  ::livekit_ffi::DataState (::livekit_ffi::DataChannel::*state$)() const = &::livekit_ffi::DataChannel::state;
  return (self.*state$)();
}

void livekit_ffi$cxxbridge1$202$DataChannel$close(::livekit_ffi::DataChannel const &self) noexcept {
  void (::livekit_ffi::DataChannel::*close$)() const = &::livekit_ffi::DataChannel::close;
  (self.*close$)();
}

::std::uint64_t livekit_ffi$cxxbridge1$202$DataChannel$buffered_amount(::livekit_ffi::DataChannel const &self) noexcept {
  ::std::uint64_t (::livekit_ffi::DataChannel::*buffered_amount$)() const = &::livekit_ffi::DataChannel::buffered_amount;
  return (self.*buffered_amount$)();
}

void livekit_ffi$cxxbridge1$202$_shared_data_channel(::std::shared_ptr<::livekit_ffi::DataChannel> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::DataChannel> (*_shared_data_channel$)() = ::livekit_ffi::_shared_data_channel;
  new (return$) ::std::shared_ptr<::livekit_ffi::DataChannel>(_shared_data_channel$());
}
::std::size_t livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$operator$alignof() noexcept;

void livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$on_state_change(::livekit_ffi::DataChannelObserverWrapper const &self, ::livekit_ffi::DataState state) noexcept;

void livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$on_message(::livekit_ffi::DataChannelObserverWrapper const &self, ::livekit_ffi::DataBuffer *buffer) noexcept;

void livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$on_buffered_amount_change(::livekit_ffi::DataChannelObserverWrapper const &self, ::std::uint64_t sent_data_size) noexcept;
} // extern "C"

::std::size_t DataChannelObserverWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$operator$sizeof();
}

::std::size_t DataChannelObserverWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$operator$alignof();
}

void DataChannelObserverWrapper::on_state_change(::livekit_ffi::DataState state) const noexcept {
  livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$on_state_change(*this, state);
}

void DataChannelObserverWrapper::on_message(::livekit_ffi::DataBuffer buffer) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::DataBuffer> buffer$(::std::move(buffer));
  livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$on_message(*this, &buffer$.value);
}

void DataChannelObserverWrapper::on_buffered_amount_change(::std::uint64_t sent_data_size) const noexcept {
  livekit_ffi$cxxbridge1$202$DataChannelObserverWrapper$on_buffered_amount_change(*this, sent_data_size);
}
} // namespace livekit_ffi

extern "C" {
::livekit_ffi::DataChannelObserverWrapper *cxxbridge1$box$livekit_ffi$DataChannelObserverWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$DataChannelObserverWrapper$dealloc(::livekit_ffi::DataChannelObserverWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$DataChannelObserverWrapper$drop(::rust::Box<::livekit_ffi::DataChannelObserverWrapper> *ptr) noexcept;

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::DataChannel>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::DataChannel>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$DataChannel$null(::std::shared_ptr<::livekit_ffi::DataChannel> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::DataChannel>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$DataChannel$raw(::std::shared_ptr<::livekit_ffi::DataChannel> *ptr, ::std::shared_ptr<::livekit_ffi::DataChannel>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::DataChannel>(raw);
  return ::rust::is_destructible<::livekit_ffi::DataChannel>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$DataChannel$clone(::std::shared_ptr<::livekit_ffi::DataChannel> const &self, ::std::shared_ptr<::livekit_ffi::DataChannel> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::DataChannel>(self);
}
::std::shared_ptr<::livekit_ffi::DataChannel>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$DataChannel$get(::std::shared_ptr<::livekit_ffi::DataChannel> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$DataChannel$drop(::std::shared_ptr<::livekit_ffi::DataChannel> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
::livekit_ffi::DataChannelObserverWrapper *Box<::livekit_ffi::DataChannelObserverWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$DataChannelObserverWrapper$alloc();
}
template <>
void Box<::livekit_ffi::DataChannelObserverWrapper>::allocation::dealloc(::livekit_ffi::DataChannelObserverWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$DataChannelObserverWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::DataChannelObserverWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$DataChannelObserverWrapper$drop(this);
}
} // namespace cxxbridge1
} // namespace rust
