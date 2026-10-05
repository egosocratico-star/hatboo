//! Plantillas de comportamiento (Agent Skills): instrucciones que escribe el
//! usuario o que instala desde un `.md`. Seis comandos.
//!
//! No hay que confundir los dos nombres del repo: `crate::cerebro` es el puente al
//! crate `hatboo-brain`, y aquí no se llama a nada de eso. Lo que vive en este
//! módulo son las plantillas de Ajustes → Plantillas, que viajan en el *system
//! prompt* de cada turno.

use super::_comunes::ATTACHMENT_MAX_BYTES;
use crate::db;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

/// Lo que envía la interfaz para crear o editar una plantilla. Con `id` vacío se
/// crea una nueva; el resto de campos los normaliza `db::save_skill`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraft {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub enabled: bool,
}

#[tauri::command]
pub fn list_skills(app: State<AppState>) -> Result<Vec<db::Skill>, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::list_skills(&conn)
}

#[tauri::command]
pub fn save_skill(app: State<AppState>, skill: SkillDraft) -> Result<db::Skill, String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let draft = db::Skill {
        id: skill.id,
        name: skill.name,
        prompt: skill.prompt,
        enabled: skill.enabled,
        created_at: 0,
    };
    db::save_skill(&conn, &draft)
}

#[tauri::command]
pub fn set_skill_enabled(app: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::set_skill_enabled(&conn, &id, enabled)
}

#[tauri::command]
pub fn delete_skill(app: State<AppState>, id: String) -> Result<(), String> {
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    db::delete_skill(&conn, &id)
}

/// Nombre y texto de un archivo de plantilla. Acepta la cabecera que reparten
/// los ecosistemas de agentes (`---` con `name:` y `description:`), una primera
/// línea `# Título`, o ninguna de las dos.
fn parse_skill_markdown(crudo: &str, defecto: &str) -> (String, String) {
    let crudo = crudo.trim_start_matches('\u{feff}');
    let lineas: Vec<&str> = crudo.lines().collect();
    let mut nombre = String::new();
    let mut descripcion = String::new();
    let mut con_cabecera = false;
    let mut cuerpo = crudo.trim().to_string();

    if lineas.first().map(|l| l.trim()) == Some("---") {
        // La cabecera termina en el siguiente `---` a pelo.
        let fin = lineas[1..].iter().position(|l| matches!(l.trim(), "---" | "..."));
        if let Some(i) = fin {
            for linea in &lineas[1..=i] {
                let Some((clave, valor)) = linea.split_once(':') else { continue };
                let clave = clave.trim();
                let valor = valor.trim().trim_matches('"').trim().trim_matches('\'').trim();
                match clave {
                    "name" | "title" if nombre.is_empty() => nombre = valor.to_string(),
                    "description" => descripcion = valor.to_string(),
                    _ => {}
                }
            }
            cuerpo = lineas[i + 2..].join("\n").trim().to_string();
            con_cabecera = true;
        }
    }
    if nombre.is_empty() && !con_cabecera {
        // Sin cabecera, un `# Título` al principio hace de nombre.
        if let Some(titulo) = lineas.iter().map(|l| l.trim()).find(|l| !l.is_empty()) {
            if let Some(t) = titulo.strip_prefix("# ") {
                nombre = t.trim().to_string();
                cuerpo = cuerpo.strip_prefix(titulo).unwrap_or(&cuerpo).trim().to_string();
            }
        }
    }
    if nombre.is_empty() {
        nombre = defecto.to_string();
    }
    // La descripción dice CUÁNDO usar la plantilla; el cuerpo, QUÉ hacer. Los dos
    // van al prompt: separados se perdería el contexto de la instrucción.
    let texto = match (descripcion.is_empty(), cuerpo.is_empty()) {
        (true, true) => String::new(),
        (true, false) => cuerpo,
        (false, true) => descripcion,
        (false, false) => format!("{descripcion}\n\n{cuerpo}"),
    };
    (nombre.trim().to_string(), texto)
}

/// Instala una plantilla desde un archivo `.md` o desde la carpeta que la
/// contiene (`mi-plantilla/SKILL.md`, que es como se comparten). Si ya existe
/// una con el mismo nombre se actualiza: instalar dos veces no duplica.
#[tauri::command]
pub fn install_skill(app: State<AppState>, path: String) -> Result<db::Skill, String> {
    let ruta = PathBuf::from(&path);
    let archivo = if ruta.is_dir() {
        ["SKILL.md", "skill.md", "README.md"]
            .iter()
            .map(|n| ruta.join(n))
            .find(|p| p.is_file())
            .ok_or_else(|| "La carpeta no tiene un SKILL.md ni un README.md.".to_string())?
    } else {
        ruta.clone()
    };
    let crudo = std::fs::read_to_string(&archivo)
        .map_err(|e| format!("No se pudo leer «{}»: {e}", archivo.display()))?;
    if crudo.len() > ATTACHMENT_MAX_BYTES {
        return Err("El archivo es demasiado grande para ser una plantilla.".into());
    }
    let defecto = archivo
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| s != "SKILL" && s != "skill" && s != "README")
        .or_else(|| {
            archivo
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "Plantilla importada".to_string());
    let (nombre, prompt) = parse_skill_markdown(&crudo, &defecto);
    if prompt.trim().is_empty() {
        return Err("El archivo no trae instrucciones que instalar.".into());
    }
    let conn = app.db.lock().map_err(|e| e.to_string())?;
    let existente = db::list_skills(&conn)?
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(nombre.trim()));
    db::save_skill(
        &conn,
        &db::Skill {
            id: existente.map(|s| s.id).unwrap_or_default(),
            name: nombre,
            prompt,
            enabled: true,
            created_at: 0,
        },
    )
}

/// Devuelve una plantilla a un archivo `.md` para poder compartirla o
/// versionarla. Lo que se exporta se vuelve a instalar tal cual.
#[tauri::command]
pub fn export_skill(app: State<AppState>, id: String, path: String) -> Result<(), String> {
    let skill = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        db::list_skills(&conn)?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| "Esa plantilla ya no existe.".to_string())?
        };
    let mut lineas = String::from("---\n");
    lineas.push_str(&format!("name: {}\n", skill.name.replace('\n', " ")));
    lineas.push_str("---\n\n");
    lineas.push_str(&skill.prompt);
    lineas.push('\n');
    std::fs::write(PathBuf::from(&path), lineas)
        .map_err(|e| format!("No se pudo escribir «{path}»: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_skill_con_cabecera_se_instala_con_su_nombre_y_su_texto() {
        let crudo = "---\nname: Revisión de código\ndescription: Busca bugs graves primero\n---\n\n\
                     Cita archivo y línea.\nNo propongas cambios de estilo.\n";
        let (nombre, texto) = parse_skill_markdown(crudo, "SKILL");
        assert_eq!(nombre, "Revisión de código");
        assert_eq!(
            texto,
            "Busca bugs graves primero\n\nCita archivo y línea.\nNo propongas cambios de estilo."
        );
    }

    #[test]
    fn sin_cabecera_manda_el_titulo_y_si_no_el_nombre_del_archivo() {
        let (nombre, texto) = parse_skill_markdown("# Explicar paso a paso\n\nDi qué hace cada paso.", "SKILL");
        assert_eq!(nombre, "Explicar paso a paso");
        assert_eq!(texto, "Di qué hace cada paso.");

        let (otro, _) = parse_skill_markdown("solo instrucciones sueltas", "mi-plantilla");
        assert_eq!(otro, "mi-plantilla");
    }

    #[test]
    fn una_cabecera_sin_cerrar_no_se_comera_el_texto() {
        let (nombre, texto) = parse_skill_markdown("---\nname: roto\nsin cerrar", "defecto");
        assert_eq!(nombre, "defecto");
        assert_eq!(texto, "---\nname: roto\nsin cerrar");
    }

    #[test]
    fn exportar_e_instalar_devuelve_lo_mismo() {
        let (nombre, texto) = parse_skill_markdown("---\nname: Prueba\n---\n\nInstrucciones.", "x");
        let exportado = format!("---\nname: {nombre}\n---\n\n{texto}\n");
        let (nombre2, texto2) = parse_skill_markdown(&exportado, "x");
        assert_eq!(nombre2, nombre);
        assert_eq!(texto2, texto);
    }
}
