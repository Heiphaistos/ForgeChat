#include "livekit/video_frame.h"
#include "livekit/media_stream_track.h"
#include "livekit/packet_trailer.h"
#include "livekit/video_track.h"
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

namespace {
template <typename T>
class impl;
} // namespace

template <typename T>
::std::size_t size_of();
template <typename T>
::std::size_t align_of();

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
  enum class ContentHint : ::std::int32_t;
  struct VideoTrackSourceConstraints;
  struct VideoResolution;
  struct FrameMetadata;
  enum class EncodedVideoCodec : ::std::int32_t;
  enum class EncodedFrameType : ::std::int32_t;
  struct EncodedVideoFrameData;
  struct EncodedRateControlRequest;
  using VideoTrack = ::livekit_ffi::VideoTrack;
  using NativeVideoSink = ::livekit_ffi::NativeVideoSink;
  using VideoTrackSource = ::livekit_ffi::VideoTrackSource;
  struct VideoSinkWrapper;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$ContentHint
#define CXXBRIDGE1_ENUM_livekit_ffi$ContentHint
enum class ContentHint : ::std::int32_t {
  None = 0,
  Fluid = 1,
  Detailed = 2,
  Text = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$ContentHint

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoTrackSourceConstraints
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoTrackSourceConstraints
struct VideoTrackSourceConstraints final {
  bool has_min_fps CXX_DEFAULT_VALUE(false);
  double min_fps CXX_DEFAULT_VALUE(0);
  bool has_max_fps CXX_DEFAULT_VALUE(false);
  double max_fps CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoTrackSourceConstraints

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoResolution
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoResolution
struct VideoResolution final {
  ::std::uint32_t width CXX_DEFAULT_VALUE(0);
  ::std::uint32_t height CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoResolution

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$FrameMetadata
#define CXXBRIDGE1_STRUCT_livekit_ffi$FrameMetadata
struct FrameMetadata final {
  bool has_packet_trailer CXX_DEFAULT_VALUE(false);
  ::std::uint64_t user_timestamp CXX_DEFAULT_VALUE(0);
  ::std::uint32_t frame_id CXX_DEFAULT_VALUE(0);
  ::rust::Vec<::std::uint8_t> user_data;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$FrameMetadata

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$EncodedVideoCodec
#define CXXBRIDGE1_ENUM_livekit_ffi$EncodedVideoCodec
enum class EncodedVideoCodec : ::std::int32_t {
  H264 = 0,
  H265 = 1,
  VP8 = 2,
  VP9 = 3,
  AV1 = 4,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$EncodedVideoCodec

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$EncodedFrameType
#define CXXBRIDGE1_ENUM_livekit_ffi$EncodedFrameType
enum class EncodedFrameType : ::std::int32_t {
  Key = 0,
  Delta = 1,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$EncodedFrameType

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$EncodedVideoFrameData
#define CXXBRIDGE1_STRUCT_livekit_ffi$EncodedVideoFrameData
struct EncodedVideoFrameData final {
  ::livekit_ffi::EncodedVideoCodec codec;
  ::livekit_ffi::EncodedFrameType frame_type;
  ::std::int64_t timestamp_us CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$EncodedVideoFrameData

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$EncodedRateControlRequest
#define CXXBRIDGE1_STRUCT_livekit_ffi$EncodedRateControlRequest
struct EncodedRateControlRequest final {
  bool has_request CXX_DEFAULT_VALUE(false);
  ::std::uint64_t target_bitrate_bps CXX_DEFAULT_VALUE(0);
  double framerate_fps CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$EncodedRateControlRequest

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoSinkWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoSinkWrapper
struct VideoSinkWrapper final : public ::rust::Opaque {
  void on_frame(::std::unique_ptr<::livekit_ffi::VideoFrame> frame) const noexcept;
  void on_discarded_frame() const noexcept;
  void on_constraints_changed(::livekit_ffi::VideoTrackSourceConstraints constraints) const noexcept;
  ~VideoSinkWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoSinkWrapper

extern "C" {
void livekit_ffi$cxxbridge1$202$VideoTrack$add_sink(::livekit_ffi::VideoTrack const &self, ::std::shared_ptr<::livekit_ffi::NativeVideoSink> const &sink) noexcept {
  void (::livekit_ffi::VideoTrack::*add_sink$)(::std::shared_ptr<::livekit_ffi::NativeVideoSink> const &) const = &::livekit_ffi::VideoTrack::add_sink;
  (self.*add_sink$)(sink);
}

void livekit_ffi$cxxbridge1$202$VideoTrack$remove_sink(::livekit_ffi::VideoTrack const &self, ::std::shared_ptr<::livekit_ffi::NativeVideoSink> const &sink) noexcept {
  void (::livekit_ffi::VideoTrack::*remove_sink$)(::std::shared_ptr<::livekit_ffi::NativeVideoSink> const &) const = &::livekit_ffi::VideoTrack::remove_sink;
  (self.*remove_sink$)(sink);
}

void livekit_ffi$cxxbridge1$202$VideoTrack$set_should_receive(::livekit_ffi::VideoTrack const &self, bool should_receive) noexcept {
  void (::livekit_ffi::VideoTrack::*set_should_receive$)(bool) const = &::livekit_ffi::VideoTrack::set_should_receive;
  (self.*set_should_receive$)(should_receive);
}

bool livekit_ffi$cxxbridge1$202$VideoTrack$should_receive(::livekit_ffi::VideoTrack const &self) noexcept {
  bool (::livekit_ffi::VideoTrack::*should_receive$)() const = &::livekit_ffi::VideoTrack::should_receive;
  return (self.*should_receive$)();
}

::livekit_ffi::ContentHint livekit_ffi$cxxbridge1$202$VideoTrack$content_hint(::livekit_ffi::VideoTrack const &self) noexcept {
  ::livekit_ffi::ContentHint (::livekit_ffi::VideoTrack::*content_hint$)() const = &::livekit_ffi::VideoTrack::content_hint;
  return (self.*content_hint$)();
}

void livekit_ffi$cxxbridge1$202$VideoTrack$set_content_hint(::livekit_ffi::VideoTrack const &self, ::livekit_ffi::ContentHint hint) noexcept {
  void (::livekit_ffi::VideoTrack::*set_content_hint$)(::livekit_ffi::ContentHint) const = &::livekit_ffi::VideoTrack::set_content_hint;
  (self.*set_content_hint$)(hint);
}

void livekit_ffi$cxxbridge1$202$new_native_video_sink(::livekit_ffi::VideoSinkWrapper *observer, ::std::shared_ptr<::livekit_ffi::NativeVideoSink> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::NativeVideoSink> (*new_native_video_sink$)(::rust::Box<::livekit_ffi::VideoSinkWrapper>) = ::livekit_ffi::new_native_video_sink;
  new (return$) ::std::shared_ptr<::livekit_ffi::NativeVideoSink>(new_native_video_sink$(::rust::Box<::livekit_ffi::VideoSinkWrapper>::from_raw(observer)));
}

void livekit_ffi$cxxbridge1$202$VideoTrackSource$video_resolution(::livekit_ffi::VideoTrackSource const &self, ::livekit_ffi::VideoResolution *return$) noexcept {
  ::livekit_ffi::VideoResolution (::livekit_ffi::VideoTrackSource::*video_resolution$)() const = &::livekit_ffi::VideoTrackSource::video_resolution;
  new (return$) ::livekit_ffi::VideoResolution((self.*video_resolution$)());
}

bool livekit_ffi$cxxbridge1$202$VideoTrackSource$on_captured_frame(::livekit_ffi::VideoTrackSource const &self, ::std::unique_ptr<::livekit_ffi::VideoFrame> const &frame, ::livekit_ffi::FrameMetadata const &frame_metadata) noexcept {
  bool (::livekit_ffi::VideoTrackSource::*on_captured_frame$)(::std::unique_ptr<::livekit_ffi::VideoFrame> const &, ::livekit_ffi::FrameMetadata const &) const = &::livekit_ffi::VideoTrackSource::on_captured_frame;
  return (self.*on_captured_frame$)(frame, frame_metadata);
}

bool livekit_ffi$cxxbridge1$202$VideoTrackSource$capture_encoded_frame(::livekit_ffi::VideoTrackSource const &self, ::std::int32_t width, ::std::int32_t height, ::livekit_ffi::EncodedVideoFrameData const &frame, ::rust::Slice<::std::uint8_t const> payload, ::livekit_ffi::FrameMetadata const &frame_metadata) noexcept {
  bool (::livekit_ffi::VideoTrackSource::*capture_encoded_frame$)(::std::int32_t, ::std::int32_t, ::livekit_ffi::EncodedVideoFrameData const &, ::rust::Slice<::std::uint8_t const>, ::livekit_ffi::FrameMetadata const &) const = &::livekit_ffi::VideoTrackSource::capture_encoded_frame;
  return (self.*capture_encoded_frame$)(width, height, frame, payload, frame_metadata);
}

bool livekit_ffi$cxxbridge1$202$VideoTrackSource$take_keyframe_request(::livekit_ffi::VideoTrackSource const &self) noexcept {
  bool (::livekit_ffi::VideoTrackSource::*take_keyframe_request$)() const = &::livekit_ffi::VideoTrackSource::take_keyframe_request;
  return (self.*take_keyframe_request$)();
}

void livekit_ffi$cxxbridge1$202$VideoTrackSource$take_rate_control_request(::livekit_ffi::VideoTrackSource const &self, ::livekit_ffi::EncodedRateControlRequest *return$) noexcept {
  ::livekit_ffi::EncodedRateControlRequest (::livekit_ffi::VideoTrackSource::*take_rate_control_request$)() const = &::livekit_ffi::VideoTrackSource::take_rate_control_request;
  new (return$) ::livekit_ffi::EncodedRateControlRequest((self.*take_rate_control_request$)());
}

void livekit_ffi$cxxbridge1$202$VideoTrackSource$set_packet_trailer_handler(::livekit_ffi::VideoTrackSource const &self, ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *handler) noexcept {
  void (::livekit_ffi::VideoTrackSource::*set_packet_trailer_handler$)(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>) const = &::livekit_ffi::VideoTrackSource::set_packet_trailer_handler;
  (self.*set_packet_trailer_handler$)(::std::move(*handler));
}

void livekit_ffi$cxxbridge1$202$new_video_track_source(::livekit_ffi::VideoResolution const &resolution, bool is_screencast, ::std::shared_ptr<::livekit_ffi::VideoTrackSource> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::VideoTrackSource> (*new_video_track_source$)(::livekit_ffi::VideoResolution const &, bool) = ::livekit_ffi::new_video_track_source;
  new (return$) ::std::shared_ptr<::livekit_ffi::VideoTrackSource>(new_video_track_source$(resolution, is_screencast));
}

void livekit_ffi$cxxbridge1$202$video_to_media(::std::shared_ptr<::livekit_ffi::VideoTrack> *track, ::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::MediaStreamTrack> (*video_to_media$)(::std::shared_ptr<::livekit_ffi::VideoTrack>) = ::livekit_ffi::video_to_media;
  new (return$) ::std::shared_ptr<::livekit_ffi::MediaStreamTrack>(video_to_media$(::std::move(*track)));
}

void livekit_ffi$cxxbridge1$202$media_to_video(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *track, ::std::shared_ptr<::livekit_ffi::VideoTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::VideoTrack> (*media_to_video$)(::std::shared_ptr<::livekit_ffi::MediaStreamTrack>) = ::livekit_ffi::media_to_video;
  new (return$) ::std::shared_ptr<::livekit_ffi::VideoTrack>(media_to_video$(::std::move(*track)));
}

void livekit_ffi$cxxbridge1$202$_shared_video_track(::std::shared_ptr<::livekit_ffi::VideoTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::VideoTrack> (*_shared_video_track$)() = ::livekit_ffi::_shared_video_track;
  new (return$) ::std::shared_ptr<::livekit_ffi::VideoTrack>(_shared_video_track$());
}
::std::size_t livekit_ffi$cxxbridge1$202$VideoSinkWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$VideoSinkWrapper$operator$alignof() noexcept;

void livekit_ffi$cxxbridge1$202$VideoSinkWrapper$on_frame(::livekit_ffi::VideoSinkWrapper const &self, ::livekit_ffi::VideoFrame *frame) noexcept;

void livekit_ffi$cxxbridge1$202$VideoSinkWrapper$on_discarded_frame(::livekit_ffi::VideoSinkWrapper const &self) noexcept;

void livekit_ffi$cxxbridge1$202$VideoSinkWrapper$on_constraints_changed(::livekit_ffi::VideoSinkWrapper const &self, ::livekit_ffi::VideoTrackSourceConstraints *constraints) noexcept;
} // extern "C"

::std::size_t VideoSinkWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$VideoSinkWrapper$operator$sizeof();
}

::std::size_t VideoSinkWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$VideoSinkWrapper$operator$alignof();
}

void VideoSinkWrapper::on_frame(::std::unique_ptr<::livekit_ffi::VideoFrame> frame) const noexcept {
  livekit_ffi$cxxbridge1$202$VideoSinkWrapper$on_frame(*this, frame.release());
}

void VideoSinkWrapper::on_discarded_frame() const noexcept {
  livekit_ffi$cxxbridge1$202$VideoSinkWrapper$on_discarded_frame(*this);
}

void VideoSinkWrapper::on_constraints_changed(::livekit_ffi::VideoTrackSourceConstraints constraints) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::VideoTrackSourceConstraints> constraints$(::std::move(constraints));
  livekit_ffi$cxxbridge1$202$VideoSinkWrapper$on_constraints_changed(*this, &constraints$.value);
}
} // namespace livekit_ffi

extern "C" {
static_assert(sizeof(::std::shared_ptr<::livekit_ffi::NativeVideoSink>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::NativeVideoSink>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$NativeVideoSink$null(::std::shared_ptr<::livekit_ffi::NativeVideoSink> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::NativeVideoSink>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$NativeVideoSink$raw(::std::shared_ptr<::livekit_ffi::NativeVideoSink> *ptr, ::std::shared_ptr<::livekit_ffi::NativeVideoSink>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::NativeVideoSink>(raw);
  return ::rust::is_destructible<::livekit_ffi::NativeVideoSink>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$NativeVideoSink$clone(::std::shared_ptr<::livekit_ffi::NativeVideoSink> const &self, ::std::shared_ptr<::livekit_ffi::NativeVideoSink> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::NativeVideoSink>(self);
}
::std::shared_ptr<::livekit_ffi::NativeVideoSink>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$NativeVideoSink$get(::std::shared_ptr<::livekit_ffi::NativeVideoSink> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$NativeVideoSink$drop(::std::shared_ptr<::livekit_ffi::NativeVideoSink> *self) noexcept {
  self->~shared_ptr();
}

::livekit_ffi::VideoSinkWrapper *cxxbridge1$box$livekit_ffi$VideoSinkWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$VideoSinkWrapper$dealloc(::livekit_ffi::VideoSinkWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$VideoSinkWrapper$drop(::rust::Box<::livekit_ffi::VideoSinkWrapper> *ptr) noexcept;

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::VideoTrackSource>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::VideoTrackSource>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$VideoTrackSource$null(::std::shared_ptr<::livekit_ffi::VideoTrackSource> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::VideoTrackSource>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$VideoTrackSource$raw(::std::shared_ptr<::livekit_ffi::VideoTrackSource> *ptr, ::std::shared_ptr<::livekit_ffi::VideoTrackSource>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::VideoTrackSource>(raw);
  return ::rust::is_destructible<::livekit_ffi::VideoTrackSource>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$VideoTrackSource$clone(::std::shared_ptr<::livekit_ffi::VideoTrackSource> const &self, ::std::shared_ptr<::livekit_ffi::VideoTrackSource> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::VideoTrackSource>(self);
}
::std::shared_ptr<::livekit_ffi::VideoTrackSource>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$VideoTrackSource$get(::std::shared_ptr<::livekit_ffi::VideoTrackSource> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$VideoTrackSource$drop(::std::shared_ptr<::livekit_ffi::VideoTrackSource> *self) noexcept {
  self->~shared_ptr();
}

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::VideoTrack>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::VideoTrack>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$VideoTrack$null(::std::shared_ptr<::livekit_ffi::VideoTrack> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::VideoTrack>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$VideoTrack$raw(::std::shared_ptr<::livekit_ffi::VideoTrack> *ptr, ::std::shared_ptr<::livekit_ffi::VideoTrack>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::VideoTrack>(raw);
  return ::rust::is_destructible<::livekit_ffi::VideoTrack>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$VideoTrack$clone(::std::shared_ptr<::livekit_ffi::VideoTrack> const &self, ::std::shared_ptr<::livekit_ffi::VideoTrack> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::VideoTrack>(self);
}
::std::shared_ptr<::livekit_ffi::VideoTrack>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$VideoTrack$get(::std::shared_ptr<::livekit_ffi::VideoTrack> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$VideoTrack$drop(::std::shared_ptr<::livekit_ffi::VideoTrack> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
::livekit_ffi::VideoSinkWrapper *Box<::livekit_ffi::VideoSinkWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$VideoSinkWrapper$alloc();
}
template <>
void Box<::livekit_ffi::VideoSinkWrapper>::allocation::dealloc(::livekit_ffi::VideoSinkWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$VideoSinkWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::VideoSinkWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$VideoSinkWrapper$drop(this);
}
} // namespace cxxbridge1
} // namespace rust
