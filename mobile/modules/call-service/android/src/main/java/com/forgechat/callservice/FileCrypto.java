package com.forgechat.callservice;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Fichiers chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §12), en flux : mêmes octets
 * que src/e2e/crypto.ts (web et JavaScript). Morceaux de 64 Kio en AES-256-GCM,
 * IV = 4 octets nuls + numéro du morceau (8 octets gros-boutiste), AAD
 * « file v1|id|numéro|dernier ». Java pur (pas d'API Android) : testable sur la JVM.
 */
public final class FileCrypto {
  public static final int CHUNK = 64 * 1024;
  public static final int TAG = 16;
  private static final int CT_CHUNK = CHUNK + TAG;

  private FileCrypto() {}

  static byte[] iv(long index) {
    byte[] iv = new byte[12];
    for (int k = 0; k < 8; k++) iv[11 - k] = (byte) (index >>> (8 * k));
    return iv;
  }

  private static Cipher cipher(int mode, byte[] key, String fileId, long index, boolean last) throws GeneralSecurityException {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG * 8, iv(index)));
    c.updateAAD(("file v1|" + fileId + "|" + index + "|" + (last ? 1 : 0)).getBytes(StandardCharsets.UTF_8));
    return c;
  }

  /** Lit jusqu'à `n` octets (moins seulement en fin de flux). */
  private static int readFully(InputStream in, byte[] buf, int n) throws IOException {
    int off = 0;
    while (off < n) {
      int r = in.read(buf, off, n - off);
      if (r < 0) break;
      off += r;
    }
    return off;
  }

  private static void checkKey(byte[] key) {
    if (key.length != 32) throw new IllegalArgumentException("clé de fichier invalide");
  }

  /** Chiffre `in` vers `out` ; rend la taille en clair. */
  public static long encrypt(InputStream in, OutputStream out, byte[] key, String fileId) throws IOException, GeneralSecurityException {
    checkKey(key);
    byte[] cur = new byte[CHUNK];
    byte[] next = new byte[CHUNK];
    int curLen = readFully(in, cur, CHUNK);
    long total = 0;
    for (long i = 0; ; i++) {
      // Morceau plein : on lit le suivant pour savoir si celui-ci est le dernier.
      int nextLen = curLen == CHUNK ? readFully(in, next, CHUNK) : 0;
      boolean last = nextLen == 0;
      out.write(cipher(Cipher.ENCRYPT_MODE, key, fileId, i, last).doFinal(cur, 0, curLen));
      total += curLen;
      if (last) return total;
      byte[] t = cur; cur = next; next = t;
      curLen = nextLen;
    }
  }

  /** Déchiffre `in` vers `out` ; lève une exception si le fichier est altéré, tronqué ou d'une autre taille. */
  public static void decrypt(InputStream in, OutputStream out, byte[] key, String fileId, long size) throws IOException, GeneralSecurityException {
    checkKey(key);
    byte[] cur = new byte[CT_CHUNK];
    byte[] next = new byte[CT_CHUNK];
    int curLen = readFully(in, cur, CT_CHUNK);
    long total = 0;
    for (long i = 0; ; i++) {
      int nextLen = curLen == CT_CHUNK ? readFully(in, next, CT_CHUNK) : 0;
      boolean last = nextLen == 0;
      if (curLen < TAG) throw new GeneralSecurityException("fichier tronqué");
      byte[] pt = cipher(Cipher.DECRYPT_MODE, key, fileId, i, last).doFinal(cur, 0, curLen);
      total += pt.length;
      if (total > size) throw new GeneralSecurityException("taille du fichier invalide");
      out.write(pt);
      if (last) {
        if (total != size) throw new GeneralSecurityException("taille du fichier invalide");
        return;
      }
      byte[] t = cur; cur = next; next = t;
      curLen = nextLen;
    }
  }
}
