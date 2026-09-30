//! Los nombres que se saltan el agente y el árbol, en UN solo sitio.
//!
//! Antes había tres listas distintas conviviendo: `search_files` se saltaba seis
//! nombres, el buscador del comando otras cinco y `list_project_dir` —el árbol que
//! él mira— **ninguna**. Por eso el agente no entraba en `node_modules` mientras el
//! panel de Archivos lo enseñaba, y por eso abrir `Documentos` como proyecto era
//! una lista de Fax, My Games y bóvedas de Obsidian.
//!
//! La lista vive en los ajustes (`ignore_dirs`), sembrada con [`FIJOS`], para que
//! cada uno pueda quitar lo que le moleste o añadir el suyo (Ajustes → Agente). El
//! agente, el árbol y la búsqueda leen la MISMA, a propósito: si una carpeta no
//! aparece en el panel tampoco debe aparecer en `list_dir`, y al revés.

/// Lo que casi nunca es el proyecto: control de versiones, salida de compilar y
/// entornos de paquetes.
pub const FIJOS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".cache",
    ".pytest_cache",
];

/// La lista tal como llega a los ajustes la primera vez (y cuando el blob guardado
/// no trae el campo, vía `#[serde(default)]`).
pub fn por_defecto() -> Vec<String> {
    FIJOS.iter().map(|s| s.to_string()).collect()
}

/// ¿Se salta este nombre? Comparación sin distinguir mayúsculas: en Windows
/// `NODE_MODULES` y `node_modules` son la misma carpeta, y el usuario escribe la
/// lista a mano.
pub fn ignora(nombre: &str, lista: &[String]) -> bool {
    let minus = nombre.to_lowercase();
    lista.iter().any(|e| e.to_lowercase() == minus)
}

/// Lo que se guarda: nombres sueltos, sin rutas ni separadores. Una carpeta se
/// salta por su nombre en cualquier nivel, que es lo que significa «ignorada»
/// aquí; si alguien pega una ruta, se queda solo con el último tramo en vez de
/// guardar algo que no va a casar nunca.
pub fn sanea(entrada: &[String]) -> Vec<String> {
    let mut vistos: Vec<String> = Vec::new();
    for e in entrada {
        let limpio = e
            .trim()
            .trim_matches('"')
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        // Los puntos se quedan donde estaban: si `sanea(".git")` devolviera `git`,
        // la lista dejaría de parecerse a lo que compara `ignora`. Lo que sí sobra
        // es una entrada que no sea más que puntos (`".."`, `"..."`), que no nombra
        // ninguna carpeta.
        if limpio.is_empty() || limpio.chars().all(|c| c == '.') {
            continue;
        }
        if vistos.iter().any(|v| v.to_lowercase() == limpio.to_lowercase()) {
            continue;
        }
        vistos.push(limpio);
    }
    vistos
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn la_lista_de_serie_salta_lo_de_siempre() {
        let l = por_defecto();
        assert!(ignora("node_modules", &l));
        assert!(ignora(".git", &l));
        assert!(ignora("__pycache__", &l));
    }

    #[test]
    fn sin_distinguir_mayusculas_porque_es_windows() {
        let l = por_defecto();
        assert!(ignora("Node_Modules", &l));
        assert!(ignora("TARGET", &l));
    }

    #[test]
    fn lo_del_usuario_se_suma_a_lo_de_serie() {
        let mut l = por_defecto();
        l.push("My Games".to_string());
        assert!(ignora("my games", &l));
        assert!(ignora("node_modules", &l));
    }

    #[test]
    fn una_carpeta_normal_no_se_salta() {
        let l = por_defecto();
        assert!(!ignora("src", &l));
        assert!(!ignora("documentos", &l));
        // `build` sí está; `builder` no, que no es un prefijo.
        assert!(!ignora("builder", &l));
    }

    #[test]
    fn el_saneado_deja_nombres_sin_ruta() {
        let limpio = sanea(&[
            "  Fax  ".to_string(),
            "C:\\Users\\x\\My Games".to_string(),
            "/home/e/quiosco".to_string(),
            "\"node_modules\"".to_string(),
            "NODE_MODULES".to_string(),
            "".to_string(),
            "...".to_string(),
        ]);
        assert_eq!(
            limpio,
            vec![
                "Fax".to_string(),
                "My Games".to_string(),
                "quiosco".to_string(),
                "node_modules".to_string()
            ]
        );
    }

    #[test]
    fn un_nombre_con_punto_sigue_con_su_punto() {
        // `.git` escrito tal cual debe seguir siendo `.git` tras sanear, o la lista
        // no casaría con ninguna carpeta.
        assert_eq!(sanea(&[".git".to_string()]), vec![".git".to_string()]);
        assert!(ignora(".git", &sanea(&[".git".to_string()])));
    }
}
