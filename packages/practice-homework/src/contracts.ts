/** Input vocabulary only. Practice and Pro Creation have no editing process. */
export type EditFlowOperatingModeV1 = "PRACTICE" | "PRO_CREATION";
export type PracticeMediaRoleV1 = "FINISH_REFERENCE" | "START_SOURCE";
export type PracticeMediaKindV1 = "VIDEO" | "AUDIO";
export interface PracticeMediaInputV1 {
  readonly mediaId: string;
  readonly role: PracticeMediaRoleV1;
  readonly mediaKind: PracticeMediaKindV1;
  readonly uri: string;
}
