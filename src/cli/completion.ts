import { Command, Option } from "commander";

import { writeLine, type IO } from "./runtime.js";

type SupportedShell = "bash" | "fish" | "zsh";

function isSubcommandToken(command: Command, token: string): Command | undefined {
  return command.commands.find((candidate) => {
    if (candidate.name() === "__complete") {
      return false;
    }

    return candidate.name() === token || candidate.aliases().includes(token);
  });
}

function optionForms(option: Option): string[] {
  const forms = [];

  if (option.short) {
    forms.push(option.short);
  }

  if (option.long) {
    forms.push(option.long);
  }

  return forms;
}

function optionTakesValue(option: Option): boolean {
  return Boolean(option.required || option.optional);
}

function resolveCompletionContext(program: Command, tokens: string[]): Command {
  let current = program;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.startsWith("-")) {
      const option = current.options.find((candidate) => optionForms(candidate).includes(token));
      if (option && optionTakesValue(option)) {
        index += 1;
      }
      continue;
    }

    const subcommand = isSubcommandToken(current, token);
    if (subcommand) {
      current = subcommand;
    }
  }

  return current;
}

function visibleCommands(command: Command): Command[] {
  return command.commands.filter((candidate) => {
    const hiddenCandidate = candidate as Command & { _hidden?: boolean };
    return candidate.name() !== "__complete" && hiddenCandidate._hidden !== true;
  });
}

function commandSuggestions(command: Command): string[] {
  return visibleCommands(command).map((candidate) => candidate.name());
}

function optionSuggestions(command: Command): string[] {
  const forms = command.options.flatMap((option) => optionForms(option));
  return ["-h", "--help", ...forms];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function getCompletionSuggestions(program: Command, words: string[]): string[] {
  const currentWord = words.at(-1) ?? "";
  const tokensBeforeCursor = currentWord === "" ? words : words.slice(0, -1);
  const context = resolveCompletionContext(program, tokensBeforeCursor);
  const suggestions =
    currentWord.startsWith("-")
      ? optionSuggestions(context)
      : [...commandSuggestions(context), ...optionSuggestions(context)];

  return uniqueSorted(suggestions).filter((candidate) => candidate.startsWith(currentWord));
}

function renderBashCompletionScript(): string {
  return [
    "# bash completion for takcli",
    "_takcli_completion() {",
    "  local IFS=$'\\n'",
    '  local words=("${COMP_WORDS[@]:1}")',
    '  COMPREPLY=($(takcli __complete bash -- "${words[@]}"))',
    "}",
    "",
    "complete -o default -F _takcli_completion takcli",
    ""
  ].join("\n");
}

function renderZshCompletionScript(): string {
  return [
    "#compdef takcli",
    "",
    "_takcli_completion() {",
    "  local -a completions",
    '  completions=("${(@f)$(takcli __complete zsh -- "${words[@]:1}")}")',
    "  _describe 'takcli completions' completions",
    "}",
    "",
    "compdef _takcli_completion takcli",
    ""
  ].join("\n");
}

function renderFishCompletionScript(): string {
  return [
    "function __takcli_complete",
    "  set -l words (commandline -opc)",
    "  set -e words[1]",
    "  takcli __complete fish -- $words",
    "end",
    "",
    "complete -c takcli -f -a '(__takcli_complete)'",
    ""
  ].join("\n");
}

export function renderCompletionScript(shell: SupportedShell): string {
  switch (shell) {
    case "bash":
      return renderBashCompletionScript();
    case "fish":
      return renderFishCompletionScript();
    case "zsh":
      return renderZshCompletionScript();
  }
}

export function createCompletionCommand(io: IO): Command {
  return new Command("completion")
    .description("Generate shell completion scripts.")
    .argument("<shell>", "Shell name: bash, zsh, or fish")
    .action(function (shell: string) {
      if (shell !== "bash" && shell !== "fish" && shell !== "zsh") {
        throw new Error(`Unsupported shell: ${shell}`);
      }

      io.stdout(renderCompletionScript(shell));
    });
}

export function createHiddenCompletionCommand(program: Command, io: IO): Command {
  const command = new Command("__complete")
    .argument("<shell>", "Shell name")
    .argument("[words...]", "Completion words")
    .action(function (_shell: string, words: string[] = []) {
      const suggestions = getCompletionSuggestions(program, words);
      for (const suggestion of suggestions) {
        writeLine(io, suggestion);
      }
    });

  (command as Command & { _hidden?: boolean })._hidden = true;
  return command;
}
