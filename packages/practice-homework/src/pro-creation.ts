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
    const retainedKnowledge = this.editTypes.knowledge(request.editTypeId);
    const knowledge = this.editTypes.transferableKnowledge(request.editTypeId);
    if (retainedKnowledge === null) {
      reasons.push("A registered Edit Type must be selected before Pro Creation can start.");
    } else if (knowledge === null) {
      reasons.push(
        "The selected Edit Type has no transfer-verified GPT Practice knowledge yet. "
          + "A single-reference reconstruction is not enough for Pro Creation; "
          + "pass the Practice proof gate on materially different reference/source footage first.",
      );
    }

    return {
      schema: "editflow.pro-creation-preparation.v1",
      sessionId: request.sessionId,
      status: reasons.length === 0 ? "READY" : "BLOCKED",
      editTypeId: request.editTypeId,
      knowledge: knowledge ?? retainedKnowledge,
      start: request.start,
      reasons,
    };
  }
}

