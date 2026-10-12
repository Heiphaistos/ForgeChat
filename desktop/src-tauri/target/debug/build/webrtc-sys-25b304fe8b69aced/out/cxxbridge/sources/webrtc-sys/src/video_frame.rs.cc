#include "livekit/video_frame_buffer.h"
#include "livekit/video_frame.h"
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
  enum class VideoRotation : ::std::int32_t;
  using VideoFrame = ::livekit_ffi::VideoFrame;
  using VideoFrameBuilder = ::livekit_ffi::VideoFrameBuilder;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$VideoRotation
#define CXXBRIDGE1_ENUM_livekit_ffi$VideoRotation
enum class VideoRotation : ::std::int32_t {
  VideoRotation0 = 0,
  VideoRotation90 = 90,
  VideoRotation180 = 180,
  VideoRotation270 = 270,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$VideoRotation

extern "C" {
::std::uint32_t livekit_ffi$cxxbridge1$202$VideoFrame$width(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::VideoFrame::*width$)() const = &::livekit_ffi::VideoFrame::width;
  return (self.*width$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$VideoFrame$height(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::VideoFrame::*height$)() const = &::livekit_ffi::VideoFrame::height;
  return (self.*height$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$VideoFrame$size(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::VideoFrame::*size$)() const = &::livekit_ffi::VideoFrame::size;
  return (self.*size$)();
}

::std::uint16_t livekit_ffi$cxxbridge1$202$VideoFrame$id(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::uint16_t (::livekit_ffi::VideoFrame::*id$)() const = &::livekit_ffi::VideoFrame::id;
  return (self.*id$)();
}

::std::int64_t livekit_ffi$cxxbridge1$202$VideoFrame$timestamp_us(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::int64_t (::livekit_ffi::VideoFrame::*timestamp_us$)() const = &::livekit_ffi::VideoFrame::timestamp_us;
  return (self.*timestamp_us$)();
}

::std::int64_t livekit_ffi$cxxbridge1$202$VideoFrame$ntp_time_ms(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::int64_t (::livekit_ffi::VideoFrame::*ntp_time_ms$)() const = &::livekit_ffi::VideoFrame::ntp_time_ms;
  return (self.*ntp_time_ms$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$VideoFrame$timestamp(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::VideoFrame::*timestamp$)() const = &::livekit_ffi::VideoFrame::timestamp;
  return (self.*timestamp$)();
}

::livekit_ffi::VideoRotation livekit_ffi$cxxbridge1$202$VideoFrame$rotation(::livekit_ffi::VideoFrame const &self) noexcept {
  ::livekit_ffi::VideoRotation (::livekit_ffi::VideoFrame::*rotation$)() const = &::livekit_ffi::VideoFrame::rotation;
  return (self.*rotation$)();
}

::livekit_ffi::VideoFrameBuffer *livekit_ffi$cxxbridge1$202$VideoFrame$video_frame_buffer(::livekit_ffi::VideoFrame const &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> (::livekit_ffi::VideoFrame::*video_frame_buffer$)() const = &::livekit_ffi::VideoFrame::video_frame_buffer;
  return (self.*video_frame_buffer$)().release();
}

::livekit_ffi::VideoFrameBuilder *livekit_ffi$cxxbridge1$202$new_video_frame_builder() noexcept {
  ::std::unique_ptr<::livekit_ffi::VideoFrameBuilder> (*new_video_frame_builder$)() = ::livekit_ffi::new_video_frame_builder;
  return new_video_frame_builder$().release();
}

void livekit_ffi$cxxbridge1$202$VideoFrameBuilder$set_timestamp_us(::livekit_ffi::VideoFrameBuilder &self, ::std::int64_t timestamp_us) noexcept {
  void (::livekit_ffi::VideoFrameBuilder::*set_timestamp_us$)(::std::int64_t) = &::livekit_ffi::VideoFrameBuilder::set_timestamp_us;
  (self.*set_timestamp_us$)(timestamp_us);
}

void livekit_ffi$cxxbridge1$202$VideoFrameBuilder$set_rotation(::livekit_ffi::VideoFrameBuilder &self, ::livekit_ffi::VideoRotation rotation) noexcept {
  void (::livekit_ffi::VideoFrameBuilder::*set_rotation$)(::livekit_ffi::VideoRotation) = &::livekit_ffi::VideoFrameBuilder::set_rotation;
  (self.*set_rotation$)(rotation);
}

void livekit_ffi$cxxbridge1$202$VideoFrameBuilder$set_id(::livekit_ffi::VideoFrameBuilder &self, ::std::uint16_t id) noexcept {
  void (::livekit_ffi::VideoFrameBuilder::*set_id$)(::std::uint16_t) = &::livekit_ffi::VideoFrameBuilder::set_id;
  (self.*set_id$)(id);
}

void livekit_ffi$cxxbridge1$202$VideoFrameBuilder$set_video_frame_buffer(::livekit_ffi::VideoFrameBuilder &self, ::livekit_ffi::VideoFrameBuffer const &buffer) noexcept {
  void (::livekit_ffi::VideoFrameBuilder::*set_video_frame_buffer$)(::livekit_ffi::VideoFrameBuffer const &) = &::livekit_ffi::VideoFrameBuilder::set_video_frame_buffer;
  (self.*set_video_frame_buffer$)(buffer);
}

::livekit_ffi::VideoFrame *livekit_ffi$cxxbridge1$202$VideoFrameBuilder$build(::livekit_ffi::VideoFrameBuilder &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::VideoFrame> (::livekit_ffi::VideoFrameBuilder::*build$)() = &::livekit_ffi::VideoFrameBuilder::build;
  return (self.*build$)().release();
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::VideoFrameBuilder>::type>::value, "definition of `::livekit_ffi::VideoFrameBuilder` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuilder$null(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>();
}
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuilder$raw(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder> *ptr, ::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>(raw);
}
::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuilder$get(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::VideoFrameBuilder>::pointer cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuilder$release(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuilder$drop(::std::unique_ptr<::livekit_ffi::VideoFrameBuilder> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::VideoFrameBuilder>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::VideoFrame>::type>::value, "definition of `::livekit_ffi::VideoFrame` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::VideoFrame>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::VideoFrame>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrame$null(::std::unique_ptr<::livekit_ffi::VideoFrame> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::VideoFrame>();
}
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrame$raw(::std::unique_ptr<::livekit_ffi::VideoFrame> *ptr, ::std::unique_ptr<::livekit_ffi::VideoFrame>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::VideoFrame>(raw);
}
::std::unique_ptr<::livekit_ffi::VideoFrame>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$VideoFrame$get(::std::unique_ptr<::livekit_ffi::VideoFrame> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::VideoFrame>::pointer cxxbridge1$unique_ptr$livekit_ffi$VideoFrame$release(::std::unique_ptr<::livekit_ffi::VideoFrame> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrame$drop(::std::unique_ptr<::livekit_ffi::VideoFrame> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::VideoFrame>::value>{}(ptr);
}
} // extern "C"
