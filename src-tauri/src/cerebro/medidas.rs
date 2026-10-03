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
//!   escalones de la escalera (2048 / 4096 / 8192). Sin huecos.
//! - La corrida anterior (`rama-2026-09-30.json`) no tenía 4096 y a `gemma3:1b`
//!   la dejó sin medir (`no_cabe` con 0,79 GB libres); por eso esta la sustituye
//!   entera.
//!
//! Lo que **no** está aquí es deliberado: un `num_ctx` fuera de la escalera no se
//! interpola. El KV cache no es lineal y §X llama a eso exactamente «afirmar sin
//! medir».

/// `(modelo, [(num_ctx, MB residentes)])` tal cual salió del arnés.
pub const MEDIDAS: &[(&str, &[(u32, u64)])] = &[
    ("gemma3:1b", &[(2048, 878), (4096, 881), (8192, 958)]),
    ("qwen2.5:1.5b", &[(2048, 1109), (4096, 1170), (8192, 1368)]),
    ("qwen2.5-coder:1.5b", &[(2048, 1109), (4096, 1170), (8192, 1368)]),
    ("qwen3.5:0.8b", &[(2048, 1063), (4096, 1090), (8192, 1197)]),
    ("deepseek-r1:1.5b", &[(2048, 1240), (4096, 1301), (8192, 1499)]),
    ("llama3.2:1b", &[(2048, 1450), (4096, 1519), (8192, 1733)]),
    ("qwen3:1.7b", &[(2048, 1645), (4096, 1882), (8192, 2419)]),
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
        // Lo que no está en la escalera no se inventa interpolando.
        assert_eq!(residente("gemma3:1b", 16384), None);
        assert_eq!(residente("modelo-que-no-existe", 2048), None);
        assert_eq!(escalones_medidos("qwen3.5:0.8b"), 3);
        assert_eq!(escalones_medidos("modelo-que-no-existe"), 0);
    }

    #[test]
    fn la_escalera_esta_completa_para_todos_los_modelos_locales() {
        // Un hueco aquí es un nivel que no se puede firmar: N2 pide 4096 y N3
        // 8192. Se comprueba contra la lista, no contra la memoria.
        for (modelo, tabla) in MEDIDAS {
            for ctx in [2048u32, 4096, 8192] {
                assert!(
                    tabla.iter().any(|(c, _)| *c == ctx),
                    "{modelo} no tiene medida a {ctx}"
                );
            }
            assert_eq!(tabla.len(), 3, "{modelo}: medida de más o de menos");
        }
        assert_eq!(MEDIDAS.len(), 7, "los siete locales de Ollama 0,35,1");
    }

    #[test]
    fn ninguna_medida_declara_un_ctx_que_no_exista_en_la_escalera() {
        // El Governor solo pregunta por {2048, 4096, 8192}; un ctx raro aquí
        // sería una cifra que nadie va a leer.
        for (_, tabla) in MEDIDAS {
            for (ctx, mb) in *tabla {
                assert!(matches!(*ctx, 2048 | 4096 | 8192), "ctx {ctx} fuera de la escalera");
                assert!(*mb > 0 && *mb < 8192, "medida imposible: {mb} MB");
            }
        }
    }
}
