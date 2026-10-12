#pragma once
#include "livekit/video_frame_buffer.h"
#include <cstdint>
#include <memory>

#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__

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
} // namespace livekit_ffi

#ifdef __clang__
#pragma clang diagnostic pop
#endif // __clang__
