// Picking the files a run is handed (FOL-163): the filter, the limits said
// before the route refuses, and how sizes read.
//
//   node --import ./tests/register.mjs --test tests/run-inputs-model.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { matchFiles, pickProblem, fileSize, PICK_LIMITS } from "../components/run-inputs-model.ts";

const files = [{ path: "reports/q4.pdf", size: 2048 }, { path: "img/photo.png", size: 60 * 1048576 }, { path: "img/logo.png", size: 50 * 1048576 }];

test("filter by every word, limits before the route, sizes", () => {
  assert.deepEqual(matchFiles(files, "img png").map((f) => f.path), ["img/photo.png", "img/logo.png"]);
  assert.deepEqual(matchFiles(files, "").length, 3);
  assert.equal(pickProblem(["reports/q4.pdf"], files), null);
  assert.match(pickProblem(["img/photo.png", "img/logo.png"], files) ?? "", /110\.0 MiB picked — at most 100 MiB/);
  assert.match(pickProblem(Array.from({ length: PICK_LIMITS.files + 1 }, (_, i) => `f${i}`), files) ?? "", /At most 20/);
  assert.equal(fileSize(2048), "2 KiB");
  assert.equal(fileSize(3 * 1048576), "3.0 MiB");
  assert.equal(fileSize(10), "10 B");
});
