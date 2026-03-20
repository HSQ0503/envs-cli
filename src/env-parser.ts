type ParsedEnv = {
  variables: Record<string, string>;
  comments: string[];
  raw: string;
};

export function parseEnvFile(content: string): ParsedEnv {
  const variables: Record<string, string> = {};
  const comments: string[] = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "" || line.trim().startsWith("#")) {
      comments.push(line);
      i++;
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      comments.push(line);
      i++;
      continue;
    }

    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1);

    // Handle quoted multiline values
    const trimmedValue = value.trim();
    if (
      (trimmedValue.startsWith('"') && !trimmedValue.endsWith('"')) ||
      (trimmedValue.startsWith("'") && !trimmedValue.endsWith("'"))
    ) {
      const quote = trimmedValue[0];
      const parts = [value];
      i++;
      while (i < lines.length) {
        parts.push(lines[i]);
        if (lines[i].trimEnd().endsWith(quote)) {
          break;
        }
        i++;
      }
      value = parts.join("\n");
    }

    // Strip surrounding quotes
    const stripped = value.trim();
    if (
      (stripped.startsWith('"') && stripped.endsWith('"')) ||
      (stripped.startsWith("'") && stripped.endsWith("'"))
    ) {
      value = stripped.slice(1, -1);
    } else {
      value = stripped;
    }

    variables[key] = value;
    i++;
  }

  return { variables, comments, raw: content };
}

export function serializeEnv(
  variables: Record<string, string>,
  comments: string[] = []
): string {
  const lines: string[] = [];

  // Write preserved comments first
  for (const comment of comments) {
    lines.push(comment);
  }

  if (comments.length > 0) {
    // Add separator if we had comments
    const lastComment = comments[comments.length - 1];
    if (lastComment.trim() !== "") {
      lines.push("");
    }
  }

  for (const [key, value] of Object.entries(variables)) {
    if (value.includes("\n")) {
      lines.push(`${key}="${value}"`);
    } else if (
      value.includes(" ") ||
      value.includes("#") ||
      value.includes("=")
    ) {
      lines.push(`${key}="${value}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join("\n") + "\n";
}
