import { Image, type ImageProps } from 'expo-image'
import { imageSource } from '@/lib/links'
import { useSignedMediaUrl } from '@/lib/useSignedUrl'

/** Image de /uploads tirée d'un contenu (chiffré) : signée à l'affichage (lib/useSignedUrl). */
export function SignedImage({ url, ...props }: { url: string } & Omit<ImageProps, 'source'>) {
  const src = useSignedMediaUrl(url)
  return src ? <Image source={imageSource(src)} {...props} /> : null
}
