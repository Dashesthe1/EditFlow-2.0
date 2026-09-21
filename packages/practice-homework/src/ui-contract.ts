export interface PracticeUiContractV1 {
  readonly modeOptions: readonly ["PRACTICE", "PRO_CREATION"];
  readonly practice: {
    readonly finish: {
      readonly label: "Finish";
      readonly accepts: "SINGLE_VIDEO";
      readonly role: "FINISH_REFERENCE";
    };
    readonly start: {
      readonly label: "Start";
      readonly accepts: "MULTI_VIDEO";
      readonly role: "START_SOURCE";
    };
    readonly action: {
      readonly id: "proceed-to-homework";
      readonly label: "Proceed to do homework";
    };
  };
}

export const PRACTICE_UI_CONTRACT_V1: PracticeUiContractV1 = {
  modeOptions: ["PRACTICE", "PRO_CREATION"],
  practice: {
    finish: {
      label: "Finish",
      accepts: "SINGLE_VIDEO",
      role: "FINISH_REFERENCE",
    },
    start: {
      label: "Start",
      accepts: "MULTI_VIDEO",
      role: "START_SOURCE",
    },
    action: {
      id: "proceed-to-homework",
      label: "Proceed to do homework",
    },
  },
};
