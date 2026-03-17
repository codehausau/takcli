import { describe, expect, it } from "vitest";

import { createCli } from "../../src/cli/create-cli.js";
import { getCompletionSuggestions, renderCompletionScript } from "../../src/cli/completion.js";

describe("completion support", () => {
  it("renders a bash completion script", () => {
    const script = renderCompletionScript("bash");

    expect(script).toContain("takcli __complete bash");
    expect(script).toContain("complete -o default -F _takcli_completion takcli");
  });

  it("suggests top-level commands", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["st"]);

    expect(suggestions).toContain("status");
    expect(suggestions).not.toContain("__complete");
  });

  it("suggests nested profile subcommands", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["profile", "a"]);

    expect(suggestions).toContain("add");
  });

  it("suggests command options", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["doctor", "--i"]);

    expect(suggestions).toContain("--insecure");
  });
});
