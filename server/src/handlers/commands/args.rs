//! Analyse des arguments d'une commande « /nom a b reste » selon ses options déclarées.
//! Fonctions pures (testées) : la résolution des membres et rôles vit dans `mod.rs`.

use serde_json::Value;

pub const KINDS: &[&str] = &["string", "integer", "boolean", "user", "role"];

#[derive(Clone, Debug)]
pub struct OptDef {
    pub name: String,
    pub description: String,
    pub kind: String,
    pub required: bool,
    /// (libellé, valeur) : si non vide, seule une valeur listée est acceptée.
    pub choices: Vec<(String, String)>,
}

impl OptDef {
    pub fn to_json(&self) -> Value {
        let mut v = serde_json::json!({
            "name": self.name, "description": self.description, "type": self.kind, "required": self.required,
        });
        if !self.choices.is_empty() {
            v["choices"] = self.choices.iter().map(|(n, val)| serde_json::json!({ "name": n, "value": val })).collect();
        }
        v
    }
}

/// Une option de bot (JSON enregistré) ; `None` si elle ne respecte pas le format.
pub fn opt_from_json(v: &Value) -> Option<OptDef> {
    let name = v.get("name")?.as_str()?.to_string();
    let description = v.get("description").and_then(Value::as_str).unwrap_or("").to_string();
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("string").to_string();
    if !valid_ident(&name) || description.chars().count() > 100 || !KINDS.contains(&kind.as_str()) {
        return None;
    }
    let mut choices = Vec::new();
    if let Some(arr) = v.get("choices") {
        let arr = arr.as_array()?;
        if arr.len() > 25 || kind == "user" || kind == "role" || kind == "boolean" {
            return None;
        }
        for c in arr {
            let n = c.get("name")?.as_str()?.to_string();
            let val = match c.get("value")? {
                Value::String(s) => s.clone(),
                Value::Number(n) if n.is_i64() => n.to_string(),
                _ => return None,
            };
            if n.is_empty() || n.chars().count() > 100 || val.is_empty() || val.chars().count() > 100 {
                return None;
            }
            choices.push((n, val));
        }
    }
    Some(OptDef { name, description, kind, required: v.get("required").and_then(Value::as_bool).unwrap_or(false), choices })
}

/// Liste d'options valide : au plus 25, noms uniques, obligatoires avant facultatives.
pub fn opts_from_json(v: &Value) -> Option<Vec<OptDef>> {
    let arr = v.as_array()?;
    if arr.len() > 25 {
        return None;
    }
    let opts: Vec<OptDef> = arr.iter().map(opt_from_json).collect::<Option<_>>()?;
    let mut seen_optional = false;
    for (i, o) in opts.iter().enumerate() {
        if opts[..i].iter().any(|p| p.name == o.name) {
            return None;
        }
        if !o.required {
            seen_optional = true;
        } else if seen_optional {
            return None;
        }
    }
    Some(opts)
}

/// Nom d'option ou de commande : 1 à 32 caractères [a-z0-9_-].
pub fn valid_ident(s: &str) -> bool {
    (1..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// Texte brut de chaque option, dans l'ordre. La dernière option texte prend tout le reste.
pub fn split(args: &str, opts: &[OptDef], cmd: &str) -> Result<Vec<Option<String>>, String> {
    let mut rest = args.trim();
    let mut out = Vec::with_capacity(opts.len());
    for (i, o) in opts.iter().enumerate() {
        rest = rest.trim_start();
        if rest.is_empty() {
            if o.required {
                return Err(usage(cmd, opts));
            }
            out.push(None);
            continue;
        }
        if i == opts.len() - 1 && o.kind == "string" {
            out.push(Some(rest.to_string()));
            rest = "";
            continue;
        }
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        out.push(Some(rest[..end].to_string()));
        rest = &rest[end..];
    }
    if !rest.trim().is_empty() {
        return Err(usage(cmd, opts));
    }
    Ok(out)
}

pub fn usage(cmd: &str, opts: &[OptDef]) -> String {
    let parts: Vec<String> = opts.iter().map(|o| if o.required { format!("<{}>", o.name) } else { format!("[{}]", o.name) }).collect();
    format!("Usage : /{cmd} {}", parts.join(" ")).trim_end().to_string()
}

pub fn parse_bool(s: &str) -> Option<bool> {
    match s.to_lowercase().as_str() {
        "true" | "1" | "oui" | "yes" | "on" | "vrai" => Some(true),
        "false" | "0" | "non" | "no" | "off" | "faux" => Some(false),
        _ => None,
    }
}

/// `<@uuid>`, `<@!uuid>`, `<@&uuid>` ou uuid nu → l'identifiant ; sinon le nom (sans `@` initial).
pub fn mention_or_name(tok: &str) -> Result<uuid::Uuid, String> {
    let inner = tok.strip_prefix('<').and_then(|t| t.strip_suffix('>')).unwrap_or(tok);
    let inner = inner.trim_start_matches('@').trim_start_matches(['!', '&']);
    inner.parse().map_err(|_| inner.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn o(name: &str, kind: &str, required: bool) -> OptDef {
        OptDef { name: name.into(), description: String::new(), kind: kind.into(), required, choices: vec![] }
    }

    #[test]
    fn split_positional_and_rest() {
        let opts = [o("user", "user", true), o("reason", "string", false)];
        assert_eq!(split("<@x> pour spam  répété", &opts, "kick").unwrap(), vec![Some("<@x>".into()), Some("pour spam  répété".into())]);
        assert_eq!(split("@bob", &opts, "kick").unwrap(), vec![Some("@bob".into()), None]);
        assert!(split("", &opts, "kick").unwrap_err().starts_with("Usage : /kick <user> [reason]"));
        let ints = [o("n", "integer", true)];
        assert!(split("5 6", &ints, "purge").is_err(), "argument en trop");
    }

    #[test]
    fn option_lists_are_validated() {
        let ok = json!([{"name":"a","type":"string","required":true},{"name":"b","type":"integer"}]);
        assert_eq!(opts_from_json(&ok).unwrap().len(), 2);
        assert!(opts_from_json(&json!([{"name":"b"},{"name":"a","required":true}])).is_none(), "obligatoire après facultative");
        assert!(opts_from_json(&json!([{"name":"A!"}])).is_none());
        assert!(opts_from_json(&json!([{"name":"a"},{"name":"a"}])).is_none());
        assert!(opts_from_json(&json!([{"name":"a","type":"magic"}])).is_none());
        assert!(opts_from_json(&json!([{"name":"a","type":"user","choices":[{"name":"x","value":"y"}]}])).is_none());
        let many: Vec<Value> = (0..26).map(|i| json!({"name": format!("o{i}")})).collect();
        assert!(opts_from_json(&Value::Array(many)).is_none());
    }

    #[test]
    fn mentions() {
        let u = uuid::Uuid::new_v4();
        assert_eq!(mention_or_name(&format!("<@{u}>")), Ok(u));
        assert_eq!(mention_or_name(&format!("<@!{u}>")), Ok(u));
        assert_eq!(mention_or_name(&format!("<@&{u}>")), Ok(u));
        assert_eq!(mention_or_name("@Bob"), Err("Bob".into()));
        assert_eq!(parse_bool("Oui"), Some(true));
        assert_eq!(parse_bool("peut-etre"), None);
    }
}
