"""Aplica el pulido del chat vacío sobre src/components/ChatWindow.tsx."""
from pathlib import Path

p = Path("src/components/ChatWindow.tsx")
s = p.read_text(encoding="utf-8")
old_composer = 'className="rounded-tarjeta border border-base-border bg-base-card shadow-flotante px-3 pt-3 pb-2.5 transition-colors focus-within:border-accent/50"'
new_composer = 'className="hatboo-composer rounded-entrada border border-base-border bg-base-card px-3 pt-3 pb-2.5 transition-colors focus-within:border-accent/55"'
if old_composer not in s:
    raise SystemExit("composer: ya aplicado o el archivo cambió")
s = s.replace(old_composer, new_composer, 1)

old_empty = """        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pb-20">
          <div className="flex flex-col items-center gap-3">
            <Mascot state={mascotState} size={132} />
            <div className="flex flex-col items-center gap-1.5">
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight">"""
new_empty = """        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-8">
          <div className="flex flex-col items-center gap-2.5">
            <Mascot state={mascotState} size={108} />
            <div className="flex flex-col items-center gap-1">
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight">"""
if old_empty not in s:
    raise SystemExit("empty header: ya aplicado o el archivo cambió")
s = s.replace(old_empty, new_empty, 1)

s = s.replace(
    '<p className="text-sm text-zinc-400">',
    '<p className="max-w-xl text-center text-[13px] leading-relaxed text-zinc-500">',
    1,
)
s = s.replace(
    '<div className="w-full max-w-3xl space-y-3">',
    '<div className="w-full max-w-2xl space-y-3">',
    1,
)
s = s.replace(
    """            <div className="pt-1">
              <SuggestionGrid
                items={SUGERENCIAS}
                onPick={(s) => {
                  setInput(s);
                  inputRef.current?.focus();
                }}
              />
            </div>""",
    """            <SuggestionGrid
              compact
              items={SUGERENCIAS}
              onPick={(s) => {
                setInput(s);
                inputRef.current?.focus();
              }}
            />""",
    1,
)
p.write_text(s, encoding="utf-8")
print("ok")
