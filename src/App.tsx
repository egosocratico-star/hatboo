import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import Settings from "./components/Settings";
import ProjectView from "./components/work/ProjectView";
import { useChatStore } from "./store/chatStore";
import { useWorkStore } from "./store/workStore";
import { useStreaming } from "./hooks/useStreaming";
import { useAgentEvents } from "./hooks/useAgentEvents";

export default function App() {
  const view = useChatStore((s) => s.view);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadSettings = useChatStore((s) => s.loadSettings);
  const loadProjects = useWorkStore((s) => s.loadProjects);

  useStreaming();
  useAgentEvents();

  useEffect(() => {
    void loadConversations();
    void loadSettings();
    void loadProjects();
  }, [loadConversations, loadSettings, loadProjects]);

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-full flex bg-base text-zinc-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        {view === "work" ? <ProjectView /> : <ChatWindow />}
      </main>
      {view === "settings" && <Settings />}
    </div>
  );
}
