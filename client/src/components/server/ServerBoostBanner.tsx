export interface ServerBoostBannerProps {
  boostLevel: number
  boostCount: number
  memberCount: number
}

export default function ServerBoostBanner({ boostLevel, boostCount }: ServerBoostBannerProps) {
  if (boostLevel <= 0) return null

  if (boostLevel === 1) {
    return (
      <div className="mx-2 mb-1 px-3 py-1.5 rounded-md bg-gradient-to-r from-indigo-600/30 to-purple-600/30 border border-indigo-500/30 flex items-center gap-2">
        <span className="text-xs font-semibold text-indigo-300 truncate">
          ⚡ Niveau 1 · {boostCount} boost{boostCount > 1 ? 's' : ''}
        </span>
      </div>
    )
  }

  if (boostLevel === 2) {
    return (
      <div
        className="mx-2 mb-1 px-3 py-1.5 rounded-md border border-purple-500/40 overflow-hidden relative flex items-center gap-2"
        style={{
          background: 'linear-gradient(90deg, #6d28d9 0%, #7c3aed 40%, #8b5cf6 70%, #6d28d9 100%)',
          backgroundSize: '200% 100%',
          animation: 'boostSlide 3s linear infinite',
        }}
      >
        <style>{`@keyframes boostSlide { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }`}</style>
        <span className="text-xs font-semibold text-white truncate relative z-10">
          ✨ Niveau 2 · {boostCount} boost{boostCount > 1 ? 's' : ''}
        </span>
        <span className="ml-auto text-[10px] text-purple-200 relative z-10 flex-shrink-0">✦ ✦ ✦</span>
      </div>
    )
  }

  // Niveau 3
  return (
    <div
      className="mx-2 mb-1 px-3 py-1.5 rounded-md border-2 overflow-hidden flex items-center gap-2"
      style={{
        background: 'linear-gradient(90deg, #78350f, #7c3aed, #d97706, #7c3aed, #78350f)',
        backgroundSize: '300% 100%',
        animation: 'boostGold 4s linear infinite',
        borderColor: '#f59e0b88',
      }}
    >
      <style>{`@keyframes boostGold { 0%{background-position:0% 50%} 100%{background-position:300% 50%} }`}</style>
      <span className="text-xs font-bold text-amber-100 truncate relative z-10">
        👑 Niveau 3 · {boostCount} boost{boostCount > 1 ? 's' : ''}
      </span>
      <span className="ml-auto text-[10px] text-amber-300 relative z-10 flex-shrink-0 animate-pulse">★ ★ ★</span>
    </div>
  )
}
