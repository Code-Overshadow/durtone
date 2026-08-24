export type ToastKind = "success" | "error" | "info";
export type Toast = { id: number; message: string; kind: ToastKind };
type Listener = (toast: Toast) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function onToast(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notify(message: string, kind: ToastKind = "info") {
  nextId += 1;
  const toast: Toast = { id: nextId, message, kind };
  listeners.forEach((listener) => listener(toast));
}
