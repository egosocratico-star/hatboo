//! Lo que hay dentro de este PC. Lo pinta Ajustes → Sistema, y de él sale también
//! si Ollama está abierto: sin leer la máquina, cualquier promesa sobre lo que
//! este equipo puede cargar es un número inventado.
//!
//! La VRAM no se lee a propósito: pediría un backend gráfico nuevo y, en un
//! equipo sin GPU, sería un cero con muy buena pinta. El presupuesto es la RAM.

use serde::Serialize;
use sysinfo::{Components, Disks, System};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub ram_total_bytes: u64,
    pub ram_libre_bytes: u64,
    /// Etiqueta de la GPU si el sistema la expone como sensor. `None` se enseña
    /// como «Sin GPU detectada», que es la verdad y no un cero.
    pub gpu: Option<String>,
    pub disco_libre_bytes: u64,
    pub disco_total_bytes: u64,
    /// Uso global de CPU en 0..=100. sysinfo necesita dos muestras separadas en
    /// el tiempo para dar un porcentaje y no un cero eterno.
    pub cpu_uso: f32,
    pub cpu_nombre: String,
}

/// Lo que pregunta la interfaz, con el estado de Ollama pegado: saber que hay 8 GB
/// no sirve si el servidor ni está abierto.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    #[serde(flatten)]
    pub base: Hardware,
    pub ollama_ok: bool,
    pub locales: usize,
}

/// Palabras con las que una tarjeta gráfica se delata en la lista de sensores.
const PISTAS_GPU: &[&str] = &[
    "nvidia", "geforce", "rtx", "gtx", "radeon", "amd radeon", "arc", "iris", "uhd",
];

fn detecta_gpu() -> Option<String> {
    let lista = Components::new_with_refreshed_list();
    lista
        .list()
        .iter()
        .map(|c| c.label().to_string())
        .find(|etiqueta| {
            let minusculas = etiqueta.to_lowercase();
            PISTAS_GPU.iter().any(|pista| minusculas.contains(pista))
        })
}

/// El disco que nos importa es donde se guardan los modelos: el del perfil de
    /// usuario. Si no se reconoce, el de más capacidad (suele ser C:).
fn disco_de_datos(disks: &Disks) -> Option<&sysinfo::Disk> {
    let raiz = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let mejor = disks
        .list()
        .iter()
        .filter(|d| !d.is_removable())
        .filter(|d| raiz.as_os_str().is_empty() || d.mount_point().starts_with(&raiz) || raiz.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());
    mejor.or_else(|| disks.list().iter().filter(|d| !d.is_removable()).max_by_key(|d| d.total_space()))
}

pub fn lee_hardware() -> Hardware {
    let mut sys = System::new();
    sys.refresh_memory();
    // Primera muestra del contador de CPU; sin la pausa solo daría 0 o 100.
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(250));
    sys.refresh_cpu_usage();
    let disks = Disks::new_with_refreshed_list();
    let disco = disco_de_datos(&disks);
    Hardware {
        ram_total_bytes: sys.total_memory(),
        ram_libre_bytes: sys.available_memory(),
        gpu: detecta_gpu(),
        disco_libre_bytes: disco.map(|d| d.available_space()).unwrap_or(0),
        disco_total_bytes: disco.map(|d| d.total_space()).unwrap_or(0),
        cpu_uso: sys.global_cpu_usage(),
        cpu_nombre: sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_el_equipo_sin_romperse() {
        let h = lee_hardware();
        assert!(h.ram_total_bytes > 0);
        assert!(h.ram_libre_bytes <= h.ram_total_bytes);
    }
}
