type Listener = () => void;

const listeners = new Set<Listener>();

export function onRefreshRequested(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestRefresh() {
  listeners.forEach((listener) => listener());
}
