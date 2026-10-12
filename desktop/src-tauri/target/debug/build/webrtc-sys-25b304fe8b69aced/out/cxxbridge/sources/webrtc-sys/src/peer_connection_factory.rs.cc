#include "livekit/rtp_parameters.h"
#include "livekit/rtc_error.h"
#include "livekit/helper.h"
#include "livekit/candidate.h"
#include "livekit/media_stream.h"
#include "livekit/rtp_transceiver.h"
#include "livekit/rtp_sender.h"
#include "livekit/rtp_receiver.h"
#include "livekit/data_channel.h"
#include "livekit/jsep.h"
#include "livekit/webrtc.h"
#include "livekit/peer_connection.h"
#include "livekit/audio_track.h"
#include "livekit/peer_connection_factory.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <exception>
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
#pragma GCC diagnostic ignored "-Wshadow"
#ifdef __clang__
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
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

#ifndef CXXBRIDGE1_RELOCATABLE
#define CXXBRIDGE1_RELOCATABLE
namespace detail {
template <typename... Ts>
struct make_void {
  using type = void;
};

template <typename... Ts>
using void_t = typename make_void<Ts...>::type;

template <typename Void, template <typename...> class, typename...>
struct detect : std::false_type {};
template <template <typename...> class T, typename... A>
struct detect<void_t<T<A...>>, T, A...> : std::true_type {};

template <template <typename...> class T, typename... A>
using is_detected = detect<void, T, A...>;

template <typename T>
using detect_IsRelocatable = typename T::IsRelocatable;

template <typename T>
struct get_IsRelocatable
    : std::is_same<typename T::IsRelocatable, std::true_type> {};
} // namespace detail

template <typename T>
struct IsRelocatable
    : std::conditional<
          detail::is_detected<detail::detect_IsRelocatable, T>::value,
          detail::get_IsRelocatable<T>,
          std::integral_constant<
              bool, std::is_trivially_move_constructible<T>::value &&
                        std::is_trivially_destructible<T>::value>>::type {};
#endif // CXXBRIDGE1_RELOCATABLE

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

template <typename T>
struct IsRelocatableOrArray : IsRelocatable<T> {};
template <typename T, ::std::size_t N>
struct IsRelocatableOrArray<T[N]> : IsRelocatableOrArray<T> {};
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

#if __cplusplus >= 201402L
#define CXX_DEFAULT_VALUE(value) = value
#else
#define CXX_DEFAULT_VALUE(value)
#endif

namespace livekit_ffi {
  struct CandidatePair;
  struct CandidatePairChangeEvent;
  using PeerConnectionFactory = ::livekit_ffi::PeerConnectionFactory;
  struct PeerConnectionObserverWrapper;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePair
#define CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePair
struct CandidatePair final {
  ::std::shared_ptr<::livekit_ffi::Candidate> local;
  ::std::shared_ptr<::livekit_ffi::Candidate> remote;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePair

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePairChangeEvent
#define CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePairChangeEvent
struct CandidatePairChangeEvent final {
  ::livekit_ffi::CandidatePair selected_candidate_pair;
  ::std::int64_t last_data_received_ms CXX_DEFAULT_VALUE(0);
  ::rust::String reason;
  ::std::int64_t estimated_disconnected_time_ms CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePairChangeEvent

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$PeerConnectionObserverWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$PeerConnectionObserverWrapper
struct PeerConnectionObserverWrapper final : public ::rust::Opaque {
  void on_signaling_change(::livekit_ffi::SignalingState new_state) const noexcept;
  void on_add_stream(::std::shared_ptr<::livekit_ffi::MediaStream> stream) const noexcept;
  void on_remove_stream(::std::shared_ptr<::livekit_ffi::MediaStream> stream) const noexcept;
  void on_data_channel(::std::shared_ptr<::livekit_ffi::DataChannel> data_channel) const noexcept;
  void on_renegotiation_needed() const noexcept;
  void on_negotiation_needed_event(::std::uint32_t event) const noexcept;
  void on_ice_connection_change(::livekit_ffi::IceConnectionState new_state) const noexcept;
  void on_standardized_ice_connection_change(::livekit_ffi::IceConnectionState new_state) const noexcept;
  void on_connection_change(::livekit_ffi::PeerConnectionState new_state) const noexcept;
  void on_ice_gathering_change(::livekit_ffi::IceGatheringState new_state) const noexcept;
  void on_ice_candidate(::std::shared_ptr<::livekit_ffi::IceCandidate> candidate) const noexcept;
  void on_ice_candidate_error(::rust::String address, ::std::int32_t port, ::rust::String url, ::std::int32_t error_code, ::rust::String error_text) const noexcept;
  void on_ice_candidates_removed(::rust::Vec<::livekit_ffi::CandidatePtr> removed) const noexcept;
  void on_ice_connection_receiving_change(bool receiving) const noexcept;
  void on_ice_selected_candidate_pair_changed(::livekit_ffi::CandidatePairChangeEvent event) const noexcept;
  void on_add_track(::std::shared_ptr<::livekit_ffi::RtpReceiver> receiver, ::rust::Vec<::livekit_ffi::MediaStreamPtr> streams) const noexcept;
  void on_track(::std::shared_ptr<::livekit_ffi::RtpTransceiver> transceiver) const noexcept;
  void on_remove_track(::std::shared_ptr<::livekit_ffi::RtpReceiver> receiver) const noexcept;
  void on_interesting_usage(::std::int32_t usage_pattern) const noexcept;
  ~PeerConnectionObserverWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$PeerConnectionObserverWrapper
} // namespace livekit_ffi

static_assert(
    ::rust::IsRelocatable<::livekit_ffi::RtcConfiguration>::value,
    "type livekit_ffi::RtcConfiguration should be trivially move constructible and trivially destructible in C++ to be used as an argument of `create_peer_connection` in Rust");
static_assert(
    ::rust::IsRelocatable<::livekit_ffi::PeerConnectionState>::value,
    "type livekit_ffi::PeerConnectionState should be trivially move constructible and trivially destructible in C++ to be used as an argument of `on_connection_change` in Rust");
static_assert(
    ::rust::IsRelocatable<::livekit_ffi::SignalingState>::value,
    "type livekit_ffi::SignalingState should be trivially move constructible and trivially destructible in C++ to be used as an argument of `on_signaling_change` in Rust");
static_assert(
    ::rust::IsRelocatable<::livekit_ffi::IceConnectionState>::value,
    "type livekit_ffi::IceConnectionState should be trivially move constructible and trivially destructible in C++ to be used as an argument of `on_ice_connection_change`, `on_standardized_ice_connection_change` in Rust");
static_assert(
    ::rust::IsRelocatable<::livekit_ffi::IceGatheringState>::value,
    "type livekit_ffi::IceGatheringState should be trivially move constructible and trivially destructible in C++ to be used as an argument of `on_ice_gathering_change` in Rust");
static_assert(
    ::rust::IsRelocatable<::livekit_ffi::RtpCapabilities>::value,
    "type livekit_ffi::RtpCapabilities should be trivially move constructible and trivially destructible in C++ to be used as a return value of `rtp_sender_capabilities`, `rtp_receiver_capabilities` in Rust");
static_assert(
    ::std::is_base_of<::rust::Opaque, ::livekit_ffi::MediaStreamPtr>::value || ::rust::IsRelocatableOrArray<::livekit_ffi::MediaStreamPtr>::value,
    "type livekit_ffi::MediaStreamPtr should be trivially move constructible and trivially destructible in C++ to be used as a vector element in Vec<MediaStreamPtr> in Rust");
static_assert(
    ::std::is_base_of<::rust::Opaque, ::livekit_ffi::CandidatePtr>::value || ::rust::IsRelocatableOrArray<::livekit_ffi::CandidatePtr>::value,
    "type livekit_ffi::CandidatePtr should be trivially move constructible and trivially destructible in C++ to be used as a vector element in Vec<CandidatePtr> in Rust");
static_assert(
    ::rust::IsRelocatable<::livekit_ffi::MediaType>::value,
    "type livekit_ffi::MediaType should be trivially move constructible and trivially destructible in C++ to be used as an argument of `rtp_sender_capabilities`, `rtp_receiver_capabilities` in Rust");

namespace livekit_ffi {
extern "C" {
void livekit_ffi$cxxbridge1$202$create_peer_connection_factory(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> (*create_peer_connection_factory$)() = ::livekit_ffi::create_peer_connection_factory;
  new (return$) ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>(create_peer_connection_factory$());
}

void livekit_ffi$cxxbridge1$202$create_peer_connection_factory_with_zero_playout_delay(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> (*create_peer_connection_factory_with_zero_playout_delay$)() = ::livekit_ffi::create_peer_connection_factory_with_zero_playout_delay;
  new (return$) ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>(create_peer_connection_factory_with_zero_playout_delay$());
}

void livekit_ffi$cxxbridge1$202$create_peer_connection_factory_with_options(bool zero_playout_delay, bool enable_warp, ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> (*create_peer_connection_factory_with_options$)(bool, bool) = ::livekit_ffi::create_peer_connection_factory_with_options;
  new (return$) ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>(create_peer_connection_factory_with_options$(zero_playout_delay, enable_warp));
}

bool livekit_ffi$cxxbridge1$202$PeerConnectionFactory$zero_playout_delay_enabled(::livekit_ffi::PeerConnectionFactory const &self) noexcept {
  bool (::livekit_ffi::PeerConnectionFactory::*zero_playout_delay_enabled$)() const = &::livekit_ffi::PeerConnectionFactory::zero_playout_delay_enabled;
  return (self.*zero_playout_delay_enabled$)();
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$PeerConnectionFactory$create_peer_connection(::livekit_ffi::PeerConnectionFactory const &self, ::livekit_ffi::RtcConfiguration *config, ::livekit_ffi::PeerConnectionObserverWrapper *observer, ::std::shared_ptr<::livekit_ffi::PeerConnection> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::PeerConnection> (::livekit_ffi::PeerConnectionFactory::*create_peer_connection$)(::livekit_ffi::RtcConfiguration, ::rust::Box<::livekit_ffi::PeerConnectionObserverWrapper>) const = &::livekit_ffi::PeerConnectionFactory::create_peer_connection;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        new (return$) ::std::shared_ptr<::livekit_ffi::PeerConnection>((self.*create_peer_connection$)(::std::move(*config), ::rust::Box<::livekit_ffi::PeerConnectionObserverWrapper>::from_raw(observer)));
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

void livekit_ffi$cxxbridge1$202$PeerConnectionFactory$create_video_track(::livekit_ffi::PeerConnectionFactory const &self, ::rust::String const *label, ::std::shared_ptr<::livekit_ffi::VideoTrackSource> *source, ::std::shared_ptr<::livekit_ffi::VideoTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::VideoTrack> (::livekit_ffi::PeerConnectionFactory::*create_video_track$)(::rust::String, ::std::shared_ptr<::livekit_ffi::VideoTrackSource>) const = &::livekit_ffi::PeerConnectionFactory::create_video_track;
  new (return$) ::std::shared_ptr<::livekit_ffi::VideoTrack>((self.*create_video_track$)(::rust::String(::rust::unsafe_bitcopy, *label), ::std::move(*source)));
}

void livekit_ffi$cxxbridge1$202$PeerConnectionFactory$create_audio_track(::livekit_ffi::PeerConnectionFactory const &self, ::rust::String const *label, ::std::shared_ptr<::livekit_ffi::AudioTrackSource> *source, ::std::shared_ptr<::livekit_ffi::AudioTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioTrack> (::livekit_ffi::PeerConnectionFactory::*create_audio_track$)(::rust::String, ::std::shared_ptr<::livekit_ffi::AudioTrackSource>) const = &::livekit_ffi::PeerConnectionFactory::create_audio_track;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioTrack>((self.*create_audio_track$)(::rust::String(::rust::unsafe_bitcopy, *label), ::std::move(*source)));
}

void livekit_ffi$cxxbridge1$202$PeerConnectionFactory$create_device_audio_track(::livekit_ffi::PeerConnectionFactory const &self, ::rust::String const *label, ::std::shared_ptr<::livekit_ffi::AudioTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioTrack> (::livekit_ffi::PeerConnectionFactory::*create_device_audio_track$)(::rust::String) const = &::livekit_ffi::PeerConnectionFactory::create_device_audio_track;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioTrack>((self.*create_device_audio_track$)(::rust::String(::rust::unsafe_bitcopy, *label)));
}

void livekit_ffi$cxxbridge1$202$PeerConnectionFactory$rtp_sender_capabilities(::livekit_ffi::PeerConnectionFactory const &self, ::livekit_ffi::MediaType *kind, ::livekit_ffi::RtpCapabilities *return$) noexcept {
  ::livekit_ffi::RtpCapabilities (::livekit_ffi::PeerConnectionFactory::*rtp_sender_capabilities$)(::livekit_ffi::MediaType) const = &::livekit_ffi::PeerConnectionFactory::rtp_sender_capabilities;
  new (return$) ::livekit_ffi::RtpCapabilities((self.*rtp_sender_capabilities$)(::std::move(*kind)));
}

void livekit_ffi$cxxbridge1$202$PeerConnectionFactory$rtp_receiver_capabilities(::livekit_ffi::PeerConnectionFactory const &self, ::livekit_ffi::MediaType *kind, ::livekit_ffi::RtpCapabilities *return$) noexcept {
  ::livekit_ffi::RtpCapabilities (::livekit_ffi::PeerConnectionFactory::*rtp_receiver_capabilities$)(::livekit_ffi::MediaType) const = &::livekit_ffi::PeerConnectionFactory::rtp_receiver_capabilities;
  new (return$) ::livekit_ffi::RtpCapabilities((self.*rtp_receiver_capabilities$)(::std::move(*kind)));
}
::std::size_t livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$operator$alignof() noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_signaling_change(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::livekit_ffi::SignalingState *new_state) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_add_stream(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::MediaStream> *stream) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_remove_stream(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::MediaStream> *stream) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_data_channel(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::DataChannel> *data_channel) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_renegotiation_needed(::livekit_ffi::PeerConnectionObserverWrapper const &self) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_negotiation_needed_event(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::uint32_t event) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_connection_change(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::livekit_ffi::IceConnectionState *new_state) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_standardized_ice_connection_change(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::livekit_ffi::IceConnectionState *new_state) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_connection_change(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::livekit_ffi::PeerConnectionState *new_state) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_gathering_change(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::livekit_ffi::IceGatheringState *new_state) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_candidate(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::IceCandidate> *candidate) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_candidate_error(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::rust::String *address, ::std::int32_t port, ::rust::String *url, ::std::int32_t error_code, ::rust::String *error_text) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_candidates_removed(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::rust::Vec<::livekit_ffi::CandidatePtr> *removed) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_connection_receiving_change(::livekit_ffi::PeerConnectionObserverWrapper const &self, bool receiving) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_selected_candidate_pair_changed(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::livekit_ffi::CandidatePairChangeEvent *event) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_add_track(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::RtpReceiver> *receiver, ::rust::Vec<::livekit_ffi::MediaStreamPtr> *streams) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_track(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::RtpTransceiver> *transceiver) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_remove_track(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::shared_ptr<::livekit_ffi::RtpReceiver> *receiver) noexcept;

void livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_interesting_usage(::livekit_ffi::PeerConnectionObserverWrapper const &self, ::std::int32_t usage_pattern) noexcept;
} // extern "C"

::std::size_t PeerConnectionObserverWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$operator$sizeof();
}

::std::size_t PeerConnectionObserverWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$operator$alignof();
}

void PeerConnectionObserverWrapper::on_signaling_change(::livekit_ffi::SignalingState new_state) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::SignalingState> new_state$(::std::move(new_state));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_signaling_change(*this, &new_state$.value);
}

void PeerConnectionObserverWrapper::on_add_stream(::std::shared_ptr<::livekit_ffi::MediaStream> stream) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::MediaStream>> stream$(::std::move(stream));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_add_stream(*this, &stream$.value);
}

void PeerConnectionObserverWrapper::on_remove_stream(::std::shared_ptr<::livekit_ffi::MediaStream> stream) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::MediaStream>> stream$(::std::move(stream));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_remove_stream(*this, &stream$.value);
}

void PeerConnectionObserverWrapper::on_data_channel(::std::shared_ptr<::livekit_ffi::DataChannel> data_channel) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::DataChannel>> data_channel$(::std::move(data_channel));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_data_channel(*this, &data_channel$.value);
}

void PeerConnectionObserverWrapper::on_renegotiation_needed() const noexcept {
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_renegotiation_needed(*this);
}

void PeerConnectionObserverWrapper::on_negotiation_needed_event(::std::uint32_t event) const noexcept {
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_negotiation_needed_event(*this, event);
}

void PeerConnectionObserverWrapper::on_ice_connection_change(::livekit_ffi::IceConnectionState new_state) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::IceConnectionState> new_state$(::std::move(new_state));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_connection_change(*this, &new_state$.value);
}

void PeerConnectionObserverWrapper::on_standardized_ice_connection_change(::livekit_ffi::IceConnectionState new_state) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::IceConnectionState> new_state$(::std::move(new_state));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_standardized_ice_connection_change(*this, &new_state$.value);
}

void PeerConnectionObserverWrapper::on_connection_change(::livekit_ffi::PeerConnectionState new_state) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::PeerConnectionState> new_state$(::std::move(new_state));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_connection_change(*this, &new_state$.value);
}

void PeerConnectionObserverWrapper::on_ice_gathering_change(::livekit_ffi::IceGatheringState new_state) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::IceGatheringState> new_state$(::std::move(new_state));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_gathering_change(*this, &new_state$.value);
}

void PeerConnectionObserverWrapper::on_ice_candidate(::std::shared_ptr<::livekit_ffi::IceCandidate> candidate) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::IceCandidate>> candidate$(::std::move(candidate));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_candidate(*this, &candidate$.value);
}

void PeerConnectionObserverWrapper::on_ice_candidate_error(::rust::String address, ::std::int32_t port, ::rust::String url, ::std::int32_t error_code, ::rust::String error_text) const noexcept {
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_candidate_error(*this, &address, port, &url, error_code, &error_text);
}

void PeerConnectionObserverWrapper::on_ice_candidates_removed(::rust::Vec<::livekit_ffi::CandidatePtr> removed) const noexcept {
  ::rust::ManuallyDrop<::rust::Vec<::livekit_ffi::CandidatePtr>> removed$(::std::move(removed));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_candidates_removed(*this, &removed$.value);
}

void PeerConnectionObserverWrapper::on_ice_connection_receiving_change(bool receiving) const noexcept {
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_connection_receiving_change(*this, receiving);
}

void PeerConnectionObserverWrapper::on_ice_selected_candidate_pair_changed(::livekit_ffi::CandidatePairChangeEvent event) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::CandidatePairChangeEvent> event$(::std::move(event));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_ice_selected_candidate_pair_changed(*this, &event$.value);
}

void PeerConnectionObserverWrapper::on_add_track(::std::shared_ptr<::livekit_ffi::RtpReceiver> receiver, ::rust::Vec<::livekit_ffi::MediaStreamPtr> streams) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::RtpReceiver>> receiver$(::std::move(receiver));
  ::rust::ManuallyDrop<::rust::Vec<::livekit_ffi::MediaStreamPtr>> streams$(::std::move(streams));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_add_track(*this, &receiver$.value, &streams$.value);
}

void PeerConnectionObserverWrapper::on_track(::std::shared_ptr<::livekit_ffi::RtpTransceiver> transceiver) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::RtpTransceiver>> transceiver$(::std::move(transceiver));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_track(*this, &transceiver$.value);
}

void PeerConnectionObserverWrapper::on_remove_track(::std::shared_ptr<::livekit_ffi::RtpReceiver> receiver) const noexcept {
  ::rust::ManuallyDrop<::std::shared_ptr<::livekit_ffi::RtpReceiver>> receiver$(::std::move(receiver));
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_remove_track(*this, &receiver$.value);
}

void PeerConnectionObserverWrapper::on_interesting_usage(::std::int32_t usage_pattern) const noexcept {
  livekit_ffi$cxxbridge1$202$PeerConnectionObserverWrapper$on_interesting_usage(*this, usage_pattern);
}
} // namespace livekit_ffi

extern "C" {
static_assert(sizeof(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$PeerConnectionFactory$null(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$PeerConnectionFactory$raw(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *ptr, ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::PeerConnectionFactory>(raw);
  return ::rust::is_destructible<::livekit_ffi::PeerConnectionFactory>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$PeerConnectionFactory$clone(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> const &self, ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>(self);
}
::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$PeerConnectionFactory$get(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$PeerConnectionFactory$drop(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *self) noexcept {
  self->~shared_ptr();
}

::livekit_ffi::PeerConnectionObserverWrapper *cxxbridge1$box$livekit_ffi$PeerConnectionObserverWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$PeerConnectionObserverWrapper$dealloc(::livekit_ffi::PeerConnectionObserverWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$PeerConnectionObserverWrapper$drop(::rust::Box<::livekit_ffi::PeerConnectionObserverWrapper> *ptr) noexcept;
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
::livekit_ffi::PeerConnectionObserverWrapper *Box<::livekit_ffi::PeerConnectionObserverWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$PeerConnectionObserverWrapper$alloc();
}
template <>
void Box<::livekit_ffi::PeerConnectionObserverWrapper>::allocation::dealloc(::livekit_ffi::PeerConnectionObserverWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$PeerConnectionObserverWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::PeerConnectionObserverWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$PeerConnectionObserverWrapper$drop(this);
}
} // namespace cxxbridge1
} // namespace rust
