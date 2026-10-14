//! Règle unique du nom d'utilisateur (inscription et modification du profil).
//!
//! Avant : longueur comptée en octets (« é » = 2) et `is_alphanumeric` Unicode,
//! qui laissait passer les sosies cyrilliques/grecs (« аdmin » avec un а
//! cyrillique). Seules les lettres latines (ASCII et accentuées) sont admises ;
//! le nom d'affichage reste libre pour le reste.

/// Lettre latine (ASCII, Latin-1, Latin étendu A/B), hors × et ÷.
fn latin_letter(c: char) -> bool {
    c.is_ascii_alphabetic() || (('\u{C0}'..='\u{24F}').contains(&c) && c.is_alphabetic())
}

/// 2 à 32 caractères : lettres latines, chiffres ASCII, `_` et `-`.
pub fn validate_username(name: &str) -> Result<(), &'static str> {
    if !(2..=32).contains(&name.chars().count()) {
        return Err("Nom d'utilisateur : 2 à 32 caractères");
    }
    if !name
        .chars()
        .all(|c| latin_letter(c) || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err("Nom d'utilisateur : lettres latines, chiffres, _ et - uniquement");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_username;

    #[test]
    fn regle() {
        for ok in ["ab", "Hélène_42", "jean-luc", "ŁukaszŻ", &"é".repeat(32)] {
            assert!(validate_username(ok).is_ok(), "{ok}");
        }
        for bad in [
            "a",
            "",
            &"é".repeat(33),
            "аdmin",
            "αlpha",
            "a b",
            "x×y",
            "<b>",
            "١٢",
        ] {
            assert!(validate_username(bad).is_err(), "{bad}");
        }
    }
}
