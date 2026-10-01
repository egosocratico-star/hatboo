import {
  BrainCircuit,
  Cloud,
  Feather,
  Gem,
  HardDrive,
  Route,
  type LucideIcon,
} from "lucide-react";
import type { LocalModel, ProviderId, Settings } from "./types";

/** Campo de `Settings` donde cada proveedor apunta su modelo. */
export type CampoModelo =
  | "anthropicModel"
  | "openaiModel"
  | "openrouterModel"
  | "geminiModel"
  | "hfModel"
  | "localModel";

export interface Proveedor {
  id: ProviderId;
  /** Nombre largo, el de la tarjeta de Ajustes. Se pinta con `t()`. */
  label: string;
  /** Nombre corto, el del chip del selector. Son marcas: se escriben igual en
   *  los dos idiomas y no pasan por el diccionario. */
  corto: string;
  icono: LucideIcon;
  /** Una línea sobre qué es y cómo se paga. Se pinta con `t()`. */
  resumen: string;
  needsKey: boolean;
  modelo: CampoModelo;
  /** Base editable en Ajustes. Los de base fija no lo llevan. */
  endpoint?: "hfEndpoint" | "localEndpoint";
  /** Pista de formato para el campo de modelo. */
  ejemplo?: string;
  /** Ayuda bajo el campo de modelo del proveedor activo. Se pinta con `t()`. */
  ayudaModelo?: string;
}

/** Añadir un proveedor es añadir una fila aquí y su rama en `state.rs`. */
export const PROVEEDORES: readonly Proveedor[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    corto: "Anthropic",
    icono: Feather,
    resumen: "Claude, de pago por uso. Fuerte en código largo.",
    needsKey: true,
    modelo: "anthropicModel",
  },
  {
    id: "openai",
    label: "OpenAI",
    corto: "OpenAI",
    icono: BrainCircuit,
    resumen: "GPT, de pago por uso. Herramientas fiables.",
    needsKey: true,
    modelo: "openaiModel",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    corto: "OpenRouter",
    icono: Route,
    resumen: "Una sola clave para cientos de modelos, también gratuitos.",
    needsKey: true,
    modelo: "openrouterModel",
    ejemplo: "openai/gpt-4o-mini",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    corto: "Gemini",
    icono: Gem,
    resumen: "Gemini, de Google: contexto enorme y capa gratuita.",
    needsKey: true,
    modelo: "geminiModel",
    ejemplo: "gemini-2.0-flash",
  },
  {
    id: "hf",
    label: "Hugging Face (nube)",
    corto: "Hugging Face",
    icono: Cloud,
    resumen: "Modelos abiertos tras el router de Hugging Face.",
    needsKey: true,
    modelo: "hfModel",
    endpoint: "hfEndpoint",
    ejemplo: "Qwen/Qwen3-8B",
    ayudaModelo: "El catálogo con buscador está en el chip del modelo, junto al compositor.",
  },
  {
    id: "local",
    label: "Local (Ollama / llama.cpp)",
    corto: "Local",
    icono: HardDrive,
    resumen: "En este PC: nada sale de tu equipo.",
    needsKey: false,
    modelo: "localModel",
    endpoint: "localEndpoint",
  },
];

/** Nombre corto por id. Cubre todos los ids de `ProviderId`. */
export const CORTOS: Record<ProviderId, string> = Object.fromEntries(
  PROVEEDORES.map((p) => [p.id, p.corto]),
) as Record<ProviderId, string>;

function datos(id: ProviderId): Proveedor | undefined {
  return PROVEEDORES.find((p) => p.id === id);
}

/** Campo de `Settings` donde este proveedor guarda su modelo. */
export function campoModelo(id: ProviderId): CampoModelo {
  return datos(id)?.modelo ?? "localModel";
}

/** Modelo apuntado en un proveedor concreto. */
export function modeloDe(s: Settings, id: ProviderId): string {
  return s[campoModelo(id)];
}

/** El modelo que responde ahora mismo. */
export function modeloActivo(s: Settings): string {
  return modeloDe(s, s.activeProvider);
}

/** Pistas de nombre para los que ven imágenes: la única señal cuando Ollama no
 *  declara capacidades (versiones antiguas) o cuando el modelo vive en un router
 *  —OpenRouter, Hugging Face— que reparte entre motores que no conocemos.
 *  «vl» vale por su cuenta porque cubre `internvl`, `bakuvl`, `kimi-vl`, `glm-4v`
 *  y los `qwen-*-vl`. Lo que no esté aquí NO se niega: en Ajustes → API hay un
 *  interruptor por modelo, porque negarle a alguien una capacidad que su modelo
 *  sí tiene es peor que preguntar. */
const CLAVES_VISION = [
  "vl",
  "vision",
  "visual",
  "multimodal",
  "llava",
  "pixtral",
  "minicpm",
  "moondream",
  "gemma-3",
  "gemma3",
  "phi-3.5-v",
  "phi-4-multimodal",
  "llama-4",
  "kimi",
  "omni",
  "mplug",
  "nvita",
];

/** Si ÉL declaró que este modelo ve imágenes (Ajustes → API). */
export function visionDeclarada(s: Settings, modelo: string): boolean {
  const m = modelo.trim().toLowerCase();
  if (!m) return false;
  return (s.visionModelos ?? []).some((x) => x.trim().toLowerCase() === m);
}

/** De dónde sale el «sí» (o el «no») de la visión. Importa decirlo: un «sí» por
 *  el nombre es una suposición, y un «no» porque no se leyó Ollama no es un
 *  límite del modelo. §III.9 del Brain: el dato real manda sobre la estimación. */
export type MotivoVision = "declarado" | "ollama" | "gama" | "nombre" | "sin-dato";

export function motivoVision(
  settings: Settings | null,
  locales: LocalModel[] | null,
): MotivoVision {
  if (!settings) return "sin-dato";
  const activo = modeloActivo(settings);
  if (visionDeclarada(settings, activo)) return "declarado";
  // Anthropic, OpenAI y Gemini ven imágenes en toda su gama.
  if (
    settings.activeProvider === "anthropic" ||
    settings.activeProvider === "openai" ||
    settings.activeProvider === "gemini"
  ) {
    return "gama";
  }
  if (settings.activeProvider === "local") {
    const m = locales?.find((x) => x.name === settings.localModel);
    if (m && m.capabilities.length > 0) {
      return m.capabilities.includes("vision") ? "ollama" : "sin-dato";
    }
    // Lista no leída, o un servidor que no declara (llama.cpp, LM Studio): ahí
    // el nombre es lo único que hay, y si tampoco dice nada, se confiesa.
    return CLAVES_VISION.some((k) => activo.toLowerCase().includes(k)) ? "nombre" : "sin-dato";
  }
  return CLAVES_VISION.some((k) => activo.toLowerCase().includes(k)) ? "nombre" : "sin-dato";
}

/** Si el modelo activo admite imágenes. Lo usan el «+» del chat y lo que se
 *  adjunta al soltar archivos sobre la ventana: la puerta tiene que ser la misma. */
export function soportaVision(
  settings: Settings | null,
  locales: LocalModel[] | null,
): boolean {
  const motivo = motivoVision(settings, locales);
  return motivo === "declarado" || motivo === "gama" || motivo === "ollama" || motivo === "nombre";
}

/** Base para `test_provider`: la editable del proveedor, o nada cuando la suya
 *  es fija (Anthropic, OpenAI, OpenRouter y Gemini la llevan en el backend). */
export function endpointDe(s: Settings, id: ProviderId): string {
  const campo = datos(id)?.endpoint;
  return campo ? s[campo] : "";
}

/** Ventanas declaradas por los modelos de nube, por prefijo de nombre. La tabla
 *  es corta a propósito: si el modelo no está, el medidor se queda en tokens en
 *  vez de calcular un porcentaje sobre un número supuesto. */
const VENTANAS_NUBE: Array<[string, number]> = [
  ["claude-", 200_000],
  ["gemini-2", 1_000_000],
  ["gemini-1.5", 1_000_000],
  ["gpt-4.1", 1_048_576],
  ["gpt-4o", 128_000],
  ["o4-mini", 200_000],
  ["o3", 200_000],
];

/** De dónde sale el número de la ventana. No es un detalle: el `num_ctx` con el
 *  que Ollama arranca un modelo suele ser mucho menor que su ventana nativa, y
 *  prometer la nativa daría un porcentaje de lo que en la práctica no cabe. */
export type FuenteVentana = "num_ctx" | "nativa" | "nube" | "";

/** Tokens que admite el modelo activo, y de dónde se sacó. Vacío = no lo
 *  sabemos, y el medidor lo dice en vez de redondear una estimación propia. */
export function ventanaContexto(
  s: Settings,
  locales: LocalModel[] | null,
): { tokens: number; fuente: FuenteVentana } {
  if (s.activeProvider === "local") {
    const nombre = s.localModel.toLowerCase();
    const m = locales?.find((x) => x.name.toLowerCase() === nombre);
    if (!m || m.contextTokens <= 0) return { tokens: 0, fuente: "" };
    return { tokens: m.contextTokens, fuente: m.contextEsNumCtx ? "num_ctx" : "nativa" };
  }
  const modelo = modeloActivo(s).toLowerCase();
  // El prefijo más específico gana: «gpt-4o-mini» no tiene por qué heredar el de
  // otra familia solo por aparecer antes en la tabla.
  const golpe = VENTANAS_NUBE.filter(([p]) => modelo.startsWith(p)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return golpe ? { tokens: golpe[1], fuente: "nube" } : { tokens: 0, fuente: "" };
}

/**
 * Motores de generación de imagen. Son un mundo aparte del chat: no se eligen
 * por `activeProvider` (nadie quiere cambiar de proveedor de conversación solo
 * para dibujar) y la clave se pide al mismo llavero que ya usa el texto.
 *
 * La lista de tamaños tiene que coincidir con `tamanos_de` en
 * `src-tauri/src/providers/imagen.rs`: ofrecer el que el motor no acepta es
 * garantizar un 400 que aparece en la burbuja.
 */
export interface MotorImagen {
  id: string;
  corto: string;
  /** Lo que usa el backend si el campo de modelo se queda vacío. Tiene que ser
   *  el mismo que devuelve `modelo_por_defecto` en Rust. */
  modeloPorDefecto: string;
  /** Los que se ofrecen en el desplegable. Son marcas: no pasan por el diccionario. */
  modelos: string[];
  /** Lo que cobra el proveedor, con la tarifa pública tal cual. No es una
   *  promesa: OpenAI cobra por tokens de salida, no por imagen. */
  precio: string;
}

export const MOTORES_IMAGEN: readonly MotorImagen[] = [
  {
    id: "gemini",
    corto: "Google Gemini",
    modeloPorDefecto: "gemini-2.5-flash-image-preview",
    modelos: ["gemini-2.5-flash-image-preview", "gemini-2.5-flash-image"],
    precio: "≈0,045 $ por imagen",
  },
  {
    id: "openai",
    corto: "OpenAI",
    modeloPorDefecto: "gpt-image-1-mini",
    modelos: ["gpt-image-1-mini", "gpt-image-1", "dall-e-3"],
    precio: "8 $/M tokens de salida la mini; 40 $/M la gpt-image-1",
  },
];

export function motorImagen(id: string): MotorImagen | undefined {
  return MOTORES_IMAGEN.find((m) => m.id === id);
}

/**
 * Motores de voz de nube (texto → audio). Solo hay uno conectado hoy: la forma
 * del `generateContent` de Gemini para audio cambió de sitio en su documentación
 * y no se escribe una petición contra la clave de nadie adivinando.
 *
 * Los modelos y las voces tienen que coincidir con `VOCES_OPENAI` y
 * `modelo_por_defecto` en `src-tauri/src/providers/audio.rs`.
 */
export interface MotorVoz {
  id: string;
  corto: string;
  modeloPorDefecto: string;
  modelos: string[];
  voces: string[];
  /** La tarifa pública, tal cual la publica él. */
  precio: string;
}

export const MOTORES_VOZ: readonly MotorVoz[] = [
  {
    id: "openai",
    corto: "OpenAI",
    modeloPorDefecto: "gpt-4o-mini-tts",
    modelos: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    voces: [
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "marin",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
    ],
    precio: "15 $/M caracteres con tts-1; 12 $/M con gpt-4o-mini-tts",
  },
];

export function motorVoz(id: string): MotorVoz | undefined {
  return MOTORES_VOZ.find((m) => m.id === id);
}

/** Tamaños que acepta un modelo de imagen. Refleja `tamanos_de` en Rust: dentro
 *  de OpenAI no es lo mismo `dall-e-3` (1792×1024) que `gpt-image-1`
 *  (1536×1024), y ofrecer el que no tiene da un 400 en la burbuja. */
export function tamanosImagen(motor: string, modelo: string): string[] {
  if (motor === "gemini") return ["1024x1024", "1280x720", "720x1280"];
  if (motor === "openai") {
    return modelo.startsWith("gpt-image")
      ? ["1024x1024", "1536x1024", "1024x1536"]
      : ["1024x1024", "1792x1024", "1024x1792"];
  }
  return ["1024x1024"];
}
