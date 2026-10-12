#include "livekit/yuv_helper.h"
#include <cstddef>
#include <cstdint>
#include <exception>
#include <string>
#include <type_traits>
#include <utility>

#ifdef __GNUC__
#pragma GCC diagnostic ignored "-Wmissing-declarations"
#pragma GCC diagnostic ignored "-Wshadow"
#ifdef __clang__
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__
#endif // __GNUC__

namespace rust {
inline namespace cxxbridge1 {
// #include "rust/cxx.h"

namespace repr {
struct PtrLen final {
  void *ptr;
  ::std::size_t len;
};
} // namespace repr

namespace detail {
class Fail final {
  ::rust::repr::PtrLen &throw$;
public:
  Fail(::rust::repr::PtrLen &throw$) noexcept : throw$(throw$) {}
  void operator()(char const *) noexcept;
  void operator()(std::string const &) noexcept;
};
} // namespace detail
} // namespace cxxbridge1

namespace behavior {
class missing {};
missing trycatch(...);

template <typename Try, typename Fail>
static typename ::std::enable_if<::std::is_same<
    decltype(trycatch(::std::declval<Try>(), ::std::declval<Fail>())),
    missing>::value>::type
trycatch(Try &&func, Fail &&fail) noexcept try {
  func();
} catch (::std::exception const &e) {
  fail(e.what());
}
} // namespace behavior
} // namespace rust

namespace livekit_ffi {
extern "C" {
::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i420_to_argb(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_argb, ::std::int32_t dst_stride_argb, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i420_to_argb$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i420_to_argb;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i420_to_argb$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_argb, dst_stride_argb, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i420_to_bgra(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_bgra, ::std::int32_t dst_stride_bgra, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i420_to_bgra$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i420_to_bgra;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i420_to_bgra$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_bgra, dst_stride_bgra, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i420_to_abgr(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_abgr, ::std::int32_t dst_stride_abgr, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i420_to_abgr$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i420_to_abgr;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i420_to_abgr$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_abgr, dst_stride_abgr, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i420_to_rgba(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_rgba, ::std::int32_t dst_stride_rgba, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i420_to_rgba$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i420_to_rgba;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i420_to_rgba$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_rgba, dst_stride_rgba, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$argb_to_i420(::std::uint8_t const *src_argb, ::std::int32_t src_stride_argb, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_u, ::std::int32_t dst_stride_u, ::std::uint8_t *dst_v, ::std::int32_t dst_stride_v, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*argb_to_i420$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::argb_to_i420;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        argb_to_i420$(src_argb, src_stride_argb, dst_y, dst_stride_y, dst_u, dst_stride_u, dst_v, dst_stride_v, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$abgr_to_i420(::std::uint8_t const *src_abgr, ::std::int32_t src_stride_abgr, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_u, ::std::int32_t dst_stride_u, ::std::uint8_t *dst_v, ::std::int32_t dst_stride_v, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*abgr_to_i420$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::abgr_to_i420;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        abgr_to_i420$(src_abgr, src_stride_abgr, dst_y, dst_stride_y, dst_u, dst_stride_u, dst_v, dst_stride_v, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$argb_to_rgb24(::std::uint8_t const *src_argb, ::std::int32_t src_stride_argb, ::std::uint8_t *dst_rgb24, ::std::int32_t dst_stride_rgb24, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*argb_to_rgb24$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::argb_to_rgb24;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        argb_to_rgb24$(src_argb, src_stride_argb, dst_rgb24, dst_stride_rgb24, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$nv12_to_i420(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_uv, ::std::int32_t src_stride_uv, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_u, ::std::int32_t dst_stride_u, ::std::uint8_t *dst_v, ::std::int32_t dst_stride_v, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*nv12_to_i420$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::nv12_to_i420;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        nv12_to_i420$(src_y, src_stride_y, src_uv, src_stride_uv, dst_y, dst_stride_y, dst_u, dst_stride_u, dst_v, dst_stride_v, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i420_to_nv12(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_uv, ::std::int32_t dst_stride_uv, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i420_to_nv12$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i420_to_nv12;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i420_to_nv12$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_y, dst_stride_y, dst_uv, dst_stride_uv, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i444_to_i420(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_u, ::std::int32_t dst_stride_u, ::std::uint8_t *dst_v, ::std::int32_t dst_stride_v, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i444_to_i420$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i444_to_i420;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i444_to_i420$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_y, dst_stride_y, dst_u, dst_stride_u, dst_v, dst_stride_v, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i422_to_i420(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_u, ::std::int32_t dst_stride_u, ::std::uint8_t *dst_v, ::std::int32_t dst_stride_v, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i422_to_i420$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i422_to_i420;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i422_to_i420$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_y, dst_stride_y, dst_u, dst_stride_u, dst_v, dst_stride_v, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i010_to_i420(::std::uint16_t const *src_y, ::std::int32_t src_stride_y, ::std::uint16_t const *src_u, ::std::int32_t src_stride_u, ::std::uint16_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_u, ::std::int32_t dst_stride_u, ::std::uint8_t *dst_v, ::std::int32_t dst_stride_v, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i010_to_i420$)(::std::uint16_t const *, ::std::int32_t, ::std::uint16_t const *, ::std::int32_t, ::std::uint16_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i010_to_i420;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i010_to_i420$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_y, dst_stride_y, dst_u, dst_stride_u, dst_v, dst_stride_v, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$nv12_to_argb(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_uv, ::std::int32_t src_stride_uv, ::std::uint8_t *dst_argb, ::std::int32_t dst_stride_argb, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*nv12_to_argb$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::nv12_to_argb;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        nv12_to_argb$(src_y, src_stride_y, src_uv, src_stride_uv, dst_argb, dst_stride_argb, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$nv12_to_abgr(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_uv, ::std::int32_t src_stride_uv, ::std::uint8_t *dst_abgr, ::std::int32_t dst_stride_abgr, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*nv12_to_abgr$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::nv12_to_abgr;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        nv12_to_abgr$(src_y, src_stride_y, src_uv, src_stride_uv, dst_abgr, dst_stride_abgr, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i444_to_argb(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_abgr, ::std::int32_t dst_stride_abgr, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i444_to_argb$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i444_to_argb;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i444_to_argb$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_abgr, dst_stride_abgr, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i444_to_abgr(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_abgr, ::std::int32_t dst_stride_abgr, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i444_to_abgr$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i444_to_abgr;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i444_to_abgr$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_abgr, dst_stride_abgr, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i422_to_argb(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_argb, ::std::int32_t dst_stride_argb, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i422_to_argb$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i422_to_argb;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i422_to_argb$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_argb, dst_stride_argb, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i422_to_abgr(::std::uint8_t const *src_y, ::std::int32_t src_stride_y, ::std::uint8_t const *src_u, ::std::int32_t src_stride_u, ::std::uint8_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_abgr, ::std::int32_t dst_stride_abgr, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i422_to_abgr$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i422_to_abgr;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i422_to_abgr$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_abgr, dst_stride_abgr, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i010_to_argb(::std::uint16_t const *src_y, ::std::int32_t src_stride_y, ::std::uint16_t const *src_u, ::std::int32_t src_stride_u, ::std::uint16_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_argb, ::std::int32_t dst_stride_argb, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i010_to_argb$)(::std::uint16_t const *, ::std::int32_t, ::std::uint16_t const *, ::std::int32_t, ::std::uint16_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i010_to_argb;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i010_to_argb$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_argb, dst_stride_argb, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$i010_to_abgr(::std::uint16_t const *src_y, ::std::int32_t src_stride_y, ::std::uint16_t const *src_u, ::std::int32_t src_stride_u, ::std::uint16_t const *src_v, ::std::int32_t src_stride_v, ::std::uint8_t *dst_abgr, ::std::int32_t dst_stride_abgr, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*i010_to_abgr$)(::std::uint16_t const *, ::std::int32_t, ::std::uint16_t const *, ::std::int32_t, ::std::uint16_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::i010_to_abgr;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        i010_to_abgr$(src_y, src_stride_y, src_u, src_stride_u, src_v, src_stride_v, dst_abgr, dst_stride_abgr, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$abgr_to_nv12(::std::uint8_t const *src_abgr, ::std::int32_t src_stride_abgr, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_uv, ::std::int32_t dst_stride_uv, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*abgr_to_nv12$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::abgr_to_nv12;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        abgr_to_nv12$(src_abgr, src_stride_abgr, dst_y, dst_stride_y, dst_uv, dst_stride_uv, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}

::rust::repr::PtrLen livekit_ffi$cxxbridge1$202$argb_to_nv12(::std::uint8_t const *src_argb, ::std::int32_t src_stride_argb, ::std::uint8_t *dst_y, ::std::int32_t dst_stride_y, ::std::uint8_t *dst_uv, ::std::int32_t dst_stride_uv, ::std::int32_t width, ::std::int32_t height) noexcept {
  void (*argb_to_nv12$)(::std::uint8_t const *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::uint8_t *, ::std::int32_t, ::std::int32_t, ::std::int32_t) = ::livekit_ffi::argb_to_nv12;
  ::rust::repr::PtrLen throw$;
  ::rust::behavior::trycatch(
      [&] {
        argb_to_nv12$(src_argb, src_stride_argb, dst_y, dst_stride_y, dst_uv, dst_stride_uv, width, height);
        throw$.ptr = nullptr;
      },
      ::rust::detail::Fail(throw$));
  return throw$;
}
} // extern "C"
} // namespace livekit_ffi
