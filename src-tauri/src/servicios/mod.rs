//! Los servicios de Hatboo: lo que el comando no debe saber hacer él mismo.
//!
//! La capa IPC (`crate::commands`) existe para recibir un `invoke`, traducirlo a
//! una llamada y devolver el resultado. Todo lo que sea **mirar el mundo** —la
//! base de datos para armar el contexto del prompt, un `HTTP` propio, un archivo
//! escrito en disco— vive aquí, con sus pruebas y sin necesitar la pantalla ni
//! Ollama ni la red.
//!
//! Un servicio no sustituye a la capa de datos: llama a `crate::db`, que es quien
//! sabe de SQL. Lo que no puede hacer ya ningún comando es abrir ese mundo por su
//! cuenta con un criterio propio.
//!
//! - [`contexto`] recoge el material del *system prompt* con un solo lock y con el
//!   Trust Gate puesto; es lo que impide que las reglas del proyecto se aprueben
//!   dos veces con dos criterios distintos.
//! - [`modelo`] es la ruta proveedor + modelo + base url, y el único HTTP que
//!   quedaba suelto en la capa IPC.
//! - [`agente`] y [`captura`]: el arranque de una tarea, el deshacer de una sesión
//!   y lo que toca disco.
//! - [`archivo`], [`adjuntos`], [`proyecto`] y [`plantillas`]: el disco de la capa
//!   IPC. Después del bloque C ningún comando abría `reqwest` ni escribía SQL; con
//!   estos cuatro tampoco abre `std::fs`. Cada uno recibe la carpeta o la raíz que
//!   el comando ya sacó de la base de datos, y devuelve lo que hay que devolver,
//!   con los mensajes literales de siempre.

pub mod adjuntos;
pub mod agente;
pub mod archivo;
pub mod captura;
pub mod contexto;
pub mod modelo;
pub mod plantillas;
pub mod proyecto;
