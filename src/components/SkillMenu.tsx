import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useChatStore } from "../store/chatStore";
import Popover from "./Popover";

interface Props {
  /** Insertar el texto de la plantilla donde esté el cursor. */
  onPick: (text: string) => void;
  disabled?: boolean;
  title?: string;
}

/** Menú de plantillas para los compositores que no tienen botón «+» (el modo
 *  trabajo). En el chat las plantillas viven dentro de ese menú «+». */
export default function SkillMenu({ onPick, disabled = false, title = "Plantillas" }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const skills = useChatStore((s) => s.skills);
  const close = () => setOpen(false);

  const item =
    "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:bg-base-raised rounded-lg transition-colors text-left";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        className="grid place-items-center w-8 h-8 shrink-0 rounded-lg border border-base-border text-zinc-400 hover:text-white hover:border-accent/50 disabled:opacity-40 transition-colors"
      >
        <Sparkles className="w-4 h-4" />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        width={256}
        cap={320}
        className="p-1.5"
      >
        <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          Plantillas
        </div>
        {skills.length === 0 ? (
          <div className={item + " opacity-45 cursor-not-allowed"} title="Créalas en Ajustes → Skills">
            <Sparkles className="w-4 h-4 text-zinc-500 shrink-0" />
            <span className="flex-1">Aún no hay plantillas</span>
          </div>
        ) : (
          skills.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onPick(s.prompt);
                close();
              }}
              className={item}
              title={
                s.enabled
                  ? `${s.prompt}\n\n(esta plantilla ya se aplica sola a cada respuesta)`
                  : s.prompt
              }
            >
              <Sparkles className="w-4 h-4 text-accent-soft shrink-0" />
              <span className="flex-1 truncate">{s.name}</span>
              {s.enabled && <span className="text-[10px] text-accent-soft/80">siempre</span>}
            </button>
          ))
        )}
      </Popover>
    </div>
  );
}
