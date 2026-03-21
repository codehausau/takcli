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

  it("suggests deploy at the top level", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["de"]);

    expect(suggestions).toContain("deploy");
  });

  it("suggests users at the top level", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["us"]);

    expect(suggestions).toContain("users");
  });

  it("suggests observe at the top level", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["ob"]);

    expect(suggestions).toContain("observe");
  });

  it("suggests nested profile subcommands", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["profile", "a"]);

    expect(suggestions).toContain("add");
  });

  it("suggests nested cot subcommands", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["cot", "q"]);

    expect(suggestions).toContain("query");
  });

  it("suggests nested users subcommands", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["users", "g"]);

    expect(suggestions).toContain("groups");
  });

  it("suggests nested observe subcommands", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["observe", "l"]);

    expect(suggestions).toContain("logs");
  });

  it("suggests observe logs options", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["observe", "logs", "--d"]);

    expect(suggestions).toContain("--deployment");
  });

  it("suggests command options", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["doctor", "--i"]);

    expect(suggestions).toContain("--insecure");
  });

  it("suggests cot command options", () => {
    const program = createCli({
      stderr: () => undefined,
      stdout: () => undefined
    });

    const suggestions = getCompletionSuggestions(program, ["cot", "follow", "--r"]);

    expect(suggestions).toContain("--raw");
  });
});
