use serde::{Deserialize, Deserializer};

/// Distingue "champ absent" (None) de "champ présent, valeur null" (Some(None))
/// -- serde réduit normalement `null` JSON à `None` pour un simple `Option<T>`,
/// ce qui rend impossible de différencier "ne pas toucher" de "vider
/// explicitement" dans un PATCH/PUT partiel. Toujours combiner avec `#[serde(default)]`.
pub fn deserialize_double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}
