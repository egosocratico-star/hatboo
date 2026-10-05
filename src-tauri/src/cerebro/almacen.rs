//! El almacén del dataset de decisiones (§15.9 del plan, abierto 9). El crate
//! **no escribe**: entrega la línea ya redactada y decide el producto. Aquí se
//! guarda en el directorio de datos de la app, en JSONL, y solo si el usuario
//! encendió el interruptor — son texto suyo.
//!
//! La retención era el abierto 8 del plan y aquí se cierra con un criterio
//! dicho, no con un «luego vemos»: un fichero y una copia, con un tope de
//! tamaño. Borrarlo es una operación de la app (Ajustes → Datos), no de este
//! módulo.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use hatboo_brain::observability::decisiones::{RegistroDecision, SinkDecisiones};

/// MB a partir de los cuales la ficha rota a `.1` (y la `.1` anterior se pierde).
const TOPE_MB: u64 = 5;

pub struct AlmacenDecisiones {
    ruta: PathBuf,
    tope: u64,
    /// Líneas que no se pudieron escribir. `guarda` no puede devolver error —el
    /// trait del crate no lo permite—, así que se cuenta: sin esto un disco lleno
    /// sería un dataset que parece completo y no lo es.
    perdidas: AtomicUsize,
}

impl AlmacenDecisiones {
    /// `<datos de la app>/brain/decisiones.jsonl`.
    pub fn nuevo(data_dir: &std::path::Path) -> Self {
        let ruta = data_dir.join("brain").join("decisiones.jsonl");
        AlmacenDecisiones {
            ruta,
            tope: TOPE_MB * 1_048_576,
            perdidas: AtomicUsize::new(0),
        }
    }

    pub fn perdidas(&self) -> usize {
        self.perdidas.load(Ordering::SeqCst)
    }

    fn rota_si_toca(&self) {
        let tamano = fs::metadata(&self.ruta).map(|m| m.len()).unwrap_or(0);
        if tamano < self.tope {
            return;
        }
        let copia = self.ruta.with_extension("jsonl.1");
        // Si la copia anterior estaba abierta o bloqueada, se queda la vieja y
        // el fichero sigue creciendo: es preferible a perder la escritura actual.
        let _ = fs::remove_file(&copia);
        let _ = fs::rename(&self.ruta, &copia);
    }
}

impl SinkDecisiones for AlmacenDecisiones {
    fn guarda(&self, registro: &RegistroDecision) {
        let linea = registro.to_linea();
        if let Some(dir) = self.ruta.parent() {
            if fs::create_dir_all(dir).is_err() {
                self.perdidas.fetch_add(1, Ordering::SeqCst);
                return;
            }
        }
        self.rota_si_toca();
        match OpenOptions::new().create(true).append(true).open(&self.ruta) {
            Ok(mut f) => {
                if f.write_all(linea.as_bytes()).is_err() || f.flush().is_err() {
                    self.perdidas.fetch_add(1, Ordering::SeqCst);
                }
            }
            Err(_) => {
                self.perdidas.fetch_add(1, Ordering::SeqCst);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registro(mensaje: &str) -> RegistroDecision {
        RegistroDecision {
            producto: "hatboo".into(),
            modo: "chat".into(),
            mensaje: mensaje.into(),
            intent: "ask".into(),
            nivel: "N1".into(),
            riesgo: "low".into(),
            contrato: "markdown".into(),
            verificacion: "formato".into(),
            modelo: "gemma3:1b".into(),
            proveedor: "ollama".into(),
            local: true,
            resultado: "completado".into(),
            motivo_plan: "regla charla-corta".into(),
            // El bloque del producto se guarda firmado, nunca en claro: quien lea
            // el dataset tiene que poder emparejar la decisión con su contexto sin
            // que el archivo acabe siendo una copia de las notas del usuario.
            contexto_producto_hash: "a".repeat(64),
        }
    }

    /// Un directorio distinto por test: si comparten uno, dos `cargo test` en
    /// paralelo se pisan los ficheros.
    fn carpeta_de_prueba(nombre: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("hatboo-almacen-{nombre}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn escribe_jsonl_y_cuenta_lo_que_no_pudo() {
        let dir = carpeta_de_prueba("escritura");
        let a = AlmacenDecisiones::nuevo(&dir);
        a.guarda(&registro("primera"));
        a.guarda(&registro("segunda"));
        let contenido = fs::read_to_string(a.ruta.clone()).unwrap();
        let lineas: Vec<&str> = contenido.lines().collect();
        assert_eq!(lineas.len(), 2, "una línea JSON por decisión");
        assert!(lineas[0].starts_with('{'), "{}", lineas[0]);
        assert_eq!(a.perdidas(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rota_a_partir_del_tope_en_vez_de_crecer_sin_freno() {
        let dir = carpeta_de_prueba("rotacion");
        let a = AlmacenDecisiones::nuevo(&dir);
        let a = AlmacenDecisiones {
            ruta: a.ruta,
            tope: 40, // bytes, para no escribir 5 MB en un test
            perdidas: AtomicUsize::new(0),
        };
        for i in 0..6 {
            a.guarda(&registro(&format!("línea número {i} con relleno para ocupar")));
        }
        let activo = fs::read_to_string(&a.ruta).unwrap();
        // La propiedad, no una cifra de bytes adivinada: con un tope por debajo
        // del tamaño de una línea, cada escritura rompe la anterior y el fichero
        // activo se queda con UNA.
        assert_eq!(
            activo.lines().count(),
            1,
            "el fichero activo tendría que tener la última línea, tiene: {activo:?}"
        );
        assert!(activo.contains("número 5"), "la última escrita es la quinta: {activo}");
        assert!(a.ruta.with_extension("jsonl.1").exists(), "la copia rotada existe");
        assert_eq!(a.perdidas(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn si_el_directorio_no_se_puede_crear_lo_dice_contando() {
        // Un fichero en la raíz hace de padre inválido: `create_dir_all` falla.
        let dir = carpeta_de_prueba("roto");
        fs::create_dir_all(&dir).unwrap();
        let estorbo = dir.join("no-es-un-directorio");
        fs::write(&estorbo, b"x").unwrap();
        let a = AlmacenDecisiones {
            ruta: estorbo.join("decisiones.jsonl"),
            tope: 1_000_000,
            perdidas: AtomicUsize::new(0),
        };
        a.guarda(&registro("no va a llegar"));
        assert_eq!(a.perdidas(), 1, "una línea perdida tiene que contarse, no desaparecer");
        let _ = fs::remove_dir_all(&dir);
    }
}
