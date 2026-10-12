#include "livekit/media_stream_track.h"
#include "livekit/audio_track.h"
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
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
  struct AudioSourceOptions;
  using AudioTrack = ::livekit_ffi::AudioTrack;
  using NativeAudioSink = ::livekit_ffi::NativeAudioSink;
  using AudioTrackSource = ::livekit_ffi::AudioTrackSource;
  struct AudioSinkWrapper;
  struct SourceContext;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$AudioSourceOptions
#define CXXBRIDGE1_STRUCT_livekit_ffi$AudioSourceOptions
struct AudioSourceOptions final {
  bool echo_cancellation CXX_DEFAULT_VALUE(false);
  bool noise_suppression CXX_DEFAULT_VALUE(false);
  bool auto_gain_control CXX_DEFAULT_VALUE(false);

  using IsRelocatable = ::std::true_type;
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$AudioSourceOptions

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$AudioSinkWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$AudioSinkWrapper
struct AudioSinkWrapper final : public ::rust::Opaque {
  void on_data(::rust::Slice<::std::int16_t const> data, ::std::int32_t sample_rate, ::std::size_t nb_channels, ::std::size_t nb_frames) const noexcept;
  ~AudioSinkWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$AudioSinkWrapper

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$SourceContext
#define CXXBRIDGE1_STRUCT_livekit_ffi$SourceContext
struct SourceContext final : public ::rust::Opaque {
  ~SourceContext() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$SourceContext
} // namespace livekit_ffi

static_assert(
    ::rust::IsRelocatable<::livekit_ffi::CompleteCallback>::value,
    "type livekit_ffi::CompleteCallback should be trivially move constructible and trivially destructible in C++ to be used as an argument of `capture_frame` in Rust");

namespace livekit_ffi {
extern "C" {
void livekit_ffi$cxxbridge1$202$AudioTrack$add_sink(::livekit_ffi::AudioTrack const &self, ::std::shared_ptr<::livekit_ffi::NativeAudioSink> const &sink) noexcept {
  void (::livekit_ffi::AudioTrack::*add_sink$)(::std::shared_ptr<::livekit_ffi::NativeAudioSink> const &) const = &::livekit_ffi::AudioTrack::add_sink;
  (self.*add_sink$)(sink);
}

void livekit_ffi$cxxbridge1$202$AudioTrack$remove_sink(::livekit_ffi::AudioTrack const &self, ::std::shared_ptr<::livekit_ffi::NativeAudioSink> const &sink) noexcept {
  void (::livekit_ffi::AudioTrack::*remove_sink$)(::std::shared_ptr<::livekit_ffi::NativeAudioSink> const &) const = &::livekit_ffi::AudioTrack::remove_sink;
  (self.*remove_sink$)(sink);
}

void livekit_ffi$cxxbridge1$202$new_native_audio_sink(::livekit_ffi::AudioSinkWrapper *observer, ::std::int32_t sample_rate, ::std::int32_t num_channels, ::std::shared_ptr<::livekit_ffi::NativeAudioSink> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::NativeAudioSink> (*new_native_audio_sink$)(::rust::Box<::livekit_ffi::AudioSinkWrapper>, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_native_audio_sink;
  new (return$) ::std::shared_ptr<::livekit_ffi::NativeAudioSink>(new_native_audio_sink$(::rust::Box<::livekit_ffi::AudioSinkWrapper>::from_raw(observer), sample_rate, num_channels));
}

bool livekit_ffi$cxxbridge1$202$AudioTrackSource$capture_frame(::livekit_ffi::AudioTrackSource const &self, ::rust::Slice<::std::int16_t const> data, ::std::uint32_t sample_rate, ::std::uint32_t nb_channels, ::std::size_t nb_frames, ::livekit_ffi::SourceContext const *userdata, ::livekit_ffi::CompleteCallback *on_complete) noexcept {
  bool (::livekit_ffi::AudioTrackSource::*capture_frame$)(::rust::Slice<::std::int16_t const>, ::std::uint32_t, ::std::uint32_t, ::std::size_t, ::livekit_ffi::SourceContext const *, ::livekit_ffi::CompleteCallback) const = &::livekit_ffi::AudioTrackSource::capture_frame;
  return (self.*capture_frame$)(data, sample_rate, nb_channels, nb_frames, userdata, ::std::move(*on_complete));
}

void livekit_ffi$cxxbridge1$202$AudioTrackSource$clear_buffer(::livekit_ffi::AudioTrackSource const &self) noexcept {
  void (::livekit_ffi::AudioTrackSource::*clear_buffer$)() const = &::livekit_ffi::AudioTrackSource::clear_buffer;
  (self.*clear_buffer$)();
}

void livekit_ffi$cxxbridge1$202$AudioTrackSource$audio_options(::livekit_ffi::AudioTrackSource const &self, ::livekit_ffi::AudioSourceOptions *return$) noexcept {
  ::livekit_ffi::AudioSourceOptions (::livekit_ffi::AudioTrackSource::*audio_options$)() const = &::livekit_ffi::AudioTrackSource::audio_options;
  new (return$) ::livekit_ffi::AudioSourceOptions((self.*audio_options$)());
}

void livekit_ffi$cxxbridge1$202$AudioTrackSource$set_audio_options(::livekit_ffi::AudioTrackSource const &self, ::livekit_ffi::AudioSourceOptions const &options) noexcept {
  void (::livekit_ffi::AudioTrackSource::*set_audio_options$)(::livekit_ffi::AudioSourceOptions const &) const = &::livekit_ffi::AudioTrackSource::set_audio_options;
  (self.*set_audio_options$)(options);
}

void livekit_ffi$cxxbridge1$202$new_audio_track_source(::livekit_ffi::AudioSourceOptions *options, ::std::int32_t sample_rate, ::std::int32_t num_channels, ::std::int32_t queue_size_ms, ::std::shared_ptr<::livekit_ffi::AudioTrackSource> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioTrackSource> (*new_audio_track_source$)(::livekit_ffi::AudioSourceOptions, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_audio_track_source;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioTrackSource>(new_audio_track_source$(::std::move(*options), sample_rate, num_channels, queue_size_ms));
}

void livekit_ffi$cxxbridge1$202$audio_to_media(::std::shared_ptr<::livekit_ffi::AudioTrack> *track, ::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::MediaStreamTrack> (*audio_to_media$)(::std::shared_ptr<::livekit_ffi::AudioTrack>) = ::livekit_ffi::audio_to_media;
  new (return$) ::std::shared_ptr<::livekit_ffi::MediaStreamTrack>(audio_to_media$(::std::move(*track)));
}

void livekit_ffi$cxxbridge1$202$media_to_audio(::std::shared_ptr<::livekit_ffi::MediaStreamTrack> *track, ::std::shared_ptr<::livekit_ffi::AudioTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioTrack> (*media_to_audio$)(::std::shared_ptr<::livekit_ffi::MediaStreamTrack>) = ::livekit_ffi::media_to_audio;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioTrack>(media_to_audio$(::std::move(*track)));
}

void livekit_ffi$cxxbridge1$202$_shared_audio_track(::std::shared_ptr<::livekit_ffi::AudioTrack> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioTrack> (*_shared_audio_track$)() = ::livekit_ffi::_shared_audio_track;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioTrack>(_shared_audio_track$());
}

void livekit_ffi$cxxbridge1$202$_shared_audio_track_source(::std::shared_ptr<::livekit_ffi::AudioTrackSource> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::AudioTrackSource> (*_shared_audio_track_source$)() = ::livekit_ffi::_shared_audio_track_source;
  new (return$) ::std::shared_ptr<::livekit_ffi::AudioTrackSource>(_shared_audio_track_source$());
}
::std::size_t livekit_ffi$cxxbridge1$202$AudioSinkWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$AudioSinkWrapper$operator$alignof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$SourceContext$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$SourceContext$operator$alignof() noexcept;

void livekit_ffi$cxxbridge1$202$AudioSinkWrapper$on_data(::livekit_ffi::AudioSinkWrapper const &self, ::rust::Slice<::std::int16_t const> data, ::std::int32_t sample_rate, ::std::size_t nb_channels, ::std::size_t nb_frames) noexcept;
} // extern "C"

::std::size_t AudioSinkWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$AudioSinkWrapper$operator$sizeof();
}

::std::size_t AudioSinkWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$AudioSinkWrapper$operator$alignof();
}

::std::size_t SourceContext::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$SourceContext$operator$sizeof();
}

::std::size_t SourceContext::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$SourceContext$operator$alignof();
}

void AudioSinkWrapper::on_data(::rust::Slice<::std::int16_t const> data, ::std::int32_t sample_rate, ::std::size_t nb_channels, ::std::size_t nb_frames) const noexcept {
  livekit_ffi$cxxbridge1$202$AudioSinkWrapper$on_data(*this, data, sample_rate, nb_channels, nb_frames);
}
} // namespace livekit_ffi

extern "C" {
static_assert(sizeof(::std::shared_ptr<::livekit_ffi::NativeAudioSink>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::NativeAudioSink>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$NativeAudioSink$null(::std::shared_ptr<::livekit_ffi::NativeAudioSink> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::NativeAudioSink>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$NativeAudioSink$raw(::std::shared_ptr<::livekit_ffi::NativeAudioSink> *ptr, ::std::shared_ptr<::livekit_ffi::NativeAudioSink>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::NativeAudioSink>(raw);
  return ::rust::is_destructible<::livekit_ffi::NativeAudioSink>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$NativeAudioSink$clone(::std::shared_ptr<::livekit_ffi::NativeAudioSink> const &self, ::std::shared_ptr<::livekit_ffi::NativeAudioSink> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::NativeAudioSink>(self);
}
::std::shared_ptr<::livekit_ffi::NativeAudioSink>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$NativeAudioSink$get(::std::shared_ptr<::livekit_ffi::NativeAudioSink> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$NativeAudioSink$drop(::std::shared_ptr<::livekit_ffi::NativeAudioSink> *self) noexcept {
  self->~shared_ptr();
}

::livekit_ffi::AudioSinkWrapper *cxxbridge1$box$livekit_ffi$AudioSinkWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$AudioSinkWrapper$dealloc(::livekit_ffi::AudioSinkWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$AudioSinkWrapper$drop(::rust::Box<::livekit_ffi::AudioSinkWrapper> *ptr) noexcept;

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::AudioTrackSource>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::AudioTrackSource>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$AudioTrackSource$null(::std::shared_ptr<::livekit_ffi::AudioTrackSource> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::AudioTrackSource>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$AudioTrackSource$raw(::std::shared_ptr<::livekit_ffi::AudioTrackSource> *ptr, ::std::shared_ptr<::livekit_ffi::AudioTrackSource>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::AudioTrackSource>(raw);
  return ::rust::is_destructible<::livekit_ffi::AudioTrackSource>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$AudioTrackSource$clone(::std::shared_ptr<::livekit_ffi::AudioTrackSource> const &self, ::std::shared_ptr<::livekit_ffi::AudioTrackSource> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::AudioTrackSource>(self);
}
::std::shared_ptr<::livekit_ffi::AudioTrackSource>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$AudioTrackSource$get(::std::shared_ptr<::livekit_ffi::AudioTrackSource> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$AudioTrackSource$drop(::std::shared_ptr<::livekit_ffi::AudioTrackSource> *self) noexcept {
  self->~shared_ptr();
}

static_assert(sizeof(::std::shared_ptr<::livekit_ffi::AudioTrack>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::AudioTrack>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$AudioTrack$null(::std::shared_ptr<::livekit_ffi::AudioTrack> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::AudioTrack>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$AudioTrack$raw(::std::shared_ptr<::livekit_ffi::AudioTrack> *ptr, ::std::shared_ptr<::livekit_ffi::AudioTrack>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::AudioTrack>(raw);
  return ::rust::is_destructible<::livekit_ffi::AudioTrack>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$AudioTrack$clone(::std::shared_ptr<::livekit_ffi::AudioTrack> const &self, ::std::shared_ptr<::livekit_ffi::AudioTrack> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::AudioTrack>(self);
}
::std::shared_ptr<::livekit_ffi::AudioTrack>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$AudioTrack$get(::std::shared_ptr<::livekit_ffi::AudioTrack> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$AudioTrack$drop(::std::shared_ptr<::livekit_ffi::AudioTrack> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
::livekit_ffi::AudioSinkWrapper *Box<::livekit_ffi::AudioSinkWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$AudioSinkWrapper$alloc();
}
template <>
void Box<::livekit_ffi::AudioSinkWrapper>::allocation::dealloc(::livekit_ffi::AudioSinkWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$AudioSinkWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::AudioSinkWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$AudioSinkWrapper$drop(this);
}
} // namespace cxxbridge1
} // namespace rust
