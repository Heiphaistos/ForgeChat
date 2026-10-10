//! Petites primitives partagées (HKDF-SHA256 sur un seul bloc).
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub type HmacSha256 = Hmac<Sha256>;

/// HKDF-SHA256 (RFC 5869), sel nul, 32 octets de sortie.
pub fn hkdf32(ikm: &[u8], info: &[u8]) -> [u8; 32] {
    let mut ext = HmacSha256::new_from_slice(&[0u8; 32]).expect("hmac");
    ext.update(ikm);
    let prk = ext.finalize().into_bytes();
    let mut exp = HmacSha256::new_from_slice(&prk).expect("hmac");
    exp.update(info);
    exp.update(&[1]);
    exp.finalize().into_bytes().into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn hkdf_rfc5869_case3() {
        // RFC 5869 A.3 : sel vide (= 32 zéros pour SHA-256), info vide.
        let okm = super::hkdf32(&[0x0b; 22], b"");
        assert_eq!(
            okm.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"
        );
    }
}
