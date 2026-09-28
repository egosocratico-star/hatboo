//! Detecta al agente repitiéndose y permite pararlo antes de ejecutar la llamada
//! sospechosa.
//!
//! El bucle de trabajo ya tiene un techo de iteraciones (25), pero eso solo corta
//! el rollo por lo sano: con un modelo pequeño las últimas vueltas suelen ser la
//! MISMA llamada con los MISMOS argumentos, y cada una gasta tokens, tiempo y —si
//! la tool escribe en disco— archivos. Aquí se mira el contenido de la llamada, no
//! cuántas vueltas van.
//!
//! Se para ANTES de ejecutar: si el modelo pidió por tercera vez
//! `run_command("del X")`, esa tercera vez no se ejecuta.

use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

/// Dos intentos pueden ser cabezonería útil; tres ya no avanzan solos.
const UMBRAL_REPETIDA: u32 = 3;

/// Lo máximo que se muestra de los argumentos en el mensaje de parada. Una
/// llamada a `write_file` lleva el archivo entero dentro.
const ARGUMENTOS_EN_CLARO: usize = 70;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Bucle {
    /// La misma herramienta con los mismos argumentos, `veces` veces.
    Repetida { llamada: String, veces: u32 },
    /// Dos llamadas que se alternan: `a, b, a, b`.
    Alterna { a: String, b: String },
}

impl Bucle {
    /// Lo que se le enseña a quien usa la app. Se paró solo, y se dice por qué:
    /// un error que no explica qué se repitió no sirve para corregir el rumbo.
    pub fn mensaje(&self) -> String {
        match self {
            Bucle::Repetida { llamada, veces } => format!(
                "El agente se paró solo: repitió {llamada} {veces} veces sin avanzar. \
                 Insistir con la misma orden no va a dar otro resultado — cámbiale el \
                 enfoque en una tarea nueva."
            ),
            Bucle::Alterna { a, b } => format!(
                "El agente se paró solo: alternaba {a} y {b} sin avanzar. \
                 Hay un paso que se le está resistiendo; dile tú qué hacer con eso."
            ),
        }
    }
}

pub struct DetectorBucles {
    veces: HashMap<u64, u32>,
    /// Cómo se escribe cada firma, para poder nombrarla en el mensaje sin
    /// conservar en memoria el argumento entero (un `write_file` son cientos de KB).
    apariencia: HashMap<u64, String>,
    /// Las últimas firmas. Para el patrón alterno solo hacen falta cuatro.
    secuencia: Vec<u64>,
}

impl Default for DetectorBucles {
    fn default() -> Self {
        Self::new()
    }
}

impl DetectorBucles {
    pub fn new() -> Self {
        Self {
            veces: HashMap::new(),
            apariencia: HashMap::new(),
            secuencia: Vec::new(),
        }
    }

    /// Registra una petición de tool y dice si hay que parar ya.
    pub fn registrar(&mut self, herramienta: &str, argumentos: &Value) -> Option<Bucle> {
        let firma = firma(herramienta, argumentos);
        self.apariencia
            .entry(firma)
            .or_insert_with(|| resumen(herramienta, argumentos));
        let veces = self.veces.entry(firma).or_insert(0);
        *veces += 1;
        if *veces >= UMBRAL_REPETIDA {
            return Some(Bucle::Repetida {
                llamada: self.apariencia[&firma].clone(),
                veces: *veces,
            });
        }
        self.secuencia.push(firma);
        let n = self.secuencia.len();
        if n >= 4 {
            let v = &self.secuencia[n - 4..n];
            if v[0] != v[1] && v[0] == v[2] && v[1] == v[3] {
                return Some(Bucle::Alterna {
                    a: self.apariencia[&v[0]].clone(),
                    b: self.apariencia[&v[1]].clone(),
                });
            }
        }
        if self.secuencia.len() > 4 {
            self.secuencia.remove(0);
        }
        None
    }
}

/// Herramienta + argumentos canónicos, reducidos a un número. `serde_json` ordena
/// las claves de los objetos (BTreeMap mientras no se active `preserve_order`),
/// así que el mismo argumento escrito en otro orden da la misma firma.
fn firma(herramienta: &str, argumentos: &Value) -> u64 {
    let mut h = DefaultHasher::new();
    herramienta.hash(&mut h);
    argumentos.to_string().hash(&mut h);
    h.finish()
}

/// La llamada, legible y corta, para el mensaje de parada.
fn resumen(herramienta: &str, argumentos: &Value) -> String {
    let json = argumentos.to_string();
    let cortados: String = json.chars().take(ARGUMENTOS_EN_CLARO).collect();
    let puntos = if cortados.chars().count() < json.chars().count() {
        "…"
    } else {
        ""
    };
    format!("{herramienta}({cortados}{puntos})")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn la_tercera_vez_de_la_misma_llamada_para_el_agente() {
        let mut d = DetectorBucles::new();
        let args = json!({"path": "src/main.rs"});
        assert_eq!(d.registrar("read_file", &args), None);
        assert_eq!(d.registrar("read_file", &args), None);
        match d.registrar("read_file", &args) {
            Some(Bucle::Repetida { llamada, veces }) => {
                assert_eq!(veces, 3);
                assert!(llamada.starts_with("read_file("), "{llamada}");
                assert!(llamada.contains("src/main.rs"));
            }
            otra => panic!("tenía que ser Repetida, salió {otra:?}"),
        }
    }

    #[test]
    fn argumentos_distintos_no_son_bucle() {
        let mut d = DetectorBucles::new();
        for i in 0..8 {
            assert_eq!(
                d.registrar("read_file", &json!({ "path": format!("a{i}.rs") })),
                None,
                "leer archivos distintos no es repetir"
            );
        }
    }

    #[test]
    fn el_orden_de_las_claves_no_cambia_la_firma() {
        let mut d = DetectorBucles::new();
        let a = json!({"path": "x.rs", "text": "hola"});
        let b = json!({"text": "hola", "path": "x.rs"});
        assert_eq!(firma("write_file", &a), firma("write_file", &b));
        assert_eq!(d.registrar("write_file", &a), None);
        assert_eq!(d.registrar("write_file", &b), None);
        assert!(matches!(
            d.registrar("write_file", &a),
            Some(Bucle::Repetida { veces: 3, .. })
        ));
    }

    #[test]
    fn alternar_dos_llamadas_se_detecta_en_la_cuarta() {
        let mut d = DetectorBucles::new();
        let x = json!({"path": "a.rs"});
        let y = json!({"command": "cargo check"});
        assert_eq!(d.registrar("read_file", &x), None);
        assert_eq!(d.registrar("run_command", &y), None);
        assert_eq!(d.registrar("read_file", &x), None);
        match d.registrar("run_command", &y) {
            Some(Bucle::Alterna { a, b }) => {
                assert!(a.contains("a.rs"), "{a}");
                assert!(b.contains("cargo check"), "{b}");
            }
            otra => panic!("tenía que ser Alterna, salió {otra:?}"),
        }
    }

    #[test]
    fn una_secuencia_que_avanza_no_salta() {
        let mut d = DetectorBucles::new();
        let pasos = [
            ("list_dir", json!({})),
            ("read_file", json!({"path": "a.rs"})),
            ("list_dir", json!({})),
            ("read_file", json!({"path": "b.rs"})),
            ("list_dir", json!({"path": "src"})),
            ("read_file", json!({"path": "c.rs"})),
        ];
        for (h, a) in pasos {
            assert_eq!(d.registrar(h, &a), None, "{h} {a} no debería parar");
        }
    }

    #[test]
    fn un_argumento_enorme_se_muestra_cortado() {
        let mut d = DetectorBucles::new();
        let args = json!({"path": "a.rs", "text": "x".repeat(4000)});
        d.registrar("write_file", &args);
        d.registrar("write_file", &args);
        match d.registrar("write_file", &args) {
            Some(Bucle::Repetida { llamada, .. }) => {
                assert!(llamada.chars().count() < 120, "lleva el archivo entero: {llamada}");
                assert!(llamada.contains('…'), "no se cortó: {llamada}");
                assert!(llamada.ends_with("…)"), "el cierre va después del corte: {llamada}");
            }
            otra => panic!("{otra:?}"),
        }
    }

    #[test]
    fn el_mensaje_dice_quien_se_repitio_cuantas_veces_y_que_hacer() {
        let m = Bucle::Repetida {
            llamada: "read_file({\"path\":\"x\"})".into(),
            veces: 3,
        }
        .mensaje();
        assert!(m.contains("read_file"), "{m}");
        assert!(m.contains("3 veces"), "{m}");
        assert!(m.contains("se paró solo"), "{m}");
    }
}
