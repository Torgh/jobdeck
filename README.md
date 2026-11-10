<p align="center">
  <img src="public/icon.svg" alt="" width="96" height="96">
</p>

<h1 align="center">Tropiciel</h1>

<p align="center">
  Osobisty tracker szukania pracy w IT – oferty z polskich portali na jednej tablicy,<br>
  a Claude ocenia je względem Twojego CV, pilnuje odpowiedzi i pomaga w aplikacji.
</p>

<p align="center">
  <a href="https://github.com/Torgh/tropiciel/actions/workflows/ci.yml"><img src="https://github.com/Torgh/tropiciel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---

Oferty z Just Join IT, No Fluff Jobs, Bulldogjob i LinkedIna trafiają na tablicę, a Claude (przez serwer MCP, na
Twojej subskrypcji, bez klucza API) ocenia, jak bardzo pasują do Twojego CV. Działa na tej samej zasadzie co
TripDeck: Claude pracuje przez narzędzia, a Ty na żywo widzisz zmiany w aplikacji.

## Widoki

- **Dziś** (start) – co jest do zrobienia, z przyciskiem przy każdej rzeczy (rozmowa → przygotowanie, cisza →
  szkic follow-upu, wygasająca oferta), 3 najlepsze nowe oferty do decyzji jednym kliknięciem, stan pipeline'u,
  bieżący tydzień i następny punkt planu nauki.
- **Skrzynka** – nowe oferty jako lista (najlepiej ocenione na górze) z otwartą ofertą obok. Szybkie decyzje
  myszką albo klawiaturą: `J`/`K` następna/poprzednia, `S` ciekawe, `X` nie dla mnie, `F` gwiazdka, `O` otwórz na
  portalu, `Z` cofnij, `/` szukaj.
- **Pipeline** – to, co w toku, jako lista pogrupowana po etapach (każda aplikacja w jednym wierszu z następnym
  krokiem i ostrzeżeniami) albo kanban: Ciekawe → Aplikuję → Wysłane → Rozmowy → Oferta (+ Zamknięte).
- **Rynek** – widełki, technologie, braki, źródła i Twój lejek (niżej).
- **Kalkulator** – B2B ↔ UoP „na rękę” (niżej).

Panel oferty ma zakładki: **Dopasowanie**, **Oferta** (opis), **Firma** (research) i **Aplikacja** (follow-up,
negocjacje, dokumenty, następny krok, historia, notatki). Link `http://127.0.0.1:3100/?job=<id>` otwiera
konkretną ofertę (Claude podaje takie linki).

## Instalacja

Wymaga [Bun](https://bun.sh) i Node 20.9+.

```bash
bun install
cp .env.example .env.local     # ustaw TROPICIEL_HOME – folder na dane (domyślnie ~/.tropiciel)
bun run dev                    # http://127.0.0.1:3100
```

Serwer MCP dla Claude Code:

```bash
claude mcp add --scope user tropiciel -e TROPICIEL_HOME=<folder z danymi> -- <ścieżka do bun> <repo>/mcp/server.ts
```

Dane (oferty, profil, CV) są w `TROPICIEL_HOME`, poza repozytorium; nic osobistego nie trafia do gita.

### Pierwsze kroki

Ekran **Dziś** prowadzi przez nie listą „Zacznij tutaj”:

1. **Ustawienia → Twoje CV**: wgraj PDF (z tekstem, nie skan) albo DOCX.
2. Ustaw frazy (np. `java, kotlin`), poziom, umowę, minimalne widełki i wykluczenia. **Tryb pracy i miasta**
   ustawiasz osobno: praca zdalna zawsze z całej Polski, a hybryda i praca stacjonarna – każda z własną listą miast
   (np. hybryda tylko Wrocław).
3. Poproś Claude: „wyciągnij umiejętności z mojego CV do Tropiciela”. Uzupełni listę umiejętności, z której liczony
   jest szybki wskaźnik „% technologii” na kartach.
4. Nowe oferty z LinkedIna i Pracuj.pl wysyłasz Claude'owi jako **zrzut ekranu** (alert, lista wyników, oferta)
   albo **link** – poczty nie trzeba podłączać.

### Dane testowe

Chcesz zobaczyć tablicę w akcji, zanim zbierzesz prawdziwe oferty? **Ustawienia → Dane testowe → Wczytaj**
(albo `bun run demo`). Dochodzi 9 ofert fikcyjnych firm z dopiskiem „(test)” na każdym etapie – z ocenami,
follow-upem, rozmową, negocjacjami i planem nauki. Usuwasz je tym samym panelem, banerem na ekranie Dziś albo
`bun run demo:clear`; prawdziwe oferty, profil i CV zostają. Claude widzi je w MCP jako `[TEST]` i pomija.

## Jak używać (co 2 dni)

1. Uruchom tablicę: `bun run dev` i otwórz http://127.0.0.1:3100.
2. W Claude Code napisz: **„co nowego w Tropicielu?”**. Claude:
   - skanuje portale od ostatniego skanu,
   - dodaje oferty z wysłanych zrzutów ekranu i linków (albo z alertów w Gmailu, jeśli go podłączysz),
   - zapisuje odpowiedzi od firm (zrzuty maili albo Gmail) i przesuwa karty,
   - ocenia nowe oferty względem CV (0–100, mocne strony, braki) i sprawdza firmy, które Cię zainteresowały,
   - podaje krótkie podsumowanie najlepszych ofert i przypomina o follow-upach.
3. Na ekranie **Dziś** odhaczasz to, co ważne: decyzje w Skrzynce, przygotowanie do rozmowy, follow-upy.

Skan bez Claude'a: przycisk **Skanuj** w nagłówku albo `bun run scan` (np. z Harmonogramu zadań Windows).

## Skąd biorą się oferty

| Źródło | Jak |
|---|---|
| Just Join IT | skan przez publiczne API |
| No Fluff Jobs | skan przez publiczne API |
| Bulldogjob | skan listy ofert według technologii (pierwsze słowo frazy, np. „Kotlin”) |
| Remotive, Himalayas | opcjonalnie: praca zdalna z zagranicy, tylko oferty otwarte dla Polski / Europy (domyślnie wyłączone) |
| LinkedIn | **link** (Claude sam czyta publiczną stronę oferty, `add_job_links`) albo **zrzut ekranu** alertu / listy (`add_jobs`); opcjonalnie publiczna wyszukiwarka (domyślnie wyłączona) |
| Pracuj.pl, theprotocol.it | **zrzut ekranu** oferty lub listy (`add_jobs`) – te portale blokują automaty, więc ich linki nie są pobierane |
| dowolny link | wklej go Claude'owi: „dodaj tę ofertę do Tropiciela” (`add_job_links`, dane oferty ze strony) |
| Gmail (opcjonalnie) | alerty e-mail z LinkedIna i Pracuj.pl, jeśli podłączysz Gmail w Claude |

Oferta ze zrzutu bez widocznego linku prowadzi do wyszukiwania; gdy później wyślesz jej link albo zrzut opisu,
karta się uzupełni.

Skan przepuszcza tylko oferty zgodne z Twoimi ustawieniami: **tytuł** (albo tagi technologii) musi zawierać
którąś z fraz – w tej kolejności, np. „head of engineering” pasuje też do „Head of Software Engineering” – bo
wyszukiwarki portali są bardzo luźne; do tego **umowa**, poziom, tryb pracy i miasta, widełki, wykluczenia, a oferty
zdalne z siedzibą za granicą odpadają (poza Remotive / Himalayas). Po zmianie ustawień `bun run refilter`
(albo Claude: `refilter_inbox`) pokazuje nowe oferty, które już nie pasują, i na żądanie je usuwa.

Ta sama oferta znaleziona na kilku portalach to jedna karta z kilkoma linkami. Wynagrodzenia są przeliczane
na PLN miesięcznie (stawka godzinowa × 168, waluty po kursie NBP), z oznaczeniem B2B / UoP.

## Ocena dopasowania

Claude porównuje treść CV z pełnym opisem oferty i przyznaje punkty (0–100):

- wymagane technologie pokryte w CV (~40),
- poziom i lata doświadczenia (~20),
- domena i charakter pracy (~15),
- Twoje preferencje: tryb, lokalizacja, umowa, widełki, „czego nie chcę” (~25).

80+ świetne · 65–79 dobre · 45–64 częściowe · poniżej 45 słabe. Po wgraniu nowego CV stare oceny są oznaczane
jako nieaktualne.

## Aplikacja krok po kroku

- **Research firmy** – gdy oznaczysz ofertę jako Ciekawą (albo dalej), Claude przy najbliższym „co nowego?”
  sprawdza firmę w sieci: czym się zajmuje (produkt / software house / body leasing / agencja), wielkość, ostatnie
  newsy (zwolnienia, finansowanie) i opinie pracowników (GoWork.pl, Glassdoor, Reddit, 4programmers). Wynik –
  oceny z linkami, plusy, minusy i rzeczy do dopytania – jest w zakładce **Firma** każdej oferty tej firmy.
  Research starszy niż 60 dni jest proponowany ponownie.
- **Dopasowane CV i list motywacyjny** – „przygotuj CV i list do oferty <id>”. Claude układa Twoje prawdziwe
  doświadczenie pod tę ofertę (kolejność, akcenty, słowa kluczowe z ogłoszenia, które CV faktycznie potwierdza –
  bez dopisywania niczego) i krótki, konkretny list. W zakładce **Aplikacja**: podgląd, edycja, **PDF** (widok A4
  → „Zapisz jako PDF”), **DOCX** i kopiowanie tekstu.
- **Odpowiedzi od firm** – wyślij Claude'owi zrzut maila od firmy albo (jeśli podłączysz Gmail) przy „co nowego?”
  Claude sam przegląda pocztę od ostatniego sprawdzenia: maile od firm, do których wysłałeś aplikację, i z systemów rekrutacyjnych (Greenhouse, Lever, Workable, Teamtailor,
  Pracuj.pl…). Każdą wiadomość zapisuje w **historii** oferty i przesuwa kartę: zaproszenie → Rozmowy (z datą jako
  następny krok), zadanie → termin, odmowa → Zamknięte, oferta → Oferta. Sam też możesz dopisać wpis (np. telefon
  od rekrutera). Ekran Dziś pokazuje, kiedy maile były sprawdzane ostatnio.
- **Follow-up** – po 7 dniach ciszy panel oferty podpowiada przypomnienie: gotowy szkic (PL/EN, neutralny
  płciowo) do skopiowania albo otwarcia w poczcie, potem „Zapisz jako wysłane”. Po 2 przypomnieniach bez odpowiedzi
  Tropiciel proponuje zamknięcie.
- **Przygotowanie do rozmowy** – w kolumnie Rozmowy: „przygotuj mnie do rozmowy <id>”. Claude zapisuje dokument
  z pytaniami technicznymi, Twoimi przykładami (STAR), pytaniami do firmy i kwotą do podania (PDF / DOCX).
- **Negocjacje** – na etapie Rozmowy / Oferta panel porównuje propozycję firmy z widełkami, rynkiem dla poziomu
  i Twoim minimum, i podaje kwotę do zaproponowania z argumentami oraz „na rękę”.

## Kalkulator B2B ↔ UoP („na rękę”)

Zakładka **Kalkulator**: UoP brutto i faktura B2B obok siebie – ryczałt, liniowy i skala – z rozbiciem na ZUS,
zdrowotną, podatek i koszty, oraz ile musi wynosić faktura, żeby dorównać danej pensji na UoP. Twoje ustawienia
(forma opodatkowania, ZUS, koszty, dni bez wynagrodzenia) zapisujesz raz, a każda oferta pokazuje
„≈ … na rękę”; w Skrzynce można sortować po tej kwocie. Claude ma narzędzie `compare_pay` do rozmów o stawkach.
Przepisy na 2026 r. są w `lib/pay.ts` (`PL_2026`) – szacunek bez ulg, PPK i wspólnego rozliczenia.

## Rynek

Zakładka **Rynek**: co mówią zebrane oferty (30 / 90 dni / wszystko) –

- widełki według poziomu (B2B netto i UoP brutto: mediana i środkowa połowa ofert) na tle Twojego minimum,
- najczęściej wymagane technologie, z wyróżnieniem tych, których nie ma w CV,
- braki, które Claude najczęściej wskazuje w ocenach, i **plan nauki**: „zrób plan nauki z braków w Tropicielu” –
  3–5 najczęstszych braków, do każdego mały projekt do CV i materiały, z odhaczaniem,
- **Twój lejek**: wybrane → wysłane → odpowiedź → rozmowa → oferta, odsetek odpowiedzi i rozmów, typowy czas do
  odpowiedzi, aplikacje bez odpowiedzi od 14+ dni i wysłane aplikacje tydzień po tygodniu,
- źródła: ile ofert, jak pasują, ile kończy się aplikacją i rozmową.

Claude ma narzędzie `get_market_insights`: „co mówi rynek w Tropicielu?”. To tylko oferty zebrane przez Tropiciela
(Twoje frazy i filtry), nie cały rynek.

**Oferty-widma**: Tropiciel pamięta najwcześniejszą datę publikacji i liczy ponowne publikacje. Oferta wystawiana od
45+ dni jest oznaczona „⏳”, a od 90 dni (albo 45 dni i co najmniej 2 odświeżenia) – jako **możliwa oferta-widmo**,
z radą, żeby przed aplikacją zapytać, czy rekrutacja trwa.

## Narzędzia MCP

`get_overview`, `scan_portals`, `add_jobs`, `add_job_links`, `list_jobs`, `get_job`, `rate_jobs`, `save_company_research`, `refilter_inbox`,
`log_events`, `save_document`, `get_document`, `compare_pay`, `get_market_insights`, `save_learning_plan`,
`update_job`, `get_profile`, `update_profile`, `import_cv`.

## Rozwój

```bash
bun run check        # typecheck + lint + testy + build – przed każdym commitem
bun run scan         # skan portali bez Claude'a
bun run demo         # dane testowe na tablicę (bun run demo:clear – usunięcie)
```

- **CI** (GitHub Actions) uruchamia typecheck, lint, testy i build przy każdym PR i pushu do `main`.
- **Dependabot** co tydzień proponuje aktualizacje zależności i akcji GitHub (drobne zgrupowane w jeden PR).
- PR-y idą do `main`; po merge'u GitHub sam usuwa gałąź.

## Licencja

[GNU Affero General Public License v3.0](LICENSE) lub nowsza (`AGPL-3.0-or-later`). Możesz używać, zmieniać
i rozpowszechniać kod, ale zmienioną wersję – także udostępnioną innym jako usługa przez sieć – musisz opublikować
na tej samej licencji, z kodem źródłowym.
