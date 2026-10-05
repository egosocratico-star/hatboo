//! El puente entre Hatboo y el crate `hatboo-brain` (§11 del plan: «el desktop
//! consume el crate; no se copia código»).
//!
//! Dos puertas, y las dos cerradas por defecto:
//!
//! - la de compilar: la feature Cargo `cerebro`. Sin ella este módulo es un
//!   `aplicable()` que siempre dice `false` y el chat no cambia ni de
//!   comportamiento ni de tamaño.
//! - la de ejecutar: el interruptor de Ajustes. Con la feature compilada pero el
//!   interruptor apagado se usa el camino de siempre.
//!
//! Qué cambia con el Brain encendido, dicho sin adornos:
//!
//! - **Solo proveedor local.** La policy es `LocalOnly` y `consentimiento_api`
//!   vale `false`: ninguna pieza de su chat sale del equipo y ninguna clave del
//!   llavero entra por aquí. La nube sigue por el camino de siempre hasta que
//!   exista una pregunta de consentimiento.
//! - **Sin imágenes.** El `BrainRequest` no lleva adjuntos; si el turno trae
//!   imágenes se cae al camino actual en vez de contestar sin verlas.
//! - **El system lo arma el crate**, por capas y en orden fijo: identidad,
//!   contrato, `proyecto` (el `HATBOO.md` aprobado por el Trust Gate) y `producto`.
//!   El prompt de persona, las skills activas y la memoria del usuario viajan en
//!   `BrainRequest::contexto_producto`, que es la capa `producto`: entra en
//!   `Presupuesto.fijo` y **no se recorta nunca**. Si con todo dentro no cabe, el
//!   Plan lo dice en su `reason` en vez de cortar una plantilla a medias. Antes
//!   cabalgaba en un mensaje `system` de la cabecera de `req.history`, que es justo
//!   lo primero que cae cuando aprieta la ventana (§11) y lo que
//!   `providers/anthropic.rs` filtra del historial. La puerta «prompt
//!   byte-identical» sigue siendo del gate de la Fase 4, no de esta tanda.

/// La tabla de RAM residente medida en este portátil: sin ella el Governor no
/// puede afirmar que un modelo local quepa, y descarta todos.
pub mod medidas;

/// El almacén del dataset de decisiones. Solo se usa con el interruptor de
/// Ajustes encendido; el crate entrega la línea redactada y aquí se escribe.
#[cfg(feature = "cerebro")]
pub mod almacen;

/// Las manos del modo trabajo: el Brain decide y aquí se ejecutan sus llamadas,
/// con la aprobación que ya usa el bucle y el sandbox de las tools de siempre.
#[cfg(feature = "cerebro")]
pub mod herramientas;

/// El brazo: una corrida completa del modo trabajo administrada por el Brain.
#[cfg(feature = "cerebro")]
pub mod trabajo;

#[cfg(feature = "cerebro")]
mod real;
#[cfg(feature = "cerebro")]
pub use real::{aplicable, turno, Traza, TrazaEvento};

/// Con la feature apagada no hay adaptador que valga: el chat es el de siempre.
#[cfg(not(feature = "cerebro"))]
pub fn aplicable(_settings: &crate::state::Settings, _messages: &[crate::providers::ChatMessage]) -> bool {
    false
}

/// Gemelo del `turno` real para que el llamador de `chat/stream.rs` tenga una
/// sola firma que compilar con la feature o sin ella. `aplicable()` ya devolvió
/// `false`, así que esto se alcanza solo si alguien quita el `if`: y entonces lo
/// honesto es un error que lo diga, no contestar otra cosa.
#[cfg(not(feature = "cerebro"))]
pub async fn turno(
    _app: tauri::AppHandle,
    _conv_id: String,
    _settings: crate::state::Settings,
    _proveedor: std::sync::Arc<dyn crate::providers::AiProvider>,
    _messages: Vec<crate::providers::ChatMessage>,
    _data_dir: std::path::PathBuf,
    _tx: tokio::sync::mpsc::Sender<crate::providers::StreamDelta>,
) -> Result<Option<String>, crate::providers::ProviderError> {
    Err(crate::providers::ProviderError::Malformed(
        "el cerebro no está compilado: falta la feature `cerebro`".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::medidas::*;

    #[test]
    fn las_medidas_salen_del_arnes_nadie_interpola() {
        assert_eq!(residente("gemma3:1b", 2048), Some(878));
        assert_eq!(residente("qwen3:1.7b", 8192), Some(2419));
        assert_eq!(residente("qwen3.5:0.8b", 4096), Some(1090));
        // Fuera de la escalera no se inventa nada interpolando entre medidas.
        assert_eq!(residente("gemma3:1b", 16384), None);
        assert_eq!(residente("modelo-que-no-existe", 2048), None);
        assert_eq!(escalones_medidos("qwen3.5:0.8b"), 3);
        assert_eq!(escalones_medidos("modelo-que-no-existe"), 0);
    }

    #[test]
    fn ninguna_medida_sale_fuera_de_la_escalera() {
        // El Governor solo pregunta por {2048, 4096, 8192}; un ctx raro aquí sería
        // una cifra que nadie va a leer nunca.
        for (modelo, tabla) in MEDIDAS {
            for (ctx, mb) in *tabla {
                assert!(matches!(*ctx, 2048 | 4096 | 8192), "{modelo}: ctx {ctx}");
                assert!(*mb > 0 && *mb < 8192, "{modelo}: {mb} MB es imposible");
            }
        }
    }
}
