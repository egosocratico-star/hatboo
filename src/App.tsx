import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import Settings from "./components/Settings";
import SearchOverlay from "./components/SearchOverlay";
import ProjectView from "./components/work/ProjectView";
import { useChatStore } from "./store/chatStore";
import { useWorkStore } from "./store/workStore";
import { useStreaming } from "./hooks/useStreaming";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { applyMotion, applyTheme, applyVibrancy, watchSystemTheme } from "./theme";
import { setLanguage, useT } from "./i18n";

export default function App() {
  // Toda la app se re-renderiza al cambiar el idioma: `t()` se llama durante el
  // render, así que sin este suscriptor el cambio no se vería hasta recargar.
  useT();
  const view = useChatStore((s) => s.view);
  const theme = useChatStore((s) => s.settings?.theme ?? "dark");
  const idioma = useChatStore((s) => s.settings?.uiLanguage ?? "system");
  const motion = useChatStore((s) => s.settings?.motion ?? "system");
  const transparency = useChatStore((s) => s.settings?.windowTransparency ?? false);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadSettings = useChatStore((s) => s.loadSettings);
  const loadSkills = useChatStore((s) => s.loadSkills);
  const loadProjects = useWorkStore((s) => s.loadProjects);

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

  // Después del de `theme`: necesita el `data-theme` ya resuelto para elegir el
  // tinte de Mica, y se vuelve a llamar al cambiar de tema con la ventana translúcida.
  useEffect(() => {
    applyVibrancy(transparency);
  }, [transparency, theme]);

  useEffect(() => {
    void loadConversations();
    void loadSettings();
    void loadSkills();
    void loadProjects();
  }, [loadConversations, loadSettings, loadSkills, loadProjects]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === "Escape" && useChatStore.getState().view === "settings") {
          useChatStore.getState().setView("chat");
        }
        return;
      }
      const key = e.key.toLowerCase();
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
        e.preventDefault();
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-full flex bg-base text-zinc-100 overflow-clip">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        {view === "work" ? <ProjectView /> : <ChatWindow />}
      </main>
      {view === "settings" && <Settings />}
      <SearchOverlay />
    </div>
  );
}
