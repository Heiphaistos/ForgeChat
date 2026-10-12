#include "livekit/webrtc.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <iterator>
#include <new>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#if __cplusplus >= 202002L
#include <ranges>
#endif

#ifdef __clang__
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__

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

namespace {
template <typename T>
struct IsRelocatableOrArray : IsRelocatable<T> {};
template <typename T, ::std::size_t N>
struct IsRelocatableOrArray<T[N]> : IsRelocatableOrArray<T> {};
} // namespace
} // namespace cxxbridge1
} // namespace rust

#if __cplusplus >= 201402L
#define CXX_DEFAULT_VALUE(value) = value
#else
#define CXX_DEFAULT_VALUE(value)
#endif

namespace livekit_ffi {
  struct StringKeyValue;
  enum class FecMechanism : ::std::int32_t;
  enum class RtcpFeedbackType : ::std::int32_t;
  enum class RtcpFeedbackMessageType : ::std::int32_t;
  enum class DegradationPreference : ::std::int32_t;
  struct RtcpFeedback;
  struct RtpCodecCapability;
  struct RtpHeaderExtensionCapability;
  enum class RtpExtensionFilter : ::std::int32_t;
  struct RtpExtension;
  struct RtpFecParameters;
  struct RtpRtxParameters;
  struct RtpEncodingParameters;
  struct RtpCodecParameters;
  struct RtpCapabilities;
  struct RtcpParameters;
  struct RtpParameters;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$StringKeyValue
#define CXXBRIDGE1_STRUCT_livekit_ffi$StringKeyValue
struct StringKeyValue final {
  ::rust::String key;
  ::rust::String value;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$StringKeyValue

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$FecMechanism
#define CXXBRIDGE1_ENUM_livekit_ffi$FecMechanism
enum class FecMechanism : ::std::int32_t {
  Red = 0,
  RedAndUlpfec = 1,
  FlexFec = 2,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$FecMechanism

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$RtcpFeedbackType
#define CXXBRIDGE1_ENUM_livekit_ffi$RtcpFeedbackType
enum class RtcpFeedbackType : ::std::int32_t {
  Ccm = 0,
  Lntf = 1,
  Nack = 2,
  Remb = 3,
  TransportCC = 4,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$RtcpFeedbackType

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$RtcpFeedbackMessageType
#define CXXBRIDGE1_ENUM_livekit_ffi$RtcpFeedbackMessageType
enum class RtcpFeedbackMessageType : ::std::int32_t {
  GenericNack = 0,
  Pli = 1,
  Fir = 2,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$RtcpFeedbackMessageType

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$DegradationPreference
#define CXXBRIDGE1_ENUM_livekit_ffi$DegradationPreference
enum class DegradationPreference : ::std::int32_t {
  // Maintain both framerate and resolution. Frames may be dropped before encoding
  // if necessary to avoid overusing network and encoder resources.
  // Note: This was previously called `Disabled` in older WebRTC versions.
  MaintainFramerateAndResolution = 0,
  MaintainFramerate = 1,
  MaintainResolution = 2,
  Balanced = 3,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$DegradationPreference

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtcpFeedback
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtcpFeedback
struct RtcpFeedback final {
  ::livekit_ffi::RtcpFeedbackType feedback_type;
  bool has_message_type CXX_DEFAULT_VALUE(false);
  ::livekit_ffi::RtcpFeedbackMessageType message_type;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtcpFeedback

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpCodecCapability
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpCodecCapability
struct RtpCodecCapability final {
  ::rust::String mime_type;
  ::rust::String name;
  ::livekit_ffi::MediaType kind;
  bool has_clock_rate CXX_DEFAULT_VALUE(false);
  ::std::int32_t clock_rate CXX_DEFAULT_VALUE(0);
  bool has_preferred_payload_type CXX_DEFAULT_VALUE(false);
  ::std::int32_t preferred_payload_type CXX_DEFAULT_VALUE(0);
  bool has_num_channels CXX_DEFAULT_VALUE(false);
  ::std::int32_t num_channels CXX_DEFAULT_VALUE(0);
  ::rust::Vec<::livekit_ffi::RtcpFeedback> rtcp_feedback;
  ::rust::Vec<::livekit_ffi::StringKeyValue> parameters;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpCodecCapability

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpHeaderExtensionCapability
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpHeaderExtensionCapability
struct RtpHeaderExtensionCapability final {
  ::rust::String uri;
  bool has_preferred_id CXX_DEFAULT_VALUE(false);
  ::std::int32_t preferred_id CXX_DEFAULT_VALUE(0);
  bool preferred_encrypt CXX_DEFAULT_VALUE(false);
  ::livekit_ffi::RtpTransceiverDirection direction;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpHeaderExtensionCapability

#ifndef CXXBRIDGE1_ENUM_livekit_ffi$RtpExtensionFilter
#define CXXBRIDGE1_ENUM_livekit_ffi$RtpExtensionFilter
enum class RtpExtensionFilter : ::std::int32_t {
  DiscardEncryptedExtension = 0,
  PreferEncryptedExtension = 1,
  RequireEncryptedExtension = 2,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$RtpExtensionFilter

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpExtension
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpExtension
struct RtpExtension final {
  ::rust::String uri;
  ::std::int32_t id CXX_DEFAULT_VALUE(0);
  bool encrypt CXX_DEFAULT_VALUE(false);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpExtension

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpFecParameters
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpFecParameters
struct RtpFecParameters final {
  bool has_ssrc CXX_DEFAULT_VALUE(false);
  ::std::uint32_t ssrc CXX_DEFAULT_VALUE(0);
  ::livekit_ffi::FecMechanism mechanism;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpFecParameters

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpRtxParameters
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpRtxParameters
struct RtpRtxParameters final {
  bool has_ssrc CXX_DEFAULT_VALUE(false);
  ::std::uint32_t ssrc CXX_DEFAULT_VALUE(0);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpRtxParameters

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpEncodingParameters
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpEncodingParameters
struct RtpEncodingParameters final {
  bool has_ssrc CXX_DEFAULT_VALUE(false);
  ::std::uint32_t ssrc CXX_DEFAULT_VALUE(0);
  double bitrate_priority CXX_DEFAULT_VALUE(0);
  ::livekit_ffi::Priority network_priority;
  bool has_max_bitrate_bps CXX_DEFAULT_VALUE(false);
  ::std::int32_t max_bitrate_bps CXX_DEFAULT_VALUE(0);
  bool has_min_bitrate_bps CXX_DEFAULT_VALUE(false);
  ::std::int32_t min_bitrate_bps CXX_DEFAULT_VALUE(0);
  bool has_max_framerate CXX_DEFAULT_VALUE(false);
  double max_framerate CXX_DEFAULT_VALUE(0);
  bool has_num_temporal_layers CXX_DEFAULT_VALUE(false);
  ::std::int32_t num_temporal_layers CXX_DEFAULT_VALUE(0);
  bool has_scale_resolution_down_by CXX_DEFAULT_VALUE(false);
  double scale_resolution_down_by CXX_DEFAULT_VALUE(0);
  bool has_scalability_mode CXX_DEFAULT_VALUE(false);
  ::rust::String scalability_mode;
  bool active CXX_DEFAULT_VALUE(false);
  ::rust::String rid;
  bool adaptive_ptime CXX_DEFAULT_VALUE(false);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpEncodingParameters

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpCodecParameters
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpCodecParameters
struct RtpCodecParameters final {
  ::rust::String mime_type;
  ::rust::String name;
  ::livekit_ffi::MediaType kind;
  ::std::int32_t payload_type CXX_DEFAULT_VALUE(0);
  bool has_clock_rate CXX_DEFAULT_VALUE(false);
  ::std::int32_t clock_rate CXX_DEFAULT_VALUE(0);
  bool has_num_channels CXX_DEFAULT_VALUE(false);
  ::std::int32_t num_channels CXX_DEFAULT_VALUE(0);
  bool has_max_ptime CXX_DEFAULT_VALUE(false);
  ::std::int32_t max_ptime CXX_DEFAULT_VALUE(0);
  bool has_ptime CXX_DEFAULT_VALUE(false);
  ::std::int32_t ptime CXX_DEFAULT_VALUE(0);
  ::rust::Vec<::livekit_ffi::RtcpFeedback> rtcp_feedback;
  ::rust::Vec<::livekit_ffi::StringKeyValue> parameters;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpCodecParameters

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpCapabilities
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpCapabilities
struct RtpCapabilities final {
  ::rust::Vec<::livekit_ffi::RtpCodecCapability> codecs;
  ::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> header_extensions;
  ::rust::Vec<::livekit_ffi::FecMechanism> fec;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpCapabilities

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtcpParameters
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtcpParameters
struct RtcpParameters final {
  bool has_ssrc CXX_DEFAULT_VALUE(false);
  ::std::uint32_t ssrc CXX_DEFAULT_VALUE(0);
  ::rust::String cname;
  bool reduced_size CXX_DEFAULT_VALUE(false);
  bool mux CXX_DEFAULT_VALUE(false);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtcpParameters

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpParameters
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpParameters
struct RtpParameters final {
  ::rust::String transaction_id;
  ::rust::String mid;
  ::rust::Vec<::livekit_ffi::RtpCodecParameters> codecs;
  ::rust::Vec<::livekit_ffi::RtpExtension> header_extensions;
  ::rust::Vec<::livekit_ffi::RtpEncodingParameters> encodings;
  ::livekit_ffi::RtcpParameters rtcp;
  bool has_degradation_preference CXX_DEFAULT_VALUE(false);
  ::livekit_ffi::DegradationPreference degradation_preference;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpParameters
} // namespace livekit_ffi

static_assert(
    ::rust::IsRelocatableOrArray<::livekit_ffi::Priority>::value,
    "type livekit_ffi::Priority should be trivially move constructible and trivially destructible in C++ to be used as a field of `RtpEncodingParameters` in Rust");
static_assert(
    ::rust::IsRelocatableOrArray<::livekit_ffi::MediaType>::value,
    "type livekit_ffi::MediaType should be trivially move constructible and trivially destructible in C++ to be used as a field of `RtpCodecCapability`, `RtpCodecParameters` in Rust");
static_assert(
    ::rust::IsRelocatableOrArray<::livekit_ffi::RtpTransceiverDirection>::value,
    "type livekit_ffi::RtpTransceiverDirection should be trivially move constructible and trivially destructible in C++ to be used as a field of `RtpHeaderExtensionCapability` in Rust");

extern "C" {
void cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$new(::rust::Vec<::livekit_ffi::RtcpFeedback> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$drop(::rust::Vec<::livekit_ffi::RtcpFeedback> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$len(::rust::Vec<::livekit_ffi::RtcpFeedback> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$capacity(::rust::Vec<::livekit_ffi::RtcpFeedback> const *ptr) noexcept;
::livekit_ffi::RtcpFeedback const *cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$data(::rust::Vec<::livekit_ffi::RtcpFeedback> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$reserve_total(::rust::Vec<::livekit_ffi::RtcpFeedback> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$set_len(::rust::Vec<::livekit_ffi::RtcpFeedback> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$truncate(::rust::Vec<::livekit_ffi::RtcpFeedback> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$new(::rust::Vec<::livekit_ffi::StringKeyValue> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$drop(::rust::Vec<::livekit_ffi::StringKeyValue> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$len(::rust::Vec<::livekit_ffi::StringKeyValue> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$capacity(::rust::Vec<::livekit_ffi::StringKeyValue> const *ptr) noexcept;
::livekit_ffi::StringKeyValue const *cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$data(::rust::Vec<::livekit_ffi::StringKeyValue> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$reserve_total(::rust::Vec<::livekit_ffi::StringKeyValue> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$set_len(::rust::Vec<::livekit_ffi::StringKeyValue> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$truncate(::rust::Vec<::livekit_ffi::StringKeyValue> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$new(::rust::Vec<::livekit_ffi::RtpCodecCapability> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$drop(::rust::Vec<::livekit_ffi::RtpCodecCapability> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$len(::rust::Vec<::livekit_ffi::RtpCodecCapability> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$capacity(::rust::Vec<::livekit_ffi::RtpCodecCapability> const *ptr) noexcept;
::livekit_ffi::RtpCodecCapability const *cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$data(::rust::Vec<::livekit_ffi::RtpCodecCapability> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$reserve_total(::rust::Vec<::livekit_ffi::RtpCodecCapability> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$set_len(::rust::Vec<::livekit_ffi::RtpCodecCapability> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$truncate(::rust::Vec<::livekit_ffi::RtpCodecCapability> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$new(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$drop(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$len(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$capacity(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> const *ptr) noexcept;
::livekit_ffi::RtpHeaderExtensionCapability const *cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$data(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$reserve_total(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$set_len(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$truncate(::rust::Vec<::livekit_ffi::RtpHeaderExtensionCapability> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$FecMechanism$new(::rust::Vec<::livekit_ffi::FecMechanism> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$FecMechanism$drop(::rust::Vec<::livekit_ffi::FecMechanism> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$FecMechanism$len(::rust::Vec<::livekit_ffi::FecMechanism> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$FecMechanism$capacity(::rust::Vec<::livekit_ffi::FecMechanism> const *ptr) noexcept;
::livekit_ffi::FecMechanism const *cxxbridge1$rust_vec$livekit_ffi$FecMechanism$data(::rust::Vec<::livekit_ffi::FecMechanism> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$FecMechanism$reserve_total(::rust::Vec<::livekit_ffi::FecMechanism> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$FecMechanism$set_len(::rust::Vec<::livekit_ffi::FecMechanism> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$FecMechanism$truncate(::rust::Vec<::livekit_ffi::FecMechanism> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$new(::rust::Vec<::livekit_ffi::RtpCodecParameters> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$drop(::rust::Vec<::livekit_ffi::RtpCodecParameters> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$len(::rust::Vec<::livekit_ffi::RtpCodecParameters> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$capacity(::rust::Vec<::livekit_ffi::RtpCodecParameters> const *ptr) noexcept;
::livekit_ffi::RtpCodecParameters const *cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$data(::rust::Vec<::livekit_ffi::RtpCodecParameters> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$reserve_total(::rust::Vec<::livekit_ffi::RtpCodecParameters> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$set_len(::rust::Vec<::livekit_ffi::RtpCodecParameters> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$truncate(::rust::Vec<::livekit_ffi::RtpCodecParameters> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpExtension$new(::rust::Vec<::livekit_ffi::RtpExtension> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpExtension$drop(::rust::Vec<::livekit_ffi::RtpExtension> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpExtension$len(::rust::Vec<::livekit_ffi::RtpExtension> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpExtension$capacity(::rust::Vec<::livekit_ffi::RtpExtension> const *ptr) noexcept;
::livekit_ffi::RtpExtension const *cxxbridge1$rust_vec$livekit_ffi$RtpExtension$data(::rust::Vec<::livekit_ffi::RtpExtension> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpExtension$reserve_total(::rust::Vec<::livekit_ffi::RtpExtension> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpExtension$set_len(::rust::Vec<::livekit_ffi::RtpExtension> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpExtension$truncate(::rust::Vec<::livekit_ffi::RtpExtension> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$new(::rust::Vec<::livekit_ffi::RtpEncodingParameters> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$drop(::rust::Vec<::livekit_ffi::RtpEncodingParameters> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$len(::rust::Vec<::livekit_ffi::RtpEncodingParameters> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$capacity(::rust::Vec<::livekit_ffi::RtpEncodingParameters> const *ptr) noexcept;
::livekit_ffi::RtpEncodingParameters const *cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$data(::rust::Vec<::livekit_ffi::RtpEncodingParameters> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$reserve_total(::rust::Vec<::livekit_ffi::RtpEncodingParameters> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$set_len(::rust::Vec<::livekit_ffi::RtpEncodingParameters> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$truncate(::rust::Vec<::livekit_ffi::RtpEncodingParameters> *ptr, ::std::size_t len) noexcept;
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
Vec<::livekit_ffi::RtcpFeedback>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$new(this);
}
template <>
void Vec<::livekit_ffi::RtcpFeedback>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtcpFeedback>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtcpFeedback>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$capacity(this);
}
template <>
::livekit_ffi::RtcpFeedback const *Vec<::livekit_ffi::RtcpFeedback>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$data(this);
}
template <>
void Vec<::livekit_ffi::RtcpFeedback>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtcpFeedback>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtcpFeedback>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtcpFeedback$truncate(this, len);
}
template <>
Vec<::livekit_ffi::StringKeyValue>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$new(this);
}
template <>
void Vec<::livekit_ffi::StringKeyValue>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::StringKeyValue>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::StringKeyValue>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$capacity(this);
}
template <>
::livekit_ffi::StringKeyValue const *Vec<::livekit_ffi::StringKeyValue>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$data(this);
}
template <>
void Vec<::livekit_ffi::StringKeyValue>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::StringKeyValue>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::StringKeyValue>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$StringKeyValue$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpCodecCapability>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$new(this);
}
template <>
void Vec<::livekit_ffi::RtpCodecCapability>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpCodecCapability>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpCodecCapability>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$capacity(this);
}
template <>
::livekit_ffi::RtpCodecCapability const *Vec<::livekit_ffi::RtpCodecCapability>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$data(this);
}
template <>
void Vec<::livekit_ffi::RtpCodecCapability>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpCodecCapability>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpCodecCapability>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecCapability$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpHeaderExtensionCapability>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$new(this);
}
template <>
void Vec<::livekit_ffi::RtpHeaderExtensionCapability>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpHeaderExtensionCapability>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpHeaderExtensionCapability>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$capacity(this);
}
template <>
::livekit_ffi::RtpHeaderExtensionCapability const *Vec<::livekit_ffi::RtpHeaderExtensionCapability>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$data(this);
}
template <>
void Vec<::livekit_ffi::RtpHeaderExtensionCapability>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpHeaderExtensionCapability>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpHeaderExtensionCapability>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpHeaderExtensionCapability$truncate(this, len);
}
template <>
Vec<::livekit_ffi::FecMechanism>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$FecMechanism$new(this);
}
template <>
void Vec<::livekit_ffi::FecMechanism>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::FecMechanism>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::FecMechanism>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$capacity(this);
}
template <>
::livekit_ffi::FecMechanism const *Vec<::livekit_ffi::FecMechanism>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$data(this);
}
template <>
void Vec<::livekit_ffi::FecMechanism>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::FecMechanism>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::FecMechanism>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$FecMechanism$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpCodecParameters>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$new(this);
}
template <>
void Vec<::livekit_ffi::RtpCodecParameters>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpCodecParameters>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpCodecParameters>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$capacity(this);
}
template <>
::livekit_ffi::RtpCodecParameters const *Vec<::livekit_ffi::RtpCodecParameters>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$data(this);
}
template <>
void Vec<::livekit_ffi::RtpCodecParameters>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpCodecParameters>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpCodecParameters>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpCodecParameters$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpExtension>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpExtension$new(this);
}
template <>
void Vec<::livekit_ffi::RtpExtension>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpExtension>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpExtension>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$capacity(this);
}
template <>
::livekit_ffi::RtpExtension const *Vec<::livekit_ffi::RtpExtension>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$data(this);
}
template <>
void Vec<::livekit_ffi::RtpExtension>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpExtension>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpExtension>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpExtension$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpEncodingParameters>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$new(this);
}
template <>
void Vec<::livekit_ffi::RtpEncodingParameters>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpEncodingParameters>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpEncodingParameters>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$capacity(this);
}
template <>
::livekit_ffi::RtpEncodingParameters const *Vec<::livekit_ffi::RtpEncodingParameters>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$data(this);
}
template <>
void Vec<::livekit_ffi::RtpEncodingParameters>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpEncodingParameters>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpEncodingParameters>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpEncodingParameters$truncate(this, len);
}
} // namespace cxxbridge1
} // namespace rust
