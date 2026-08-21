import supabase from "./supabase";
import logger from "../utils/logger";

/**
 * Patch a lead's `enriched_data` WITHOUT clobbering concurrent writers.
 *
 * `enriched_data` is a single JSONB column that four independent code paths write to —
 * enrichment, the audit-token stamp, the call-script generator, and the background Lighthouse
 * fetch. Each of them used to do `update({ enriched_data: { ...edReadEarlier, myField } })`,
 * spreading a snapshot taken at the START of a request that then ran for 30–90 seconds.
 *
 * Whichever request finished LAST silently erased every field the others had added in the
 * meantime. Lighthouse lost that race every time, because it is by far the slowest writer:
 * `pageSpeed` was fetched, stored, and then wiped by the call-script or audit-token write
 * landing on top of it with a stale snapshot — which is why reports rendered with no gauges
 * even though the Google API had answered successfully.
 *
 * Re-reading immediately before the write shrinks the window from ~90s to a few ms. Fields
 * are merged shallowly: the caller's patch wins for the keys it names, everything else on the
 * row survives.
 */
export async function mergeEnrichedData(
  leadId: string,
  /**
   * The fields to set. Pass a FUNCTION when the new value depends on the current one — for
   * example adding one Lighthouse strategy to a `pageSpeed` object the other strategy may
   * have just created. The function receives the freshly-read row, so nesting stays safe.
   */
  patch: Record<string, any> | ((current: Record<string, any>) => Record<string, any>)
): Promise<boolean> {
  const { data: fresh, error: readErr } = await supabase
    .from("leads")
    .select("enriched_data")
    .eq("id", leadId)
    .maybeSingle();

  if (readErr || !fresh) {
    logger.warn({ leadId, error: readErr?.message }, "mergeEnrichedData: lead not readable");
    return false;
  }

  const current = (fresh.enriched_data || {}) as Record<string, any>;
  const fields = typeof patch === "function" ? patch(current) : patch;

  const { error: writeErr } = await supabase
    .from("leads")
    .update({ enriched_data: { ...current, ...fields } })
    .eq("id", leadId);

  if (writeErr) {
    logger.warn({ leadId, error: writeErr.message }, "mergeEnrichedData: write failed");
    return false;
  }
  return true;
}
