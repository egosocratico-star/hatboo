import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import TitleBar from "./components/TitleBar";
import ChatWindow from "./components/ChatWindow";
import Settings from "./components/Settings";
import SearchOverlay from "./components/SearchOverlay";
import PantallaCarga, { type Paso } from "./components/PantallaCarga";
import ProjectView from "./components/work/ProjectView";
import ProjectsView from "./components/work/ProjectsView";
import CreateProjectModal from "./components/work/CreateProjectModal";
import { useChatStore } from "./store/chatStore";
import { useWorkStore } from "./store/workStore";
import { useStreaming } from "./hooks/useStreaming";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { applyMotion, applyTheme, watchSystemTheme } from "./theme";
import { setLanguage, t, useT } from "./i18n";

/** Lo que se lee de disco al abrir, en el orden en que se lee. No es una lista
 *  decorativa: cada línea se marca cuando su carga termina de verdad. */
const PASOS_ARRANQUE: Paso[] = [
  { id: "ajustes", etiqueta: "Tus ajustes", listo: false },
  { id: "chats", etiqueta: "Tus conversaciones", listo: false },
  { id: "proyectos", etiqueta: "Tus proyectos", listo: false },
  { id: "plantillas", etiqueta: "Tus plantillas", listo: false },
  { id: "borradores", etiqueta: "Lo que dejaste a medias", listo: false },
];

/** Lo mismo al cerrar: hay trabajo pendiente que se hace antes de matar la
 *  ventana, y mientras se hace la pantalla lo dice. */
const PASOS_CIERRE: Paso[] = [
  { id: "detener", etiqueta: "Terminar lo que estaba en marcha", listo: false },
  { id: "guardar", etiqueta: "Guardar lo escrito sin enviar", listo: false },
];

/**
 * Suelo de tiempo que se ven las dos pantallas. Lo que cada una lista es trabajo
 * que se hace de verdad, pero en un disco limpio termina en doscientos
 * milisegundos y la pantalla parpadea sin dar tiempo a leerla — peor que no
 * tenerla. El suelo es eso: tiempo mínimo en pantalla, no carga fingida.
 */
const MUESTRA_MIN_MS = 1500;
const MUESTRA_CIERRE_MIN_MS = 1200;

/** Cumple el mínimo desde `desde` sin esperar de más si ya se pasó. */
function hastaElMinimo(desde: number, min: number) {
  const restante = min - (Date.now() - desde);
  return restante > 0
    ? new Promise<void>((resolver) => setTimeout(resolver, restante))
    : Promise.resolve();
}

/**
 * Cierra el capítulo de espera si `ms` pasan sin que la promesa responda. Solo se
 * usa al apagar: un `invoke` colgado ahí abajo dejaría la pantalla de «Cerrando
 * Hatboo» para siempre sobre una app que no se va. Vale perderse el último paso de
 * guardado; no vale dejarlo encerrado.
 */
function conReloj(p: Promise<unknown>, ms: number) {
  return Promise.race([
    p.catch(() => {}),
    new Promise<void>((resolver) => setTimeout(resolver, ms)),
  ]);
}

export default function App() {
  // Toda la app se re-renderiza al cambiar el idioma: `t()` se llama durante el
  // render, así que sin este suscriptor el cambio no se vería hasta recargar.
  useT();
  const view = useChatStore((s) => s.view);
  const theme = useChatStore((s) => s.settings?.theme ?? "dark");
  const idioma = useChatStore((s) => s.settings?.uiLanguage ?? "system");
  const motion = useChatStore((s) => s.settings?.motion ?? "system");
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadSettings = useChatStore((s) => s.loadSettings);
  const loadSkills = useChatStore((s) => s.loadSkills);
  const loadProjects = useWorkStore((s) => s.loadProjects);
  const openProjectPath = useWorkStore((s) => s.openProjectPath);
  const [arrastrando, setArrastrando] = useState(false);
  const [pasos, setPasos] = useState(PASOS_ARRANQUE);
  const [listo, setListo] = useState(false);
  const [pasosCierre, setPasosCierre] = useState(PASOS_CIERRE);
  const [cerrando, setCerrando] = useState(false);
  // El aviso de cierre puede llegar dos veces (el botón de la barra y Alt+F4);
  // un estado de React no vale porque el listener se montó con el de siempre.
  const cerrandoRef = useRef(false);

  // Soltar una carpeta encima de la ventana la abre como proyecto: es el gesto
  // que explica «un proyecto es una carpeta» mejor que cualquier botón.
  useEffect(() => {
    let vivo = true;
    const registro = getCurrentWebview().onDragDropEvent((e) => {
      if (!vivo) return;
      const payload = e.payload;
      if (payload.type === "enter" || payload.type === "over") setArrastrando(true);
      else if (payload.type === "leave") setArrastrando(false);
      else if (payload.type === "drop") {
        setArrastrando(false);
        if (payload.paths.length === 0) return;
        // El reparto lo hace el backend, que es quien puede mirar el disco: una
        // carpeta sigue abriendo proyecto y un archivo se va al mensaje.
        void invoke<{ carpetas: string[]; archivos: string[] }>("clasifica_soltadas", {
          paths: payload.paths,
        })
          .then(({ carpetas, archivos }) => {
            const [primera] = carpetas;
            if (primera) void openProjectPath(primera);
            if (archivos.length > 0) useChatStore.setState({ soltados: archivos });
          })
          .catch(() => {});
      }
    });
    return () => {
      vivo = false;
      void registro.then(( parar ) => parar());
    };
  }, [openProjectPath]);

  useStreaming();
  useAgentEvents();

  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyMotion(motion);
  }, [motion]);

  useEffect(() => {
    setLanguage(idioma);
  }, [idioma]);

  useEffect(() => {
    let vivo = true;
    const desde = Date.now();
    const marca = (id: string) =>
      vivo && setPasos((p) => p.map((s) => (s.id === id ? { ...s, listo: true } : s)));
    // Un fallo leyendo una tabla no puede dejar la app encerrada en la pantalla
    // de carga: se marca igual y el ErrorBoundary ya hará lo suyo después.
    const tarea = (id: string, promesa: Promise<unknown>) =>
      promesa.catch(() => {}).then(() => marca(id));
    void (async () => {
      // Ajustes primero: de él salen el tema, el idioma y el movimiento, y
      // pintar la app con los valores por defecto para corregirla un momento
      // después es exactamente el parpadeo que esta pantalla viene a quitar.
      await tarea("ajustes", loadSettings());
      await Promise.all([
        tarea("chats", loadConversations()),
        tarea("proyectos", loadProjects()),
        tarea("plantillas", loadSkills()),
        tarea("borradores", useChatStore.getState().loadDrafts()),
      ]);
      await hastaElMinimo(desde, MUESTRA_MIN_MS);
      if (vivo) setListo(true);
    })();
    // Red de seguridad: si algo se colgara, la app abre igualmente a los 10 s.
    const rescate = window.setTimeout(() => vivo && setListo(true), 10000);
    return () => {
      vivo = false;
      window.clearTimeout(rescate);
    };
    // Una sola vez: es el arranque, no un efecto que deba repetirse.
  }, [loadConversations, loadSettings, loadSkills, loadProjects]);

  useEffect(() => {
    const ventana = getCurrentWindow();
    const registro = ventana.onCloseRequested(async (e) => {
      e.preventDefault();
      if (cerrandoRef.current) return;
      cerrandoRef.current = true;
      const desde = Date.now();
      setCerrando(true);
      const marca = (id: string) =>
        setPasosCierre((p) => p.map((s) => (s.id === id ? { ...s, listo: true } : s)));
      const chat = useChatStore.getState();
      const trabajo = useWorkStore.getState();
      // Lo primero es lo que sigue escribiendo: si no se detiene aquí, el stream
      // o el agente quedan trabajando contra una ventana que ya se cierra.
      if (chat.status === "streaming") await conReloj(chat.stopStreaming(), 2500);
      const tab = trabajo.activeProjectId ? trabajo.tabs[trabajo.activeProjectId] : undefined;
      if (tab && (tab.agentStatus === "running" || tab.agentStatus === "awaiting")) {
        await conReloj(trabajo.cancelTask(), 2500);
      }
      marca("detener");
      await conReloj(chat.flushDrafts(), 2500);
      marca("guardar");
      await hastaElMinimo(desde, MUESTRA_CIERRE_MIN_MS);
      try {
        await ventana.destroy();
      } catch {
        // Si la ventana no se apaga, quedarse encerrado en esta pantalla sería
        // peor que el fallo: se vuelve atrás para que el siguiente intento
        // (los pasos ya están hechos) lo intente de nuevo.
        cerrandoRef.current = false;
        setCerrando(false);
      }
    });
    return () => {
      void registro.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        const v = useChatStore.getState().view;
        if (e.key === "Escape" && (v === "settings" || v === "projects")) {
          useChatStore.getState().setView("chat");
        }
        // F5 recarga la vista —y con ella vuelve la pantalla de arranque—; F12
        // abre las herramientas de Chromium. Ninguna de las dos es de Hatboo.
        if (e.key === "F5" || e.key === "F12") e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      if (e.shiftKey && (key === "i" || key === "j")) {
        // Inspector y consola, por la otra vía.
        e.preventDefault();
        return;
      }
      // Las teclas del navegador: recargar, guardar la página, abrir archivo,
      // ver el código fuente, ir a la barra de direcciones. Cada una delataba que
      // esto «es una web». Sin Mayús: con Mayús son atajos propios de la app.
      if (!e.shiftKey && !e.altKey && ["r", "s", "o", "u", "g"].includes(key)) {
        e.preventDefault();
        return;
      }
      if (key === "n") {
        e.preventDefault();
        void useChatStore.getState().newConversation();
      } else if (key === ",") {
        e.preventDefault();
        useChatStore.getState().setView("settings");
      } else if (key === "f") {
        // La tecla SIEMPRE se reclama aquí: si no, WebView2 abre su propia barra
        // «Buscar en la página», que desentona con la app y no busca en la
        // conversación. El buscador vive en la cabecera del chat, que solo
        // existe si hay mensajes.
        e.preventDefault();
        const { view, messages } = useChatStore.getState();
        if (view === "chat" && messages.length > 0) {
          useChatStore.getState().openFinder();
        }
      } else if (key === "k") {
        e.preventDefault();
        const s = useChatStore.getState();
        s.setSearchOpen(!s.searchOpen);
      } else if (key === "p") {
        // Idem con el diálogo de imprimir de Chromium: no es una app de páginas.
        // Con Mayús es el selector de proyectos, libre por lo mismo.
        e.preventDefault();
        if (e.shiftKey) useChatStore.getState().setView("projects");
      } else if (key === "b") {
        e.preventDefault();
        const s = useChatStore.getState();
        s.patchSettings({ sidebarCompact: !(s.settings?.sidebarCompact ?? false) });
      } else if (e.key === ".") {
        // Modo foco del workspace; solo tiene sentido con la vista de trabajo
        // abierta, que es donde está el botón para salir.
        e.preventDefault();
        const s = useChatStore.getState();
        if (s.view === "work") s.patchSettings({ focusMode: !(s.settings?.focusMode ?? false) });
      }
    };
    const menu = (e: MouseEvent) => {
      // El botón derecho sacaba el menú de Chromium (Atrás, Actualizar, Guardar
      // como, Imprimir, Inspeccionar). Donde Hatboo tiene menú propio ya lo pide
      // él. En un campo de texto se deja el del sistema, que es donde se pega.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", menu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", menu);
    };
  }, []);

  // Los dos estados que sustituyen a la interfaz entera: mientras se carga no
  // hay vista que mostrar, y al cerrar tampoco debe quedar la anterior detrás.
  if (cerrando) {
    return (
      <PantallaCarga
        titulo={t("Cerrando Hatboo")}
        pasos={pasosCierre}
        pie={t("Terminando de guardar antes de apagar.")}
      />
    );
  }
  if (!listo) {
    return (
      <PantallaCarga
        titulo="Hatboo"
        pasos={pasos}
        pie={t("Leyendo lo que hay en este equipo.")}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-base text-zinc-100 overflow-clip">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <ErrorBoundary zona={t("la barra lateral")}>
          <Sidebar />
        </ErrorBoundary>
        <main className="flex-1 min-w-0 flex flex-col">
          {view === "work" ? (
            <ErrorBoundary zona={t("el modo trabajo")}>
              <ProjectView />
            </ErrorBoundary>
          ) : view === "projects" ? (
            <ErrorBoundary zona={t("la página de proyectos")}>
              <ProjectsView />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary zona={t("el chat")}>
              <ChatWindow />
            </ErrorBoundary>
          )}
        </main>
        {view === "settings" && (
          <ErrorBoundary zona={t("los ajustes")}>
            <Settings />
          </ErrorBoundary>
        )}
      </div>
      <SearchOverlay />
      <CreateProjectModal />
      {arrastrando && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-8">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-base-card px-8 py-6 text-center">
            <p className="text-base font-medium">{t("Suelta aquí lo que quieras añadir")}</p>
            <p className="mt-1 text-sm text-zinc-400">
              {t("Una carpeta se abre como proyecto; un archivo va al mensaje.")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
