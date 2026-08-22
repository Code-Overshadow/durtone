"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    try {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getSession().then(({ data }) => {
        if (active) {
          setSession(data.session);
          setCheckingSession(false);
        }
      });
      const subscription = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
      return () => {
        active = false;
        subscription.data.subscription.unsubscribe();
      };
    } catch {
      window.setTimeout(() => setCheckingSession(false), 0);
    }
  }, []);

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    setSession(null);
  }

  return { session, checkingSession, signOut };
}
