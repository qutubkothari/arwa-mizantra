export type FormulaInputs = Record<string, number>;

type Token = { type: "number" | "name" | "op" | "paren" | "comma"; value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    const rest = expression.slice(cursor);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { cursor += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { tokens.push({ type: "number", value: number[0] }); cursor += number[0].length; continue; }
    const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (name) { tokens.push({ type: "name", value: name[0] }); cursor += name[0].length; continue; }
    const char = rest[0];
    if ("+-*/^".includes(char)) tokens.push({ type: "op", value: char });
    else if ("()".includes(char)) tokens.push({ type: "paren", value: char });
    else if (char === ",") tokens.push({ type: "comma", value: char });
    else throw new Error(`Unsupported formula character '${char}'`);
    cursor += 1;
  }
  return tokens;
}

export function evaluateProductionFormula(expression: string, inputs: FormulaInputs): number {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];
  const parsePrimary = (): number => {
    const token = consume();
    if (!token) throw new Error("Formula ended unexpectedly");
    if (token.type === "number") return Number(token.value);
    if (token.type === "op" && ["+", "-"].includes(token.value)) {
      const value = parsePrimary();
      return token.value === "-" ? -value : value;
    }
    if (token.type === "paren" && token.value === "(") {
      const value = parseAddSubtract();
      if (consume()?.value !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token.type === "name") {
      if (peek()?.value === "(") {
        consume();
        const args: number[] = [];
        if (peek()?.value !== ")") {
          do { args.push(parseAddSubtract()); } while (peek()?.type === "comma" && consume());
        }
        if (consume()?.value !== ")") throw new Error("Missing function closing parenthesis");
        const fn = token.value.toLowerCase();
        if (fn === "min") return Math.min(...args);
        if (fn === "max") return Math.max(...args);
        if (fn === "ceil" && args.length === 1) return Math.ceil(args[0]);
        if (fn === "floor" && args.length === 1) return Math.floor(args[0]);
        if (fn === "round" && args.length === 1) return Math.round(args[0]);
        if (fn === "abs" && args.length === 1) return Math.abs(args[0]);
        throw new Error(`Unsupported function '${token.value}'`);
      }
      if (!Object.prototype.hasOwnProperty.call(inputs, token.value)) throw new Error(`Missing input '${token.value}'`);
      const value = Number(inputs[token.value]);
      if (!Number.isFinite(value)) throw new Error(`Input '${token.value}' must be numeric`);
      return value;
    }
    throw new Error(`Unexpected token '${token.value}'`);
  };
  const parsePower = (): number => {
    let value = parsePrimary();
    while (peek()?.value === "^") { consume(); value = Math.pow(value, parsePrimary()); }
    return value;
  };
  const parseMultiplyDivide = (): number => {
    let value = parsePower();
    while (["*", "/"].includes(peek()?.value)) {
      const operator = consume().value, right = parsePower();
      if (operator === "/" && right === 0) throw new Error("Division by zero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const parseAddSubtract = (): number => {
    let value = parseMultiplyDivide();
    while (["+", "-"].includes(peek()?.value)) {
      const operator = consume().value, right = parseMultiplyDivide();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = parseAddSubtract();
  if (position !== tokens.length) throw new Error(`Unexpected token '${tokens[position].value}'`);
  if (!Number.isFinite(result)) throw new Error("Formula result is not finite");
  return result;
}

export function roundProductionFormula(value: number, mode: string, places: number): number {
  const factor = 10 ** Math.max(0, Math.min(8, Math.round(places || 0)));
  if (mode === "UP") return Math.ceil(value * factor) / factor;
  if (mode === "DOWN") return Math.floor(value * factor) / factor;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
