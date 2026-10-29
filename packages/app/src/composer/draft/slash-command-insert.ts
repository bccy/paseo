/**
 * Compose the composer text after the desk pet's slash-command menu picks a
 * command.
 *
 * The menu is a shortcut, not a draft reset: the command goes to the head of the
 * draft and whatever the user already typed stays behind it. A draft that already
 * starts with a slash command has that token swapped for the new one, so tapping
 * two commands in a row does not stack `/a /b text`.
 *
 * Pure and React-free so the merge rules are testable without the input stack.
 *
 * @module paseo/composer/draft/slash-command-insert
 */

/** `/` plus the command name: everything up to the first whitespace. */
const LEADING_SLASH_COMMAND = /^\/\S+/;

/** Boundary whitespace the insert's own trailing space replaces. */
const LEADING_WHITESPACE = /^\s+/;

function withoutLeadingWhitespace(text: string): string {
  return text.replace(LEADING_WHITESPACE, "");
}

export function composeSlashCommandInsert(input: {
  /** The draft text as the user sees it. */
  currentText: string;
  /** What the menu inserts, e.g. `/model `. */
  insert: string;
}): string {
  const body = withoutLeadingWhitespace(input.currentText);
  if (body.length === 0) {
    return input.insert;
  }
  // A lone `/` is the user mid-way through typing a command, not draft prose;
  // treat it as an empty command token so the insert does not leave it behind.
  if (body === "/") {
    return input.insert;
  }
  const command = LEADING_SLASH_COMMAND.exec(body);
  if (!command) {
    return input.insert + body;
  }
  return input.insert + withoutLeadingWhitespace(body.slice(command[0].length));
}
