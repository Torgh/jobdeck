# JobDeck

Osobisty tracker szukania pracy w IT. Oferty z polskich portali i LinkedIna trafiają na tablicę kanban,
a Claude (przez serwer MCP, na Twojej subskrypcji, bez klucza API) ocenia, jak bardzo pasują do Twojego CV.
Działa na tej samej zasadzie co TripDeck: Claude pracuje przez narzędzia, a Ty na żywo widzisz zmiany w aplikacji.

Dwa widoki:

- **Skrzynka** – nowe oferty jako lista (najlepiej ocenione na górze) z otwartą ofertą obok. Szybkie decyzje
  myszką albo klawiaturą: `J`/`K` następna/poprzednia, `S` ciekawe, `X` nie dla mnie, `F` gwiazdka, `O` otwórz na
  portalu, `Z` cofnij, `/` szukaj.
- **Pipeline** – kanban tylko dla tego, co w toku: Ciekawe → Aplikuję → Wysłane → Rozmowy → Oferta (+ Zamknięte).

Pasek **Dziś** pokazuje nowe oferty, oceny do zrobienia, wysłane aplikacje i rozmowy, a **Do ogarnięcia** –
follow-upy, terminy, wygasające oferty i firmy do sprawdzenia. Link `http://127.0.0.1:3100/?job=<id>` otwiera
konkretną ofertę (Claude podaje takie linki).

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

## Odpowiedzi od firm (Gmail)

Przy „co nowego?” Claude przegląda Gmaila od ostatniego sprawdzenia: maile od firm, do których wysłałeś aplikację,
i z systemów rekrutacyjnych (Greenhouse, Lever, Workable, Teamtailor, Pracuj.pl…). Każdą wiadomość zapisuje w
**historii** oferty i przesuwa kartę: zaproszenie → Rozmowy (z datą jako następny krok), zadanie → termin,
odmowa → Zamknięte, oferta → Oferta. Na tablicy możesz też sam dopisać wpis (np. telefon od rekrutera).
Pasek „Dziś” pokazuje, kiedy maile były sprawdzane ostatnio.

## Dopasowane CV i list motywacyjny

Napisz w Claude: „przygotuj CV i list do oferty <id>”. Claude układa Twoje prawdziwe doświadczenie pod tę ofertę
(kolejność, akcenty, słowa kluczowe z ogłoszenia, które CV faktycznie potwierdza – bez dopisywania niczego) i krótki,
konkretny list. W panelu oferty: podgląd, edycja, **PDF** (widok A4 → „Zapisz jako PDF”), **DOCX** i kopiowanie tekstu.

## Kalkulator B2B ↔ UoP („na rękę”)

🧮 na górnym pasku: UoP brutto i faktura B2B obok siebie – ryczałt, liniowy i skala – z rozbiciem na ZUS,
zdrowotną, podatek i koszty, oraz ile musi wynosić faktura, żeby dorównać danej pensji na UoP. Twoje ustawienia
(forma opodatkowania, ZUS, koszty, dni bez wynagrodzenia) zapisujesz raz, a każda oferta pokazuje
„≈ … na rękę”; w Skrzynce można sortować po tej kwocie. Claude ma narzędzie `compare_pay` do rozmów o stawkach.
Przepisy na 2026 r. są w `lib/pay.ts` (`PL_2026`) – szacunek bez ulg, PPK i wspólnego rozliczenia.

## Research firm

Gdy oznaczysz ofertę jako Ciekawą (albo dalej), firma trafia na listę „Do ogarnięcia”. Przy najbliższym
„co nowego?” Claude sprawdza ją w sieci: czym się zajmuje (produkt / software house / body leasing / agencja),
wielkość, ostatnie newsy (zwolnienia, finansowanie) i opinie pracowników (GoWork.pl, Glassdoor, Reddit,
4programmers). Wynik – oceny z linkami, plusy, minusy i rzeczy do dopytania na rozmowie – widać przy każdej
ofercie tej firmy. Research starszy niż 60 dni jest proponowany ponownie.

## Narzędzia MCP

`get_overview`, `scan_portals`, `add_jobs`, `list_jobs`, `get_job`, `rate_jobs`, `save_company_research`,
`log_events`, `save_document`, `get_document`, `compare_pay`, `update_job`, `get_profile`, `update_profile`, `import_cv`.

## Rozwój

```bash
bun run check    # typecheck + lint + testy + build
```
