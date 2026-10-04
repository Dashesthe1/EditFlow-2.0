/** Reject retired formula/decision directives, including nested queued operations. */
export const assertExplicitEditorialPayloadV1 = (payload: unknown): void => {
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["liveCurveIntent", "liveCurveEaseIntent"].includes(key)) throw new TypeError("FORMULA_EDITING_RETIRED: supply exact keyframes and easing chosen by ChatGPT.");
      if (["autoCorrect", "autoSelect", "automaticFallback", "autoAdapt", "autoApply", "autoRank", "autoPrune", "autoChooseMethod"].includes(key) && item === true) throw new TypeError("AUTOMATIC_EDITORIAL_DECISIONS_RETIRED");
      visit(item);
    }
  };
  visit(payload);
};
