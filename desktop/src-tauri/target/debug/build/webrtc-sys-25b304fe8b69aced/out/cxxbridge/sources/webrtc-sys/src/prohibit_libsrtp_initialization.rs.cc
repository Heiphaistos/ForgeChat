#include "livekit/prohibit_libsrtp_initialization.h"

#ifdef __GNUC__
#pragma GCC diagnostic ignored "-Wmissing-declarations"
#ifdef __clang__
#pragma clang diagnostic ignored "-Wdollar-in-identifier-extension"
#endif // __clang__
#endif // __GNUC__

namespace livekit_ffi {
extern "C" {
void livekit_ffi$cxxbridge1$202$ProhibitLibsrtpInitialization() noexcept {
  void (*ProhibitLibsrtpInitialization$)() = ::livekit_ffi::ProhibitLibsrtpInitialization;
  ProhibitLibsrtpInitialization$();
}
} // extern "C"
} // namespace livekit_ffi
