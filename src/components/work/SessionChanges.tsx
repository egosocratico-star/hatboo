import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileDiff, FilePlus2, FilePen, Undo2 } from "lucide-react";
import Popover from "../Popover";
import Vacio from "../Vacio";
import ConfirmModal, { type AvisoBorrado } from "../ConfirmModal";
import DiffView, { ArchivoCompleto } from "../DiffView";

interface Cambio {
  ruta: string;
  diff: string;
  creado: boolean;
  escrituras: number;
}

/** Lo que devuelve `preview_project_file`. */
interface Previa {
  texto: string;
  bytes: number;
  lineas: number;
  truncado: boolean;
}

/** Lo que aparece en el aviso antes de deshacer: ocho rutas y un recuento. */
function listaDeCambios(cambios: Cambio[]): string {
  const primeros = cambios.slice(0, 8).map((c) => `· ${c.ruta}`);
  const restantes = cambios.length - primeros.length;
  if (restantes > 0) {
    primeros.push(
      restantes === 1
        ? t("· y 1 archivo más")
        : t("· y {n} archivos más", { n: restantes })
    );
  }
  return primeros.join("\n");
}

/** Frase con lo que el deshacer devolvió de verdad. */
function resumenDeDeshacer(rutas: string[]): string {
  if (rutas.length === 0) {
    return t("No había respaldos de esta sesión: no se tocó nada.");
  }
  const primeros = rutas.slice(0, 6);
  const restantes = rutas.length - primeros.length;
  const lista =
    primeros.join(", ") + (restantes > 0 ? t(" y {n} más", { n: restantes }) : "");
  return rutas.length === 1
    ? t("Devolvió 1 archivo: {lista}", { lista })
    : t("Devolvió {n} archivos: {lista}", { n: rutas.length, lista });
}

/**
 * Un archivo tocado en la sesión: su ruta, si nació o se modificó, y el diff con
 * el que se aplica el cambio. «Verlo entero» lee el archivo que hay ahora mismo
 * en disco, que es el estado final después de todas las escrituras.
 */
function FilaCambio({ projectId, cambio }: { projectId: string; cambio: Cambio }) {
  const [entero, setEntero] = useState(false);
  const [archivo, setArchivo] = useState<Previa | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  // Se vuelve a leer cada vez que se pide, en vez de guardarse: el agente puede
  // escribir otra vez sobre el mismo archivo mientras el popover está abierto.
  const carga = () => {
    if (entero) {
      setEntero(false);
      return;
    }
    void invoke<Previa>("preview_project_file", {
      projectId,
      relativePath: cambio.ruta,
    }).then(
      (p) => {
        setArchivo(p);
        setEntero(true);
        setFallo(null);
      },
      (e) => setFallo(String(e)),
    );
  };

  return (
    <div className="rounded-lg border border-base-border overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-base text-[11px]">
        {cambio.creado ? (
          <FilePlus2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
        ) : (
          <FilePen className="w-3.5 h-3.5 shrink-0 text-amber-400" />
        )}
        <span className="font-mono truncate text-zinc-200">{cambio.ruta}</span>
        <span className="ml-auto shrink-0 text-zinc-500">
          {cambio.creado ? t("nuevo") : t("modificado")}
          {cambio.escrituras > 1 ? t(" · {n} escrituras", { n: cambio.escrituras }) : ""}
        </span>
        <button
          onClick={carga}
          className="shrink-0 rounded border border-base-border px-1 py-px text-[10px] text-zinc-500 transition-colors hover:bg-base-hover hover:text-zinc-200"
        >
          {entero ? t("Ver el diff") : t("Verlo entero")}
        </button>
      </div>
      <div className="p-1.5">
        {entero && archivo ? (
          <ArchivoCompleto texto={archivo.texto} altoMax={220} />
        ) : cambio.diff ? (
          <DiffView diff={cambio.diff} altoMax={200} corte={80} />
        ) : (
          <p className="px-1 py-1 text-[11px] text-zinc-500">{t("(sin diff)")}</p>
        )}
        {fallo && <p className="mt-1 text-[10px] text-red-300">{fallo}</p>}
        {entero && archivo?.truncado && (
          <p className="mt-1 text-[10px] text-zinc-500">{t("Se enseña el principio: el archivo es más grande que la vista previa.")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Lo que el agente escribió en esta sesión de trabajo. Sale de los diffs que ya
 * se guardaron al aplicar cada `write_file`, así que funciona también en
 * proyectos que no son repo de git. Si el archivo se escribió varias veces se
 * muestra el último diff, que es el estado final.
 */
export default function SessionChanges({
  conversationId,
  projectId,
  recargarCon,
}: {
  conversationId: string | null;
  projectId: string;
  /** Algo que cambia cuando el agente termina: fuerza a volver a leer. */
  recargarCon: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [cambios, setCambios] = useState<Cambio[]>([]);
  const [aviso, setAviso] = useState<AvisoBorrado | null>(null);
  /** Lo que respondió `deshace_sesion`, para enseñarlo donde estaba la lista. */
  const [devuelto, setDevuelto] = useState<string | null>(null);
  /** Se suma al deshacer para releer la lista, se haya cerrado o no el panel. */
  const [vuelve, setVuelve] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    let vivo = true;
    void invoke<Cambio[]>("session_changes", { conversationId }).then(
      (c) => vivo && setCambios(c),
      () => vivo && setCambios([])
    );
    return () => {
      vivo = false;
    };
  }, [open, conversationId, recargarCon, vuelve]);

  const total = cambios.length;

  // El respaldo lo hizo `write_file` antes de pisar; deshacer es devolver cada
  // archivo a ese estado y borrar lo que la sesión creó de la nada.
  const pideDeshacer = () => {
    if (!conversationId) return;
    setAviso({
      title: t("¿Deshacer lo que hizo esta sesión?"),
      body: [
        t("Cada archivo vuelve a como estaba antes de que Hatboo lo tocara:"),
        listaDeCambios(cambios),
        t("Los que la sesión creó se borran. No se toca ningún otro archivo."),
      ].join("\n\n"),
      confirmLabel: t("Deshacer"),
      onConfirm: () => {
        void invoke<string[]>("deshace_sesion", { conversationId }).then(
          (r) => setDevuelto(resumenDeDeshacer(r)),
          (e) => setDevuelto(String(e))
        );
        setVuelve((v) => v + 1);
        setOpen(true);
      },
    });
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => {
          setDevuelto(null);
          setOpen((v) => !v);
        }}
        title={
          total === 0
            ? t("Aún no has escrito archivos en esta sesión")
            : total === 1
              ? t("{n} archivo escrito en esta sesión", { n: total })
              : t("{n} archivos escritos en esta sesión", { n: total })
        }
        className={`flex h-[26px] min-w-[26px] items-center justify-center gap-1 rounded-md px-1 text-[11px] transition-colors ${
          total > 0
            ? "bg-accent/10 text-accent-soft hover:bg-accent/20"
            : "text-zinc-500 hover:bg-base-hover hover:text-zinc-200"
        }`}
      >
        <FileDiff className="w-3.5 h-3.5 shrink-0" />
        {total > 0 && <span className="tabular-nums">{total}</span>}
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={560}
        cap={560}
        className="p-3 space-y-2"
      >
        <p className="text-xs font-medium text-zinc-200">
          {t("Cambios de esta sesión")}
        </p>
        {devuelto && (
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-200">
            {devuelto}
          </p>
        )}
        {total === 0 ? (
          <Vacio
            icon={FileDiff}
            titulo={t("El agente todavía no escribió ningún archivo aquí.")}
            detalle={t("Cuando lo haga verás la ruta, si es nuevo o modificado y el diff, con el botón para deshacer la sesión.")}
          />
        ) : (
          cambios.map((c) => (
            <FilaCambio key={c.ruta} projectId={projectId} cambio={c} />
          ))
        )}
        {total > 0 && (
          <div className="pt-2 border-t border-base-border">
            <button
              onClick={pideDeshacer}
              title={t("Devuelve cada archivo a como estaba antes de esta sesión")}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200 transition-colors hover:border-red-500 hover:bg-red-500/20"
            >
              <Undo2 className="w-3.5 h-3.5 shrink-0" />
              {t("Deshacer sesión")}
            </button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              {t("Solo devuelve lo que la sesión pudo respaldar al escribir; no toca ningún otro archivo.")}
            </p>
          </div>
        )}
      </Popover>

      <ConfirmModal aviso={aviso} cerrar={() => setAviso(null)} />
    </div>
  );
}
