use super::{AgentTool, RiskLevel, ToolError};
use crate::providers::imagen;
use crate::state::Settings;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

/// Dibuja con el motor de nube apuntado en Ajustes → API y guarda el archivo
/// dentro del proyecto. Es la misma ruta que el botón del chat, pero el resultado
/// queda en el repo porque en el modo trabajo lo que se produce son archivos.
pub struct GenerateImageTool {
    motor: String,
    modelo: String,
    tamano: String,
}

impl GenerateImageTool {
    /// `None` cuando en Ajustes no hay motor elegido: sin motor no se ofrece la
    /// tool, porque el agente prometería un dibujo que solo puede fallar.
    pub fn desde_ajustes(s: &Settings) -> Option<Self> {
        if s.image_provider.trim().is_empty() {
            return None;
        }
        Some(Self {
            motor: s.image_provider.clone(),
            modelo: s.image_model.clone(),
            tamano: s.image_size.clone(),
        })
    }
}

/// La extensión del archivo va detrás de lo que devuelva el motor: pedir
/// `portada.png` y recibir un JPEG dejaría un archivo mentiroso en el repo.
fn con_extension(ruta: &str, media_type: &str) -> String {
    let base = match ruta.rfind('.') {
        Some(i) if i > ruta.rfind('/').unwrap_or(0) && i > ruta.rfind('\\').unwrap_or(0) => {
            &ruta[..i]
        }
        _ => ruta,
    };
    let ext = match media_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    };
    format!("{}.{ext}", base.trim_end_matches('.'))
}

#[async_trait]
impl AgentTool for GenerateImageTool {
    fn name(&self) -> &str {
        "generate_image"
    }

    fn description(&self) -> &str {
        "Genera una imagen con el motor de nube elegido en Ajustes (OpenAI o Gemini) y la \
         guarda dentro del proyecto. Sirve para portadas, iconos, texturas y maquetas. \
         Cuesta dinero y tarda varios segundos: úsalo solo cuando se pida una imagen \
         expresamente, nunca como adorno."
    }

    /// Alto: saca la descripción a internet y cobra. Con el nivel por defecto
    /// pasa por el modal de aprobación, donde se lee el prompt antes de gastar.
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::High
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "Qué dibujar, en una frase descriptiva" },
                "ruta": {
                    "type": "string",
                    "description": "Archivo dentro del proyecto, p. ej. «assets/portada.png». Si no se dice, «imagen.png» en la raíz."
                }
            },
            "required": ["prompt"]
        })
    }

    fn preview(&self, input: &Value, _project_root: &Path) -> String {
        format!(
            "Generar imagen con {} («{}»)",
            self.motor,
            input["prompt"].as_str().unwrap_or("?")
        )
    }

    async fn execute(&self, input: Value, project_root: &Path) -> Result<Value, ToolError> {
        let prompt = input["prompt"]
            .as_str()
            .filter(|p| !p.trim().is_empty())
            .ok_or_else(|| ToolError::Other("Falta el parámetro 'prompt'".into()))?;
        let pedida = input["ruta"]
            .as_str()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .unwrap_or("imagen.png");
        let destino = super::resolve_in_project(project_root, pedida)?;
        let generado = imagen::generar(&self.motor, &self.modelo, prompt, &self.tamano)
            .await
            .map_err(ToolError::Other)?;
        let ruta_final = con_extension(&destino.display().to_string(), &generado.media_type);
        let finalizada = Path::new(&ruta_final);
        if let Some(padre) = finalizada.parent() {
            std::fs::create_dir_all(padre).map_err(ToolError::Io)?;
        }
        std::fs::write(finalizada, &generado.bytes).map_err(ToolError::Io)?;
        Ok(json!({
            "ruta": ruta_final,
            "bytes": generado.bytes.len(),
            "medio": generado.media_type,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_motor_apuntado_no_hay_tool() {
        let mut s = Settings::default();
        s.image_provider = String::new();
        assert!(GenerateImageTool::desde_ajustes(&s).is_none());
        s.image_provider = "   ".into();
        assert!(GenerateImageTool::desde_ajustes(&s).is_none());
        s.image_provider = "gemini".into();
        assert!(GenerateImageTool::desde_ajustes(&s).is_some());
    }

    #[test]
    fn la_extension_sigue_lo_que_devuelve_el_motor() {
        assert_eq!(con_extension("assets/portada.png", "image/jpeg"), "assets/portada.jpg");
        assert_eq!(con_extension("logo", "image/webp"), "logo.webp");
        assert_eq!(con_extension("a.b.c.png", "image/png"), "a.b.c.png");
        // Un punto en una carpeta no es una extensión.
        assert_eq!(con_extension("v1.2/logo", "image/png"), "v1.2/logo.png");
    }

    #[test]
    fn es_de_riesgo_alto_y_el_preview_muestra_el_prompt() {
        let tool = GenerateImageTool {
            motor: "gemini".into(),
            modelo: "x".into(),
            tamano: "1024x1024".into(),
        };
        assert_eq!(tool.risk_level(), RiskLevel::High);
        let preview = tool.preview(&json!({ "prompt": "un gato" }), Path::new("/tmp"));
        assert_eq!(preview, "Generar imagen con gemini («un gato»)");
    }
}
