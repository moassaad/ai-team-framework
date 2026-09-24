import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withEmptyTempProject, withTempProject } from "./helpers/temp-project";

// Foundation tests (T-001): prove the shared isolation helper works.
// No production code is exercised here.
describe("test foundation isolation helper", () => {
  it("provides a fresh root pre-populated with files", () => {
    withTempProject({ ".ai-team/config.yaml": "version: 1\n" }, (root) => {
      assert.equal(
        fs.readFileSync(path.join(root, ".ai-team", "config.yaml"), "utf8"),
        "version: 1\n",
      );
    });
  });

  it("removes the root afterwards, even when the body throws", () => {
    let observed = "";
    assert.throws(() => {
      withTempProject({ "file.txt": "data" }, (root) => {
        observed = root;
        throw new Error("body failure");
      });
    }, /body failure/);
    assert.equal(fs.existsSync(observed), false);
  });

  it("isolates calls with unique roots", () => {
    const roots: string[] = [];
    withEmptyTempProject((root) => {
      roots.push(root);
      fs.writeFileSync(path.join(root, "marker.txt"), "x", "utf8");
    });
    withEmptyTempProject((root) => {
      roots.push(root);
      assert.equal(fs.existsSync(path.join(root, "marker.txt")), false);
    });
    assert.notEqual(roots[0], roots[1]);
  });

  it("creates roots under the OS temp directory only", () => {
    withEmptyTempProject((root) => {
      assert.ok(root.startsWith(os.tmpdir()), `root ${root} is under os.tmpdir()`);
    });
  });
});
