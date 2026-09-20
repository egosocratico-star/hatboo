use hatboo_lib::providers::{delete_api_key, get_api_key, set_api_key};

#[test]
fn api_key_roundtrip_through_keychain() {
    let provider = "test-hatboo-roundtrip";
    delete_api_key(provider).unwrap();

    assert!(get_api_key(provider).is_none());
    set_api_key(provider, "sk-probar-123").unwrap();
    assert_eq!(get_api_key(provider).as_deref(), Some("sk-probar-123"));

    set_api_key(provider, "sk-actualizada").unwrap();
    assert_eq!(get_api_key(provider).as_deref(), Some("sk-actualizada"));

    delete_api_key(provider).unwrap();
    assert!(get_api_key(provider).is_none());
    delete_api_key(provider).unwrap(); // idempotente
}
