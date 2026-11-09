# JobDeck

Osobisty tracker szukania pracy w IT. Oferty z polskich portali i LinkedIna trafiają na tablicę kanban,
a Claude (przez serwer MCP, na Twojej subskrypcji, bez klucza API) ocenia, jak bardzo pasują do Twojego CV.
Działa na tej samej zasadzie co TripDeck: Claude pracuje przez narzędzia, a Ty na żywo widzisz zmiany w aplikacji.

```
Nowe → Ciekawe → Aplikuję → Wysłane → Rozmowy → Oferta   (+ Zamknięte)
```

## Skąd biorą się oferty

| Źródło | Jak |
|---|---|
| Just Join IT | skan przez publiczne API |
| No Fluff Jobs | skan przez publiczne API |
| LinkedIn | **alerty e-mail** → Claude czyta je w Gmailu (`add_jobs`); opcjonalnie publiczna wyszukiwarka (domyślnie wyłączona) |
| Pracuj.pl, theprotocol.it | **alerty e-mail** → Claude czyta je w Gmailu (`add_jobs`); te portale blokują automaty |
| dowolny link | wklej go Claude'owi: „dodaj tę ofertę do JobDeck” |

Ta sama oferta znaleziona na kilku portalach to jedna karta z kilkoma linkami. Wynagrodzenia są przeliczane
na PLN miesięcznie (stawka godzinowa × 168, waluty po kursie NBP), z oznaczeniem B2B / UoP.

## Instalacja

Wymaga [Bun](https://bun.sh) i Node 20.9+.

```bash
bun install
cp .env.example .env.local     # ustaw JOBDECK_HOME – folder na dane (domyślnie ~/.jobdeck)
bun run dev                    # http://127.0.0.1:3100
```

Serwer MCP dla Claude Code:

```bash
claude mcp add --scope user jobdeck -e JOBDECK_HOME=<folder z danymi> -- <ścieżka do bun> <repo>/mcp/server.ts
```

Dane (oferty, profil, CV) są w `JOBDECK_HOME`, poza repozytorium; nic osobistego nie trafia do gita.

## Jak używać (co 2 dni)

1. Uruchom tablicę: `bun run dev` i otwórz http://127.0.0.1:3100.
2. W Claude Code napisz: **„co nowego w JobDeck?”**. Claude:
   - skanuje Just Join IT i No Fluff Jobs od ostatniego skanu,
   - czyta alerty z LinkedIna i Pracuj.pl w Gmailu (jeśli podłączysz Gmail w Claude) i dodaje oferty,
   - ocenia nowe oferty względem CV (0–100, mocne strony, braki),
   - podaje krótkie podsumowanie najlepszych ofert i przypomina o follow-upach.
3. Przeciągaj karty między kolumnami, dopisuj notatki i następne kroki (rozmowa, follow-up z datą).

Skan bez Claude'a: przycisk **Skanuj portale** na tablicy albo `bun run scan` (np. z Harmonogramu zadań Windows).

### Pierwsze kroki

1. **Ustawienia → Twoje CV**: wgraj PDF (z tekstem, nie skan) albo DOCX.
2. Ustaw frazy (np. `java, kotlin`), miasta, poziom, umowę, minimalne widełki i wykluczenia.
3. Poproś Claude: „wyciągnij umiejętności z mojego CV do JobDeck”. Uzupełni listę umiejętności, z której liczony jest
   szybki wskaźnik „% technologii” na kartach.
4. Na LinkedInie ustaw alerty ofert pracy (codziennie, e-mail), to samo na Pracuj.pl.

## Ocena dopasowania

Claude porównuje treść CV z pełnym opisem oferty i przyznaje punkty (0–100):

- wymagane technologie pokryte w CV (~40),
- poziom i lata doświadczenia (~20),
- domena i charakter pracy (~15),
- Twoje preferencje: tryb, lokalizacja, umowa, widełki, „czego nie chcę” (~25).

80+ świetne · 65–79 dobre · 45–64 częściowe · poniżej 45 słabe. Po wgraniu nowego CV stare oceny są oznaczane jako nieaktualne.

## Narzędzia MCP

`get_overview`, `scan_portals`, `add_jobs`, `list_jobs`, `get_job`, `rate_jobs`, `update_job`, `get_profile`,
`update_profile`, `import_cv`.

## Rozwój

```bash
bun run check    # typecheck + lint + testy + build
```
