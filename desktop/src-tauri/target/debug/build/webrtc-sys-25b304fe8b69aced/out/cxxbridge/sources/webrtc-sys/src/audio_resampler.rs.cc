#include "livekit/audio_resampler.h"
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
  using AudioResampler = ::livekit_ffi::AudioResampler;
}

namespace livekit_ffi {
extern "C" {
::std::size_t livekit_ffi$cxxbridge1$202$AudioResampler$remix_and_resample(::livekit_ffi::AudioResampler &self, ::std::int16_t const *src, ::std::size_t samples_per_channel, ::std::size_t num_channels, ::std::int32_t sample_rate, ::std::size_t dst_num_channels, ::std::int32_t dst_sample_rate) noexcept {
  ::std::size_t (::livekit_ffi::AudioResampler::*remix_and_resample$)(::std::int16_t const *, ::std::size_t, ::std::size_t, ::std::int32_t, ::std::size_t, ::std::int32_t) = &::livekit_ffi::AudioResampler::remix_and_resample;
  return (self.*remix_and_resample$)(src, samples_per_channel, num_channels, sample_rate, dst_num_channels, dst_sample_rate);
}

::std::int16_t const *livekit_ffi$cxxbridge1$202$AudioResampler$data(::livekit_ffi::AudioResampler const &self) noexcept {
  ::std::int16_t const *(::livekit_ffi::AudioResampler::*data$)() const = &::livekit_ffi::AudioResampler::data;
  return (self.*data$)();
}

::livekit_ffi::AudioResampler *livekit_ffi$cxxbridge1$202$create_audio_resampler() noexcept {
  ::std::unique_ptr<::livekit_ffi::AudioResampler> (*create_audio_resampler$)() = ::livekit_ffi::create_audio_resampler;
  return create_audio_resampler$().release();
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::AudioResampler>::type>::value, "definition of `::livekit_ffi::AudioResampler` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::AudioResampler>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::AudioResampler>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$AudioResampler$null(::std::unique_ptr<::livekit_ffi::AudioResampler> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::AudioResampler>();
}
void cxxbridge1$unique_ptr$livekit_ffi$AudioResampler$raw(::std::unique_ptr<::livekit_ffi::AudioResampler> *ptr, ::std::unique_ptr<::livekit_ffi::AudioResampler>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::AudioResampler>(raw);
}
::std::unique_ptr<::livekit_ffi::AudioResampler>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$AudioResampler$get(::std::unique_ptr<::livekit_ffi::AudioResampler> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::AudioResampler>::pointer cxxbridge1$unique_ptr$livekit_ffi$AudioResampler$release(::std::unique_ptr<::livekit_ffi::AudioResampler> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$AudioResampler$drop(::std::unique_ptr<::livekit_ffi::AudioResampler> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::AudioResampler>::value>{}(ptr);
}
} // extern "C"
