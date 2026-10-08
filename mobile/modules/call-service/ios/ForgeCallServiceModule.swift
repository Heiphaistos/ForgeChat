import CommonCrypto
import CryptoKit
import ExpoModulesCore
import Foundation

/// Pendant iOS de CallServiceModule.kt : seules les fonctions utiles sur iOS. Le reste (service
/// d'appel, widgets, mise à jour, image dans l'image, effets vidéo) est réservé à Android dans le
/// JavaScript (Platform.OS), ou absent ici et donc ignoré (`requireOptionalNativeModule`).
public class ForgeCallServiceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ForgeCallService")

    // Appel en cours : iOS garde l'audio en arrière-plan (UIBackgroundModes audio), rien à lancer.
    Function("start") { (_: String) in }
    Function("stop") {}

    // PBKDF2-HMAC-SHA256 (src/e2e/crypto.ts) : 600 000 itérations prennent des minutes en
    // JavaScript, une fraction de seconde ici. Octets bruts en base64 standard, comme Android.
    AsyncFunction("pbkdf2") { (secretB64: String, saltB64: String, iterations: Int, length: Int) throws -> String in
      guard (1...10_000_000).contains(iterations), (1...64).contains(length),
            var secret = Data(base64Encoded: secretB64), let salt = Data(base64Encoded: saltB64), !salt.isEmpty else {
        throw FcException("paramètres PBKDF2 invalides")
      }
      // Clé HMAC vide = octets nuls (complétée par des zéros) : un octet nul est équivalent.
      if secret.isEmpty { secret = Data([0]) }
      var out = Data(count: length)
      let status = out.withUnsafeMutableBytes { o in
        secret.withUnsafeBytes { p in
          salt.withUnsafeBytes { s in
            CCKeyDerivationPBKDF(
              CCPBKDFAlgorithm(kCCPBKDF2),
              p.baseAddress!.assumingMemoryBound(to: CChar.self), secret.count,
              s.baseAddress!.assumingMemoryBound(to: UInt8.self), salt.count,
              CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
              o.baseAddress!.assumingMemoryBound(to: UInt8.self), length)
          }
        }
      }
      guard status == kCCSuccess else { throw FcException("PBKDF2 a échoué (\(status))") }
      return out.base64EncodedString()
    }

    // Fichiers chiffrés de bout en bout (src/e2e/files.ts) : en flux sur le disque, mêmes octets
    // que FileCrypto.java et le web. `src`, `dest` : file:// du cache de l'appli.
    AsyncFunction("encryptFile") { (src: String, dest: String, keyB64: String, fileId: String) throws -> Double in
      let out = try fileUrl(dest)
      do {
        return Double(try FileCrypto.encrypt(from: try fileUrl(src), to: out, key: try key(keyB64), fileId: fileId))
      } catch {
        try? FileManager.default.removeItem(at: out)
        throw error
      }
    }

    AsyncFunction("decryptFile") { (src: String, dest: String, keyB64: String, fileId: String, size: Double) throws -> String? in
      let out = try fileUrl(dest)
      do {
        try FileCrypto.decrypt(from: try fileUrl(src), to: out, key: try key(keyB64), fileId: fileId, size: Int64(size))
        return nil
      } catch {
        // Jamais de fichier partiel (ou non authentifié) laissé dans le cache.
        try? FileManager.default.removeItem(at: out)
        throw error
      }
    }
  }
}

final class FcException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

private func fileUrl(_ uri: String) throws -> URL {
  if let u = URL(string: uri), u.isFileURL { return u }
  if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
  throw FcException("chemin de fichier invalide")
}

private func key(_ b64: String) throws -> SymmetricKey {
  guard let raw = Data(base64Encoded: b64), raw.count == 32 else { throw FcException("clé de fichier invalide") }
  return SymmetricKey(data: raw)
}

/// Morceaux de 64 Kio en AES-256-GCM, IV = 4 octets nuls + numéro du morceau (8 octets
/// gros-boutiste), AAD « file v1|id|numéro|dernier » (docs/CHIFFREMENT-E2E.md §12).
enum FileCrypto {
  static let chunk = 64 * 1024
  static let tag = 16

  static func nonce(_ index: UInt64) throws -> AES.GCM.Nonce {
    var iv = Data(count: 12)
    for k in 0..<8 { iv[11 - k] = UInt8(truncatingIfNeeded: index >> (8 * UInt64(k))) }
    return try AES.GCM.Nonce(data: iv)
  }

  static func aad(_ fileId: String, _ index: UInt64, _ last: Bool) -> Data {
    Data("file v1|\(fileId)|\(index)|\(last ? 1 : 0)".utf8)
  }

  /// Lit jusqu'à `n` octets (moins seulement en fin de fichier).
  static func read(_ h: FileHandle, _ n: Int) throws -> Data {
    var buf = Data()
    while buf.count < n {
      guard let d = try h.read(upToCount: n - buf.count), !d.isEmpty else { break }
      buf.append(d)
    }
    return buf
  }

  static func open(_ src: URL, _ dest: URL) throws -> (FileHandle, FileHandle) {
    let input = try FileHandle(forReadingFrom: src)
    FileManager.default.createFile(atPath: dest.path, contents: nil)
    return (input, try FileHandle(forWritingTo: dest))
  }

  /// Chiffre `src` vers `dest` ; rend la taille en clair.
  static func encrypt(from src: URL, to dest: URL, key: SymmetricKey, fileId: String) throws -> Int64 {
    let (input, output) = try open(src, dest)
    defer { try? input.close(); try? output.close() }
    var cur = try read(input, chunk)
    var total: Int64 = 0
    var i: UInt64 = 0
    while true {
      // Morceau plein : on lit le suivant pour savoir si celui-ci est le dernier.
      let next = cur.count == chunk ? try read(input, chunk) : Data()
      let last = next.isEmpty
      let box = try AES.GCM.seal(cur, using: key, nonce: try nonce(i), authenticating: aad(fileId, i, last))
      try output.write(contentsOf: box.ciphertext + box.tag)
      total += Int64(cur.count)
      if last { return total }
      cur = next
      i += 1
    }
  }

  /// Déchiffre `src` vers `dest` ; erreur si le fichier est altéré, tronqué ou d'une autre taille.
  static func decrypt(from src: URL, to dest: URL, key: SymmetricKey, fileId: String, size: Int64) throws {
    let (input, output) = try open(src, dest)
    defer { try? input.close(); try? output.close() }
    let ctChunk = chunk + tag
    var cur = try read(input, ctChunk)
    var total: Int64 = 0
    var i: UInt64 = 0
    while true {
      let next = cur.count == ctChunk ? try read(input, ctChunk) : Data()
      let last = next.isEmpty
      guard cur.count >= tag else { throw FcException("fichier tronqué") }
      let box = try AES.GCM.SealedBox(nonce: try nonce(i), ciphertext: cur.prefix(cur.count - tag), tag: cur.suffix(tag))
      let pt = try AES.GCM.open(box, using: key, authenticating: aad(fileId, i, last))
      total += Int64(pt.count)
      guard total <= size else { throw FcException("taille du fichier invalide") }
      try output.write(contentsOf: pt)
      if last {
        guard total == size else { throw FcException("taille du fichier invalide") }
        return
      }
      cur = next
      i += 1
    }
  }
}
