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

  return (
    <div className="h-full flex bg-base text-zinc-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        {view === "settings" ? <Settings /> : view === "work" ? <ProjectView /> : <ChatWindow />}
      </main>
    </div>
  );
}
