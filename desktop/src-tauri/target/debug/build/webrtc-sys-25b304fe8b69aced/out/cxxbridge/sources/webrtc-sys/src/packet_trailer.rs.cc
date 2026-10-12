#include "livekit/packet_trailer.h"
#include "livekit/rtp_sender.h"
#include "livekit/rtp_receiver.h"
#include "livekit/peer_connection_factory.h"
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
  enum class VideoPublishTimingStage : ::std::int32_t;
  enum class VideoSubscribeTimingStage : ::std::int32_t;
  struct VideoPublishTimingEvent;
  struct VideoSubscribeTimingEvent;
  using PacketTrailerHandler = ::livekit_ffi::PacketTrailerHandler;
  struct VideoPublishTimingObserverWrapper;
  struct VideoSubscribeTimingObserverWrapper;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$VideoPublishTimingStage
#define CXXBRIDGE1_ENUM_livekit_ffi$VideoPublishTimingStage
enum class VideoPublishTimingStage : ::std::int32_t {
  EncoderUpload = 0,
  EncoderOutput = 1,
  WebrtcPacketize = 2,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$VideoPublishTimingStage

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$VideoSubscribeTimingStage
#define CXXBRIDGE1_ENUM_livekit_ffi$VideoSubscribeTimingStage
enum class VideoSubscribeTimingStage : ::std::int32_t {
  WebrtcReceive = 0,
  DecoderUpload = 1,
  DecoderOutput = 2,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$VideoSubscribeTimingStage

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoPublishTimingEvent
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoPublishTimingEvent
struct VideoPublishTimingEvent final {
  ::livekit_ffi::VideoPublishTimingStage stage;
  ::std::uint64_t timestamp_us CXX_DEFAULT_VALUE(0);
  ::std::uint64_t capture_timestamp_us CXX_DEFAULT_VALUE(0);
  ::std::uint32_t frame_id CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoPublishTimingEvent

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoSubscribeTimingEvent
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoSubscribeTimingEvent
struct VideoSubscribeTimingEvent final {
  ::livekit_ffi::VideoSubscribeTimingStage stage;
  ::std::uint64_t timestamp_us CXX_DEFAULT_VALUE(0);
  ::std::uint64_t capture_timestamp_us CXX_DEFAULT_VALUE(0);
  ::std::uint32_t frame_id CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoSubscribeTimingEvent

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoPublishTimingObserverWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoPublishTimingObserverWrapper
struct VideoPublishTimingObserverWrapper final : public ::rust::Opaque {
  void on_publish_timing(::livekit_ffi::VideoPublishTimingEvent event) const noexcept;
  ~VideoPublishTimingObserverWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoPublishTimingObserverWrapper

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoSubscribeTimingObserverWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoSubscribeTimingObserverWrapper
struct VideoSubscribeTimingObserverWrapper final : public ::rust::Opaque {
  void on_subscribe_timing(::livekit_ffi::VideoSubscribeTimingEvent event) const noexcept;
  ~VideoSubscribeTimingObserverWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoSubscribeTimingObserverWrapper

extern "C" {
void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$set_enabled(::livekit_ffi::PacketTrailerHandler const &self, bool enabled) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*set_enabled$)(bool) const = &::livekit_ffi::PacketTrailerHandler::set_enabled;
  (self.*set_enabled$)(enabled);
}

bool livekit_ffi$cxxbridge1$202$PacketTrailerHandler$enabled(::livekit_ffi::PacketTrailerHandler const &self) noexcept {
  bool (::livekit_ffi::PacketTrailerHandler::*enabled$)() const = &::livekit_ffi::PacketTrailerHandler::enabled;
  return (self.*enabled$)();
}

::std::uint64_t livekit_ffi$cxxbridge1$202$PacketTrailerHandler$lookup_timestamp(::livekit_ffi::PacketTrailerHandler const &self, ::std::uint32_t rtp_timestamp) noexcept {
  ::std::uint64_t (::livekit_ffi::PacketTrailerHandler::*lookup_timestamp$)(::std::uint32_t) const = &::livekit_ffi::PacketTrailerHandler::lookup_timestamp;
  return (self.*lookup_timestamp$)(rtp_timestamp);
}

::std::uint32_t livekit_ffi$cxxbridge1$202$PacketTrailerHandler$last_lookup_frame_id(::livekit_ffi::PacketTrailerHandler const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::PacketTrailerHandler::*last_lookup_frame_id$)() const = &::livekit_ffi::PacketTrailerHandler::last_lookup_frame_id;
  return (self.*last_lookup_frame_id$)();
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$last_lookup_user_data(::livekit_ffi::PacketTrailerHandler const &self, ::rust::Vec<::std::uint8_t> *return$) noexcept {
  ::rust::Vec<::std::uint8_t> (::livekit_ffi::PacketTrailerHandler::*last_lookup_user_data$)() const = &::livekit_ffi::PacketTrailerHandler::last_lookup_user_data;
  new (return$) ::rust::Vec<::std::uint8_t>((self.*last_lookup_user_data$)());
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$store_frame_metadata(::livekit_ffi::PacketTrailerHandler const &self, ::std::int64_t capture_timestamp_us, ::std::uint64_t user_timestamp, ::std::uint32_t frame_id, ::rust::Slice<::std::uint8_t const> user_data) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*store_frame_metadata$)(::std::int64_t, ::std::uint64_t, ::std::uint32_t, ::rust::Slice<::std::uint8_t const>) const = &::livekit_ffi::PacketTrailerHandler::store_frame_metadata;
  (self.*store_frame_metadata$)(capture_timestamp_us, user_timestamp, frame_id, user_data);
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$set_publish_timing_observer(::livekit_ffi::PacketTrailerHandler const &self, ::livekit_ffi::VideoPublishTimingObserverWrapper *observer) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*set_publish_timing_observer$)(::rust::Box<::livekit_ffi::VideoPublishTimingObserverWrapper>) const = &::livekit_ffi::PacketTrailerHandler::set_publish_timing_observer;
  (self.*set_publish_timing_observer$)(::rust::Box<::livekit_ffi::VideoPublishTimingObserverWrapper>::from_raw(observer));
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$clear_publish_timing_observer(::livekit_ffi::PacketTrailerHandler const &self) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*clear_publish_timing_observer$)() const = &::livekit_ffi::PacketTrailerHandler::clear_publish_timing_observer;
  (self.*clear_publish_timing_observer$)();
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$set_subscribe_timing_observer(::livekit_ffi::PacketTrailerHandler const &self, ::livekit_ffi::VideoSubscribeTimingObserverWrapper *observer) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*set_subscribe_timing_observer$)(::rust::Box<::livekit_ffi::VideoSubscribeTimingObserverWrapper>) const = &::livekit_ffi::PacketTrailerHandler::set_subscribe_timing_observer;
  (self.*set_subscribe_timing_observer$)(::rust::Box<::livekit_ffi::VideoSubscribeTimingObserverWrapper>::from_raw(observer));
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$clear_subscribe_timing_observer(::livekit_ffi::PacketTrailerHandler const &self) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*clear_subscribe_timing_observer$)() const = &::livekit_ffi::PacketTrailerHandler::clear_subscribe_timing_observer;
  (self.*clear_subscribe_timing_observer$)();
}

void livekit_ffi$cxxbridge1$202$PacketTrailerHandler$emit_subscribe_timing(::livekit_ffi::PacketTrailerHandler const &self, ::livekit_ffi::VideoSubscribeTimingStage stage, ::std::uint64_t user_timestamp, ::std::uint32_t frame_id) noexcept {
  void (::livekit_ffi::PacketTrailerHandler::*emit_subscribe_timing$)(::livekit_ffi::VideoSubscribeTimingStage, ::std::uint64_t, ::std::uint32_t) const = &::livekit_ffi::PacketTrailerHandler::emit_subscribe_timing;
  (self.*emit_subscribe_timing$)(stage, user_timestamp, frame_id);
}

void livekit_ffi$cxxbridge1$202$new_packet_trailer_sender(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *peer_factory, ::std::shared_ptr<::livekit_ffi::RtpSender> *sender, ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> (*new_packet_trailer_sender$)(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>, ::std::shared_ptr<::livekit_ffi::RtpSender>) = ::livekit_ffi::new_packet_trailer_sender;
  new (return$) ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>(new_packet_trailer_sender$(::std::move(*peer_factory), ::std::move(*sender)));
}

void livekit_ffi$cxxbridge1$202$new_packet_trailer_receiver(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory> *peer_factory, ::std::shared_ptr<::livekit_ffi::RtpReceiver> *receiver, ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> (*new_packet_trailer_receiver$)(::std::shared_ptr<::livekit_ffi::PeerConnectionFactory>, ::std::shared_ptr<::livekit_ffi::RtpReceiver>) = ::livekit_ffi::new_packet_trailer_receiver;
  new (return$) ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>(new_packet_trailer_receiver$(::std::move(*peer_factory), ::std::move(*receiver)));
}
::std::size_t livekit_ffi$cxxbridge1$202$VideoPublishTimingObserverWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$VideoPublishTimingObserverWrapper$operator$alignof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$VideoSubscribeTimingObserverWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$VideoSubscribeTimingObserverWrapper$operator$alignof() noexcept;

void livekit_ffi$cxxbridge1$202$VideoPublishTimingObserverWrapper$on_publish_timing(::livekit_ffi::VideoPublishTimingObserverWrapper const &self, ::livekit_ffi::VideoPublishTimingEvent *event) noexcept;

void livekit_ffi$cxxbridge1$202$VideoSubscribeTimingObserverWrapper$on_subscribe_timing(::livekit_ffi::VideoSubscribeTimingObserverWrapper const &self, ::livekit_ffi::VideoSubscribeTimingEvent *event) noexcept;
} // extern "C"

::std::size_t VideoPublishTimingObserverWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$VideoPublishTimingObserverWrapper$operator$sizeof();
}

::std::size_t VideoPublishTimingObserverWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$VideoPublishTimingObserverWrapper$operator$alignof();
}

::std::size_t VideoSubscribeTimingObserverWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$VideoSubscribeTimingObserverWrapper$operator$sizeof();
}

::std::size_t VideoSubscribeTimingObserverWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$VideoSubscribeTimingObserverWrapper$operator$alignof();
}

void VideoPublishTimingObserverWrapper::on_publish_timing(::livekit_ffi::VideoPublishTimingEvent event) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::VideoPublishTimingEvent> event$(::std::move(event));
  livekit_ffi$cxxbridge1$202$VideoPublishTimingObserverWrapper$on_publish_timing(*this, &event$.value);
}

void VideoSubscribeTimingObserverWrapper::on_subscribe_timing(::livekit_ffi::VideoSubscribeTimingEvent event) const noexcept {
  ::rust::ManuallyDrop<::livekit_ffi::VideoSubscribeTimingEvent> event$(::std::move(event));
  livekit_ffi$cxxbridge1$202$VideoSubscribeTimingObserverWrapper$on_subscribe_timing(*this, &event$.value);
}
} // namespace livekit_ffi

extern "C" {
::livekit_ffi::VideoPublishTimingObserverWrapper *cxxbridge1$box$livekit_ffi$VideoPublishTimingObserverWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$VideoPublishTimingObserverWrapper$dealloc(::livekit_ffi::VideoPublishTimingObserverWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$VideoPublishTimingObserverWrapper$drop(::rust::Box<::livekit_ffi::VideoPublishTimingObserverWrapper> *ptr) noexcept;

::livekit_ffi::VideoSubscribeTimingObserverWrapper *cxxbridge1$box$livekit_ffi$VideoSubscribeTimingObserverWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$VideoSubscribeTimingObserverWrapper$dealloc(::livekit_ffi::VideoSubscribeTimingObserverWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$VideoSubscribeTimingObserverWrapper$drop(::rust::Box<::livekit_ffi::VideoSubscribeTimingObserverWrapper> *ptr) noexcept;

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$PacketTrailerHandler$null(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$PacketTrailerHandler$raw(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *ptr, ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::PacketTrailerHandler>(raw);
  return ::rust::is_destructible<::livekit_ffi::PacketTrailerHandler>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$PacketTrailerHandler$clone(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> const &self, ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>(self);
}
::std::shared_ptr<::livekit_ffi::PacketTrailerHandler>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$PacketTrailerHandler$get(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$PacketTrailerHandler$drop(::std::shared_ptr<::livekit_ffi::PacketTrailerHandler> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
::livekit_ffi::VideoPublishTimingObserverWrapper *Box<::livekit_ffi::VideoPublishTimingObserverWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$VideoPublishTimingObserverWrapper$alloc();
}
template <>
void Box<::livekit_ffi::VideoPublishTimingObserverWrapper>::allocation::dealloc(::livekit_ffi::VideoPublishTimingObserverWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$VideoPublishTimingObserverWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::VideoPublishTimingObserverWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$VideoPublishTimingObserverWrapper$drop(this);
}
template <>
::livekit_ffi::VideoSubscribeTimingObserverWrapper *Box<::livekit_ffi::VideoSubscribeTimingObserverWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$VideoSubscribeTimingObserverWrapper$alloc();
}
template <>
void Box<::livekit_ffi::VideoSubscribeTimingObserverWrapper>::allocation::dealloc(::livekit_ffi::VideoSubscribeTimingObserverWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$VideoSubscribeTimingObserverWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::VideoSubscribeTimingObserverWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$VideoSubscribeTimingObserverWrapper$drop(this);
}
} // namespace cxxbridge1
} // namespace rust
