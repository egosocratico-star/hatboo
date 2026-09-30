import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { aplicarSlash, opciones, raizSlash, type Raiz } from "../slash";
import type { Skill } from "../types";

/** Lo que devuelve: el compositor lo usa en `onChange`, en `onKeyDown` y para
 *  pintar la lista. Se comparten así los dos compositores (chat y trabajo). */
export interface Slash {
  abierto: boolean;
  lista: Skill[];
  indice: number;
  onTexto: (texto: string, caret: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  elegir: (skill: Skill) => void;
  cerrar: () => void;
}

/** `/` en el compositor abre la lista de plantillas. La regla de cuándo abre y
 *  qué sustituye vive en `src/slash.ts` y se prueba con `npm run prueba-slash`. */
export function useSlashSkills(opts: {
  skills: Skill[];
  caja: RefObject<HTMLTextAreaElement | null>;
  poner: (texto: string) => void;
}): Slash {
  const { skills, caja, poner } = opts;
  const [raiz, setRaiz] = useState<Raiz | null>(null);
  const [indice, setIndice] = useState(0);
  const lista = useMemo(() => opciones(skills, raiz), [skills, raiz]);
  // Con la raiz puesta pero nada que casar no se pinta nada: una caja vacía
  // flotando sobre el compositor parece un fallo.
  const abierto = raiz !== null && lista.length > 0;

  const cerrar = () => setRaiz(null);

  const onTexto = (texto: string, caret: number) => {
    setRaiz(raizSlash(texto, caret));
    setIndice(0);
  };

  const elegir = (skill: Skill) => {
    const el = caja.current;
    if (!el || !raiz) return;
    // Se lee el valor del DOM, no el del estado: recién pulsado el Enter, el
    // estado todavía puede ir una escritura por detrás.
    const { texto, caret } = aplicarSlash(el.value, el.selectionStart, raiz, skill.prompt);
    setRaiz(null);
    poner(texto);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  /** `true` = la tecla era de la lista y el compositor no debe seguir con la suya
   *  (el Enter de enviar, sobre todo). */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!abierto) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setIndice((i) => (i + paso + lista.length) % lista.length);
      return true;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      elegir(lista[Math.min(indice, lista.length - 1)]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
      return true;
    }
    return false;
  };

  return { abierto, lista, indice, onTexto, onKeyDown, elegir, cerrar };
}
