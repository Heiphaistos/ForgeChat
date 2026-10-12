#include "livekit/apm.h"
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
  using AudioProcessingModule = ::livekit_ffi::AudioProcessingModule;
}

namespace livekit_ffi {
extern "C" {
::std::int32_t livekit_ffi$cxxbridge1$202$AudioProcessingModule$process_stream(::livekit_ffi::AudioProcessingModule &self, ::std::int16_t const *src, ::std::size_t src_len, ::std::int16_t *dst, ::std::size_t dst_len, ::std::int32_t sample_rate, ::std::int32_t num_channels) noexcept {
  ::std::int32_t (::livekit_ffi::AudioProcessingModule::*process_stream$)(::std::int16_t const *, ::std::size_t, ::std::int16_t *, ::std::size_t, ::std::int32_t, ::std::int32_t) = &::livekit_ffi::AudioProcessingModule::process_stream;
  return (self.*process_stream$)(src, src_len, dst, dst_len, sample_rate, num_channels);
}

::std::int32_t livekit_ffi$cxxbridge1$202$AudioProcessingModule$process_reverse_stream(::livekit_ffi::AudioProcessingModule &self, ::std::int16_t const *src, ::std::size_t src_len, ::std::int16_t *dst, ::std::size_t dst_len, ::std::int32_t sample_rate, ::std::int32_t num_channels) noexcept {
  ::std::int32_t (::livekit_ffi::AudioProcessingModule::*process_reverse_stream$)(::std::int16_t const *, ::std::size_t, ::std::int16_t *, ::std::size_t, ::std::int32_t, ::std::int32_t) = &::livekit_ffi::AudioProcessingModule::process_reverse_stream;
  return (self.*process_reverse_stream$)(src, src_len, dst, dst_len, sample_rate, num_channels);
}

::std::int32_t livekit_ffi$cxxbridge1$202$AudioProcessingModule$set_stream_delay_ms(::livekit_ffi::AudioProcessingModule &self, ::std::int32_t delay) noexcept {
  ::std::int32_t (::livekit_ffi::AudioProcessingModule::*set_stream_delay_ms$)(::std::int32_t) = &::livekit_ffi::AudioProcessingModule::set_stream_delay_ms;
  return (self.*set_stream_delay_ms$)(delay);
}

::livekit_ffi::AudioProcessingModule *livekit_ffi$cxxbridge1$202$create_apm(bool echo_canceller_enabled, bool gain_controller_enabled, bool high_pass_filter_enabled, bool noise_suppression_enabled) noexcept {
  ::std::unique_ptr<::livekit_ffi::AudioProcessingModule> (*create_apm$)(bool, bool, bool, bool) = ::livekit_ffi::create_apm;
  return create_apm$(echo_canceller_enabled, gain_controller_enabled, high_pass_filter_enabled, noise_suppression_enabled).release();
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::AudioProcessingModule>::type>::value, "definition of `::livekit_ffi::AudioProcessingModule` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::AudioProcessingModule>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::AudioProcessingModule>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$AudioProcessingModule$null(::std::unique_ptr<::livekit_ffi::AudioProcessingModule> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::AudioProcessingModule>();
}
void cxxbridge1$unique_ptr$livekit_ffi$AudioProcessingModule$raw(::std::unique_ptr<::livekit_ffi::AudioProcessingModule> *ptr, ::std::unique_ptr<::livekit_ffi::AudioProcessingModule>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::AudioProcessingModule>(raw);
}
::std::unique_ptr<::livekit_ffi::AudioProcessingModule>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$AudioProcessingModule$get(::std::unique_ptr<::livekit_ffi::AudioProcessingModule> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::AudioProcessingModule>::pointer cxxbridge1$unique_ptr$livekit_ffi$AudioProcessingModule$release(::std::unique_ptr<::livekit_ffi::AudioProcessingModule> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$AudioProcessingModule$drop(::std::unique_ptr<::livekit_ffi::AudioProcessingModule> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::AudioProcessingModule>::value>{}(ptr);
}
} // extern "C"
