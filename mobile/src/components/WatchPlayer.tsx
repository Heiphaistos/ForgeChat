import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { openExternalUrl } from '@/lib/links'
import { parsePlayerEvent, playerScript, syncCommands, type PlayerCmd, type PlayerReport, type WatchInfo } from '@/lib/watchTogether'

// Lecteur « Regarder ensemble » : page HTML inline avec l'API IFrame YouTube (youtube-nocookie, sans
// contrôles YouTube : toute action passe par nos boutons, donc par le serveur). Pont :
// RN → page `window.fcCmd(cmd)` (injectJavaScript), page → RN `{ready|state|ended|error}` (postMessage).
// Aucun réglage audio n'est touché : le son passe par la WebView, la session d'appel reste celle de LiveKit.

/** Origine déclarée à YouTube (paramètre `origin` + baseUrl de la page). */
const ORIGIN = 'https://forgechat.heiphaistos.org'

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{width:100%;height:100%;border:0}</style>
</head><body><div id="p"></div><script>
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var p=null;
function report(){if(p)post({type:'state',state:p.getPlayerState(),currentTime:p.getCurrentTime()||0,duration:p.getDuration()||0})}
window.fcCmd=function(c){if(!p)return;
if(c.type==='load'){var o={videoId:c.videoId,startSeconds:c.position};c.playing?p.loadVideoById(o):p.cueVideoById(o)}
else if(c.type==='play')p.playVideo();else if(c.type==='pause')p.pauseVideo();
else if(c.type==='seek')p.seekTo(c.position,true);else if(c.type==='mute')c.muted?p.mute():p.unMute()};
function onYouTubeIframeAPIReady(){new YT.Player('p',{host:'https://www.youtube-nocookie.com',width:'100%',height:'100%',
playerVars:{controls:0,disablekb:1,rel:0,playsinline:1,origin:${JSON.stringify(ORIGIN)}},
events:{onReady:function(e){p=e.target;post({type:'ready'});setInterval(report,1000)},
onStateChange:function(e){if(e.data===0)post({type:'ended'});report()},
onError:function(e){post({type:'error',code:e.data})}}})}
</script><script src="https://www.youtube.com/iframe_api" onerror="post({type:'error',code:-1})"></script></body></html>`

// Navigation de la page elle-même : seule notre page ; un lien YouTube cliqué s'ouvre hors de l'app.
// (Les iframes YouTube ne passent pas ici sur Android ; sur iOS on les laisse charger.)
const onNavigate = (r: ShouldStartLoadRequest) => {
  if (!r.isTopFrame || r.url === 'about:blank' || r.url.startsWith(ORIGIN)) return true
  // http(s) seulement, confirmation avec le domaine réel (lib/links.ts).
  void openExternalUrl(r.url)
  return false
}

interface Props {
  watch: WatchInfo
  muted: boolean
  /** Fin de la vidéo `item` : le salon passe à la suivante (WATCH_NEXT). */
  onEnded: (item: number) => void
  /** Lecture impossible ici (intégration désactivée, réseau…) pour la vidéo `item`. */
  onFailed: (item: number) => void
}

export function WatchPlayer({ watch, muted, onEnded, onFailed }: Props) {
  const web = useRef<WebView>(null)
  const ready = useRef(false)
  const loaded = useRef<number | null>(null)
  const report = useRef<PlayerReport | null>(null)
  const latest = useRef({ watch, muted })

  const run = (cmds: PlayerCmd[]) => {
    for (const c of cmds) {
      if (c.type === 'load') {
        loaded.current = latest.current.watch.item
        report.current = null
      }
      web.current?.injectJavaScript(playerScript(c))
    }
  }
  const sync = (force: boolean) => {
    if (ready.current) run(syncCommands(latest.current.watch, loaded.current, report.current, Date.now(), force))
  }

  useEffect(() => {
    latest.current = { watch, muted }
    sync(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync ne lit que des refs
  }, [watch])
  useEffect(() => {
    latest.current = { watch, muted }
    if (ready.current) run([{ type: 'mute', muted }])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idem
  }, [muted])

  const onMessage = (e: WebViewMessageEvent) => {
    const ev = parsePlayerEvent(e.nativeEvent.data)
    if (!ev) return
    if (ev.type === 'ready') {
      ready.current = true
      run([{ type: 'mute', muted: latest.current.muted }])
      sync(true)
    } else if (ev.type === 'state') {
      report.current = { ...ev, at: Date.now() }
      sync(false)
    } else if (ev.type === 'ended') {
      if (loaded.current !== null) onEnded(loaded.current)
    } else {
      onFailed(loaded.current ?? latest.current.watch.item)
    }
  }

  return (
    <View style={styles.box}>
      <WebView
        ref={web}
        source={{ html: HTML, baseUrl: ORIGIN }}
        originWhitelist={['https://*']}
        onShouldStartLoadWithRequest={onNavigate}
        onMessage={onMessage}
        onError={() => onFailed(latest.current.watch.item)}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        style={styles.web}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
})
