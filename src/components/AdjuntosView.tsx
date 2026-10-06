import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, Image as IconoImagen, Paperclip, Search } from "lucide-react";
import { t, useT } from "../i18n";
import { fmtDate, grupoDeFecha, haceRelativo } from "../time";
import { useChatStore } from "../store/chatStore";
import Insignia from "./Insignia";
import Vacio from "./Vacio";
import { CAMPO } from "./modalUi";

/** `db::Adjunto`, que viaja en camelCase. */
interface Adjunto {
  id: string;
  nombre: string;
  esImagen: boolean;
  mediaType: string | null;
  archivo: string | null;
  adelanto: string;
  mensajeId: string;
  rol: string;
  creadoEn: number;
  conversacionId: string;
  titulo: string;
}

interface Pagina {
  adjuntos: Adjunto[];
  hayMas: boolean;
}

/** Mensajes con adjuntos que se leen. Es un recorrido de tabla sin índice
 *  posible —la columna es JSON—, así que tiene techo y la pantalla lo dice. */
const LIMITE_MENSAJES = 300;

const URI_CACHE = new Map<string, string>();

/**
 * La miniatura de una imagen. Los bytes no están en la BD: se piden con
 * `attachment_image`, que canonicaliza y exige que la ruta siga dentro de
 * `attachments/`. Si ya no está, se dice en la fila en vez de dejar un hueco.
 */
function Miniatura({ archivo }: { archivo: string }) {
  const [uri, setUri] = useState<string | null>(URI_CACHE.get(archivo) ?? null);
  const [perdido, setPerdido] = useState(false);

  useEffect(() => {
    if (uri) return;
    let vivo = true;
    void invoke<string>("attachment_image", { file: archivo }).then(
      (u) => {
        URI_CACHE.set(archivo, u);
        if (vivo) setUri(u);
      },
      () => {
        if (vivo) setPerdido(true);
      },
    );
    return () => {
      vivo = false;
    };
  }, [archivo, uri]);

  if (perdido) {
    return (
      <span
        title={t("Ya no está en la carpeta de adjuntos de Hatboo.")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-base-border text-micro text-zinc-600"
      >
        ?
      </span>
    );
  }
  if (!uri) {
    return <span className="h-10 w-10 shrink-0 animate-pulse rounded-md border border-base-border/60 bg-base-raised" />;
  }
  return (
    <img
      src={uri}
      alt=""
      className="h-10 w-10 shrink-0 rounded-md border border-base-border object-cover"
    />
  );
}

/**
 * Lo que el usuario subió, con la conversación de origen. No es un gestor de
 * archivos: no se puede borrar un adjunto suelto ni desde aquí ni desde ningún
 * sitio, así que la pantalla no ofrece esa acción y lo dice en el subtítulo.
 */
export default function AdjuntosView() {
  useT();
  const [pagina, setPagina] = useState<Pagina>({ adjuntos: [], hayMas: false });
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const setView = useChatStore((s) => s.setView);
  const selectConversation = useChatStore((s) => s.selectConversation);

  const cargar = useCallback(() => {
    void invoke<Pagina>("list_attachments", { limite: LIMITE_MENSAJES }).then(
      (p) => {
        setPagina(p);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, []);

  useEffect(cargar, [cargar]);

  const q = filtro.trim().toLowerCase();
  const visibles = useMemo(
    () =>
      q
        ? pagina.adjuntos.filter(
            (a) =>
              a.nombre.toLowerCase().includes(q) || a.titulo.toLowerCase().includes(q),
          )
        : pagina.adjuntos,
    [pagina.adjuntos, q],
  );

  /** Un encabezado por cajón del calendario, en el orden en que vienen. */
  const grupos = useMemo(() => {
    const out: Array<{ nombre: string; filas: Adjunto[] }> = [];
    for (const a of visibles) {
      const nombre = grupoDeFecha(a.creadoEn);
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.nombre === nombre) ultimo.filas.push(a);
      else out.push({ nombre, filas: [a] });
    }
    return out;
  }, [visibles]);

  const abrir = (id: string) => {
    setView("chat");
    void selectConversation(id);
  };

  return (
    <>
      <header className="border-b border-base-border pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{t("Adjuntos")}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t("Lo que subiste al chat, con la conversación de la que salió.")}
            </p>
            <p className="mt-1 text-etiqueta leading-relaxed text-zinc-600">
              {t(
                "Las imágenes se guardan en disco y el texto, ya extraído. Se van al borrar el mensaje o la conversación: no hay forma de quitar un adjunto suelto.",
              )}
            </p>
          </div>
          <Insignia
            cuadrada
            title={
              pagina.hayMas
                ? t("La lista corta en los mensajes más recientes; hay más detrás.")
                : t("Todos los adjuntos que encuentra la lista.")
            }
          >
            {visibles.length}
          </Insignia>
        </div>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder={t("Buscar por archivo o conversación…")}
            className={`${CAMPO} pl-8`}
          />
        </label>
        {error && (
          <p className="mt-2 text-etiqueta text-red-400">
            {t("No se pudo leer la lista:")} {error}
          </p>
        )}
      </header>

      {visibles.length === 0 && !error && (
        <div className="pt-4">
          <Vacio
            icon={Paperclip}
            titulo={
              q ? t("Nada coincide con lo que escribiste.") : t("Todavía no subiste nada.")
            }
            detalle={
              q
                ? t("Prueba con el nombre del archivo o con el título de la conversación.")
                : t("El clip del compositor adjunta archivos de texto e imágenes.")
            }
          />
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.nombre} className="pt-4">
          <h3 className="px-1 pb-1 text-micro uppercase tracking-wider text-zinc-600">
            {g.nombre}
          </h3>
          <ul className="overflow-hidden rounded-xl border border-base-border">
            {g.filas.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 border-b border-base-border/60 bg-base px-3 py-2 last:border-b-0"
              >
                {a.esImagen && a.archivo ? (
                  <Miniatura archivo={a.archivo} />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-base-border bg-base-raised">
                    <FileText className="h-4 w-4 text-zinc-500" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-ui font-medium text-zinc-200" title={a.nombre}>
                      {a.nombre}
                    </p>
                    <Insignia cuadrada>
                      {a.esImagen ? t("imagen") : t("texto")}
                    </Insignia>
                  </div>
                  {a.adelanto && (
                    <p className="mt-0.5 line-clamp-2 text-etiqueta leading-snug text-zinc-500">
                      {a.adelanto}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-etiqueta text-zinc-600">
                    <button
                      type="button"
                      onClick={() => abrir(a.conversacionId)}
                      className="truncate underline decoration-base-border underline-offset-2 hover:text-zinc-300"
                      title={a.titulo}
                    >
                      {a.titulo}
                    </button>
                    <span title={fmtDate(a.creadoEn)}>{haceRelativo(a.creadoEn)}</span>
                  </div>
                </div>
                {a.esImagen && (
                  <IconoImagen className="h-3.5 w-3.5 shrink-0 text-zinc-700" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {pagina.hayMas && visibles.length > 0 && (
        <p className="pt-3 text-etiqueta text-zinc-600">
          {t(
            "La lista corta en los mensajes con adjuntos más recientes; puede haber más antiguos detrás.",
          )}
        </p>
      )}
    </>
  );
}
