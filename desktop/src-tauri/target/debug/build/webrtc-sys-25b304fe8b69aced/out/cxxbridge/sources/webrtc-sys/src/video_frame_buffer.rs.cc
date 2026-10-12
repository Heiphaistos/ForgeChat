#include "livekit/video_frame_buffer.h"
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
  enum class VideoFrameBufferType : ::std::int32_t;
  using VideoFrameBuffer = ::livekit_ffi::VideoFrameBuffer;
  using PlanarYuvBuffer = ::livekit_ffi::PlanarYuvBuffer;
  using PlanarYuv8Buffer = ::livekit_ffi::PlanarYuv8Buffer;
  using PlanarYuv16BBuffer = ::livekit_ffi::PlanarYuv16BBuffer;
  using BiplanarYuvBuffer = ::livekit_ffi::BiplanarYuvBuffer;
  using BiplanarYuv8Buffer = ::livekit_ffi::BiplanarYuv8Buffer;
  using I420Buffer = ::livekit_ffi::I420Buffer;
  using I420ABuffer = ::livekit_ffi::I420ABuffer;
  using I422Buffer = ::livekit_ffi::I422Buffer;
  using I444Buffer = ::livekit_ffi::I444Buffer;
  using I010Buffer = ::livekit_ffi::I010Buffer;
  using NV12Buffer = ::livekit_ffi::NV12Buffer;
  using PlatformImageBuffer = ::livekit_ffi::PlatformImageBuffer;
}

namespace livekit_ffi {
#ifndef CXXBRIDGE1_ENUM_livekit_ffi$VideoFrameBufferType
#define CXXBRIDGE1_ENUM_livekit_ffi$VideoFrameBufferType
enum class VideoFrameBufferType : ::std::int32_t {
  Native = 0,
  I420 = 1,
  I420A = 2,
  I422 = 3,
  I444 = 4,
  I010 = 5,
  NV12 = 6,
};
#endif // CXXBRIDGE1_ENUM_livekit_ffi$VideoFrameBufferType

extern "C" {
::livekit_ffi::VideoFrameBufferType livekit_ffi$cxxbridge1$202$VideoFrameBuffer$buffer_type(::livekit_ffi::VideoFrameBuffer const &self) noexcept {
  ::livekit_ffi::VideoFrameBufferType (::livekit_ffi::VideoFrameBuffer::*buffer_type$)() const = &::livekit_ffi::VideoFrameBuffer::buffer_type;
  return (self.*buffer_type$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$VideoFrameBuffer$width(::livekit_ffi::VideoFrameBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::VideoFrameBuffer::*width$)() const = &::livekit_ffi::VideoFrameBuffer::width;
  return (self.*width$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$VideoFrameBuffer$height(::livekit_ffi::VideoFrameBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::VideoFrameBuffer::*height$)() const = &::livekit_ffi::VideoFrameBuffer::height;
  return (self.*height$)();
}

::livekit_ffi::I420Buffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$to_i420(::livekit_ffi::VideoFrameBuffer const &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420Buffer> (::livekit_ffi::VideoFrameBuffer::*to_i420$)() const = &::livekit_ffi::VideoFrameBuffer::to_i420;
  return (self.*to_i420$)().release();
}

::livekit_ffi::I420Buffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$get_i420(::livekit_ffi::VideoFrameBuffer &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420Buffer> (::livekit_ffi::VideoFrameBuffer::*get_i420$)() = &::livekit_ffi::VideoFrameBuffer::get_i420;
  return (self.*get_i420$)().release();
}

::livekit_ffi::I420ABuffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$get_i420a(::livekit_ffi::VideoFrameBuffer &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420ABuffer> (::livekit_ffi::VideoFrameBuffer::*get_i420a$)() = &::livekit_ffi::VideoFrameBuffer::get_i420a;
  return (self.*get_i420a$)().release();
}

::livekit_ffi::I422Buffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$get_i422(::livekit_ffi::VideoFrameBuffer &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::I422Buffer> (::livekit_ffi::VideoFrameBuffer::*get_i422$)() = &::livekit_ffi::VideoFrameBuffer::get_i422;
  return (self.*get_i422$)().release();
}

::livekit_ffi::I444Buffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$get_i444(::livekit_ffi::VideoFrameBuffer &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::I444Buffer> (::livekit_ffi::VideoFrameBuffer::*get_i444$)() = &::livekit_ffi::VideoFrameBuffer::get_i444;
  return (self.*get_i444$)().release();
}

::livekit_ffi::I010Buffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$get_i010(::livekit_ffi::VideoFrameBuffer &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::I010Buffer> (::livekit_ffi::VideoFrameBuffer::*get_i010$)() = &::livekit_ffi::VideoFrameBuffer::get_i010;
  return (self.*get_i010$)().release();
}

::livekit_ffi::NV12Buffer *livekit_ffi$cxxbridge1$202$VideoFrameBuffer$get_nv12(::livekit_ffi::VideoFrameBuffer &self) noexcept {
  ::std::unique_ptr<::livekit_ffi::NV12Buffer> (::livekit_ffi::VideoFrameBuffer::*get_nv12$)() = &::livekit_ffi::VideoFrameBuffer::get_nv12;
  return (self.*get_nv12$)().release();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$PlanarYuvBuffer$chroma_width(::livekit_ffi::PlanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::PlanarYuvBuffer::*chroma_width$)() const = &::livekit_ffi::PlanarYuvBuffer::chroma_width;
  return (self.*chroma_width$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$PlanarYuvBuffer$chroma_height(::livekit_ffi::PlanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::PlanarYuvBuffer::*chroma_height$)() const = &::livekit_ffi::PlanarYuvBuffer::chroma_height;
  return (self.*chroma_height$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$PlanarYuvBuffer$stride_y(::livekit_ffi::PlanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::PlanarYuvBuffer::*stride_y$)() const = &::livekit_ffi::PlanarYuvBuffer::stride_y;
  return (self.*stride_y$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$PlanarYuvBuffer$stride_u(::livekit_ffi::PlanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::PlanarYuvBuffer::*stride_u$)() const = &::livekit_ffi::PlanarYuvBuffer::stride_u;
  return (self.*stride_u$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$PlanarYuvBuffer$stride_v(::livekit_ffi::PlanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::PlanarYuvBuffer::*stride_v$)() const = &::livekit_ffi::PlanarYuvBuffer::stride_v;
  return (self.*stride_v$)();
}

::std::uint8_t const *livekit_ffi$cxxbridge1$202$PlanarYuv8Buffer$data_y(::livekit_ffi::PlanarYuv8Buffer const &self) noexcept {
  ::std::uint8_t const *(::livekit_ffi::PlanarYuv8Buffer::*data_y$)() const = &::livekit_ffi::PlanarYuv8Buffer::data_y;
  return (self.*data_y$)();
}

::std::uint8_t const *livekit_ffi$cxxbridge1$202$PlanarYuv8Buffer$data_u(::livekit_ffi::PlanarYuv8Buffer const &self) noexcept {
  ::std::uint8_t const *(::livekit_ffi::PlanarYuv8Buffer::*data_u$)() const = &::livekit_ffi::PlanarYuv8Buffer::data_u;
  return (self.*data_u$)();
}

::std::uint8_t const *livekit_ffi$cxxbridge1$202$PlanarYuv8Buffer$data_v(::livekit_ffi::PlanarYuv8Buffer const &self) noexcept {
  ::std::uint8_t const *(::livekit_ffi::PlanarYuv8Buffer::*data_v$)() const = &::livekit_ffi::PlanarYuv8Buffer::data_v;
  return (self.*data_v$)();
}

::std::uint16_t const *livekit_ffi$cxxbridge1$202$PlanarYuv16BBuffer$data_y(::livekit_ffi::PlanarYuv16BBuffer const &self) noexcept {
  ::std::uint16_t const *(::livekit_ffi::PlanarYuv16BBuffer::*data_y$)() const = &::livekit_ffi::PlanarYuv16BBuffer::data_y;
  return (self.*data_y$)();
}

::std::uint16_t const *livekit_ffi$cxxbridge1$202$PlanarYuv16BBuffer$data_u(::livekit_ffi::PlanarYuv16BBuffer const &self) noexcept {
  ::std::uint16_t const *(::livekit_ffi::PlanarYuv16BBuffer::*data_u$)() const = &::livekit_ffi::PlanarYuv16BBuffer::data_u;
  return (self.*data_u$)();
}

::std::uint16_t const *livekit_ffi$cxxbridge1$202$PlanarYuv16BBuffer$data_v(::livekit_ffi::PlanarYuv16BBuffer const &self) noexcept {
  ::std::uint16_t const *(::livekit_ffi::PlanarYuv16BBuffer::*data_v$)() const = &::livekit_ffi::PlanarYuv16BBuffer::data_v;
  return (self.*data_v$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$BiplanarYuvBuffer$chroma_width(::livekit_ffi::BiplanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::BiplanarYuvBuffer::*chroma_width$)() const = &::livekit_ffi::BiplanarYuvBuffer::chroma_width;
  return (self.*chroma_width$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$BiplanarYuvBuffer$chroma_height(::livekit_ffi::BiplanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::BiplanarYuvBuffer::*chroma_height$)() const = &::livekit_ffi::BiplanarYuvBuffer::chroma_height;
  return (self.*chroma_height$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$BiplanarYuvBuffer$stride_y(::livekit_ffi::BiplanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::BiplanarYuvBuffer::*stride_y$)() const = &::livekit_ffi::BiplanarYuvBuffer::stride_y;
  return (self.*stride_y$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$BiplanarYuvBuffer$stride_uv(::livekit_ffi::BiplanarYuvBuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::BiplanarYuvBuffer::*stride_uv$)() const = &::livekit_ffi::BiplanarYuvBuffer::stride_uv;
  return (self.*stride_uv$)();
}

::std::uint8_t const *livekit_ffi$cxxbridge1$202$BiplanarYuv8Buffer$data_y(::livekit_ffi::BiplanarYuv8Buffer const &self) noexcept {
  ::std::uint8_t const *(::livekit_ffi::BiplanarYuv8Buffer::*data_y$)() const = &::livekit_ffi::BiplanarYuv8Buffer::data_y;
  return (self.*data_y$)();
}

::std::uint8_t const *livekit_ffi$cxxbridge1$202$BiplanarYuv8Buffer$data_uv(::livekit_ffi::BiplanarYuv8Buffer const &self) noexcept {
  ::std::uint8_t const *(::livekit_ffi::BiplanarYuv8Buffer::*data_uv$)() const = &::livekit_ffi::BiplanarYuv8Buffer::data_uv;
  return (self.*data_uv$)();
}

::std::uint32_t livekit_ffi$cxxbridge1$202$I420ABuffer$stride_a(::livekit_ffi::I420ABuffer const &self) noexcept {
  ::std::uint32_t (::livekit_ffi::I420ABuffer::*stride_a$)() const = &::livekit_ffi::I420ABuffer::stride_a;
  return (self.*stride_a$)();
}

::std::uint8_t const *livekit_ffi$cxxbridge1$202$I420ABuffer$data_a(::livekit_ffi::I420ABuffer const &self) noexcept {
  ::std::uint8_t const *(::livekit_ffi::I420ABuffer::*data_a$)() const = &::livekit_ffi::I420ABuffer::data_a;
  return (self.*data_a$)();
}

::livekit_ffi::I420Buffer *livekit_ffi$cxxbridge1$202$I420Buffer$scale(::livekit_ffi::I420Buffer const &self, ::std::int32_t scaled_width, ::std::int32_t scaled_height) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420Buffer> (::livekit_ffi::I420Buffer::*scale$)(::std::int32_t, ::std::int32_t) const = &::livekit_ffi::I420Buffer::scale;
  return (self.*scale$)(scaled_width, scaled_height).release();
}

::livekit_ffi::I420ABuffer *livekit_ffi$cxxbridge1$202$I420ABuffer$scale(::livekit_ffi::I420ABuffer const &self, ::std::int32_t scaled_width, ::std::int32_t scaled_height) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420ABuffer> (::livekit_ffi::I420ABuffer::*scale$)(::std::int32_t, ::std::int32_t) const = &::livekit_ffi::I420ABuffer::scale;
  return (self.*scale$)(scaled_width, scaled_height).release();
}

::livekit_ffi::I422Buffer *livekit_ffi$cxxbridge1$202$I422Buffer$scale(::livekit_ffi::I422Buffer const &self, ::std::int32_t scaled_width, ::std::int32_t scaled_height) noexcept {
  ::std::unique_ptr<::livekit_ffi::I422Buffer> (::livekit_ffi::I422Buffer::*scale$)(::std::int32_t, ::std::int32_t) const = &::livekit_ffi::I422Buffer::scale;
  return (self.*scale$)(scaled_width, scaled_height).release();
}

::livekit_ffi::I444Buffer *livekit_ffi$cxxbridge1$202$I444Buffer$scale(::livekit_ffi::I444Buffer const &self, ::std::int32_t scaled_width, ::std::int32_t scaled_height) noexcept {
  ::std::unique_ptr<::livekit_ffi::I444Buffer> (::livekit_ffi::I444Buffer::*scale$)(::std::int32_t, ::std::int32_t) const = &::livekit_ffi::I444Buffer::scale;
  return (self.*scale$)(scaled_width, scaled_height).release();
}

::livekit_ffi::I010Buffer *livekit_ffi$cxxbridge1$202$I010Buffer$scale(::livekit_ffi::I010Buffer const &self, ::std::int32_t scaled_width, ::std::int32_t scaled_height) noexcept {
  ::std::unique_ptr<::livekit_ffi::I010Buffer> (::livekit_ffi::I010Buffer::*scale$)(::std::int32_t, ::std::int32_t) const = &::livekit_ffi::I010Buffer::scale;
  return (self.*scale$)(scaled_width, scaled_height).release();
}

::livekit_ffi::NV12Buffer *livekit_ffi$cxxbridge1$202$NV12Buffer$scale(::livekit_ffi::NV12Buffer const &self, ::std::int32_t scaled_width, ::std::int32_t scaled_height) noexcept {
  ::std::unique_ptr<::livekit_ffi::NV12Buffer> (::livekit_ffi::NV12Buffer::*scale$)(::std::int32_t, ::std::int32_t) const = &::livekit_ffi::NV12Buffer::scale;
  return (self.*scale$)(scaled_width, scaled_height).release();
}

::livekit_ffi::I420Buffer *livekit_ffi$cxxbridge1$202$copy_i420_buffer(::std::unique_ptr<::livekit_ffi::I420Buffer> const &i420) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420Buffer> (*copy_i420_buffer$)(::std::unique_ptr<::livekit_ffi::I420Buffer> const &) = ::livekit_ffi::copy_i420_buffer;
  return copy_i420_buffer$(i420).release();
}

::livekit_ffi::I420Buffer *livekit_ffi$cxxbridge1$202$new_i420_buffer(::std::int32_t width, ::std::int32_t height, ::std::int32_t stride_y, ::std::int32_t stride_u, ::std::int32_t stride_v) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420Buffer> (*new_i420_buffer$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_i420_buffer;
  return new_i420_buffer$(width, height, stride_y, stride_u, stride_v).release();
}

::livekit_ffi::I420Buffer *livekit_ffi$cxxbridge1$202$new_black_i420_buffer(::std::int32_t width, ::std::int32_t height, ::std::int32_t stride_y, ::std::int32_t stride_u, ::std::int32_t stride_v) noexcept {
  ::std::unique_ptr<::livekit_ffi::I420Buffer> (*new_black_i420_buffer$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_black_i420_buffer;
  return new_black_i420_buffer$(width, height, stride_y, stride_u, stride_v).release();
}

::livekit_ffi::I422Buffer *livekit_ffi$cxxbridge1$202$new_i422_buffer(::std::int32_t width, ::std::int32_t height, ::std::int32_t stride_y, ::std::int32_t stride_u, ::std::int32_t stride_v) noexcept {
  ::std::unique_ptr<::livekit_ffi::I422Buffer> (*new_i422_buffer$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_i422_buffer;
  return new_i422_buffer$(width, height, stride_y, stride_u, stride_v).release();
}

::livekit_ffi::I444Buffer *livekit_ffi$cxxbridge1$202$new_i444_buffer(::std::int32_t width, ::std::int32_t height, ::std::int32_t stride_y, ::std::int32_t stride_u, ::std::int32_t stride_v) noexcept {
  ::std::unique_ptr<::livekit_ffi::I444Buffer> (*new_i444_buffer$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_i444_buffer;
  return new_i444_buffer$(width, height, stride_y, stride_u, stride_v).release();
}

::livekit_ffi::I010Buffer *livekit_ffi$cxxbridge1$202$new_i010_buffer(::std::int32_t width, ::std::int32_t height, ::std::int32_t stride_y, ::std::int32_t stride_u, ::std::int32_t stride_v) noexcept {
  ::std::unique_ptr<::livekit_ffi::I010Buffer> (*new_i010_buffer$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_i010_buffer;
  return new_i010_buffer$(width, height, stride_y, stride_u, stride_v).release();
}

::livekit_ffi::NV12Buffer *livekit_ffi$cxxbridge1$202$new_nv12_buffer(::std::int32_t width, ::std::int32_t height, ::std::int32_t stride_y, ::std::int32_t stride_uv) noexcept {
  ::std::unique_ptr<::livekit_ffi::NV12Buffer> (*new_nv12_buffer$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_nv12_buffer;
  return new_nv12_buffer$(width, height, stride_y, stride_uv).release();
}

::livekit_ffi::VideoFrameBuffer *livekit_ffi$cxxbridge1$202$new_native_buffer_from_platform_image_buffer(::livekit_ffi::PlatformImageBuffer *platform_native_buffer) noexcept {
  ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> (*new_native_buffer_from_platform_image_buffer$)(::livekit_ffi::PlatformImageBuffer *) = ::livekit_ffi::new_native_buffer_from_platform_image_buffer;
  return new_native_buffer_from_platform_image_buffer$(platform_native_buffer).release();
}

::livekit_ffi::PlatformImageBuffer *livekit_ffi$cxxbridge1$202$native_buffer_to_platform_image_buffer(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> const &buffer) noexcept {
  ::livekit_ffi::PlatformImageBuffer *(*native_buffer_to_platform_image_buffer$)(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> const &) = ::livekit_ffi::native_buffer_to_platform_image_buffer;
  return native_buffer_to_platform_image_buffer$(buffer);
}

::livekit_ffi::VideoFrameBuffer *livekit_ffi$cxxbridge1$202$new_native_buffer_from_dmabuf(::std::int32_t dmabuf_fd, ::std::int32_t width, ::std::int32_t height, ::std::int32_t pixel_format) noexcept {
  ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> (*new_native_buffer_from_dmabuf$)(::std::int32_t, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::new_native_buffer_from_dmabuf;
  return new_native_buffer_from_dmabuf$(dmabuf_fd, width, height, pixel_format).release();
}

::std::int32_t livekit_ffi$cxxbridge1$202$native_buffer_to_dmabuf_fd(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> const &buffer) noexcept {
  ::std::int32_t (*native_buffer_to_dmabuf_fd$)(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> const &) = ::livekit_ffi::native_buffer_to_dmabuf_fd;
  return native_buffer_to_dmabuf_fd$(buffer);
}

::livekit_ffi::VideoFrameBuffer const *livekit_ffi$cxxbridge1$202$yuv_to_vfb(::livekit_ffi::PlanarYuvBuffer const *yuv) noexcept {
  ::livekit_ffi::VideoFrameBuffer const *(*yuv_to_vfb$)(::livekit_ffi::PlanarYuvBuffer const *) = ::livekit_ffi::yuv_to_vfb;
  return yuv_to_vfb$(yuv);
}

::livekit_ffi::VideoFrameBuffer const *livekit_ffi$cxxbridge1$202$biyuv_to_vfb(::livekit_ffi::BiplanarYuvBuffer const *yuv) noexcept {
  ::livekit_ffi::VideoFrameBuffer const *(*biyuv_to_vfb$)(::livekit_ffi::BiplanarYuvBuffer const *) = ::livekit_ffi::biyuv_to_vfb;
  return biyuv_to_vfb$(yuv);
}

::livekit_ffi::PlanarYuvBuffer const *livekit_ffi$cxxbridge1$202$yuv8_to_yuv(::livekit_ffi::PlanarYuv8Buffer const *yuv8) noexcept {
  ::livekit_ffi::PlanarYuvBuffer const *(*yuv8_to_yuv$)(::livekit_ffi::PlanarYuv8Buffer const *) = ::livekit_ffi::yuv8_to_yuv;
  return yuv8_to_yuv$(yuv8);
}

::livekit_ffi::PlanarYuvBuffer const *livekit_ffi$cxxbridge1$202$yuv16b_to_yuv(::livekit_ffi::PlanarYuv16BBuffer const *yuv16b) noexcept {
  ::livekit_ffi::PlanarYuvBuffer const *(*yuv16b_to_yuv$)(::livekit_ffi::PlanarYuv16BBuffer const *) = ::livekit_ffi::yuv16b_to_yuv;
  return yuv16b_to_yuv$(yuv16b);
}

::livekit_ffi::BiplanarYuvBuffer const *livekit_ffi$cxxbridge1$202$biyuv8_to_biyuv(::livekit_ffi::BiplanarYuv8Buffer const *biyuv8) noexcept {
  ::livekit_ffi::BiplanarYuvBuffer const *(*biyuv8_to_biyuv$)(::livekit_ffi::BiplanarYuv8Buffer const *) = ::livekit_ffi::biyuv8_to_biyuv;
  return biyuv8_to_biyuv$(biyuv8);
}

::livekit_ffi::PlanarYuv8Buffer const *livekit_ffi$cxxbridge1$202$i420_to_yuv8(::livekit_ffi::I420Buffer const *i420) noexcept {
  ::livekit_ffi::PlanarYuv8Buffer const *(*i420_to_yuv8$)(::livekit_ffi::I420Buffer const *) = ::livekit_ffi::i420_to_yuv8;
  return i420_to_yuv8$(i420);
}

::livekit_ffi::PlanarYuv8Buffer const *livekit_ffi$cxxbridge1$202$i420a_to_yuv8(::livekit_ffi::I420ABuffer const *i420a) noexcept {
  ::livekit_ffi::PlanarYuv8Buffer const *(*i420a_to_yuv8$)(::livekit_ffi::I420ABuffer const *) = ::livekit_ffi::i420a_to_yuv8;
  return i420a_to_yuv8$(i420a);
}

::livekit_ffi::PlanarYuv8Buffer const *livekit_ffi$cxxbridge1$202$i422_to_yuv8(::livekit_ffi::I422Buffer const *i422) noexcept {
  ::livekit_ffi::PlanarYuv8Buffer const *(*i422_to_yuv8$)(::livekit_ffi::I422Buffer const *) = ::livekit_ffi::i422_to_yuv8;
  return i422_to_yuv8$(i422);
}

::livekit_ffi::PlanarYuv8Buffer const *livekit_ffi$cxxbridge1$202$i444_to_yuv8(::livekit_ffi::I444Buffer const *i444) noexcept {
  ::livekit_ffi::PlanarYuv8Buffer const *(*i444_to_yuv8$)(::livekit_ffi::I444Buffer const *) = ::livekit_ffi::i444_to_yuv8;
  return i444_to_yuv8$(i444);
}

::livekit_ffi::PlanarYuv16BBuffer const *livekit_ffi$cxxbridge1$202$i010_to_yuv16b(::livekit_ffi::I010Buffer const *i010) noexcept {
  ::livekit_ffi::PlanarYuv16BBuffer const *(*i010_to_yuv16b$)(::livekit_ffi::I010Buffer const *) = ::livekit_ffi::i010_to_yuv16b;
  return i010_to_yuv16b$(i010);
}

::livekit_ffi::BiplanarYuv8Buffer const *livekit_ffi$cxxbridge1$202$nv12_to_biyuv8(::livekit_ffi::NV12Buffer const *nv12) noexcept {
  ::livekit_ffi::BiplanarYuv8Buffer const *(*nv12_to_biyuv8$)(::livekit_ffi::NV12Buffer const *) = ::livekit_ffi::nv12_to_biyuv8;
  return nv12_to_biyuv8$(nv12);
}

::livekit_ffi::VideoFrameBuffer *livekit_ffi$cxxbridge1$202$_unique_video_frame_buffer() noexcept {
  ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> (*_unique_video_frame_buffer$)() = ::livekit_ffi::_unique_video_frame_buffer;
  return _unique_video_frame_buffer$().release();
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::I420Buffer>::type>::value, "definition of `::livekit_ffi::I420Buffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::I420Buffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::I420Buffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$I420Buffer$null(::std::unique_ptr<::livekit_ffi::I420Buffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I420Buffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$I420Buffer$raw(::std::unique_ptr<::livekit_ffi::I420Buffer> *ptr, ::std::unique_ptr<::livekit_ffi::I420Buffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I420Buffer>(raw);
}
::std::unique_ptr<::livekit_ffi::I420Buffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$I420Buffer$get(::std::unique_ptr<::livekit_ffi::I420Buffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::I420Buffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$I420Buffer$release(::std::unique_ptr<::livekit_ffi::I420Buffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$I420Buffer$drop(::std::unique_ptr<::livekit_ffi::I420Buffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::I420Buffer>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::I420ABuffer>::type>::value, "definition of `::livekit_ffi::I420ABuffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::I420ABuffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::I420ABuffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$I420ABuffer$null(::std::unique_ptr<::livekit_ffi::I420ABuffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I420ABuffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$I420ABuffer$raw(::std::unique_ptr<::livekit_ffi::I420ABuffer> *ptr, ::std::unique_ptr<::livekit_ffi::I420ABuffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I420ABuffer>(raw);
}
::std::unique_ptr<::livekit_ffi::I420ABuffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$I420ABuffer$get(::std::unique_ptr<::livekit_ffi::I420ABuffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::I420ABuffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$I420ABuffer$release(::std::unique_ptr<::livekit_ffi::I420ABuffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$I420ABuffer$drop(::std::unique_ptr<::livekit_ffi::I420ABuffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::I420ABuffer>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::I422Buffer>::type>::value, "definition of `::livekit_ffi::I422Buffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::I422Buffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::I422Buffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$I422Buffer$null(::std::unique_ptr<::livekit_ffi::I422Buffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I422Buffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$I422Buffer$raw(::std::unique_ptr<::livekit_ffi::I422Buffer> *ptr, ::std::unique_ptr<::livekit_ffi::I422Buffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I422Buffer>(raw);
}
::std::unique_ptr<::livekit_ffi::I422Buffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$I422Buffer$get(::std::unique_ptr<::livekit_ffi::I422Buffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::I422Buffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$I422Buffer$release(::std::unique_ptr<::livekit_ffi::I422Buffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$I422Buffer$drop(::std::unique_ptr<::livekit_ffi::I422Buffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::I422Buffer>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::I444Buffer>::type>::value, "definition of `::livekit_ffi::I444Buffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::I444Buffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::I444Buffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$I444Buffer$null(::std::unique_ptr<::livekit_ffi::I444Buffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I444Buffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$I444Buffer$raw(::std::unique_ptr<::livekit_ffi::I444Buffer> *ptr, ::std::unique_ptr<::livekit_ffi::I444Buffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I444Buffer>(raw);
}
::std::unique_ptr<::livekit_ffi::I444Buffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$I444Buffer$get(::std::unique_ptr<::livekit_ffi::I444Buffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::I444Buffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$I444Buffer$release(::std::unique_ptr<::livekit_ffi::I444Buffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$I444Buffer$drop(::std::unique_ptr<::livekit_ffi::I444Buffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::I444Buffer>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::I010Buffer>::type>::value, "definition of `::livekit_ffi::I010Buffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::I010Buffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::I010Buffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$I010Buffer$null(::std::unique_ptr<::livekit_ffi::I010Buffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I010Buffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$I010Buffer$raw(::std::unique_ptr<::livekit_ffi::I010Buffer> *ptr, ::std::unique_ptr<::livekit_ffi::I010Buffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::I010Buffer>(raw);
}
::std::unique_ptr<::livekit_ffi::I010Buffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$I010Buffer$get(::std::unique_ptr<::livekit_ffi::I010Buffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::I010Buffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$I010Buffer$release(::std::unique_ptr<::livekit_ffi::I010Buffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$I010Buffer$drop(::std::unique_ptr<::livekit_ffi::I010Buffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::I010Buffer>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::NV12Buffer>::type>::value, "definition of `::livekit_ffi::NV12Buffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::NV12Buffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::NV12Buffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$NV12Buffer$null(::std::unique_ptr<::livekit_ffi::NV12Buffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::NV12Buffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$NV12Buffer$raw(::std::unique_ptr<::livekit_ffi::NV12Buffer> *ptr, ::std::unique_ptr<::livekit_ffi::NV12Buffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::NV12Buffer>(raw);
}
::std::unique_ptr<::livekit_ffi::NV12Buffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$NV12Buffer$get(::std::unique_ptr<::livekit_ffi::NV12Buffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::NV12Buffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$NV12Buffer$release(::std::unique_ptr<::livekit_ffi::NV12Buffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$NV12Buffer$drop(::std::unique_ptr<::livekit_ffi::NV12Buffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::NV12Buffer>::value>{}(ptr);
}

static_assert(::rust::detail::is_complete<::std::remove_extent<::livekit_ffi::VideoFrameBuffer>::type>::value, "definition of `::livekit_ffi::VideoFrameBuffer` is required");
static_assert(sizeof(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>) == sizeof(void *), "");
static_assert(alignof(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>) == alignof(void *), "");
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuffer$null(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> *ptr) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>();
}
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuffer$raw(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> *ptr, ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>::pointer raw) noexcept {
  ::new (ptr) ::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>(raw);
}
::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>::element_type const *cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuffer$get(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> const &ptr) noexcept {
  return ptr.get();
}
::std::unique_ptr<::livekit_ffi::VideoFrameBuffer>::pointer cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuffer$release(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> &ptr) noexcept {
  return ptr.release();
}
void cxxbridge1$unique_ptr$livekit_ffi$VideoFrameBuffer$drop(::std::unique_ptr<::livekit_ffi::VideoFrameBuffer> *ptr) noexcept {
  ::rust::deleter_if<::rust::detail::is_complete<::livekit_ffi::VideoFrameBuffer>::value>{}(ptr);
}
} // extern "C"
