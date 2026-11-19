import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { terminatePiProcess } from "./rpc.ts";

const piGroup = (input: {
  /** How many probes after SIGTERM still find a group member running. */
  readonly probesUntilGone: number;
  readonly hasExited: () => boolean;
}) => {
  const signals: Array<NodeJS.Signals> = [];
  let probes = 0;
  return {
    signals,
    teardown: Effect.forkChild(
      terminatePiProcess(
        (signal) => {
          signals.push(signal);
          return true;
        },
        input.hasExited,
        () => signals.includes("SIGTERM") && ++probes > input.probesUntilGone,
      ),
    ),
  };
};

describe("terminatePiProcess", () => {
  it.effect("does not send SIGKILL after the process group was seen gone", () =>
    Effect.gen(function* () {
      // Pi's exit is not observed yet and a later lookup finds a group under the same id.
      const pi = piGroup({ probesUntilGone: 1, hasExited: () => false });
      const fiber = yield* pi.teardown;
      yield* TestClock.adjust("20 millis");
      assert.isUndefined(fiber.pollUnsafe(), "teardown returned while the group still ran");
      yield* TestClock.adjust("20 millis");
      assert.isDefined(fiber.pollUnsafe(), "teardown still waiting after the group exited");
      yield* Fiber.join(fiber);
      assert.deepEqual(pi.signals, ["SIGTERM"]);
    }),
  );

  it.effect("does not send SIGKILL when Pi's exit is observed by the end of the grace", () =>
    Effect.gen(function* () {
      let exited = false;
      const pi = piGroup({ probesUntilGone: Infinity, hasExited: () => exited });
      const fiber = yield* pi.teardown;
      yield* TestClock.adjust("999 millis");
      exited = true;
      yield* TestClock.adjust("1 millis");
      yield* Fiber.join(fiber);
      assert.deepEqual(pi.signals, ["SIGTERM"]);
    }),
  );

  it.effect("sends SIGKILL when the group outlives the grace", () =>
    Effect.gen(function* () {
      const pi = piGroup({ probesUntilGone: Infinity, hasExited: () => false });
      const fiber = yield* pi.teardown;
      yield* TestClock.adjust("999 millis");
      assert.deepEqual(pi.signals, ["SIGTERM"]);
      yield* TestClock.adjust("1 millis");
      yield* Fiber.join(fiber);
      assert.deepEqual(pi.signals, ["SIGTERM", "SIGKILL"]);
    }),
  );
});
