/**
 * Every string a regular-expression source accepts, for the small syntax the safety-bypass word lists
 * use: literals, (?:a|b) groups, ? + * quantifiers, character classes and \s \b \. escapes. Whitespace
 * is rendered as one space. An open letter class ([a-z-]+) has an unbounded language, so it is rendered
 * as the given sample words. Anything else (counted repeats, lookarounds, backreferences) throws, so a
 * word list cannot silently grow syntax the matrix does not enumerate.
 */
export function regexLanguage(source: string, openClassSamples: readonly string[] = ["door"]): string[] {
  let i = 0;
  const peek = () => source[i];
  const fail = (why: string): never => {
    throw new Error(`regexLanguage: ${why} at ${i} in ${source.slice(Math.max(0, i - 20), i + 20)}`);
  };
  const cross = (a: string[], b: string[]) => a.flatMap((x) => b.map((y) => x + y));

  function alternation(): string[] {
    const out = [...sequence()];
    while (peek() === "|") {
      i++;
      out.push(...sequence());
    }
    return out;
  }
  function sequence(): string[] {
    let acc = [""];
    while (i < source.length && peek() !== "|" && peek() !== ")") acc = cross(acc, quantified());
    return acc;
  }
  function quantified(): string[] {
    const { strings, open } = atom();
    const q = peek();
    if (q === "?") {
      i++;
      return ["", ...strings];
    }
    if (q === "*") {
      i++;
      return ["", ...(open ? openClassSamples : strings)];
    }
    if (q === "+") {
      i++;
      return open ? [...openClassSamples] : strings;
    }
    if (q === "{") fail("counted repeat");
    if (open) fail("open class without a quantifier");
    return strings;
  }
  function atom(): { strings: string[]; open: boolean } {
    const c = peek();
    if (c === "(") {
      if (source.slice(i, i + 3) !== "(?:") fail("only non-capturing groups");
      i += 3;
      const inner = alternation();
      if (peek() !== ")") fail("unclosed group");
      i++;
      return { strings: inner, open: false };
    }
    if (c === "[") return charClass();
    if (c === "\\") {
      const e = source[i + 1];
      i += 2;
      if (e === "s") return { strings: [" "], open: false };
      if (e === "b") return { strings: [""], open: false };
      if (".-/".includes(e)) return { strings: [e], open: false };
      return fail(`escape \\${e}`);
    }
    if ("^$.".includes(c)) fail(`metacharacter ${c}`);
    i++;
    return { strings: [c], open: false };
  }
  function charClass(): { strings: string[]; open: boolean } {
    i++;
    const items: string[] = [];
    let open = false;
    while (peek() !== "]") {
      if (i >= source.length) fail("unclosed class");
      if (peek() === "\\") {
        const e = source[i + 1];
        i += 2;
        items.push(e === "s" ? " " : e);
      } else if (source[i + 1] === "-" && source[i + 2] !== "]") {
        open = true;
        i += 3;
      } else {
        items.push(source[i]);
        i++;
      }
    }
    i++;
    return { strings: [...new Set(items)], open };
  }

  const out = alternation();
  if (i !== source.length) fail("trailing input");
  return [...new Set(out.map((s) => s.replace(/ +/g, " ").trim()))].filter(Boolean);
}
