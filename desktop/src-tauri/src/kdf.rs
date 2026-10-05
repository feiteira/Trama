//! Argon2id for passphrases and recovery phrases. Parameters are passed by the caller so the
//! TypeScript core stays the single owner of them; they are checked against sane bounds.

use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

pub fn argon2id(
    secret: &[u8],
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
    len: usize,
) -> AppResult<Zeroizing<Vec<u8>>> {
    if !(8 * p..=1 << 21).contains(&m_kib) || !(1..=10).contains(&t) || !(1..=16).contains(&p) {
        return Err(AppError::Invalid("argon2 parameters out of range".into()));
    }
    if !(16..=64).contains(&len) || salt.len() < 16 {
        return Err(AppError::Invalid(
            "argon2 output or salt length out of range".into(),
        ));
    }
    let params =
        Params::new(m_kib, t, p, Some(len)).map_err(|e| AppError::Invalid(e.to_string()))?;
    let mut out = Zeroizing::new(vec![0u8; len]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, &mut out)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The same vectors are checked by the TypeScript core (`test-vectors/argon2id.json`).
    #[test]
    fn matches_shared_vectors() {
        let raw = include_str!("../../../test-vectors/argon2id.json");
        let doc: Value = serde_json::from_str(raw).unwrap();
        for v in doc["vectors"].as_array().unwrap() {
            let out = argon2id(
                v["secret_utf8"].as_str().unwrap().as_bytes(),
                &hex::decode(v["salt_hex"].as_str().unwrap()).unwrap(),
                v["m"].as_u64().unwrap() as u32,
                v["t"].as_u64().unwrap() as u32,
                v["p"].as_u64().unwrap() as u32,
                v["len"].as_u64().unwrap() as usize,
            )
            .unwrap();
            assert_eq!(
                hex::encode(&*out),
                v["out_hex"].as_str().unwrap(),
                "{}",
                v["name"]
            );
        }
    }

    #[test]
    fn rejects_weak_parameters() {
        assert!(argon2id(b"x", &[0u8; 16], 8, 1, 1, 32).is_ok());
        assert!(argon2id(b"x", &[0u8; 8], 65536, 3, 4, 32).is_err());
        assert!(argon2id(b"x", &[0u8; 16], 65536, 0, 4, 32).is_err());
    }
}
