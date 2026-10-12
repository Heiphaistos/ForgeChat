#include "livekit/audio_mixer.h"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
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
  using AudioMixer = ::livekit_ffi::AudioMixer;
  using NativeAudioFrame = ::livekit_ffi::NativeAudioFrame;
  enum class AudioFrameInfo : ::std::uint8_t;
  struct AudioMixerSourceWrapper;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$AudioFrameInfo
#define CXXBRIDGE1_ENUM_livekit_ffi$AudioFrameInfo
enum class AudioFrameInfo : ::std::uint8_t {
  Normal = 0,
  Muted = 1,
  Error = 2,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$AudioFrameInfo

#ifndef CXXBRIDGE1_STRUCT_livekit_ffi$AudioMixerSourceWrapper
#define CXXBRIDGE1_STRUCT_livekit_ffi$AudioMixerSourceWrapper
struct AudioMixerSourceWrapper final : public ::rust::Opaque {
  ::std::int32_t ssrc() const noexcept;
  ::std::int32_t preferred_sample_rate() const noexcept;
  ::livekit_ffi::AudioFrameInfo get_audio_frame_with_info(::std::int32_t target_sample_rate, ::livekit_ffi::NativeAudioFrame &frame) const noexcept;
  ~AudioMixerSourceWrapper() = delete;

private:
  friend ::rust::layout;
  struct layout {
    static ::std::size_t size() noexcept;
    static ::std::size_t align() noexcept;
  };
};
#endif // CXXBRIDGE1_STRUCT_livekit_ffi$AudioMixerSourceWrapper

extern "C" {
void livekit_ffi$cxxbridge1$202$AudioMixer$add_source(::livekit_ffi::AudioMixer &self, ::livekit_ffi::AudioMixerSourceWrapper *src) noexcept {
  void (::livekit_ffi::AudioMixer::*add_source$)(::rust::Box<::livekit_ffi::AudioMixerSourceWrapper>) = &::livekit_ffi::AudioMixer::add_source;
  (self.*add_source$)(::rust::Box<::livekit_ffi::AudioMixerSourceWrapper>::from_raw(src));
}

void livekit_ffi$cxxbridge1$202$AudioMixer$remove_source(::livekit_ffi::AudioMixer &self, ::std::int32_t ssrc) noexcept {
  void (::livekit_ffi::AudioMixer::*remove_source$)(::std::int32_t) = &::livekit_ffi::AudioMixer::remove_source;
  (self.*remove_source$)(ssrc);
}

::std::size_t livekit_ffi$cxxbridge1$202$AudioMixer$mix(::livekit_ffi::AudioMixer &self, ::std::size_t num_channels) noexcept {
  ::std::size_t (::livekit_ffi::AudioMixer::*mix$)(::std::size_t) = &::livekit_ffi::AudioMixer::mix;
  return (self.*mix$)(num_channels);
}

::std::int16_t const *livekit_ffi$cxxbridge1$202$AudioMixer$data(::livekit_ffi::AudioMixer const &self) noexcept {
  ::std::int16_t const *(::livekit_ffi::AudioMixer::*data$)() const = &::livekit_ffi::AudioMixer::data;
  return (self.*data$)();
}

::livekit_ffi::AudioMixer *livekit_ffi$cxxbridge1$202$create_audio_mixer() noexcept {
  ::std::unique_ptr<::livekit_ffi::AudioMixer> (*create_audio_mixer$)() = ::livekit_ffi::create_audio_mixer;
  return create_audio_mixer$().release();
}

void livekit_ffi$cxxbridge1$202$NativeAudioFrame$update_frame(::livekit_ffi::NativeAudioFrame &self, ::std::uint32_t timestamp, ::std::int16_t const *data, ::std::size_t samples_per_channel, ::std::int32_t sample_rate_hz, ::std::size_t num_channels) noexcept {
  void (::livekit_ffi::NativeAudioFrame::*update_frame$)(::std::uint32_t, ::std::int16_t const *, ::std::size_t, ::std::int32_t, ::std::size_t) = &::livekit_ffi::NativeAudioFrame::update_frame;
  (self.*update_frame$)(timestamp, data, samples_per_channel, sample_rate_hz, num_channels);
}
::std::size_t livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$operator$sizeof() noexcept;
::std::size_t livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$operator$alignof() noexcept;

::std::int32_t livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$ssrc(::livekit_ffi::AudioMixerSourceWrapper const &self) noexcept;

::std::int32_t livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$preferred_sample_rate(::livekit_ffi::AudioMixerSourceWrapper const &self) noexcept;

::livekit_ffi::AudioFrameInfo livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$get_audio_frame_with_info(::livekit_ffi::AudioMixerSourceWrapper const &self, ::std::int32_t target_sample_rate, ::livekit_ffi::NativeAudioFrame &frame) noexcept;
} // extern "C"

::std::size_t AudioMixerSourceWrapper::layout::size() noexcept {
  return livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$operator$sizeof();
}

::std::size_t AudioMixerSourceWrapper::layout::align() noexcept {
  return livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$operator$alignof();
}

::std::int32_t AudioMixerSourceWrapper::ssrc() const noexcept {
  return livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$ssrc(*this);
}

::std::int32_t AudioMixerSourceWrapper::preferred_sample_rate() const noexcept {
  return livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$preferred_sample_rate(*this);
}

::livekit_ffi::AudioFrameInfo AudioMixerSourceWrapper::get_audio_frame_with_info(::std::int32_t target_sample_rate, ::livekit_ffi::NativeAudioFrame &frame) const noexcept {
  return livekit_ffi$cxxbridge1$202$AudioMixerSourceWrapper$get_audio_frame_with_info(*this, target_sample_rate, frame);
}
} // namespace livekit_ffi

extern "C" {
::livekit_ffi::AudioMixerSourceWrapper *cxxbridge1$box$livekit_ffi$AudioMixerSourceWrapper$alloc() noexcept;
void cxxbridge1$box$livekit_ffi$AudioMixerSourceWrapper$dealloc(::livekit_ffi::AudioMixerSourceWrapper *) noexcept;
void cxxbridge1$box$livekit_ffi$AudioMixerSourceWrapper$drop(::rust::Box<::livekit_ffi::AudioMixerSourceWrapper> *ptr) noexcept;

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::AudioMixer>::type>::value, "definition of `::livekit_ffi::AudioMixer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::AudioMixer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::AudioMixer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$AudioMixer$null(::std::unique_ptr<::livekit_ffi::AudioMixer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::AudioMixer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$AudioMixer$raw(::std::unique_ptr<::livekit_ffi::AudioMixer> *ptr, ::std::unique_ptr<::livekit_ffi::AudioMixer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::AudioMixer>(raw);
}
::std::unique_ptr<::livekit_ffi::AudioMixer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$AudioMixer$get(::std::unique_ptr<::livekit_ffi::AudioMixer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::AudioMixer>::pointer cxxbridge1$unique_ptr$livekit_ffi$AudioMixer$release(::std::unique_ptr<::livekit_ffi::AudioMixer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$AudioMixer$drop(::std::unique_ptr<::livekit_ffi::AudioMixer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::AudioMixer>::value>{}(ptr);
}
} // extern "C"

namespace rust {
inline namespace cxxbridge1 {
template <>
::livekit_ffi::AudioMixerSourceWrapper *Box<::livekit_ffi::AudioMixerSourceWrapper>::allocation::alloc() noexcept {
  return cxxbridge1$box$livekit_ffi$AudioMixerSourceWrapper$alloc();
}
template <>
void Box<::livekit_ffi::AudioMixerSourceWrapper>::allocation::dealloc(::livekit_ffi::AudioMixerSourceWrapper *ptr) noexcept {
  cxxbridge1$box$livekit_ffi$AudioMixerSourceWrapper$dealloc(ptr);
}
template <>
void Box<::livekit_ffi::AudioMixerSourceWrapper>::drop() noexcept {
  cxxbridge1$box$livekit_ffi$AudioMixerSourceWrapper$drop(this);
}
} // namespace cxxbridge1
} // namespace rust
