// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { expect, it, vi } from "vite-plus/test";

import { makePosixProcessTreeController } from "./AcpSessionRuntime.ts";

const proc = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFS>()),
  readdirSync: proc.readdir,
  readFileSync: proc.readFile,
}));

it("snapshots the processes still running when another exits during the scan", () => {
  // Node's fallback lstat for an entry of unknown type fails once that process has exited.
  proc.readdir.mockImplementation((_path, options) => {
    if (options?.withFileTypes) {
      throw Object.assign(new Error("ENOENT: no such file or directory, lstat '/proc/200'"), {
        code: "ENOENT",
      });
    }
    return ["100", "200", "self"];
  });
  proc.readFile.mockImplementation((path) => {
    if (path !== "/proc/100/stat") throw Object.assign(new Error("vanished"), { code: "ENOENT" });
    return `100 (agent) S 1 100 100 ${Array(15).fill("0").join(" ")} 99`;
  });
  expect(makePosixProcessTreeController("linux").snapshot()).toMatchObject([
    { pid: 100, startTime: "99" },
  ]);
});
