/* EditFlow 2.0 clean-room JSON codec for ExtendScript.
 * Does not use eval and does not depend on ambient Adobe panel state.
 */
(function () {
  "use strict";

  function fail(message, index) {
    throw new Error("EditFlow JSON error at " + index + ": " + message);
  }

  function hex4(code) {
    var text = code.toString(16).toUpperCase();
    while (text.length < 4) text = "0" + text;
    return text;
  }

  function isArray(value) {
    return value instanceof Array || Object.prototype.toString.call(value) === "[object Array]";
  }

  function quoteString(value) {
    var text = String(value);
    var out = '"';
    var i, code, ch;
    for (i = 0; i < text.length; i += 1) {
      ch = text.charAt(i);
      code = text.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (code < 32 || code === 0x2028 || code === 0x2029) out += "\\u" + hex4(code);
      else out += ch;
    }
    return out + '"';
  }

  function stringify(value) {
    var stack = [];

    function containsIdentity(candidate) {
      var i;
      for (i = 0; i < stack.length; i += 1) if (stack[i] === candidate) return true;
      return false;
    }

    function encode(candidate, inArray) {
      if (candidate === null) return "null";
      var type = typeof candidate;
      if (type === "string") return quoteString(candidate);
      if (type === "boolean") return candidate ? "true" : "false";
      if (type === "number") return isFinite(candidate) ? String(candidate) : "null";
      if (type === "undefined" || type === "function") return inArray ? "null" : undefined;
      if (type !== "object") return inArray ? "null" : undefined;
      if (containsIdentity(candidate)) throw new Error("EditFlow JSON cannot stringify cyclic structures.");

      stack.push(candidate);
      var out, i, item, key, encoded;
      if (isArray(candidate)) {
        out = "[";
        for (i = 0; i < candidate.length; i += 1) {
          if (i > 0) out += ",";
          item = encode(candidate[i], true);
          out += item === undefined ? "null" : item;
        }
        out += "]";
      } else {
        out = "{";
        var first = true;
        for (key in candidate) {
          if (Object.prototype.hasOwnProperty && !Object.prototype.hasOwnProperty.call(candidate, key)) continue;
          encoded = encode(candidate[key], false);
          if (encoded === undefined) continue;
          if (!first) out += ",";
          first = false;
          out += quoteString(key) + ":" + encoded;
        }
        out += "}";
      }
      stack.pop();
      return out;
    }

    return encode(value, false);
  }

  function parse(input) {
    var source = String(input);
    var index = 0;

    function skipWhitespace() {
      while (index < source.length) {
        var code = source.charCodeAt(index);
        if (code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0D) index += 1;
        else break;
      }
    }

    function parseLiteral(literal, value) {
      if (source.substr(index, literal.length) !== literal) fail("Expected " + literal, index);
      index += literal.length;
      return value;
    }

    function parseString() {
      if (source.charAt(index) !== '"') fail("Expected string", index);
      index += 1;
      var out = "";
      while (index < source.length) {
        var ch = source.charAt(index++);
        if (ch === '"') return out;
        if (ch === "\\") {
          if (index >= source.length) fail("Unterminated escape", index);
          var esc = source.charAt(index++);
          if (esc === '"' || esc === "\\" || esc === "/") out += esc;
          else if (esc === "b") out += "\b";
          else if (esc === "f") out += "\f";
          else if (esc === "n") out += "\n";
          else if (esc === "r") out += "\r";
          else if (esc === "t") out += "\t";
          else if (esc === "u") {
            var hex = source.substr(index, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid unicode escape", index);
            out += String.fromCharCode(parseInt(hex, 16));
            index += 4;
          } else fail("Invalid escape", index - 1);
        } else {
          if (ch.charCodeAt(0) < 32) fail("Control character in string", index - 1);
          out += ch;
        }
      }
      fail("Unterminated string", index);
    }

    function parseNumber() {
      var start = index;
      if (source.charAt(index) === "-") index += 1;
      if (source.charAt(index) === "0") index += 1;
      else {
        var digitStart = index;
        while (index < source.length && /[0-9]/.test(source.charAt(index))) index += 1;
        if (index === digitStart) fail("Invalid number", index);
      }
      if (source.charAt(index) === ".") {
        index += 1;
        var fractionStart = index;
        while (index < source.length && /[0-9]/.test(source.charAt(index))) index += 1;
        if (index === fractionStart) fail("Invalid fraction", index);
      }
      var exp = source.charAt(index);
      if (exp === "e" || exp === "E") {
        index += 1;
        var sign = source.charAt(index);
        if (sign === "+" || sign === "-") index += 1;
        var exponentStart = index;
        while (index < source.length && /[0-9]/.test(source.charAt(index))) index += 1;
        if (index === exponentStart) fail("Invalid exponent", index);
      }
      var value = Number(source.substring(start, index));
      if (!isFinite(value)) fail("Non-finite number", start);
      return value;
    }

    function parseArray() {
      var result = [];
      index += 1;
      skipWhitespace();
      if (source.charAt(index) === "]") { index += 1; return result; }
      while (true) {
        result.push(parseValue());
        skipWhitespace();
        var ch = source.charAt(index++);
        if (ch === "]") return result;
        if (ch !== ",") fail("Expected comma or closing bracket", index - 1);
        skipWhitespace();
      }
    }

    function parseObject() {
      var result = {};
      index += 1;
      skipWhitespace();
      if (source.charAt(index) === "}") { index += 1; return result; }
      while (true) {
        if (source.charAt(index) !== '"') fail("Expected object key", index);
        var key = parseString();
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          fail("Unsafe object key rejected", index);
        }
        skipWhitespace();
        if (source.charAt(index++) !== ":") fail("Expected colon", index - 1);
        skipWhitespace();
        result[key] = parseValue();
        skipWhitespace();
        var ch = source.charAt(index++);
        if (ch === "}") return result;
        if (ch !== ",") fail("Expected comma or closing brace", index - 1);
        skipWhitespace();
      }
    }

    function parseValue() {
      skipWhitespace();
      var ch = source.charAt(index);
      if (ch === '"') return parseString();
      if (ch === "{") return parseObject();
      if (ch === "[") return parseArray();
      if (ch === "t") return parseLiteral("true", true);
      if (ch === "f") return parseLiteral("false", false);
      if (ch === "n") return parseLiteral("null", null);
      if (ch === "-" || /[0-9]/.test(ch)) return parseNumber();
      fail("Unexpected token", index);
    }

    var value = parseValue();
    skipWhitespace();
    if (index !== source.length) fail("Trailing content", index);
    return value;
  }

  $.global.EditFlow2_JSON = { parse: parse, stringify: stringify };
}());
