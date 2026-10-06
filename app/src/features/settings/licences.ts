// The open-source software bundled with Trama, shown under Settings → About. Kept by hand:
// update it when a dependency is added (app/package.json, desktop/src-tauri/Cargo.toml).

export interface BundledSoftware {
  name: string;
  licence: string;
}

export const BUNDLED: Record<'fonts' | 'libraries' | 'desktop', readonly BundledSoftware[]> = {
  fonts: [
    { name: 'Instrument Sans', licence: 'SIL Open Font License 1.1' },
    { name: 'Literata', licence: 'SIL Open Font License 1.1' },
  ],
  libraries: [
    { name: 'React', licence: 'MIT' },
    { name: 'Lucide', licence: 'ISC' },
    { name: 'Luxon', licence: 'MIT' },
    { name: 'noble-ciphers, noble-hashes', licence: 'MIT' },
    { name: 'scure-bip39', licence: 'MIT' },
    { name: 'sql.js', licence: 'MIT' },
    { name: 'fflate', licence: 'MIT' },
    { name: 'xmldom', licence: 'MIT' },
    { name: 'Mammoth', licence: 'BSD-2-Clause' },
    { name: 'Papa Parse', licence: 'MIT' },
    { name: 'PDF.js', licence: 'Apache-2.0' },
  ],
  desktop: [
    { name: 'Tauri', licence: 'Apache-2.0 / MIT' },
    { name: 'SQLCipher', licence: 'BSD-3-Clause' },
    { name: 'rusqlite', licence: 'MIT' },
    { name: 'RustCrypto argon2', licence: 'Apache-2.0 / MIT' },
    { name: 'OpenSSL', licence: 'Apache-2.0' },
    { name: 'SQLite (inside SQLCipher and sql.js)', licence: 'Public domain' },
    { name: 'serde, serde_json, hex, zeroize, thiserror, percent-encoding', licence: 'Apache-2.0 / MIT' },
    { name: 'walkdir', licence: 'MIT / Unlicense' },
  ],
};
