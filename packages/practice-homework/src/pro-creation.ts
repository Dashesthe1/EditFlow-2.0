import type {
  ProCreationPreparationResultV1,
  ProCreationSessionRequestV1,
} from "./contracts.js";
import { EditTypeRegistryV1 } from "./edit-types.js";

export class ProCreationPreparationEngineV1 {
  readonly editTypes: EditTypeRegistryV1;

  constructor(editTypes: EditTypeRegistryV1) {
    this.editTypes = editTypes;
  }

  prepare(request: ProCreationSessionRequestV1): ProCreationPreparationResultV1 {
    const reasons: string[] = [];
    if (request.mode !== "PRO_CREATION") {
      reasons.push("Pro Creation preparation only accepts PRO_CREATION mode.");
    }
    if (request.start.length === 0
      || request.start.some((item) => item.role !== "START_SOURCE")) {
      reasons.push("Pro Creation Start must contain one or more START_SOURCE media items.");
    }
    if (!request.start.some((item) => item.mediaKind === "VIDEO")) {
      reasons.push("Pro Creation requires at least one raw video source.");
    }
    const knowledge = this.editTypes.knowledge(request.editTypeId);
    if (knowledge === null) {
      reasons.push("A registered Edit Type must be selected before Pro Creation can start.");
    } else if (knowledge.masteredSessionCount === 0) {
      reasons.push(
        "The selected Edit Type has no mastered Practice success path yet. "
          + "Complete at least one successful GPT-orchestrated Practice session first.",
      );
    }

    return {
      schema: "editflow.pro-creation-preparation.v1",
      sessionId: request.sessionId,
      status: reasons.length === 0 ? "READY" : "BLOCKED",
      editTypeId: request.editTypeId,
      knowledge,
      start: request.start,
      reasons,
    };
  }
}

