#include "livekit/candidate.h"
#include <cstddef>
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

namespace livekit_ffi {
  using Candidate = ::livekit_ffi::Candidate;
}

namespace livekit_ffi {
extern "C" {
void livekit_ffi$cxxbridge1$202$_shared_candidate(::std::shared_ptr<::livekit_ffi::Candidate> *return$) noexcept {
  ::std::shared_ptr<::livekit_ffi::Candidate> (*_shared_candidate$)() = ::livekit_ffi::_shared_candidate;
  new (return$) ::std::shared_ptr<::livekit_ffi::Candidate>(_shared_candidate$());
}
} // extern "C"
} // namespace livekit_ffi

extern "C" {
static_assert(sizeof(::std::shared_ptr<::livekit_ffi::Candidate>) == 2 * sizeof(void *), "");
static_assert(alignof(::std::shared_ptr<::livekit_ffi::Candidate>) == alignof(void *), "");
void cxxbridge1$shared_ptr$livekit_ffi$Candidate$null(::std::shared_ptr<::livekit_ffi::Candidate> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::Candidate>();
}
bool cxxbridge1$shared_ptr$livekit_ffi$Candidate$raw(::std::shared_ptr<::livekit_ffi::Candidate> *ptr, ::std::shared_ptr<::livekit_ffi::Candidate>::element_type *raw) noexcept {
  ::new (ptr) ::rust::shared_ptr_if_destructible<::livekit_ffi::Candidate>(raw);
  return ::rust::is_destructible<::livekit_ffi::Candidate>::value;
}
void cxxbridge1$shared_ptr$livekit_ffi$Candidate$clone(::std::shared_ptr<::livekit_ffi::Candidate> const &self, ::std::shared_ptr<::livekit_ffi::Candidate> *ptr) noexcept {
  ::new (ptr) ::std::shared_ptr<::livekit_ffi::Candidate>(self);
}
::std::shared_ptr<::livekit_ffi::Candidate>::element_type const *cxxbridge1$shared_ptr$livekit_ffi$Candidate$get(::std::shared_ptr<::livekit_ffi::Candidate> const &self) noexcept {
  return self.get();
}
void cxxbridge1$shared_ptr$livekit_ffi$Candidate$drop(::std::shared_ptr<::livekit_ffi::Candidate> *self) noexcept {
  self->~shared_ptr();
}
} // extern "C"
