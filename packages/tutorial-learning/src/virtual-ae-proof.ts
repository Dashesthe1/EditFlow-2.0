import type {
  VirtualAeProjectV1,
} from "../../virtual-ae/src/index.js";
import {
  compileEditingIrRecipeToVirtualAeV1,
  type CompiledVirtualAeRecipeV1,
  type RecipeCompilerContextV1,
} from "../../recipe-compiler/src/index.js";
import {
  compileTeachTraceRegressionV1,
  createTeachTraceFromProgramV1,
  type TeachTraceRegressionContractV1,
  type TeachTraceV1,
} from "../../teach-trace/src/index.js";
import type { TutorialDeepLessonV1 } from "./deep-analysis.js";
import { TutorialLessonValidationError } from "./compiler.js";

export interface TutorialVirtualAeProofV1 {
  readonly schema: "editflow.tutorial-virtual-ae-proof.v1";
  readonly tutorialId: string;
  readonly skillId: string;
  readonly sourceRef: string;
  readonly compiled: CompiledVirtualAeRecipeV1;
  readonly trace: TeachTraceV1;
  readonly regression: TeachTraceRegressionContractV1;
}
export const compileTutorialVirtualAeProofV1 = (
  lesson: TutorialDeepLessonV1,
  skillId: string,
  initialProject: VirtualAeProjectV1,
  context: RecipeCompilerContextV1,
): TutorialVirtualAeProofV1 => {
  const skill = lesson.skills.find(
    (candidate) => candidate.analysis.skillId === skillId,
  );
  if (skill === undefined) {
    throw new TutorialLessonValidationError(
      "Tutorial skill '" + skillId + "' is not present in lesson '"
        + lesson.tutorialId + "'.",
    );
  }

  const compiled = compileEditingIrRecipeToVirtualAeV1(
    skill.editingIr,
    initialProject,
    context,
  );
  const trace = createTeachTraceFromProgramV1(
    {
      kind: "PROOF",
      referenceId:
        lesson.sourceRef + "#virtual-ae-proof:" + encodeURIComponent(skillId),
    },
    initialProject,
    compiled.operations,
  );
  const regression = compileTeachTraceRegressionV1(trace);

  return {
    schema: "editflow.tutorial-virtual-ae-proof.v1",
    tutorialId: lesson.tutorialId,
    skillId,
    sourceRef: lesson.sourceRef,
    compiled,
    trace,
    regression,
  };
};
