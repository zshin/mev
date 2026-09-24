import assert from "node:assert/strict";
import test from "node:test";

import { closedReasonCopy, CLOSED_REASONS } from "@/lib/jev/contract";
import { jevHealth, readTypesafeApiKey } from "@/lib/jev/keyStatus";

test("health reports configured without echoing the key", () => {
  const secret = "super-secret-key";
  assert.equal(readTypesafeApiKey({}), undefined);
  assert.equal(readTypesafeApiKey({ TYPESAFE_API_KEY: "  " }), undefined);
  assert.equal(readTypesafeApiKey({ TYPESAFE_API_KEY: `  ${secret}  ` }), secret);

  const present = jevHealth({ TYPESAFE_API_KEY: secret });
  const absent = jevHealth({});
  assert.equal(present.configured, true);
  assert.equal(absent.configured, false);
  assert.equal(present.model, "jev-latest");
  assert.equal(JSON.stringify(present).includes(secret), false);
  assert.equal(JSON.stringify(absent).includes("TYPESAFE"), false);
});

test("closed reasons have display copy and do not mention a key value", () => {
  for (const reason of CLOSED_REASONS) {
    const copy = closedReasonCopy(reason);
    assert.equal(copy.length > 0, true);
    assert.equal(copy.toLowerCase().includes("bearer"), false);
  }
});
