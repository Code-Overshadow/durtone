"use client";

import { useEffect } from "react";
import { onRefreshRequested } from "@/lib/refresh-bus";

export function useRefreshable(refresh: () => void) {
  useEffect(() => onRefreshRequested(refresh));
}
