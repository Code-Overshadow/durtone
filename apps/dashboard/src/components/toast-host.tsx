"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { onToast, type Toast } from "@/lib/toast-bus";

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };
const TOAST_DURATION_MS = 5000;

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => onToast((toast) => {
    setToasts((current) => [...current, toast]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), TOAST_DURATION_MS);
  }), []);

  if (!toasts.length) return null;
  return <div className="toast-host">
    {toasts.map((toast) => {
      const Icon = ICON[toast.kind];
      return <div key={toast.id} className={`notice ${toast.kind}`}><Icon size={16} />{toast.message}</div>;
    })}
  </div>;
}
