//! Lo que usan varios dominios a la vez: los helpers que viajaban sueltos
//! en `commands.rs`. Ninguna función de aquí se registra en `lib.rs`.

use crate::state;

/// Título corto a partir del primer mensaje. Cortar por caracteres dejaba
/// «lee a.txt y luego b.txt y dime…» partido a media palabra.
///
/// `pub(crate)` porque lo llaman dos dominios en tres sitios —`chat` al renombrar
/// y al enviar, `agent` al arrancar una sesión de trabajo—: era privado de un solo
/// archivo y ahora es privado de la carpeta.
pub(crate) fn titulo_breve(texto: &str) -> String {
    let limpio: String = texto.split_whitespace().collect::<Vec<_>>().join(" ");
    if limpio.chars().count() <= 34 {
        return limpio;
    }
    let corte = limpio
        .char_indices()
        .take_while(|(i, _)| *i < 34)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(34);
    let mut cabeza = &limpio[..corte];
    if let Some((ultimo, _)) = cabeza.match_indices(' ').next_back() {
        // Solo se queda con la palabra anterior si no deja un título ridículo.
        if ultimo > 12 {
            cabeza = &cabeza[..ultimo];
        }
    }
    format!("{}…", cabeza.trim_end())
}

/// Máximo de bytes que se leen de un archivo adjunto de texto (M2).
///
/// `pub(crate)`: lo mide el «+» de `files`, pero también lo comprueba `install_skill`
/// (`cerebro`) para no leerse un libro como plantilla.
pub(crate) const ATTACHMENT_MAX_BYTES: usize = 200_000;

/// Borra del disco las imágenes referenciadas (ignora errores: pueden faltar).
///
/// `pub(crate)`: lo mismo que borra `delete_conversation` y `clear_conversation_messages`
/// (`chat`) es lo que borra el reintento de un dibujo (`models`) y el de un proyecto
/// (`projects`).
pub(crate) fn remove_image_files(paths: Vec<String>) {
    for p in paths {
        let _ = std::fs::remove_file(p);
    }
}

/// Prompt de sistema del modo código. También lo usa el agente del modo trabajo,
/// para que el chip «Código» signifique lo mismo en las dos vistas.
pub(crate) const CODE_MODE_PROMPT: &str = "Modo código activo: responde como ingeniero senior. Ve directo \
 al código que funciona, sin preámbulos. Entrega bloques completos y ejecutables, indica la ruta \
 del archivo cuando sea relevante y señala las suposiciones que hagas. Si hay un error, explica \
 la causa raíz en una línea antes del arreglo. Prefiere la solución más simple y las dependencias \
 que ya existen en el proyecto antes de proponer nuevas.";

/// El *system prompt* del chat normal, sin efectos secundarios: lo arma
/// `spawn_chat_stream` (en `chat/stream.rs`) y lo mide `context_usage` para el
/// indicador de contexto.
///
/// Tres bloques con las cabeceras siempre iguales. Antes de esta estructura el
/// prompt podía quedarse vacío, y la única frase que mencionaba un nombre era
/// «el usuario prefiere que lo llames Azrael»: un modelo de 0,8B se presentaba
/// como Azrael porque no había nada que le dijera quién era él. Por eso el
/// nombre del usuario va en su propio bloque, lejos de la identidad.
/// Las plantillas activas van al final: si chocan con el modo código, gana lo
/// que el usuario escribió a mano.
pub(crate) fn chat_system_prompt(settings: &state::Settings, skills: &str, memoria: &str) -> String {
    let nombre = settings.assistant_name.trim();
    let trato = if settings.user_address.trim().eq_ignore_ascii_case("usted") {
        "usted"
    } else {
        "tú"
    };
    let idioma = match settings.answer_language.as_str() {
        "es" => "español",
        "en" => "inglés",
        _ => "el mismo idioma en que te escriba",
    };
    let quien = if nombre.is_empty() {
        "Es el usuario de esta máquina; no tiene nombre guardado.".to_string()
    } else {
        format!("Se llama «{nombre}»: úsalo para dirigirte a él, nunca para presentarte.")
    };
    let notas = if settings.user_notes.trim().is_empty() {
        String::new()
    } else {
        format!("Nota del usuario: {}\n", settings.user_notes.trim())
    };
    // Lo que puede mirar: la búsqueda es un prerrecorrido que se inyecta arriba
    // como mensaje de sistema, no una tool que llama él. Decirlo tal cual evita
    // que prometa «déjame buscar» cuando la búsqueda está apagada.
    let busqueda = if settings.web_search {
        "Búsqueda web: activada. Cuando la pregunta pide un dato actual, Hatboo ya \
         busca antes de responderte y te pasa los resultados en un bloque de sistema \
         con sus direcciones: úsalos y cítalos."
    } else {
        "Búsqueda web: apagada por el usuario. No tienes cómo mirar en internet ahora \
         mismo, así que lo que digas de actualidad sale de memoria y conviene decirlo."
    };
    let hoy = crate::behavior::hoy(settings.tz_offset_min);
    let mut system = format!(
        "## Asistente\n\
         Eres Hatboo, el asistente de escritorio del usuario. Tu nombre es Hatboo y no \
         cambia nunca; el nombre de abajo es el del usuario, no el tuyo. Si te preguntan \
         cómo te llamas, respondes «Soy Hatboo».\n\n\
         {conducta}\n\n\
         {chat}\n\n\
         ## Usuario\n\
         {quien}\n\
         Trátalo de {trato}.\n\
         Responde en {idioma}.\n\
         {notas}{memoria}\
         \n## Esta sesión\n\
         Hoy es {hoy}.\n\
         Tipo: chat (sin proyecto abierto).\n\
         {busqueda}\n",
        conducta = crate::behavior::CONDUCTA,
        chat = crate::behavior::CONDUCTA_CHAT,
    );
    if settings.code_mode {
        system.push_str(CODE_MODE_PROMPT);
    }
    system.push_str(skills);
    system
}

#[cfg(test)]
mod tests {
    use super::*;


        #[test]
        fn el_nombre_del_usuario_no_es_el_del_asistente() {
            let aj = state::Settings {
                assistant_name: "Azrael".into(),
                ..Default::default()
            };
            let p = chat_system_prompt(&aj, "", "");
            assert!(p.contains("Eres Hatboo"));
            assert!(p.contains("Se llama «Azrael»"));
            assert!(p.contains("«Soy Hatboo»"));
            assert!(p.contains("## Esta sesión"));
            // El nombre del usuario no puede aparecer en su propio bloque de identidad.
            let asistente = p.split("## Usuario").next().unwrap();
            assert!(!asistente.contains("Azrael"), "{asistente}");
        }

        #[test]
        fn el_chat_pide_responder_corto_y_sin_relleno() {
            let p = chat_system_prompt(&state::Settings::default(), "", "");
            assert!(p.contains("Cómo hablas:"), "{p}");
            assert!(p.contains("sin preámbulos"));
            assert!(p.contains("Breve por defecto"));
            // El estilo va en el bloque del asistente: si cayera debajo de «## Usuario»,
            // un modelo pequeño lo leería como una preferencia del usuario y lo negocia.
            let asistente = p.split("## Usuario").next().unwrap();
            assert!(asistente.contains("Cómo hablas:"), "{asistente}");
        }

        #[test]
        fn el_chat_sabe_la_fecha_y_lo_que_puede_mirar() {
            let por_defecto = chat_system_prompt(&state::Settings::default(), "", "");
            // Sin fecha no hay forma de contestar a «ayer» ni de buscar con el año
            // bien: es lo que hacía alucinar fechas a los modelos locales.
            assert!(por_defecto.contains("Hoy es "), "{por_defecto}");
            assert!(por_defecto.contains("Búsqueda web: apagada"), "{por_defecto}");
            // Y deja claro que aquí no toca archivos, para que no lo finja.
            assert!(
                por_defecto.contains("no tienes herramientas de disco"),
                "{por_defecto}"
            );

            let aj = state::Settings {
                web_search: true,
                ..Default::default()
            };
            let con_busqueda = chat_system_prompt(&aj, "", "");
            assert!(con_busqueda.contains("Búsqueda web: activada"));
            assert!(!con_busqueda.contains("Búsqueda web: apagada"));
        }

        #[test]
        fn trato_idioma_y_nota_llegan_al_bloque_de_usuario() {
            let aj = state::Settings {
                user_address: "usted".into(),
                answer_language: "en".into(),
                user_notes: "Estudio programación.".into(),
                ..Default::default()
            };
            let p = chat_system_prompt(&aj, "", "");
            assert!(p.contains("Trátalo de usted."));
            assert!(p.contains("Responde en inglés."));
            assert!(p.contains("Nota del usuario: Estudio programación."));

            let por_defecto = chat_system_prompt(&state::Settings::default(), "", "");
            assert!(por_defecto.contains("Trátalo de tú."));
            assert!(!por_defecto.contains("Nota del usuario"));
            // Sin nombre guardado tampoco queda un hueco raro.
            assert!(por_defecto.contains("no tiene nombre guardado"));
        }

        #[test]
        fn el_titulo_corta_por_palabra_y_sin_saltos() {
            assert_eq!(titulo_breve("hola\n\t¿qué tal?"), "hola ¿qué tal?");
            assert_eq!(titulo_breve("   espaciado   sucio   "), "espaciado sucio");
            assert_eq!(
                titulo_breve("lee a.txt y luego b.txt y dime cuántas líneas tiene cada uno"),
                "lee a.txt y luego b.txt y dime…"
            );
            // Un texto sin espacios no se puede partir por palabra: se corta igual.
            assert_eq!(titulo_breve(&"x".repeat(80)).chars().count(), 35);
            assert_eq!(titulo_breve(""), "");
        }

        /// Ruta 1 de `benchmarks/fase0.md` §7: el arnés de Fase 0 emula la puerta de la
        /// app, y para eso necesita el system prompt real. Copiado a mano se deriva en
        /// cuanto toque una de las capas, así que se vuelca desde el código:
        /// `HATBOO_VOLCAR_PROMPT=1 cargo test --lib volcar_system_prompt`.
        /// Sin la variable esta prueba no hace nada (no escribe ni falla en la batería).
        #[test]
        fn volcar_system_prompt_para_el_arnes() {
            let Some(destino) = std::env::var("HATBOO_VOLCAR_PROMPT").ok() else {
                return;
            };
            let aj = state::Settings::default();
            let raiz = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
            let chat = chat_system_prompt(&aj, "", "");
            let agente = crate::agent::loop_runner::system_prompt(
                raiz,
                &crate::agent::loop_runner::PromptDeSistema::default(),
            );
            let texto = format!(
                "# System prompt de Hatboo, volcado desde el código\n\n\
                 Generado por `volcar_system_prompt_para_el_arnes` (src-tauri/src/commands.rs), {hecho}.\n\n\
                 **Es una copia y puede derivar.** Si cambia el código, se vuelve a generar con:\n\
                 `HATBOO_VOLCAR_PROMPT=1 cargo test --manifest-path src-tauri/Cargo.toml --lib volcar_system_prompt`\n\n\
                 Ni una de las dos versiones lleva tools, historial de sesión, skills ni\n\
                 `memoria_prompt`: los tres argumentos se pasan vacíos a propósito, para que\n\
                 la línea base sea la del chat pelado de la app. El prompt de agente además\n\
                 lista el CONTENIDO DEL DIRECTORIO de `src-tauri` porque esa es la raíz que se\n\
                 le pasó: en otro proyecto el listing cambia y el prefill también.\n\n\
                 ## Chat (`chat_system_prompt`)\n\n```\n{chat}\n```\n\n\
                 ## Agente (`system_prompt`)\n\n```\n{agente}\n```\n",
                hecho = crate::behavior::hoy(aj.tz_offset_min),
            );
            std::fs::write(&destino, texto).expect("el volcado tiene que escribirse");
        }
}
