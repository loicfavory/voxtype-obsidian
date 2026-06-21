/**
 * poller.ts — Utilitaires de polling asynchrone non bloquants.
 * Tout le polling passe par des timers async ; jamais de boucle synchrone bloquante.
 */

export interface PollOptions {
  /** Intervalle entre les vérifications en ms */
  intervalMs: number;
  /** Délai maximal total en ms avant abandon */
  timeoutMs: number;
}

export type PollResult<T> =
  | { outcome: "success"; value: T }
  | { outcome: "timeout" }
  | { outcome: "error"; message: string };

/**
 * Tente `check()` toutes les `intervalMs` ms jusqu'à ce qu'elle retourne une valeur non-null
 * ou que `timeoutMs` soit dépassé.
 *
 * `check()` doit retourner :
 *  - `null` pour continuer à attendre
 *  - une valeur `T` pour signaler le succès
 *  - lever une exception pour signaler une erreur fatale
 */
export async function poll<T>(
  check: () => Promise<T | null>,
  options: PollOptions,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<PollResult<T>> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    let result: T | null;
    try {
      result = await check();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { outcome: "error", message };
    }

    if (result !== null) {
      return { outcome: "success", value: result };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    // Attente async non bloquante
    await sleepFn(Math.min(options.intervalMs, remaining));
  }

  return { outcome: "timeout" };
}

/** Retourne une promesse qui se résout après `ms` millisecondes. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
