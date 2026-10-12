#include "livekit/webrtc.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <iterator>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#if __cplusplus >= 202002L
#include <ranges>
#endif

#ifdef __GNUC__
#pragma GCC diagnostic ignored "-Wmissing-declarations"
#ifdef __clang__
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#pragma clang diagnostic ignored "-Wreturn-type-c-linkage"
#endif // __clang__
#endif // __GNUC__

namespace rust {
inline namespace cxxbridge1 {
// #include "rust/cxx.h"

#ifndef CXXBRIDGE1_PANIC
#define CXXBRIDGE1_PANIC
template <typename Exception>
void panic [[noreturn]] (const char *msg);
#endif // CXXBRIDGE1_PANIC

struct unsafe_bitcopy_t;

namespace {
template <typename T>
class impl;
} // namespace

class Opaque;

template <typename T>
::std::size_t size_of();
template <typename T>
::std::size_t align_of();

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

#ifndef CXXBRIDGE1_RUST_SLICE
#define CXXBRIDGE1_RUST_SLICE
namespace detail {
template <bool>
struct copy_assignable_if {};

template <>
struct copy_assignable_if<false> {
  copy_assignable_if() noexcept = default;
  copy_assignable_if(const copy_assignable_if &) noexcept = default;
  copy_assignable_if &operator=(const copy_assignable_if &) & noexcept = delete;
  copy_assignable_if &operator=(copy_assignable_if &&) & noexcept = default;
};
} // namespace detail

template <typename T>
class Slice final
    : private detail::copy_assignable_if<std::is_const<T>::value> {
public:
  using value_type = T;

  Slice() noexcept;
  Slice(T *, std::size_t count) noexcept;

  template <typename C>
  explicit Slice(C &c) : Slice(c.data(), c.size()) {}

  Slice &operator=(const Slice<T> &) & noexcept = default;
  Slice &operator=(Slice<T> &&) & noexcept = default;

  T *data() const noexcept;
  std::size_t size() const noexcept;
  std::size_t length() const noexcept;
  bool empty() const noexcept;

  T &operator[](std::size_t n) const noexcept;
  T &at(std::size_t n) const;
  T &front() const noexcept;
  T &back() const noexcept;

  Slice(const Slice<T> &) noexcept = default;
  ~Slice() noexcept = default;

  class iterator;
  iterator begin() const noexcept;
  iterator end() const noexcept;

  void swap(Slice &) noexcept;

private:
  class uninit;
  Slice(uninit) noexcept;
  friend impl<Slice>;
  friend void sliceInit(void *, const void *, std::size_t) noexcept;
  friend void *slicePtr(const void *) noexcept;
  friend std::size_t sliceLen(const void *) noexcept;

  std::array<std::uintptr_t, 2> repr;
};

#ifdef __cpp_deduction_guides
template <typename C>
explicit Slice(C &c)
    -> Slice<std::remove_reference_t<decltype(*std::declval<C>().data())>>;
#endif // __cpp_deduction_guides

template <typename T>
class Slice<T>::iterator final {
public:
#if __cplusplus >= 202002L
  using iterator_category = std::contiguous_iterator_tag;
#else
  using iterator_category = std::random_access_iterator_tag;
#endif
  using value_type = T;
  using difference_type = std::ptrdiff_t;
  using pointer = typename std::add_pointer<T>::type;
  using reference = typename std::add_lvalue_reference<T>::type;

  reference operator*() const noexcept;
  pointer operator->() const noexcept;
  reference operator[](difference_type) const noexcept;

  iterator &operator++() noexcept;
  iterator operator++(int) noexcept;
  iterator &operator--() noexcept;
  iterator operator--(int) noexcept;

  iterator &operator+=(difference_type) noexcept;
  iterator &operator-=(difference_type) noexcept;
  iterator operator+(difference_type) const noexcept;
  friend inline iterator operator+(difference_type lhs, iterator rhs) noexcept {
    return rhs + lhs;
  }
  iterator operator-(difference_type) const noexcept;
  difference_type operator-(const iterator &) const noexcept;

  bool operator==(const iterator &) const noexcept;
  bool operator!=(const iterator &) const noexcept;
  bool operator<(const iterator &) const noexcept;
  bool operator<=(const iterator &) const noexcept;
  bool operator>(const iterator &) const noexcept;
  bool operator>=(const iterator &) const noexcept;

private:
  friend class Slice;
  void *pos;
  std::size_t stride;
};

template <typename T>
Slice<T>::Slice() noexcept {
  sliceInit(this, reinterpret_cast<void *>(align_of<T>()), 0);
}

template <typename T>
Slice<T>::Slice(T *s, std::size_t count) noexcept {
  assert(s != nullptr || count == 0);
  sliceInit(this,
            s == nullptr && count == 0
                ? reinterpret_cast<void *>(align_of<T>())
                : const_cast<typename std::remove_const<T>::type *>(s),
            count);
}

template <typename T>
T *Slice<T>::data() const noexcept {
  return reinterpret_cast<T *>(slicePtr(this));
}

template <typename T>
std::size_t Slice<T>::size() const noexcept {
  return sliceLen(this);
}

template <typename T>
std::size_t Slice<T>::length() const noexcept {
  return this->size();
}

template <typename T>
bool Slice<T>::empty() const noexcept {
  return this->size() == 0;
}

template <typename T>
T &Slice<T>::operator[](std::size_t n) const noexcept {
  assert(n < this->size());
  auto ptr = static_cast<char *>(slicePtr(this)) + size_of<T>() * n;
  return *reinterpret_cast<T *>(ptr);
}

template <typename T>
T &Slice<T>::at(std::size_t n) const {
  if (n >= this->size()) {
    panic<std::out_of_range>("rust::Slice index out of range");
  }
  return (*this)[n];
}

template <typename T>
T &Slice<T>::front() const noexcept {
  assert(!this->empty());
  return (*this)[0];
}

template <typename T>
T &Slice<T>::back() const noexcept {
  assert(!this->empty());
  return (*this)[this->size() - 1];
}

template <typename T>
typename Slice<T>::iterator::reference
Slice<T>::iterator::operator*() const noexcept {
  return *static_cast<T *>(this->pos);
}

template <typename T>
typename Slice<T>::iterator::pointer
Slice<T>::iterator::operator->() const noexcept {
  return static_cast<T *>(this->pos);
}

template <typename T>
typename Slice<T>::iterator::reference Slice<T>::iterator::operator[](
    typename Slice<T>::iterator::difference_type n) const noexcept {
  auto ptr = static_cast<char *>(this->pos) + this->stride * n;
  return *reinterpret_cast<T *>(ptr);
}

template <typename T>
typename Slice<T>::iterator &Slice<T>::iterator::operator++() noexcept {
  this->pos = static_cast<char *>(this->pos) + this->stride;
  return *this;
}

template <typename T>
typename Slice<T>::iterator Slice<T>::iterator::operator++(int) noexcept {
  auto ret = iterator(*this);
  this->pos = static_cast<char *>(this->pos) + this->stride;
  return ret;
}

template <typename T>
typename Slice<T>::iterator &Slice<T>::iterator::operator--() noexcept {
  this->pos = static_cast<char *>(this->pos) - this->stride;
  return *this;
}

template <typename T>
typename Slice<T>::iterator Slice<T>::iterator::operator--(int) noexcept {
  auto ret = iterator(*this);
  this->pos = static_cast<char *>(this->pos) - this->stride;
  return ret;
}

template <typename T>
typename Slice<T>::iterator &Slice<T>::iterator::operator+=(
    typename Slice<T>::iterator::difference_type n) noexcept {
  this->pos = static_cast<char *>(this->pos) + this->stride * n;
  return *this;
}

template <typename T>
typename Slice<T>::iterator &Slice<T>::iterator::operator-=(
    typename Slice<T>::iterator::difference_type n) noexcept {
  this->pos = static_cast<char *>(this->pos) - this->stride * n;
  return *this;
}

template <typename T>
typename Slice<T>::iterator Slice<T>::iterator::operator+(
    typename Slice<T>::iterator::difference_type n) const noexcept {
  auto ret = iterator(*this);
  ret.pos = static_cast<char *>(this->pos) + this->stride * n;
  return ret;
}

template <typename T>
typename Slice<T>::iterator Slice<T>::iterator::operator-(
    typename Slice<T>::iterator::difference_type n) const noexcept {
  auto ret = iterator(*this);
  ret.pos = static_cast<char *>(this->pos) - this->stride * n;
  return ret;
}

template <typename T>
typename Slice<T>::iterator::difference_type
Slice<T>::iterator::operator-(const iterator &other) const noexcept {
  auto diff = std::distance(static_cast<char *>(other.pos),
                            static_cast<char *>(this->pos));
  return diff / static_cast<typename Slice<T>::iterator::difference_type>(
                    this->stride);
}

template <typename T>
bool Slice<T>::iterator::operator==(const iterator &other) const noexcept {
  return this->pos == other.pos;
}

template <typename T>
bool Slice<T>::iterator::operator!=(const iterator &other) const noexcept {
  return this->pos != other.pos;
}

template <typename T>
bool Slice<T>::iterator::operator<(const iterator &other) const noexcept {
  return this->pos < other.pos;
}

template <typename T>
bool Slice<T>::iterator::operator<=(const iterator &other) const noexcept {
  return this->pos <= other.pos;
}

template <typename T>
bool Slice<T>::iterator::operator>(const iterator &other) const noexcept {
  return this->pos > other.pos;
}

template <typename T>
bool Slice<T>::iterator::operator>=(const iterator &other) const noexcept {
  return this->pos >= other.pos;
}

template <typename T>
typename Slice<T>::iterator Slice<T>::begin() const noexcept {
  iterator it;
  it.pos = slicePtr(this);
  it.stride = size_of<T>();
  return it;
}

template <typename T>
typename Slice<T>::iterator Slice<T>::end() const noexcept {
  iterator it = this->begin();
  it.pos = static_cast<char *>(it.pos) + it.stride * this->size();
  return it;
}

template <typename T>
void Slice<T>::swap(Slice &rhs) noexcept {
  std::swap(*this, rhs);
}
#endif // CXXBRIDGE1_RUST_SLICE

#ifndef CXXBRIDGE1_RUST_BITCOPY_T
#define CXXBRIDGE1_RUST_BITCOPY_T
struct unsafe_bitcopy_t final {
  explicit unsafe_bitcopy_t() = default;
};
#endif // CXXBRIDGE1_RUST_BITCOPY_T

#ifndef CXXBRIDGE1_RUST_VEC
#define CXXBRIDGE1_RUST_VEC
template <typename T>
class Vec final {
public:
  using value_type = T;

  Vec() noexcept;
  Vec(std::initializer_list<T>);
  Vec(const Vec &);
  Vec(Vec &&) noexcept;
  ~Vec() noexcept;

  Vec &operator=(Vec &&) & noexcept;
  Vec &operator=(const Vec &) &;

  std::size_t size() const noexcept;
  bool empty() const noexcept;
  const T *data() const noexcept;
  T *data() noexcept;
  std::size_t capacity() const noexcept;

  const T &operator[](std::size_t n) const noexcept;
  const T &at(std::size_t n) const;
  const T &front() const noexcept;
  const T &back() const noexcept;

  T &operator[](std::size_t n) noexcept;
  T &at(std::size_t n);
  T &front() noexcept;
  T &back() noexcept;

  void reserve(std::size_t new_cap);
  void push_back(const T &value);
  void push_back(T &&value);
  template <typename... Args>
  void emplace_back(Args &&...args);
  void truncate(std::size_t len);
  void clear();

  using iterator = typename Slice<T>::iterator;
  iterator begin() noexcept;
  iterator end() noexcept;

  using const_iterator = typename Slice<const T>::iterator;
  const_iterator begin() const noexcept;
  const_iterator end() const noexcept;
  const_iterator cbegin() const noexcept;
  const_iterator cend() const noexcept;

  void swap(Vec &) noexcept;

  Vec(unsafe_bitcopy_t, const Vec &) noexcept;

private:
  void reserve_total(std::size_t new_cap) noexcept;
  void set_len(std::size_t len) noexcept;
  void drop() noexcept;

  friend void swap(Vec &lhs, Vec &rhs) noexcept { lhs.swap(rhs); }

  std::array<std::uintptr_t, 3> repr;
};

template <typename T>
Vec<T>::Vec(std::initializer_list<T> init) : Vec{} {
  this->reserve_total(init.size());
  std::move(init.begin(), init.end(), std::back_inserter(*this));
}

template <typename T>
Vec<T>::Vec(const Vec &other) : Vec() {
  this->reserve_total(other.size());
  std::copy(other.begin(), other.end(), std::back_inserter(*this));
}

template <typename T>
Vec<T>::Vec(Vec &&other) noexcept : repr(other.repr) {
  new (&other) Vec();
}

template <typename T>
Vec<T>::~Vec() noexcept {
  this->drop();
}

template <typename T>
Vec<T> &Vec<T>::operator=(Vec &&other) & noexcept {
  this->drop();
  this->repr = other.repr;
  new (&other) Vec();
  return *this;
}

template <typename T>
Vec<T> &Vec<T>::operator=(const Vec &other) & {
  if (this != &other) {
    this->drop();
    new (this) Vec(other);
  }
  return *this;
}

template <typename T>
bool Vec<T>::empty() const noexcept {
  return this->size() == 0;
}

template <typename T>
T *Vec<T>::data() noexcept {
  return const_cast<T *>(const_cast<const Vec<T> *>(this)->data());
}

template <typename T>
const T &Vec<T>::operator[](std::size_t n) const noexcept {
  assert(n < this->size());
  auto data = reinterpret_cast<const char *>(this->data());
  return *reinterpret_cast<const T *>(data + n * size_of<T>());
}

template <typename T>
const T &Vec<T>::at(std::size_t n) const {
  if (n >= this->size()) {
    panic<std::out_of_range>("rust::Vec index out of range");
  }
  return (*this)[n];
}

template <typename T>
const T &Vec<T>::front() const noexcept {
  assert(!this->empty());
  return (*this)[0];
}

template <typename T>
const T &Vec<T>::back() const noexcept {
  assert(!this->empty());
  return (*this)[this->size() - 1];
}

template <typename T>
T &Vec<T>::operator[](std::size_t n) noexcept {
  assert(n < this->size());
  auto data = reinterpret_cast<char *>(this->data());
  return *reinterpret_cast<T *>(data + n * size_of<T>());
}

template <typename T>
T &Vec<T>::at(std::size_t n) {
  if (n >= this->size()) {
    panic<std::out_of_range>("rust::Vec index out of range");
  }
  return (*this)[n];
}

template <typename T>
T &Vec<T>::front() noexcept {
  assert(!this->empty());
  return (*this)[0];
}

template <typename T>
T &Vec<T>::back() noexcept {
  assert(!this->empty());
  return (*this)[this->size() - 1];
}

template <typename T>
void Vec<T>::reserve(std::size_t new_cap) {
  this->reserve_total(new_cap);
}

template <typename T>
void Vec<T>::push_back(const T &value) {
  this->emplace_back(value);
}

template <typename T>
void Vec<T>::push_back(T &&value) {
  this->emplace_back(std::move(value));
}

template <typename T>
template <typename... Args>
void Vec<T>::emplace_back(Args &&...args) {
  auto size = this->size();
  this->reserve_total(size + 1);
  ::new (reinterpret_cast<T *>(reinterpret_cast<char *>(this->data()) +
                               size * size_of<T>()))
      T(std::forward<Args>(args)...);
  this->set_len(size + 1);
}

template <typename T>
void Vec<T>::clear() {
  this->truncate(0);
}

template <typename T>
typename Vec<T>::iterator Vec<T>::begin() noexcept {
  return Slice<T>(this->data(), this->size()).begin();
}

template <typename T>
typename Vec<T>::iterator Vec<T>::end() noexcept {
  return Slice<T>(this->data(), this->size()).end();
}

template <typename T>
typename Vec<T>::const_iterator Vec<T>::begin() const noexcept {
  return this->cbegin();
}

template <typename T>
typename Vec<T>::const_iterator Vec<T>::end() const noexcept {
  return this->cend();
}

template <typename T>
typename Vec<T>::const_iterator Vec<T>::cbegin() const noexcept {
  return Slice<const T>(this->data(), this->size()).begin();
}

template <typename T>
typename Vec<T>::const_iterator Vec<T>::cend() const noexcept {
  return Slice<const T>(this->data(), this->size()).end();
}

template <typename T>
void Vec<T>::swap(Vec &rhs) noexcept {
  using std::swap;
  swap(this->repr, rhs.repr);
}

template <typename T>
Vec<T>::Vec(unsafe_bitcopy_t, const Vec &bits) noexcept : repr(bits.repr) {}
#endif // CXXBRIDGE1_RUST_VEC

#ifndef CXXBRIDGE1_RUST_FN
#define CXXBRIDGE1_RUST_FN
template <typename Signature>
class Fn;

template <typename Ret, typename... Args>
class Fn<Ret(Args...)> final {
public:
  Ret operator()(Args... args) const noexcept;
  Fn operator*() const noexcept;

private:
  Ret (*trampoline)(Args..., void *fn) noexcept;
  void *fn;
};

template <typename Ret, typename... Args>
Ret Fn<Ret(Args...)>::operator()(Args... args) const noexcept {
  return (*this->trampoline)(std::forward<Args>(args)..., this->fn);
}

template <typename Ret, typename... Args>
Fn<Ret(Args...)> Fn<Ret(Args...)>::operator*() const noexcept {
  return *this;
}
#endif // CXXBRIDGE1_RUST_FN

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

namespace {
template <bool> struct deleter_if {
  template <typename T> void operator()(T *) {}
};
template <> struct deleter_if<true> {
  template <typename T> void operator()(T *ptr) { ptr->~T(); }
};
} // namespace
} // namespace cxxbridge1
} // namespace rust

namespace livekit_ffi {
  enum class MediaType : ::std::int32_t;
  enum class Priority : ::std::int32_t;
  enum class RtpTransceiverDirection : ::std::int32_t;
  enum class LoggingSeverity : ::std::int32_t;
  enum class VideoEncoderBackend : ::std::int32_t;
  using LogSink = ::livekit_ffi::LogSink;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$MediaType
#define CXXBRIDGE1_ENUM_livekit_ffi$MediaType
enum class MediaType : ::std::int32_t {
  Audio = 0,
  Video = 1,
  Data = 2,
  Unsupported = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$MediaType

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$Priority
#define CXXBRIDGE1_ENUM_livekit_ffi$Priority
enum class Priority : ::std::int32_t {
  VeryLow = 0,
  Low = 1,
  Medium = 2,
  High = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$Priority

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$RtpTransceiverDirection
#define CXXBRIDGE1_ENUM_livekit_ffi$RtpTransceiverDirection
enum class RtpTransceiverDirection : ::std::int32_t {
  SendRecv = 0,
  SendOnly = 1,
  RecvOnly = 2,
  Inactive = 3,
  Stopped = 4,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$RtpTransceiverDirection

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$LoggingSeverity
#define CXXBRIDGE1_ENUM_livekit_ffi$LoggingSeverity
enum class LoggingSeverity : ::std::int32_t {
  Verbose = 0,
  Info = 1,
  Warning = 2,
  Error = 3,
  None = 4,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$LoggingSeverity

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$VideoEncoderBackend
#define CXXBRIDGE1_ENUM_livekit_ffi$VideoEncoderBackend
enum class VideoEncoderBackend : ::std::int32_t {
  Auto = 0,
  Software = 1,
  Hardware = 2,
  Nvenc = 3,
  Vaapi = 4,
  VideoToolbox = 5,
  PreEncoded = 6,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$VideoEncoderBackend

extern "C" {
void livekit_ffi$cxxbridge1$202$create_random_uuid(::rust::String *return$) noexcept {
  ::rust::String (*create_random_uuid$)() = ::livekit_ffi::create_random_uuid;
  new (return$) ::rust::String(create_random_uuid$());
}

void livekit_ffi$cxxbridge1$202$video_encoder_backend_list(::rust::Vec<::livekit_ffi::VideoEncoderBackend> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::VideoEncoderBackend> (*video_encoder_backend_list$)() = ::livekit_ffi::video_encoder_backend_list;
  new (return$) ::rust::Vec<::livekit_ffi::VideoEncoderBackend>(video_encoder_backend_list$());
}

::livekit_ffi::LogSink *livekit_ffi$cxxbridge1$202$new_log_sink(::rust::Fn<void(::rust::String, ::livekit_ffi::LoggingSeverity)> fnc) noexcept {
  ::std::unique_ptr<::livekit_ffi::LogSink> (*new_log_sink$)(::rust::Fn<void(::rust::String, ::livekit_ffi::LoggingSeverity)>) = ::livekit_ffi::new_log_sink;
  return new_log_sink$(fnc).release();
}

void livekit_ffi$cxxbridge1$202$new_log_sink$fnc$1(::rust::String *arg0, ::livekit_ffi::LoggingSeverity arg1, void *) noexcept;

void livekit_ffi$cxxbridge1$202$new_log_sink$fnc$0(::rust::String arg0, ::livekit_ffi::LoggingSeverity arg1, void *extern$) noexcept {
  livekit_ffi$cxxbridge1$202$new_log_sink$fnc$1(&arg0, arg1, extern$);
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
void cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$new(::rust::Vec<::livekit_ffi::VideoEncoderBackend> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$drop(::rust::Vec<::livekit_ffi::VideoEncoderBackend> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$len(::rust::Vec<::livekit_ffi::VideoEncoderBackend> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$capacity(::rust::Vec<::livekit_ffi::VideoEncoderBackend> const *ptr) noexcept;
::livekit_ffi::VideoEncoderBackend const *cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$data(::rust::Vec<::livekit_ffi::VideoEncoderBackend> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$reserve_total(::rust::Vec<::livekit_ffi::VideoEncoderBackend> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$set_len(::rust::Vec<::livekit_ffi::VideoEncoderBackend> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$truncate(::rust::Vec<::livekit_ffi::VideoEncoderBackend> *ptr, ::std::size_t len) noexcept;

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::LogSink>::type>::value, "definition of `::livekit_ffi::LogSink` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::LogSink>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::LogSink>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$LogSink$null(::std::unique_ptr<::livekit_ffi::LogSink> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::LogSink>();
}
void cxxbridge1$unique_ptr$livekit_ffi$LogSink$raw(::std::unique_ptr<::livekit_ffi::LogSink> *ptr, ::std::unique_ptr<::livekit_ffi::LogSink>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::LogSink>(raw);
}
::std::unique_ptr<::livekit_ffi::LogSink>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$LogSink$get(::std::unique_ptr<::livekit_ffi::LogSink> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::LogSink>::pointer cxxbridge1$unique_ptr$livekit_ffi$LogSink$release(::std::unique_ptr<::livekit_ffi::LogSink> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$LogSink$drop(::std::unique_ptr<::livekit_ffi::LogSink> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::LogSink>::value>{}(ptr);
}
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
Vec<::livekit_ffi::VideoEncoderBackend>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$new(this);
}
template <>
void Vec<::livekit_ffi::VideoEncoderBackend>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::VideoEncoderBackend>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::VideoEncoderBackend>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$capacity(this);
}
template <>
::livekit_ffi::VideoEncoderBackend const *Vec<::livekit_ffi::VideoEncoderBackend>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$data(this);
}
template <>
void Vec<::livekit_ffi::VideoEncoderBackend>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::VideoEncoderBackend>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::VideoEncoderBackend>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$VideoEncoderBackend$truncate(this, len);
}
} // namespace cxxbridge1
} // namespace rust
