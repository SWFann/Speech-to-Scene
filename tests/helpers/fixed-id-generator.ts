import type { IdGenerator } from "../../src/application/ports/id-generator.js";

let projectCounter = 0;
let tempCounter = 0;
let sceneCounter = 0;

export class FixedIdGenerator implements IdGenerator {
  projectId(): string {
    projectCounter++;
    return `project-${String(projectCounter).padStart(8, "0")}-1111-1111-1111-111111111111`;
  }

  temporaryId(): string {
    tempCounter++;
    return `tmp-${String(tempCounter).padStart(8, "0")}-2222-2222-2222-222222222222`;
  }

  sceneId(): string {
    sceneCounter++;
    return `scene-${String(sceneCounter).padStart(8, "0")}-3333-3333-3333-333333333333`;
  }

  reset(): void {
    projectCounter = 0;
    tempCounter = 0;
    sceneCounter = 0;
  }
}
