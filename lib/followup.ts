import type { Job } from "./types";

/** Days without an answer after which a reminder is due (again). */
export const FOLLOW_UP_DAYS = 7;
/** After this many reminders without an answer, suggest letting the application go. */
export const MAX_FOLLOW_UPS = 2;

export interface FollowUpState {
  /** Reminders already sent. */
  count: number;
  /** Days since the last thing that happened (sending, a reminder, any entry in the history). */
  quietDays: number;
  /** A reminder is due now. */
  due: boolean;
  /** Reminders were sent and still nothing: time to close it. */
  giveUp: boolean;
}

/** Whether the user should send a reminder about an application still waiting for an answer. */
export function followUpState(job: Pick<Job, "status" | "statusChangedAt" | "appliedAt" | "events" | "nextStep">, now = Date.now()): FollowUpState | undefined {
  if (job.status !== "applied") return undefined;
  const times = [job.statusChangedAt, job.appliedAt && `${job.appliedAt}T00:00:00Z`, ...(job.events ?? []).map((e) => e.at)]
    .filter((t): t is string => !!t)
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t));
  const last = Math.max(...times);
  const quietDays = Math.floor((now - last) / 86_400_000);
  const count = (job.events ?? []).filter((e) => e.kind === "follow_up").length;
  const quiet = quietDays >= FOLLOW_UP_DAYS && !job.nextStep;
  return { count, quietDays, due: quiet && count < MAX_FOLLOW_UPS, giveUp: quiet && count >= MAX_FOLLOW_UPS };
}

const EN_WORDS = /\b(the|and|you|with|will|our|we|are|for|experience|team|skills)\b/gi;
const PL_WORDS = /\b(i|w|z|na|się|oraz|dla|jest|będziesz|doświadczenie|zespół|umiejętności|oferujemy|wymagania)\b/gi;

/** The offer's language: from the tailored documents, else a word count on the description. */
export function offerLanguage(job: Pick<Job, "documents" | "description" | "summary" | "title">): "pl" | "en" {
  const fromDocs = job.documents?.letter?.language ?? job.documents?.cv?.language;
  if (fromDocs) return fromDocs;
  const text = `${job.title} ${job.description ?? job.summary ?? ""}`;
  const en = text.match(EN_WORDS)?.length ?? 0;
  const pl = text.match(PL_WORDS)?.length ?? 0;
  if (/[ąćęłńóśźż]/i.test(text) && pl >= en) return "pl";
  return en > pl ? "en" : "pl";
}

/** The user's name: the heading of a tailored CV, else a short first line of the CV that looks like a name. */
export function applicantName(job: Pick<Job, "documents">, cvText?: string): string | undefined {
  const heading = job.documents?.cv?.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/\*+/g, "");
  const first = cvText?.split("\n").map((l) => l.trim()).find(Boolean);
  if (first && /^[\p{Lu}][\p{L}'-]+(\s+[\p{Lu}][\p{L}'-]+){1,3}$/u.test(first)) return first;
  return undefined;
}

const plDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export interface FollowUpDraft {
  subject: string;
  body: string;
  language: "pl" | "en";
}

/**
 * A short, polite reminder about an application. Neutral in grammatical gender (Polish), concrete
 * (role, date, the skills that match), no pressure. The user edits it before sending.
 */
export function followUpDraft(
  job: Pick<Job, "title" | "company" | "appliedAt" | "statusChangedAt" | "events" | "documents" | "description" | "summary">,
  opts: { name?: string; matched?: string[] } = {},
): FollowUpDraft {
  const language = offerLanguage(job);
  const second = (job.events ?? []).some((e) => e.kind === "follow_up");
  const sentOn = job.appliedAt ?? job.statusChangedAt.slice(0, 10);
  const skills = (opts.matched ?? []).slice(0, 2);
  if (language === "en") {
    const fit = skills.length ? ` My experience with ${skills.join(" and ")} matches what you are looking for, and I would be glad to tell you more about it.` : "";
    const lines = second
      ? [
          "Hello,",
          "",
          `I am following up once more on my application for the ${job.title} position (sent on ${sentOn}). The role is still of great interest to me – could you let me know whether the recruitment is still open and what the next steps are?`,
          "",
          "Thank you for your time.",
        ]
      : [
          "Hello,",
          "",
          `On ${sentOn} I applied for the ${job.title} position at ${job.company}. I would like to ask about the status of the recruitment and whether there is anything else you need from me.${fit}`,
          "",
          "Thank you in advance for your reply.",
        ];
    return {
      language,
      subject: `${second ? "Follow-up: " : ""}Application for ${job.title} – status`,
      body: [...lines, "", "Best regards,", opts.name ?? "[Your name]"].join("\n"),
    };
  }
  const fit = skills.length ? ` Moje doświadczenie z ${skills.join(" i ")} dobrze odpowiada Państwa wymaganiom – chętnie opowiem o nim więcej.` : "";
  const lines = second
    ? [
        "Dzień dobry,",
        "",
        `uprzejmie przypominam się w sprawie aplikacji na stanowisko ${job.title} (wysłanej ${plDate(sentOn)}). To stanowisko nadal bardzo mnie interesuje – czy mogę prosić o informację, czy rekrutacja jest wciąż otwarta i jakie są kolejne kroki?`,
        "",
        "Dziękuję za poświęcony czas.",
      ]
    : [
        "Dzień dobry,",
        "",
        `piszę w sprawie mojej aplikacji na stanowisko ${job.title} w ${job.company}, przesłanej ${plDate(sentOn)}. Czy mogę prosić o informację, na jakim etapie jest rekrutacja i czy potrzebują Państwo ode mnie dodatkowych informacji?${fit}`,
        "",
        "Z góry dziękuję za odpowiedź.",
      ];
  return {
    language,
    subject: `${second ? "Ponownie: " : ""}Aplikacja na stanowisko ${job.title} – pytanie o status`,
    body: [...lines, "", "Pozdrawiam serdecznie,", opts.name ?? "[Imię i nazwisko]"].join("\n"),
  };
}
