import { expect, it } from "vitest";
import { escapeLike } from "./like";

it("escapes LIKE wildcards and the escape character", () => {
  expect(escapeLike("50% off_now\\x")).toBe("50\\% off\\_now\\\\x");
  expect(escapeLike("Ana")).toBe("Ana");
});
