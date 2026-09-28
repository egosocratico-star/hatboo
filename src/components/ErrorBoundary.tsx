import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";
import Mascot from "./mascot/Mascot";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "./modalUi";

interface Props {
  children: ReactNode;
  /** Nombre ya traducido de la zona, para que el aviso diga qué se cayó. */
  zona: string;
}

interface State {
  error: Error | null;
}

/**
 * WebView2 no tiene pantalla de error propia: un throw durante el render deja
 * la ventana en blanco y al usuario sin forma de volver. Con esto cada zona se
 * cae ella sola, se explica y se reintenta sin tocar el estado de las demás.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Hatboo: se cayó ${this.props.zona}`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <Mascot state="confused" size={72} />
        <h2 className="text-base font-semibold">{t("Esta pantalla se ha roto por dentro.")}</h2>
        <p className="max-w-md text-sm text-zinc-400">
          {t("Tus chats y tus proyectos están a salvo en el disco: solo falló el dibujo de {zona}.", {
            zona: this.props.zona,
          })}
        </p>
        <p className="max-w-md break-words font-mono text-[11px] text-zinc-600">{error.message}</p>
        <div className="mt-1 flex items-center gap-2">
          <button className={BOTON_PRIMARIO} onClick={() => this.setState({ error: null })}>
            {t("Reintentar la vista")}
          </button>
          <button className={BOTON_SECUNDARIO} onClick={() => location.reload()}>
            {t("Recargar Hatboo")}
          </button>
        </div>
      </div>
    );
  }
}
