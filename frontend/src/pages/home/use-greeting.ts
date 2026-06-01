import { useMessages } from "@/i18n";

/** Returns the home greeting line, varying the salutation by the current local hour. */
export function useGreeting() {
    const m = useMessages();
    const hour = new Date().getHours();
    const salutation =
        hour < 5 || hour >= 23
            ? m.home_greeting_night()
            : hour < 12
              ? m.home_greeting_morning()
              : hour < 18
                ? m.home_greeting_afternoon()
                : m.home_greeting_evening();
    return m.home_greeting({ greeting: salutation });
}
