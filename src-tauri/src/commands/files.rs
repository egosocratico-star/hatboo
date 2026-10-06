//! Archivos y adjuntos: la puerta del «+», el árbol del proyecto, su buscador y
//! su vista previa.
//!
//! Nueve comandos, y ninguno toca disco. Todo lo que había de `std::fs` aquí —el
//! `read_dir` del árbol, el `read` de la vista previa y del adjunto, el
//! `create_dir_all` + `write` de la imagen, el `metadata` de la tarjeta y el
//! recorrido del buscador— se fue a [`crate::servicios::archivo`] y a
//! [`crate::servicios::adjuntos`], siguiendo el precedente de
//! [`crate::servicios::captura`]: el servicio recibe la carpeta de destino o la
//! raíz del proyecto y devuelve lo que hay que devolver, con los mensajes de error
//! exactos.
//!
//! Lo que sigue siendo del comando es lo que solo la app sabe: **de qué proyecto**
//! se habla —la raíz sale de la base de datos, con un solo lock— y **dónde** guarda
//! Hatboo sus adjuntos (`data_dir/attachments`). El candado de rutas viaja con la
//! función: `resolve_in_project` sigue validando contra la raíz, `image_data_uri`
//! sigue exigiendo que la ruta canonicalizada empiece por la carpeta de adjuntos
//! antes de leer, y `fetch_github` sigue restringiendo hosts y sin seguir
//! redirecciones desde [`crate::servicios::modelo`].

use crate::db;
use crate::servicios::archivo::{self, FileEntry, FileMeta, Soltadas, VistaPrevia};
use crate::state::{self, AppState};
use std::path::PathBuf;
use tauri::State;

// ---------- Metadatos de archivos del proyecto ----------

/// Tamaño y fecha de un archivo del proyecto, para la tarjeta que sale bajo la
/// respuesta que lo escribió. La ruta llega RELATIVA y el servicio la valida
/// contra la raíz del proyecto como cualquier otra ruta del agente: un «../» que
/// salga fuera se rechaza sin tocar disco.
#[tauri::command]
pub fn file_meta(
    app: State<AppState>,
    project_id: String,
    ruta: String,
) -> Result<FileMeta, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    archivo::file_meta(&root, &ruta)
}

/// Lee un archivo elegido por el usuario para adjuntarlo a un mensaje. Es la
/// puerta única del «+»: una imagen se guarda y se referencia como payload de
/// visión; lo demás se lee como texto, con truncado para no comerse la ventana de
/// contexto. Antes había dos opciones en el menú y dos comandos para lo mismo.
#[tauri::command]
pub fn read_attachment(
    app: State<'_, AppState>,
    path: String,
) -> Result<db::Attachment, String> {
    archivo::read_attachment(&app.data_dir.join("attachments"), &path)
}

/// Lo que se soltó encima de la ventana, repartido: las carpetas son proyectos (el
/// gesto de siempre) y los archivos van al mensaje que se está escribiendo. Sin
/// este reparto, soltar un .png intentaba abrirlo como proyecto y contestaba un
/// error.
#[tauri::command]
pub fn clasifica_soltadas(paths: Vec<String>) -> Soltadas {
    archivo::clasifica_soltadas(paths)
}

/// Lee un archivo de GitHub como contexto de texto, sin clonar el repo.
/// Es solo lectura y solo hacia github.com; lo que se obtiene entra por la misma
/// ruta que un archivo adjunto del disco.
///
/// La lista de hosts, el cliente sin redirecciones y la cabecera `raw` no están
/// aquí: viven en [`crate::servicios::modelo`], que es el único sitio con HTTP de
/// la app fuera de los proveedores. El comando registra el nombre que invocaba el
/// frontend y traduce, nada más.
#[tauri::command]
pub async fn fetch_github(url: String) -> Result<db::Attachment, String> {
    crate::servicios::modelo::ModelService::adjunto_de_github(&url).await
}

/// Captura la pantalla principal y la guarda como imagen adjunta, para enseñar
/// un error o una maqueta sin tener que guardar el archivo antes. Sale por el
/// mismo camino que una imagen elegida del disco: `data_dir/attachments` y
/// referencia en el mensaje, nunca el binario en SQLite.
///
/// `xcap`, el codificador PNG y la escritura del archivo no están aquí: viven en
/// [`crate::servicios::captura`], que recibe la carpeta de destino y devuelve la
/// ruta escrita. Al comando le queda lo que es suyo: el `Attachment` que pide el
/// frontend.
#[tauri::command]
pub fn capture_screen(app: State<AppState>, nombre: String) -> Result<db::Attachment, String> {
    let destino = crate::servicios::captura::capturar_pantalla(&app.data_dir.join("attachments"))?;
    Ok(db::Attachment {
        name: crate::servicios::captura::nombre_de_archivo(&nombre),
        text: String::new(),
        image_media_type: Some("image/png".to_string()),
        image_file: Some(destino.display().to_string()),
    })
}

/// Devuelve una imagen adjunta como data URI para poder pintarla en la burbuja.
/// La ruta llega desde la BD —y tras una importación ese JSON es ajeno—, así que
/// se canonicaliza y se exige que siga dentro de `attachments/` antes de leer.
#[tauri::command]
pub fn attachment_image(app: State<AppState>, file: String) -> Result<String, String> {
    archivo::image_data_uri(&app.data_dir.join("attachments"), &file)
}

/// Lista un nivel del árbol de archivos del proyecto (ruta relativa; "" = raíz).
///
/// Se saltan las carpetas de `ignore_dirs`, la MISMA lista que usan `list_dir` y
/// `search_files` del agente: si el panel las enseña, el agente las ve, y si no,
/// tampoco las busca. Con `Documentos` como raíz era lo que más se notaba.
#[tauri::command]
pub fn list_project_dir(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<Vec<FileEntry>, String> {
    // Antes de bloquear la conexión: `load_settings` usa el mismo mutex.
    let ignoradas = state::load_settings(&app).ignore_dirs;
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    archivo::list_project_dir(&root, &relative_path, &ignoradas)
}

/// El texto de un archivo del proyecto para verlo en el panel, sin añadirlo al
/// mensaje. Pasa por el mismo candado de rutas que las herramientas del agente.
#[tauri::command]
pub fn preview_project_file(
    app: State<AppState>,
    project_id: String,
    relative_path: String,
) -> Result<VistaPrevia, String> {
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    archivo::preview_project_file(&root, &relative_path)
}

/// Busca archivos por nombre (sin distinguir mayúsculas) dentro del proyecto.
/// `dentro`, si viene, es una carpeta del proyecto y el recorrido arranca y se
/// para ahí («buscar aquí» en el árbol). Las rutas que salen siguen siendo
/// relativas a la raíz del proyecto: es lo que entienden la vista previa y el
/// «añadir al mensaje», y lo que el árbol abre sin tener que traducir nada.
///
/// El recorrido va a un hilo de bloqueo —puede tocar decenas de miles de entradas
/// y el runtime de Tauri no puede pararse aquí— y la validación de `dentro` contra
/// la raíz del proyecto viaja con él, dentro de
/// [`archivo::search_project_files`].
#[tauri::command]
pub async fn search_project_files(
    app: State<'_, AppState>,
    project_id: String,
    query: String,
    dentro: Option<String>,
) -> Result<Vec<String>, String> {
    // Antes de bloquear la conexión: `load_settings` usa el mismo mutex.
    let ignoradas = state::load_settings(&app).ignore_dirs;
    let root = {
        let conn = app.db.lock().map_err(|e| e.to_string())?;
        PathBuf::from(db::get_project(&conn, &project_id)?.root_path)
    };
    tauri::async_runtime::spawn_blocking(move || {
        archivo::search_project_files(&root, &query, dentro.as_deref(), &ignoradas)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // Las pruebas siguen en este archivo porque es el escenario que montan (una
    // carpeta temporal con sus archivos). Lo único que cambió es la ruta de la
    // función llamada: ahora vive en `servicios::archivo`.
    use crate::servicios::archivo::{
        buscar_por_niveles, image_data_uri, leer_vista_previa, Presupuesto, PREVIEW_MAX_BYTES,
    };

        /// Carpeta de adjuntos desechable con un PNG minúsculo dentro.
        fn dir_con_imagen() -> PathBuf {
            let dir = std::env::temp_dir().join(format!("hatboo-img-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let mut f = std::fs::File::create(dir.join("foto.png")).unwrap();
            f.write_all(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
            dir
        }

        #[test]
        fn sirve_como_data_uri_una_imagen_de_la_carpeta() {
            let dir = dir_con_imagen();
            let file = dir.join("foto.png").display().to_string();
            let uri = image_data_uri(&dir, &file).unwrap();
            assert!(uri.starts_with("data:image/png;base64,"));
            assert!(uri.contains("iVBORw0KGgo"));
            std::fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn rechaza_rutas_de_fuera_de_la_carpeta_de_adjuntos() {
            let dir = dir_con_imagen();
            let fuera = std::env::temp_dir().join("hatboo-fuera.png");
            std::fs::write(&fuera, b"x").unwrap();
            // Escapando con .. y también con una ruta absoluta directa.
            assert!(image_data_uri(&dir, "../../hatboo-fuera.png").is_err());
            assert!(image_data_uri(&dir, &fuera.display().to_string()).is_err());
            // Y lo que no existe o no es imagen.
            assert!(image_data_uri(&dir, "no-existe.png").is_err());
            std::fs::write(dir.join("nota.txt"), b"x").unwrap();
            assert!(image_data_uri(&dir, &dir.join("nota.txt").display().to_string()).is_err());
            std::fs::remove_dir_all(&dir).ok();
            std::fs::remove_file(&fuera).ok();
        }

        #[test]
        fn lo_soltado_reparte_carpetas_y_archivos() {
            // Soltar una carpeta abre un proyecto; soltar un archivo va al mensaje.
            // Si las dos cosas siguen el mismo camino, la segunda contesta un error
            // que no significa nada.
            let raiz = std::env::temp_dir().join(format!("hatboo-soltar-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&raiz).unwrap();
            let archivo = raiz.join("nota.md");
            std::fs::write(&archivo, b"hola").unwrap();

            let repartidas = clasifica_soltadas(vec![
                raiz.display().to_string(),
                archivo.display().to_string(),
            ]);
            assert_eq!(repartidas.carpetas, vec![raiz.display().to_string()]);
            assert_eq!(repartidas.archivos, vec![archivo.display().to_string()]);

            // Una ruta que ya no existe cuenta como archivo, no como carpeta: el
            // lector dirá lo que pasa en vez de abrir un proyecto a medias.
            let ido = clasifica_soltadas(vec![raiz.join("borrado.md").display().to_string()]);
            assert!(ido.carpetas.is_empty() && ido.archivos.len() == 1);

            let _ = std::fs::remove_dir_all(&raiz);
        }

        #[test]
        fn una_carpeta_enorme_no_le_roba_el_presupuesto_a_sus_vecinas() {
            // El fallo real en `Documentos`: 200 notas en la primera subcarpeta
            // bastaban para que el recorrido no llegara a mirar la del lado.
            let raiz = std::env::temp_dir().join(format!("hatboo-busca-{}", uuid::Uuid::new_v4()));
            let vault = raiz.join("aaa-vault");
            let facturas = raiz.join("b-facturas");
            std::fs::create_dir_all(&vault).unwrap();
            std::fs::create_dir_all(&facturas).unwrap();
            for i in 0..200 {
                std::fs::write(vault.join(format!("nota-{i}.md")), b"x").unwrap();
            }
            std::fs::write(facturas.join("factura-2026.pdf"), b"x").unwrap();

            let hits = buscar_por_niveles(
                &raiz,
                &raiz,
                "factura",
                &Presupuesto {
                    total: 40,
                    por_carpeta: 5,
                },
                &crate::agent::ignore::por_defecto(),
            );
            assert_eq!(hits, vec!["b-facturas/factura-2026.pdf".to_string()]);

            // Y lo que se salta a propósito no vuelve: el presupuesto se nota.
            assert!(buscar_por_niveles(
                &raiz,
                &raiz,
                "nota-199",
                &Presupuesto {
                    total: 40,
                    por_carpeta: 5,
                },
                &crate::agent::ignore::por_defecto()
            )
            .is_empty());
            std::fs::remove_dir_all(&raiz).ok();
        }

        #[test]
        fn buscar_aqui_sale_en_relativo_a_la_raiz_del_proyecto() {
            // «Buscar aquí» recorta el recorrido a la subcarpeta, pero lo que devuelve
            // tiene que seguir siendo relativo a la raíz del proyecto: la vista previa
            // y el «añadir al mensaje» reciben eso, y una ruta relativa a la subcarpeta
            // se abriría en el sitio equivocado (o no se abriría).
            let raiz = std::env::temp_dir().join(format!("hatboo-aqui-{}", uuid::Uuid::new_v4()));
            let dentro = raiz.join("papel/2026");
            std::fs::create_dir_all(&dentro).unwrap();
            std::fs::create_dir_all(raiz.join("otro")).unwrap();
            std::fs::write(dentro.join("factura.pdf"), b"x").unwrap();
            std::fs::write(raiz.join("otro/factura-vieja.pdf"), b"x").unwrap();
            let p = Presupuesto {
                total: 500,
                por_carpeta: 100,
            };
            let sin_recorte = buscar_por_niveles(&raiz, &raiz, "factura", &p, &[]);
            assert_eq!(sin_recorte.len(), 2);

            let aqui = buscar_por_niveles(&raiz, &dentro, "factura", &p, &[]);
            assert_eq!(aqui, vec!["papel/2026/factura.pdf".to_string()]);
            std::fs::remove_dir_all(&raiz).ok();
        }

        #[test]
        fn el_buscador_del_arbol_se_salt_lo_que_salta_el_rbol() {
            // La regla del plan: árbol, búsqueda y `list_dir` usan UNA lista. Antes el
            // buscador tenía la suya y el árbol ninguna, así que `node_modules` se veía
            // y no se encontraba (o al revés según la carpeta).
            let raiz = std::env::temp_dir().join(format!("hatboo-ignoradas-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(raiz.join("node_modules")).unwrap();
            std::fs::create_dir_all(raiz.join("papel")).unwrap();
            std::fs::write(raiz.join("node_modules/factura.js"), b"x").unwrap();
            std::fs::write(raiz.join("papel/factura.txt"), b"x").unwrap();
            let p = Presupuesto {
                total: 500,
                por_carpeta: 100,
            };

            let con_lista =
                buscar_por_niveles(&raiz, &raiz, "factura", &p, &crate::agent::ignore::por_defecto());
            assert_eq!(con_lista, vec!["papel/factura.txt".to_string()]);

            // Y una carpeta propia que él añada en Ajustes se salta igual; `dist` no
            // está en la lista vacía, así que aparece.
            let sin_lista = buscar_por_niveles(&raiz, &raiz, "factura", &p, &[]);
            assert_eq!(sin_lista.len(), 2);
            let solo_dist = buscar_por_niveles(&raiz, &raiz, "factura", &p, &["dist".to_string()]);
            assert_eq!(solo_dist.len(), 2);
            std::fs::remove_dir_all(&raiz).ok();
        }

        #[test]
        fn la_vista_previa_corta_y_no_muerde_binarios() {
            let dir = std::env::temp_dir().join(format!(
                "hatboo-previa-{}-{}",
                std::process::id(),
                std::time::UNIX_EPOCH
                    .elapsed()
                    .map(|d| d.subsec_nanos())
                    .unwrap_or(0)
            ));
            std::fs::create_dir_all(&dir).unwrap();

            let grande = dir.join("grande.txt");
            let mut f = std::fs::File::create(&grande).unwrap();
            f.write_all(&vec![b'x'; PREVIEW_MAX_BYTES + 10]).unwrap();
            drop(f);
            let v = leer_vista_previa(&grande).unwrap();
            assert!(v.truncado, "un archivo mayor que el tope debe decirlo");
            assert_eq!(v.texto.len(), PREVIEW_MAX_BYTES);
            assert_eq!(v.bytes as usize, PREVIEW_MAX_BYTES + 10);
            assert_eq!(v.lineas, 1);

            let corto = dir.join("corto.txt");
            std::fs::write(&corto, "uno\ndos\n").unwrap();
            let c = leer_vista_previa(&corto).unwrap();
            assert!(!c.truncado);
            assert_eq!(c.lineas, 2);
            assert_eq!(c.bytes, 8);

            let binario = dir.join("foto.bin");
            std::fs::write(&binario, [0xFF_u8, 0x00, 0x10]).unwrap();
            assert!(leer_vista_previa(&binario).is_err());

            std::fs::remove_dir_all(&dir).ok();
        }
}
