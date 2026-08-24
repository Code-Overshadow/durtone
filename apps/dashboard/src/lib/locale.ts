export type Locale = "pt" | "en";

/** "Nacional" = Brasil ⇒ português; qualquer outro país ⇒ inglês (sem i18n completo por ora,
 * só o par de idiomas que decide entre mensagem crua em inglês e mensagem amigável). */
export function localeForCountry(country: string | undefined): Locale {
  return country === "BR" ? "pt" : "en";
}
