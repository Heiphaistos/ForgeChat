#pragma once
#include "livekit/video_frame_buffer.h"
#include "livekit/video_frame.h"
#include <cstdint>
#include <memory>

#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__

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
} // namespace livekit_ffi

#ifdef __clang__
#pragma clang diagnostic pop
#endif // __clang__
