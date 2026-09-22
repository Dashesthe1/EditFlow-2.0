export interface PracticeUiContractV1 {
  readonly modeOptions: readonly ["PRACTICE", "PRO_CREATION"];
  readonly editType: {
    readonly label: "Edit Type";
    readonly required: true;
    readonly source: "EDIT_TYPE_REGISTRY";
    readonly acceptsChoiceWords: true;
  };
  readonly practice: {
    readonly finish: {
      readonly label: "Finish";
      readonly accepts: "SINGLE_VIDEO";
      readonly role: "FINISH_REFERENCE";
    };
    readonly start: {
      readonly label: "Start";
      readonly accepts: "MULTI_VIDEO_OR_AUDIO";
      readonly role: "START_SOURCE";
    };
    readonly action: {
      readonly id: "proceed-to-homework";
      readonly label: "Proceed to do homework";
    };
    readonly completionDialog: {
      readonly id: "allocate-practice-learning";
      readonly label: "Allocate learned Practice session";
      readonly selector: "EDIT_TYPE";
      readonly default: "CURRENT_EDIT_TYPE";
      readonly actionLabel: "Allocate learning";
    };
  };
  readonly proCreation: {
    readonly finish: null;
    readonly start: {
      readonly label: "Start";
      readonly accepts: "MULTI_VIDEO_OR_AUDIO";
      readonly role: "START_SOURCE";
    };
    readonly action: {
      readonly id: "create-pro-edit";
      readonly label: "Create pro edit";
    };
  };
}

export const PRACTICE_UI_CONTRACT_V1: PracticeUiContractV1 = {
  modeOptions: ["PRACTICE", "PRO_CREATION"],
  editType: {
    label: "Edit Type",
    required: true,
    source: "EDIT_TYPE_REGISTRY",
    acceptsChoiceWords: true,
  },
  practice: {
    finish: {
      label: "Finish",
      accepts: "SINGLE_VIDEO",
      role: "FINISH_REFERENCE",
    },
    start: {
      label: "Start",
      accepts: "MULTI_VIDEO_OR_AUDIO",
      role: "START_SOURCE",
    },
    action: {
      id: "proceed-to-homework",
      label: "Proceed to do homework",
    },
    completionDialog: {
      id: "allocate-practice-learning",
      label: "Allocate learned Practice session",
      selector: "EDIT_TYPE",
      default: "CURRENT_EDIT_TYPE",
      actionLabel: "Allocate learning",
    },
  },
  proCreation: {
    finish: null,
    start: {
      label: "Start",
      accepts: "MULTI_VIDEO_OR_AUDIO",
      role: "START_SOURCE",
    },
    action: {
      id: "create-pro-edit",
      label: "Create pro edit",
    },
  },
};
