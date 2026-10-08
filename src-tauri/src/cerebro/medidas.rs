//! RAM residente medida **en el portátil de él**, por modelo y `num_ctx`. El
//! crate la pide en `ModelInfo::ram_mb_by_ctx` y §X del Canon prohíbe afirmarla
//! si no está medida: sin esta tabla el Governor descarta todos los modelos
//! locales y el Brain no puede firmar ningún Plan.
//!
//! De dónde sale cada número, para poder reponerlo si alguien lo duda:
//!
//! - `benchmarks/resultados/rama-2026-10-03.json` — modo `rama` del arnés
//!   (`npm run fase0 -- rama`): carga el modelo, lee `/api/ps` y apunta
//!   `ram_ollama_mb` a ese ctx. Corrido el 03-10-2026 con **8,45 GB** de máquina,
//!   **Ollama 0,35,1** y sin GPU, sobre los siete modelos locales y los tres
//!   escalones de entonces (2048 / 4096 / 8192). Sin huecos.
//! - `benchmarks/resultados/rama-2026-10-06.json` — la misma ruta, corrida el
//!   05-10 a las 23:44 (el fichero dice 10-06 porque `hoy()` formatea en UTC) sobre
//!   los **peldaños bajos** nuevos, 512 y 1024, midiendo también 2048 en la misma
//!   corrida. Las siete cifras de 2048 salieron **idénticas** a las del 03-10 (878,
//!   1109, 1109, 1063, 1240, 1450, 1645), así que las dos mitades de la tabla son
//!   comparables.
//! - La corrida anterior (`rama-2026-09-30.json`) no tenía 4096 y a `gemma3:1b`
//!   la dejó sin medir (`no_cabe` con 0,79 GB libres); por eso esta la sustituye
//!   entera.
//!
//! Lo que **no** está aquí es deliberado: un `num_ctx` fuera de la escalera no se
//! interpola. El KV cache no es lineal y §X llama a eso exactamente «afirmar sin
//! medir».
//!
//! Y lo que dice la tabla, porque cambia de qué sirve apretar la ventana: entre
//! 2048 y 512 solo hay **0–52 MB** en seis de los siete (gemma3 878→865, coder y
//! qwen2.5 1109→1064, deepseek 1240→1195, llama3.2 1450→1398, y `qwen3.5:0.8b`
//! plano en 1063 —allí el KV no pesa nada por debajo de 2048—), salvo
//! `qwen3:1.7b`, que baja 177. El peso del modelo domina; el KV de la ventana corta
//! casi no pesa. Bajar de peldaño **no** es la palanca cuando faltan cien megas —la
//! palanca es dejar de negar el turno y correr con el margen apurado—.

/// `(modelo, [(num_ctx, MB residentes)])` tal cual salió del arnés.
pub const MEDIDAS: &[(&str, &[(u32, u64)])] = &[
    (
        "gemma3:1b",
        &[(512, 865), (1024, 877), (2048, 878), (4096, 881), (8192, 958)],
    ),
    (
        "qwen2.5:1.5b",
        &[(512, 1064), (1024, 1079), (2048, 1109), (4096, 1170), (8192, 1368)],
    ),
    (
        "qwen2.5-coder:1.5b",
        &[(512, 1064), (1024, 1079), (2048, 1109), (4096, 1170), (8192, 1368)],
    ),
    (
        "qwen3.5:0.8b",
        &[(512, 1063), (1024, 1063), (2048, 1063), (4096, 1090), (8192, 1197)],
    ),
    (
        "deepseek-r1:1.5b",
        &[(512, 1195), (1024, 1210), (2048, 1240), (4096, 1301), (8192, 1499)],
    ),
    (
        "llama3.2:1b",
        &[(512, 1398), (1024, 1415), (2048, 1450), (4096, 1519), (8192, 1733)],
    ),
    (
        "qwen3:1.7b",
        &[(512, 1468), (1024, 1527), (2048, 1645), (4096, 1882), (8192, 2419)],
    ),
];

/// Lo que ocupa ese modelo residente a ese ctx, o `None` si nadie lo midió.
pub fn residente(id: &str, num_ctx: u32) -> Option<u64> {
    MEDIDAS
        .iter()
        .find(|(m, _)| *m == id)
        .and_then(|(_, tabla)| tabla.iter().find(|(c, _)| *c == num_ctx).map(|(_, mb)| *mb))
}

/// Cuántos escalones tiene medidos ese modelo (0 = sin medir).
pub fn escalones_medidos(id: &str) -> usize {
    MEDIDAS.iter().find(|(m, _)| *m == id).map(|(_, t)| t.len()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_cifras_salen_de_la_medicion_y_nadie_extrapola() {
        assert_eq!(residente("gemma3:1b", 2048), Some(878));
        assert_eq!(residente("qwen3:1.7b", 8192), Some(2419));
        // 4096 se midió el 03-10: es el escalón que dejaba los turnos N2 sin
        // firmar. Sin esta línea el Governor descartaba N2 con motivo, y el
        // motivo era cierto.
        assert_eq!(residente("qwen3.5:0.8b", 4096), Some(1090));
        // Y los dos peldaños bajos, medidos el 05-10: son los que le permiten al
        // Governor apretar la ventana en vez de negar el turno.
        assert_eq!(residente("gemma3:1b", 512), Some(865));
        assert_eq!(residente("qwen2.5-coder:1.5b", 1024), Some(1079));
        // Lo que no está en la escalera no se inventa interpolando.
        assert_eq!(residente("gemma3:1b", 16384), None);
        assert_eq!(residente("modelo-que-no-existe", 2048), None);
        assert_eq!(escalones_medidos("qwen3.5:0.8b"), 5);
        assert_eq!(escalones_medidos("modelo-que-no-existe"), 0);
    }

    #[test]
    fn la_escalera_esta_completa_para_todos_los_modelos_locales() {
        // Un hueco aquí es un peldaño que el Governor no puede usar: pregunta por
        // la cifra exacta y `ram_para` no interpola. Se comprueba contra la lista,
        // no contra la memoria.
        for (modelo, tabla) in MEDIDAS {
            for ctx in [512u32, 1024, 2048, 4096, 8192] {
                assert!(
                    tabla.iter().any(|(c, _)| *c == ctx),
                    "{modelo} no tiene medida a {ctx}"
                );
            }
            assert_eq!(tabla.len(), 5, "{modelo}: medida de más o de menos");
        }
        assert_eq!(MEDIDAS.len(), 7, "los siete locales de Ollama 0,35,1");
    }

    #[test]
    fn la_ventana_corta_casi_no_pesa_y_eso_va_en_la_documentacion() {
        // El hallazgo del 05-10, escrito como prueba para que no se vuelva a
        // suponer lo contrario: entre 2048 y 512 hay **0–52 MB** en seis de los
        // siete modelos (y 177 en qwen3:1.7b). Quien proponga «solucionar» la falta
        // de RAM bajando de peldaño tiene que pasar por aquí.
        for (modelo, tabla) in MEDIDAS {
            let alto = tabla.iter().find(|(c, _)| *c == 2048).map(|(_, r)| *r).unwrap();
            let bajo = tabla.iter().find(|(c, _)| *c == 512).map(|(_, r)| *r).unwrap();
            let ahorro = alto - bajo;
            let tope = if *modelo == "qwen3:1.7b" { 200 } else { 60 };
            assert!(ahorro <= tope, "{}: se ahorran {ahorro} MB al pasar a 512", modelo);
        }
    }

    #[test]
    fn ninguna_medida_declara_un_ctx_que_no_exista_en_la_escalera() {
        // El Governor solo pregunta por los cinco peldaños de su conjunto; un ctx
        // raro aquí sería una cifra que nadie va a leer.
        for (_, tabla) in MEDIDAS {
            for (ctx, mb) in *tabla {
                assert!(
                    matches!(*ctx, 512 | 1024 | 2048 | 4096 | 8192),
                    "ctx {ctx} fuera de la escalera"
                );
                assert!(*mb > 0 && *mb < 8192, "medida imposible: {mb} MB");
            }
        }
    }
}
