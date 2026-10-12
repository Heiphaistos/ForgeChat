#include "livekit/helper.h"
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

class Opaque;

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
} // namespace cxxbridge1
} // namespace rust

namespace livekit_ffi {
  struct MediaStreamPtr;
  struct CandidatePtr;
  struct AudioTrackPtr;
  struct VideoTrackPtr;
  struct RtpSenderPtr;
  struct RtpReceiverPtr;
  struct RtpTransceiverPtr;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$MediaStreamPtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$MediaStreamPtr
struct MediaStreamPtr final {
  ::std::shared_ptr<::livekit_ffi::MediaStream> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$MediaStreamPtr

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePtr
struct CandidatePtr final {
  ::std::shared_ptr<::livekit_ffi::Candidate> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$CandidatePtr

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$AudioTrackPtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$AudioTrackPtr
struct AudioTrackPtr final {
  ::std::shared_ptr<::livekit_ffi::AudioTrack> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$AudioTrackPtr

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$VideoTrackPtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$VideoTrackPtr
struct VideoTrackPtr final {
  ::std::shared_ptr<::livekit_ffi::VideoTrack> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$VideoTrackPtr

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpSenderPtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpSenderPtr
struct RtpSenderPtr final {
  ::std::shared_ptr<::livekit_ffi::RtpSender> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpSenderPtr

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpReceiverPtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpReceiverPtr
struct RtpReceiverPtr final {
  ::std::shared_ptr<::livekit_ffi::RtpReceiver> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpReceiverPtr

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$RtpTransceiverPtr
#define CXXBRIDGE1_STRUCT_livekit_ffi$RtpTransceiverPtr
struct RtpTransceiverPtr final {
  ::std::shared_ptr<::livekit_ffi::RtpTransceiver> ptr;

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$RtpTransceiverPtr

extern "C" {
void livekit_ffi$cxxbridge1$202$_vec_media_stream_ptr(::rust::Vec<::livekit_ffi::MediaStreamPtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::MediaStreamPtr> (*_vec_media_stream_ptr$)() = ::livekit_ffi::_vec_media_stream_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::MediaStreamPtr>(_vec_media_stream_ptr$());
}

void livekit_ffi$cxxbridge1$202$_vec_candidate_ptr(::rust::Vec<::livekit_ffi::CandidatePtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::CandidatePtr> (*_vec_candidate_ptr$)() = ::livekit_ffi::_vec_candidate_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::CandidatePtr>(_vec_candidate_ptr$());
}

void livekit_ffi$cxxbridge1$202$_vec_audio_track_ptr(::rust::Vec<::livekit_ffi::AudioTrackPtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::AudioTrackPtr> (*_vec_audio_track_ptr$)() = ::livekit_ffi::_vec_audio_track_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::AudioTrackPtr>(_vec_audio_track_ptr$());
}

void livekit_ffi$cxxbridge1$202$_vec_video_track_ptr(::rust::Vec<::livekit_ffi::VideoTrackPtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::VideoTrackPtr> (*_vec_video_track_ptr$)() = ::livekit_ffi::_vec_video_track_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::VideoTrackPtr>(_vec_video_track_ptr$());
}

void livekit_ffi$cxxbridge1$202$_vec_rtp_sender_ptr(::rust::Vec<::livekit_ffi::RtpSenderPtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::RtpSenderPtr> (*_vec_rtp_sender_ptr$)() = ::livekit_ffi::_vec_rtp_sender_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::RtpSenderPtr>(_vec_rtp_sender_ptr$());
}

void livekit_ffi$cxxbridge1$202$_vec_rtp_receiver_ptr(::rust::Vec<::livekit_ffi::RtpReceiverPtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::RtpReceiverPtr> (*_vec_rtp_receiver_ptr$)() = ::livekit_ffi::_vec_rtp_receiver_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::RtpReceiverPtr>(_vec_rtp_receiver_ptr$());
}

void livekit_ffi$cxxbridge1$202$_vec_rtp_transceiver_ptr(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> *return$) noexcept {
  ::rust::Vec<::livekit_ffi::RtpTransceiverPtr> (*_vec_rtp_transceiver_ptr$)() = ::livekit_ffi::_vec_rtp_transceiver_ptr;
  new (return$) ::rust::Vec<::livekit_ffi::RtpTransceiverPtr>(_vec_rtp_transceiver_ptr$());
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
void cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$new(::rust::Vec<::livekit_ffi::MediaStreamPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$drop(::rust::Vec<::livekit_ffi::MediaStreamPtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$len(::rust::Vec<::livekit_ffi::MediaStreamPtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$capacity(::rust::Vec<::livekit_ffi::MediaStreamPtr> const *ptr) noexcept;
::livekit_ffi::MediaStreamPtr const *cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$data(::rust::Vec<::livekit_ffi::MediaStreamPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$reserve_total(::rust::Vec<::livekit_ffi::MediaStreamPtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$set_len(::rust::Vec<::livekit_ffi::MediaStreamPtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$truncate(::rust::Vec<::livekit_ffi::MediaStreamPtr> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$new(::rust::Vec<::livekit_ffi::CandidatePtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$drop(::rust::Vec<::livekit_ffi::CandidatePtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$len(::rust::Vec<::livekit_ffi::CandidatePtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$capacity(::rust::Vec<::livekit_ffi::CandidatePtr> const *ptr) noexcept;
::livekit_ffi::CandidatePtr const *cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$data(::rust::Vec<::livekit_ffi::CandidatePtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$reserve_total(::rust::Vec<::livekit_ffi::CandidatePtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$set_len(::rust::Vec<::livekit_ffi::CandidatePtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$truncate(::rust::Vec<::livekit_ffi::CandidatePtr> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$new(::rust::Vec<::livekit_ffi::AudioTrackPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$drop(::rust::Vec<::livekit_ffi::AudioTrackPtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$len(::rust::Vec<::livekit_ffi::AudioTrackPtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$capacity(::rust::Vec<::livekit_ffi::AudioTrackPtr> const *ptr) noexcept;
::livekit_ffi::AudioTrackPtr const *cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$data(::rust::Vec<::livekit_ffi::AudioTrackPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$reserve_total(::rust::Vec<::livekit_ffi::AudioTrackPtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$set_len(::rust::Vec<::livekit_ffi::AudioTrackPtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$truncate(::rust::Vec<::livekit_ffi::AudioTrackPtr> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$new(::rust::Vec<::livekit_ffi::VideoTrackPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$drop(::rust::Vec<::livekit_ffi::VideoTrackPtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$len(::rust::Vec<::livekit_ffi::VideoTrackPtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$capacity(::rust::Vec<::livekit_ffi::VideoTrackPtr> const *ptr) noexcept;
::livekit_ffi::VideoTrackPtr const *cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$data(::rust::Vec<::livekit_ffi::VideoTrackPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$reserve_total(::rust::Vec<::livekit_ffi::VideoTrackPtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$set_len(::rust::Vec<::livekit_ffi::VideoTrackPtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$truncate(::rust::Vec<::livekit_ffi::VideoTrackPtr> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$new(::rust::Vec<::livekit_ffi::RtpSenderPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$drop(::rust::Vec<::livekit_ffi::RtpSenderPtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$len(::rust::Vec<::livekit_ffi::RtpSenderPtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$capacity(::rust::Vec<::livekit_ffi::RtpSenderPtr> const *ptr) noexcept;
::livekit_ffi::RtpSenderPtr const *cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$data(::rust::Vec<::livekit_ffi::RtpSenderPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$reserve_total(::rust::Vec<::livekit_ffi::RtpSenderPtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$set_len(::rust::Vec<::livekit_ffi::RtpSenderPtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$truncate(::rust::Vec<::livekit_ffi::RtpSenderPtr> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$new(::rust::Vec<::livekit_ffi::RtpReceiverPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$drop(::rust::Vec<::livekit_ffi::RtpReceiverPtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$len(::rust::Vec<::livekit_ffi::RtpReceiverPtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$capacity(::rust::Vec<::livekit_ffi::RtpReceiverPtr> const *ptr) noexcept;
::livekit_ffi::RtpReceiverPtr const *cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$data(::rust::Vec<::livekit_ffi::RtpReceiverPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$reserve_total(::rust::Vec<::livekit_ffi::RtpReceiverPtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$set_len(::rust::Vec<::livekit_ffi::RtpReceiverPtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$truncate(::rust::Vec<::livekit_ffi::RtpReceiverPtr> *ptr, ::std::size_t len) noexcept;

void cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$new(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$drop(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$len(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> const *ptr) noexcept;
::std::size_t cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$capacity(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> const *ptr) noexcept;
::livekit_ffi::RtpTransceiverPtr const *cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$data(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> const *ptr) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$reserve_total(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> *ptr, ::std::size_t new_cap) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$set_len(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> *ptr, ::std::size_t len) noexcept;
void cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$truncate(::rust::Vec<::livekit_ffi::RtpTransceiverPtr> *ptr, ::std::size_t len) noexcept;
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
Vec<::livekit_ffi::MediaStreamPtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$new(this);
}
template <>
void Vec<::livekit_ffi::MediaStreamPtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::MediaStreamPtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::MediaStreamPtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$capacity(this);
}
template <>
::livekit_ffi::MediaStreamPtr const *Vec<::livekit_ffi::MediaStreamPtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$data(this);
}
template <>
void Vec<::livekit_ffi::MediaStreamPtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::MediaStreamPtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::MediaStreamPtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$MediaStreamPtr$truncate(this, len);
}
template <>
Vec<::livekit_ffi::CandidatePtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$new(this);
}
template <>
void Vec<::livekit_ffi::CandidatePtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::CandidatePtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::CandidatePtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$capacity(this);
}
template <>
::livekit_ffi::CandidatePtr const *Vec<::livekit_ffi::CandidatePtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$data(this);
}
template <>
void Vec<::livekit_ffi::CandidatePtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::CandidatePtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::CandidatePtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$CandidatePtr$truncate(this, len);
}
template <>
Vec<::livekit_ffi::AudioTrackPtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$new(this);
}
template <>
void Vec<::livekit_ffi::AudioTrackPtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::AudioTrackPtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::AudioTrackPtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$capacity(this);
}
template <>
::livekit_ffi::AudioTrackPtr const *Vec<::livekit_ffi::AudioTrackPtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$data(this);
}
template <>
void Vec<::livekit_ffi::AudioTrackPtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::AudioTrackPtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::AudioTrackPtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$AudioTrackPtr$truncate(this, len);
}
template <>
Vec<::livekit_ffi::VideoTrackPtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$new(this);
}
template <>
void Vec<::livekit_ffi::VideoTrackPtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::VideoTrackPtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::VideoTrackPtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$capacity(this);
}
template <>
::livekit_ffi::VideoTrackPtr const *Vec<::livekit_ffi::VideoTrackPtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$data(this);
}
template <>
void Vec<::livekit_ffi::VideoTrackPtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::VideoTrackPtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::VideoTrackPtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$VideoTrackPtr$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpSenderPtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$new(this);
}
template <>
void Vec<::livekit_ffi::RtpSenderPtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpSenderPtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpSenderPtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$capacity(this);
}
template <>
::livekit_ffi::RtpSenderPtr const *Vec<::livekit_ffi::RtpSenderPtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$data(this);
}
template <>
void Vec<::livekit_ffi::RtpSenderPtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpSenderPtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpSenderPtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpSenderPtr$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpReceiverPtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$new(this);
}
template <>
void Vec<::livekit_ffi::RtpReceiverPtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpReceiverPtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpReceiverPtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$capacity(this);
}
template <>
::livekit_ffi::RtpReceiverPtr const *Vec<::livekit_ffi::RtpReceiverPtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$data(this);
}
template <>
void Vec<::livekit_ffi::RtpReceiverPtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpReceiverPtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpReceiverPtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpReceiverPtr$truncate(this, len);
}
template <>
Vec<::livekit_ffi::RtpTransceiverPtr>::Vec() noexcept {
  cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$new(this);
}
template <>
void Vec<::livekit_ffi::RtpTransceiverPtr>::drop() noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$drop(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpTransceiverPtr>::size() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$len(this);
}
template <>
::std::size_t Vec<::livekit_ffi::RtpTransceiverPtr>::capacity() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$capacity(this);
}
template <>
::livekit_ffi::RtpTransceiverPtr const *Vec<::livekit_ffi::RtpTransceiverPtr>::data() const noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$data(this);
}
template <>
void Vec<::livekit_ffi::RtpTransceiverPtr>::reserve_total(::std::size_t new_cap) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$reserve_total(this, new_cap);
}
template <>
void Vec<::livekit_ffi::RtpTransceiverPtr>::set_len(::std::size_t len) noexcept {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$set_len(this, len);
}
template <>
void Vec<::livekit_ffi::RtpTransceiverPtr>::truncate(::std::size_t len) {
  return cxxbridge1$rust_vec$livekit_ffi$RtpTransceiverPtr$truncate(this, len);
}
} // namespace cxxbridge1
} // namespace rust
