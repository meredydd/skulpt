// Skulpt handles both 'str' and 'bytes' with Javascript strings.
// When 'str's contain astral code points, we compute the indices
// of these codepoints up front, and use those instead of the
// JS string indices (which are full of surrogate-pair malarkey).

let checkStringish = (self, v) => (v !== null && v.constructor === self.__class__);

Sk.builtin.bytes = function(source, encoding, errors) {
    Sk.builtin.pyCheckArgsLen("bytes", arguments.length, 0, 3);

    let isConstructor = (this instanceof Sk.builtin.bytes);

    let dunderBytes;

    if (isConstructor && typeof(source) === "string") {
        this.__class__ = Sk.builtin.bytes;
        this.v = source;
        return this;
    }

    if (source === undefined) {
        source = "";

    } else if (source instanceof Sk.builtin.str) {
        if (!(encoding instanceof Sk.builtin.str)) {
            throw new Sk.builtin.TypeError("string argument without an encoding");
        }
        return Sk.misceval.callsimArray(Sk.builtin.str.prototype["encode"], [source, encoding, errors]);

    } else if (source instanceof Sk.builtin.int_) {
        source = "\x00".repeat(source.v);

    } else if (source instanceof Sk.builtin.bytes) {
        source = source.v;

    } else if ((dunderBytes = Sk.builtin.type.typeLookup(source.ob$type, Sk.builtin.str.$bytes))) {
        let r = Sk.misceval.callsimArray(dunderBytes, [source]);
        return isConstructor ? Sk.misceval.retryOptionalSuspensionOrThrow(r) : r;

    } else {
        // Try to iterate.
        let v = "";
        let r = Sk.misceval.iterFor(Sk.abstr.iter(source), (byte) => {
            if (!Sk.builtin.checkInt(byte)) {
                throw new Sk.builtin.TypeError("'" + Sk.abstr.typeName(byte) + "' object cannot be interpreted as an integer");
            }
            let n = Sk.builtin.asnum$(byte);
            if (n < 0 || n > 255) {
                throw new Sk.builtin.ValueError("bytes must be in range(0, 256)");
            }
            v += String.fromCodePoint(n);
        });

        // If we aren't being constructed, we can suspend.
        if (isConstructor) {
            Sk.misceval.retryOptionalSuspensionOrThrow(r);
            source = v;
        } else {
            return Sk.misceval.chain(r, () => new Sk.builtin.bytes(v));
        }
    }

    if (encoding) {
        // We haven't got here if it was a string
        throw new Sk.builtin.TypeError("encoding without a string argument");
    }

    for (let i=0; i < source.length; i++) {
        if (source.charCodeAt(i) > 0xff) {
            throw new Sk.builtin.ValueError("bytes must be in range(0, 256)");
        }
    }

    if (isConstructor) {
        this.__class__ = Sk.builtin.bytes;
        this.v = source;
        return this;
    } else {
        return new Sk.builtin.bytes(source);
    }
};
Sk.exportSymbol("Sk.builtin.bytes", Sk.builtin.bytes);

Sk.abstr.setUpInheritance("bytes", Sk.builtin.bytes, Sk.builtin.seqtype);



Sk.builtin.interned = {};

/**
 * @constructor
 * @param {*} x
 * @extends Sk.builtin.object
 */
Sk.builtin.str = function (x, encoding) {
    var ret;

    Sk.builtin.pyCheckArgsLen("str", arguments.length, 0, Sk.__future__ && Sk.__future__.python3 ? 2 : 1);

    if (x === undefined) {
        x = "";
    }

    if (encoding || x instanceof Sk.builtin.bytes) {
        if (!Sk.builtin.checkBytes(x)) {
            throw new TypeError("decoding " + Sk.abstr.typeName(x) + " is not supported");
        }
        return Sk.misceval.callsimArray(x.tp$getattr(new Sk.builtin.str("decode")), encoding ? [encoding] : []);
    }

    if (x instanceof Sk.builtin.str) {
        return x;
    }
    if (!(this instanceof Sk.builtin.str)) {
        return new Sk.builtin.str(x);
    }


    // convert to js string
    if (x === true) {
        ret = "True";
    } else if (x === false) {
        ret = "False";
    } else if ((x === null) || (x instanceof Sk.builtin.none)) {
        ret = "None";
    } else if (x instanceof Sk.builtin.bool) {
        if (x.v) {
            ret = "True";
        } else {
            ret = "False";
        }
    } else if (typeof x === "number") {
        ret = x.toString();
        if (ret === "Infinity") {
            ret = "inf";
        } else if (ret === "-Infinity") {
            ret = "-inf";
        }
    } else if (typeof x === "string") {
        ret = x;
    } else if (x.tp$str !== undefined) {
        ret = x.tp$str();
        if (!(ret instanceof Sk.builtin.str)) {
            throw new Sk.builtin.ValueError("__str__ didn't return a str");
        }
        return ret;
    } else {
        return Sk.misceval.objectRepr(x);
    }

    // interning required for strings in py
    if (Sk.builtin.interned["1" + ret]) {
        return Sk.builtin.interned["1" + ret];
    }

    this.__class__ = Sk.builtin.str;
    this.v = ret;
    this["v"] = this.v;
    Sk.builtin.interned["1" + ret] = this;

    return this;

};
Sk.exportSymbol("Sk.builtin.str", Sk.builtin.str);

Sk.abstr.setUpInheritance("str", Sk.builtin.str, Sk.builtin.seqtype);

Sk.builtin.str.$englishname = "string";
Sk.builtin.bytes.$englishname = "bytes";
Sk.builtin.str.$englishsingular = "char";
Sk.builtin.bytes.$englishsingular = "byte";

Sk.builtin.str.prototype.$hasAstralCodePoints = function() {
    // If a string has astral code points, we have to work
    // out where they are before we can do things like
    // slicing, computing length, etc.
    // We work this out when we need to.

    if (this.codepoints === null) {
        return false;
    } else if (this.codepoints !== undefined) {
        return true;
    }
    // Does this string contain astral code points? If so, we have to do things
    // the slow way.
    for (let i = 0; i < this.v.length; i++) {
        let cc = this.v.charCodeAt(i);
        if (cc >= 0xd800 && cc < 0xe000) {
            // Yep, it's a surrogate pair. Mark off the
            // indices of all the code points for O(1) seeking
            // later

            this.codepoints = [];
            for (let j = 0; j < this.v.length; j++) {
                this.codepoints.push(j);
                cc = this.v.charCodeAt(j);
                if (cc >= 0xd800 && cc < 0xdc00) {
                    // High surrogate. Skip next char
                    j++;
                }
            }
            return true;
        }
    }
    this.codepoints = null;
    return false;
};

Sk.builtin.bytes.prototype.$hasAstralCodePoints = () => false;

Sk.builtin.str.prototype.$jsstr = Sk.builtin.bytes.prototype.$jsstr = function () {
    return this.v;
};

Sk.builtin.str.prototype.mp$subscript = function (index) {
    var ret;
    if (Sk.misceval.isIndex(index)) {
        index = Sk.misceval.asIndex(index);
        let len = this.$hasAstralCodePoints() ? this.codepoints.length : this.v.length;
        if (index < 0) {
            index = len + index;
        }
        if (index < 0 || index >= len) {
            throw new Sk.builtin.IndexError("string index out of range");
        }
        if (this.codepoints) {
            return new Sk.builtin.str(this.v.substring(this.codepoints[index], this.codepoints[index+1]));
        } else {
            return new Sk.builtin.str(this.v.charAt(index));
        }
    } else if (index instanceof Sk.builtin.slice) {
        ret = "";
        if (this.$hasAstralCodePoints()) {
            index.sssiter$(this.codepoints.length, (i, wrt) => {
                if (i >= 0 && i < this.codepoints.length) {
                    ret += this.v.substring(this.codepoints[i], this.codepoints[i+1]);
                }
            });
        } else {
            index.sssiter$(this, function (i, wrt) {
                if (i >= 0 && i < wrt.v.length) {
                    ret += wrt.v.charAt(i);
                }
            });
        };
        return new Sk.builtin.str(ret);
    } else {
        throw new Sk.builtin.TypeError("string indices must be integers, not " + Sk.abstr.typeName(index));
    }
};

Sk.builtin.bytes.prototype.mp$subscript = function(index) {
    if (Sk.misceval.isIndex(index)) {
        index = Sk.misceval.asIndex(index);
        if (index < 0) {
            index = this.v.length + index;
        }
        if (index < 0 || index >= this.v.length) {
            throw new Sk.builtin.IndexError("bytestring index out of range");
        }
        return new Sk.builtin.int_(this.v.charCodeAt(index));
    } else if (index instanceof Sk.builtin.slice) {
        let ret = "";
        index.sssiter$(this, function (i, wrt) {
            if (i >= 0 && i < wrt.v.length) {
                ret += wrt.v.charAt(i);
            }
        });
        return new Sk.builtin.bytes(ret);
    } else {
        throw new Sk.builtin.TypeError("bytestring indices must be integers, not " + Sk.abstr.typeName(index));
    }
};

Sk.builtin.str.prototype.sq$length = function () {
    return this.$hasAstralCodePoints() ? this.codepoints.length : this.v.length;
};
Sk.builtin.bytes.prototype.sq$length = function () {
    return this.v.length;
};
Sk.builtin.str.prototype.sq$concat = Sk.builtin.bytes.prototype.sq$concat = function (other) {
    var otypename;
    if (!other || other.__class__ !== this.__class__) {
        otypename = Sk.abstr.typeName(other);
        throw new Sk.builtin.TypeError("cannot concatenate '" + this.tp$name + "' and '" + otypename + "' objects");
    }
    return new this.__class__(this.v + other.v);
};
Sk.builtin.str.prototype.nb$add = Sk.builtin.bytes.prototype.nb$add = Sk.builtin.str.prototype.sq$concat;
Sk.builtin.str.prototype.nb$inplace_add = Sk.builtin.bytes.prototype.nb$add = Sk.builtin.str.prototype.sq$concat;
Sk.builtin.str.prototype.sq$repeat = Sk.builtin.bytes.prototype.sq$repeat = function (n) {
    var i;
    var ret;

    if (!Sk.misceval.isIndex(n)) {
        throw new Sk.builtin.TypeError("can't multiply sequence by non-int of type '" + Sk.abstr.typeName(n) + "'");
    }

    n = Sk.misceval.asIndex(n);
    ret = "";
    for (i = 0; i < n; ++i) {
        ret += this.v;
    }
    return new this.__class__(ret);
};
Sk.builtin.str.prototype.nb$multiply = Sk.builtin.bytes.prototype.nb$multiply = Sk.builtin.str.prototype.sq$repeat;
Sk.builtin.str.prototype.nb$inplace_multiply = Sk.builtin.bytes.prototype.nb$inplace_multiply = Sk.builtin.str.prototype.sq$repeat;
Sk.builtin.str.prototype.sq$item = Sk.builtin.bytes.prototype.sq$item = function () {
    Sk.asserts.fail();
};
Sk.builtin.str.prototype.sq$slice = Sk.builtin.bytes.prototype.sq$slice = function (i1, i2) {
    i1 = Sk.builtin.asnum$(i1);
    i2 = Sk.builtin.asnum$(i2);
    if (i1 < 0) {
        i1 = 0;
    }
    if (this.$hasAstralCodePoints()) {
        if (i1 >= this.codepoints.length) {
            return this.__class__.$emptystr;
        }
        return new this.__class__(this.v.substring(this.codepoints[i1], this.codepoints[i2]));
    } else {
        return new this.__class__(this.v.substring(i1, i2));
    }
};

Sk.builtin.str.prototype.sq$contains = function (ob) {
    if (!(ob instanceof Sk.builtin.str)) {
        throw new Sk.builtin.TypeError("TypeError: 'In <string> requires string as left operand");
    }
    return this.v.indexOf(ob.v) != -1;
};

Sk.builtin.bytes.prototype.sq$contains = function(ob) {
    if (ob instanceof Sk.builtin.bytes) {
        return this.v.indexOf(ob.v) != -1;
    } else if (Sk.builtin.checkInt(ob)) {
        let v = Sk.ffi.remapToJs(ob);
        if (v < 0 || v > 0xff) {
            throw new Sk.builtin.ValueError("byte must be in range (0, 256)");
        }
        return this.v.indexOf(String.fromCharCode(v)) != -1;
    } else {
        throw new Sk.builtin.TypeError("TypeError: 'In <bytes> requires a bytes-like object as left operand, not " + Sk.abstr.typeName(ob));
    }
};

Sk.builtin.str.prototype.__iter__ = new Sk.builtin.func(function (self) {
    return new Sk.builtin.str_iter_(self);
});

Sk.builtin.str.prototype.tp$iter = function () {
    return new Sk.builtin.str_iter_(this);
};

Sk.builtin.bytes.prototype.tp$iter = function() {
    let i = 0;
    return new Sk.misceval.Iterator(() => {
        if (i < this.v.length) {
            return new Sk.builtin.int_(this.v.charCodeAt(i++));
        }
    }, true);
};

Sk.builtin.str.prototype.tp$richcompare = Sk.builtin.bytes.prototype.tp$richcompare = function (other, op) {
    if (!(other instanceof this.__class__)) {
        return Sk.builtin.NotImplemented.NotImplemented$;
    }

    switch (op) {
        case "Lt":
            return this.v < other.v;
        case "LtE":
            return this.v <= other.v;
        case "Eq":
            return this.v === other.v;
        case "NotEq":
            return this.v !== other.v;
        case "Gt":
            return this.v > other.v;
        case "GtE":
            return this.v >= other.v;
        default:
            Sk.asserts.fail();
    }
};

Sk.builtin.str.prototype["$r"] = Sk.builtin.bytes.prototype["$r"] = function () {
    // single is preferred
    var ashex;
    var c;
    var cc;
    var i;
    var ret;
    var len;
    var quote = "'";
    //jshint ignore:start
    if (this.v.indexOf("'") !== -1 && this.v.indexOf('"') === -1) {
        quote = '"';
    }
    //jshint ignore:end
    len = this.v.length;
    ret = (this.__class__ === Sk.builtin.bytes) ? "b" + quote : quote;
    for (i = 0; i < len; ++i) {
        c = this.v.charAt(i);
        cc = this.v.charCodeAt(i);
        if (c === quote || c === "\\") {
            ret += "\\" + c;
        } else if (c === "\t") {
            ret += "\\t";
        } else if (c === "\n") {
            ret += "\\n";
        } else if (c === "\r") {
            ret += "\\r";
        } else if ((cc > 0xff && cc < 0xd800 || cc >= 0xe000) && !Sk.__future__.python3) {
            // BMP
            ret += "\\u" + ("000"+cc.toString(16)).slice(-4);
        } else if (cc >= 0xd800 && !Sk.__future__.python3) {
            // Surrogate pair stuff
            let val = this.v.codePointAt(i);
            i++;

            val = val.toString(16);
            let s = ("0000000"+val.toString(16));
            if (val.length > 4) {
                ret += "\\U" + s.slice(-8);
            } else {
                ret += "\\u" + s.slice(-4);
            }
        } else if (cc > 0xff && !Sk.__future__.python3) {
            // Invalid!
            ret += "\\ufffd";
        } else if (c < " " || cc >= 0x7f && !Sk.__future__.python3) {
            ashex = c.charCodeAt(0).toString(16);
            if (ashex.length < 2) {
                ashex = "0" + ashex;
            }
            ret += "\\x" + ashex;
        } else {
            ret += c;
        }
    }
    ret += quote;
    return new Sk.builtin.str(ret);
};


Sk.builtin.str.re_escape_ = function (s) {
    var c;
    var i;
    var ret = [];
    var re = /^[A-Za-z0-9]+$/;
    for (i = 0; i < s.length; ++i) {
        c = s.charAt(i);

        if (re.test(c)) {
            ret.push(c);
        } else {
            if (c === "\\000") {
                ret.push("\\000");
            } else {
                ret.push("\\" + c);
            }
        }
    }
    return ret.join("");
};

Sk.builtin.str.prototype["lower"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("lower", arguments.length, 1, 1);
    return new Sk.builtin.str(self.v.toLowerCase());
});

Sk.builtin.str.prototype["upper"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("upper", arguments.length, 1, 1);
    return new Sk.builtin.str(self.v.toUpperCase());
});

Sk.builtin.str.prototype["capitalize"] = new Sk.builtin.func(function (self) {
    var i;
    var cap;
    var orig;
    Sk.builtin.pyCheckArgsLen("capitalize", arguments.length, 1, 1);
    orig = self.v;

    if (orig.length === 0) {
        return new Sk.builtin.str("");
    }
    cap = orig.charAt(0).toUpperCase();

    for (i = 1; i < orig.length; i++) {
        cap += orig.charAt(i).toLowerCase();
    }
    return new Sk.builtin.str(cap);
});

Sk.builtin.str.prototype["join"] = Sk.builtin.bytes.prototype["join"] = new Sk.builtin.func(function (self, seq) {
    var it, i;
    var arrOfStrs;
    Sk.builtin.pyCheckArgsLen("join", arguments.length, 2, 2);
    Sk.builtin.pyCheckType("seq", "iterable", Sk.builtin.checkIterable(seq));
    arrOfStrs = [];
    for (it = seq.tp$iter(), i = it.tp$iternext(); i !== undefined; i = it.tp$iternext()) {
        if (i.constructor !== self.__class__) {
            throw new Sk.builtin.TypeError("TypeError: sequence item " + arrOfStrs.length + ": expected " + self.__class__.$englishname + ", " + typeof i + " found");
        }
        arrOfStrs.push(i.v);
    }
    return new self.__class__(arrOfStrs.join(self.v));
});

Sk.builtin.str.prototype["split"] = Sk.builtin.bytes.prototype["split"] = new Sk.builtin.func(function (self, on, howmany) {
    var splits;
    var index;
    var match;
    var result;
    var s;
    var str;
    var regex;
    Sk.builtin.pyCheckArgsLen("split", arguments.length, 1, 3);
    if ((on === undefined) || (on instanceof Sk.builtin.none)) {
        on = null;
    }
    if ((on !== null) && !checkStringish(self, on)) {
        throw new Sk.builtin.TypeError("expected " + self.__class__.$englishname);
    }
    if ((on !== null) && on.v === "") {
        throw new Sk.builtin.ValueError("empty separator");
    }
    if ((howmany !== undefined) && !Sk.builtin.checkInt(howmany)) {
        throw new Sk.builtin.TypeError("an integer is required");
    }

    howmany = Sk.builtin.asnum$(howmany);
    regex = /[\s\xa0]+/g;
    str = self.v;
    if (on === null) {
        // Remove leading whitespace
        str = str.replace(/^[\s\xa0]+/, "");
    } else {
        // Escape special characters in "on" so we can use a regexp
        s = on.v.replace(/([.*+?=|\\\/()\[\]\{\}^$])/g, "\\$1");
        regex = new RegExp(s, "g");
    }

    // This is almost identical to re.split,
    // except how the regexp is constructed

    result = [];
    index = 0;
    splits = 0;
    while ((match = regex.exec(str)) != null) {
        if (match.index === regex.lastIndex) {
            // empty match
            break;
        }
        result.push(new self.__class__(str.substring(index, match.index)));
        index = regex.lastIndex;
        splits += 1;
        if (howmany && (splits >= howmany)) {
            break;
        }
    }
    str = str.substring(index);
    if (on !== null || (str.length > 0)) {
        result.push(new self.__class__(str));
    }

    return new Sk.builtin.list(result);
});

Sk.builtin.str.prototype["strip"] = Sk.builtin.bytes.prototype["strip"] = new Sk.builtin.func(function (self, chars) {
    var regex;
    var pattern;
    Sk.builtin.pyCheckArgsLen("strip", arguments.length, 1, 2);
    if ((chars !== undefined) && chars.__class__ !== self.__class__) {
        throw new Sk.builtin.TypeError("strip arg must be None or " + self.__class__.$englishname);
    }
    if (chars === undefined) {
        pattern = /^\s+|\s+$/g;
    } else {
        regex = Sk.builtin.str.re_escape_(chars.v);
        pattern = new RegExp("^[" + regex + "]+|[" + regex + "]+$", "g");
    }
    return new self.__class__(self.v.replace(pattern, ""));
});

Sk.builtin.str.prototype["lstrip"] = Sk.builtin.bytes.prototype["lstrip"] = new Sk.builtin.func(function (self, chars) {
    var regex;
    var pattern;
    Sk.builtin.pyCheckArgsLen("lstrip", arguments.length, 1, 2);
    if ((chars !== undefined) && chars.__class__ !== self.__class__) {
        throw new Sk.builtin.TypeError("lstrip arg must be None or " + self.__class__.$englishname);
    }
    if (chars === undefined) {
        pattern = /^\s+/g;
    } else {
        regex = Sk.builtin.str.re_escape_(chars.v);
        pattern = new RegExp("^[" + regex + "]+", "g");
    }
    return new self.__class__(self.v.replace(pattern, ""));
});

Sk.builtin.str.prototype["rstrip"] = Sk.builtin.bytes.prototype["rstrip"] = new Sk.builtin.func(function (self, chars) {
    var regex;
    var pattern;
    Sk.builtin.pyCheckArgsLen("rstrip", arguments.length, 1, 2);
    if ((chars !== undefined) && chars.__class__ !== self.__class__) {
        throw new Sk.builtin.TypeError("rstrip arg must be None or " + self.__class__.$englishname);
    }
    if (chars === undefined) {
        pattern = /\s+$/g;
    } else {
        regex = Sk.builtin.str.re_escape_(chars.v);
        pattern = new RegExp("[" + regex + "]+$", "g");
    }
    return new self.__class__(self.v.replace(pattern, ""));
});

Sk.builtin.str.prototype["__format__"] = new Sk.builtin.func(function (self, format_spec) {
    var formatstr;
    Sk.builtin.pyCheckArgsLen("__format__", arguments.length, 2, 2);

    if (!Sk.builtin.checkString(format_spec)) {
        if (Sk.__future__.exceptions) {
            throw new Sk.builtin.TypeError("format() argument 2 must be str, not " + Sk.abstr.typeName(format_spec));
        } else {
            throw new Sk.builtin.TypeError("format expects arg 2 to be string or unicode, not " + Sk.abstr.typeName(format_spec));
        }
    } else {
        formatstr = Sk.ffi.remapToJs(format_spec);
        if (formatstr !== "" && formatstr !== "s") {
            throw new Sk.builtin.NotImplementedError("format spec is not yet implemented");
        }
    }

    return new Sk.builtin.str(self);
});

Sk.builtin.str.prototype["partition"] = Sk.builtin.bytes.prototype["partition"] = new Sk.builtin.func(function (self, sep) {
    var pos;
    var sepStr;
    Sk.builtin.pyCheckArgsLen("partition", arguments.length, 2, 2);
    Sk.builtin.pyCheckType("sep", self.__class__.$englishname, checkStringish(self, sep));
    sepStr = new self.__class__(sep);
    pos = self.v.indexOf(sepStr.v);
    if (pos < 0) {
        return new Sk.builtin.tuple([self, self.__class__.$emptystr, self.__class__.$emptystr]);
    }

    return new Sk.builtin.tuple([
        new self.__class__(self.v.substring(0, pos)),
        sepStr,
        new self.__class__(self.v.substring(pos + sepStr.v.length))]);
});

Sk.builtin.str.prototype["rpartition"] = Sk.builtin.bytes.prototype["rpartition"] = new Sk.builtin.func(function (self, sep) {
    var pos;
    var sepStr;
    Sk.builtin.pyCheckArgsLen("rpartition", arguments.length, 2, 2);
    Sk.builtin.pyCheckType("sep", self.__class__.$englishname, checkStringish(self, sep));
    sepStr = new self.__class__(sep);
    pos = self.v.lastIndexOf(sepStr.v);
    if (pos < 0) {
        return new Sk.builtin.tuple([self.__class__.$emptystr, self.__class__.$emptystr, self]);
    }

    return new Sk.builtin.tuple([
        new self.__class__(self.v.substring(0, pos)),
        sepStr,
        new self.__class__(self.v.substring(pos + sepStr.v.length))]);
});

Sk.builtin.str.prototype["count"] = Sk.builtin.bytes.prototype["count"] = new Sk.builtin.func(function (self, pat, start, end) {
    var normaltext;
    var ctl;
    var slice;
    var m;
    Sk.builtin.pyCheckArgsLen("count", arguments.length, 2, 4);
    if (!checkStringish(self, pat)) {
        throw new Sk.builtin.TypeError("expected a character buffer object");
    }
    if ((start !== undefined) && !Sk.builtin.checkInt(start)) {
        throw new Sk.builtin.TypeError("slice indices must be integers or None or have an __index__ method");
    }
    if ((end !== undefined) && !Sk.builtin.checkInt(end)) {
        throw new Sk.builtin.TypeError("slice indices must be integers or None or have an __index__ method");
    }

    let len = self.sq$length();

    if (start === undefined) {
        start = 0;
    } else {
        start = Sk.builtin.asnum$(start);
        start = start >= 0 ? start : len + start;
        if (start > len) {
            // Guard against running off the end of the codepoints array
            return new Sk.builtin.int_(0);
        }
    }

    if (end === undefined) {
        end = len;
    } else {
        end = Sk.builtin.asnum$(end);
        end = end >= 0 ? end : len + end;
    }

    normaltext = pat.v.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    m = new RegExp(normaltext, "g");
    slice = self.v.slice(self.codepoints ? self.codepoints[start] : start,
                         self.codepoints ? self.codepoints[end] : end);
    ctl = slice.match(m);
    if (!ctl) {
        return  new Sk.builtin.int_(0);
    } else {
        return new Sk.builtin.int_(ctl.length);
    }

});

function mkJust(isRight, isCenter) {
    return new Sk.builtin.func(function (self, len, fillchar) {
        var newstr;
        Sk.builtin.pyCheckArgsLen(isCenter ? "center" : isRight ? "rjust" : "ljust",
                                  arguments.length, 2, 3);
        if (!Sk.builtin.checkInt(len)) {
            throw new Sk.builtin.TypeError("integer argument expected, got " + Sk.abstr.typeName(len));
        }
        if ((fillchar !== undefined) && (!checkStringish(self, fillchar) || fillchar.v.length !== 1 && fillchar.sq$length() !== 1)) {
            throw new Sk.builtin.TypeError("must be " + self.__class__.$englishsingular + ", not " + Sk.abstr.typeName(fillchar));
        }
        if (fillchar === undefined) {
            fillchar = " ";
        } else {
            fillchar = fillchar.v;
        }
        len = Sk.builtin.asnum$(len);
        let mylen = self.sq$length();
        if (mylen >= len) {
            return self;
        } else if (isCenter) {
            newstr = fillchar.repeat(Math.floor((len - mylen)/2));

            newstr = newstr + self.v + newstr;

            if ((len - mylen) % 2) {
                newstr += fillchar;
            }

            return new self.__class__(newstr);

        } else {
            newstr = fillchar.repeat(len - mylen);
            return new self.__class__(isRight ? (newstr + self.v) : (self.v + newstr));
        }
    });
}

Sk.builtin.str.prototype["ljust"] = Sk.builtin.bytes.prototype["ljust"] = mkJust(false);

Sk.builtin.str.prototype["rjust"] = Sk.builtin.bytes.prototype["rjust"] = mkJust(true);

Sk.builtin.str.prototype["center"] = Sk.builtin.bytes.prototype["center"] = mkJust(false, true);

function mkFind(isReversed) {
    return new Sk.builtin.func(function (self, tgt, start, end) {
        var idx;
        Sk.builtin.pyCheckArgsLen("find", arguments.length, 2, 4);
        if (!checkStringish(self, tgt)) {
            throw new Sk.builtin.TypeError("expected a " + self.__class__.$englishname + " object");
        }
        if ((start !== undefined) && (start !== Sk.builtin.none.none$) && !Sk.builtin.checkInt(start)) {
            throw new Sk.builtin.TypeError("slice indices must be integers or None or have an __index__ method");
        }
        if ((end !== undefined) && (start !== Sk.builtin.none.none$) && !Sk.builtin.checkInt(end)) {
            throw new Sk.builtin.TypeError("slice indices must be integers or None or have an __index__ method");
        }

        let len = self.$hasAstralCodePoints() ? self.codepoints.length : self.v.length;

        // Find start and end in Python coordinates

        if (start === undefined || start === Sk.builtin.none.none$) {
            start = 0;
        } else {
            start = Sk.builtin.asnum$(start);
            start = start >= 0 ? start : len + start;
            if (start < 0) { start = 0; }
        }
        if (start > len) {
            return new Sk.builtin.int_(-1);
        }

        if (end === undefined || end === Sk.builtin.none.none$) {
            end = len;
        } else {
            end = Sk.builtin.asnum$(end);
            end = end >= 0 ? end : len + end;
        }
        // This guard makes sure we don't, eg, look for self.codepoints[-1]
        if (end < start) {
            return new Sk.builtin.int_(-1);
        }

        if (self.$hasAstralCodePoints()) {
            // Convert start and end to JS coordinates...

            start = self.codepoints[start];
            end = self.codepoints[end];
            if (start === undefined) { start = self.v.length; }
            if (end === undefined) { end = self.v.length; }

            // ...do the search..
            end -= tgt.v.length;
            let jsidx = isReversed ? self.v.lastIndexOf(tgt.v, end) : self.v.indexOf(tgt.v, start);
            jsidx = ((jsidx >= start) && (jsidx <= end)) ? jsidx : -1;

            // ...and now convert them back

            idx = -1;

            for (let i = 0; i < len; i++) {
                if (jsidx == self.codepoints[i]) { 
                    idx = i;
                }
            }
        } else {
            // No astral codepoints, no conversion required
            end -= tgt.v.length;
            idx = isReversed ? self.v.lastIndexOf(tgt.v, end) : self.v.indexOf(tgt.v, start);
            idx = ((idx >= start) && (idx <= end)) ? idx : -1;
        }

        return new Sk.builtin.int_(idx);
    });
};

Sk.builtin.str.prototype["find"] = Sk.builtin.bytes.prototype["find"] = mkFind(false);

Sk.builtin.str.prototype["index"] = Sk.builtin.bytes.prototype["index"] = new Sk.builtin.func(function (self, tgt, start, end) {
    var idx;
    Sk.builtin.pyCheckArgsLen("index", arguments.length, 2, 4);
    idx = Sk.misceval.callsimArray(self["find"], [self, tgt, start, end]);
    if (Sk.builtin.asnum$(idx) === -1) {
        throw new Sk.builtin.ValueError("substring not found");
    }
    return idx;
});

Sk.builtin.str.prototype["rfind"] = Sk.builtin.bytes.prototype["rfind"] = mkFind(true);

Sk.builtin.str.prototype["rindex"] = Sk.builtin.bytes.prototype["rindex"] = new Sk.builtin.func(function (self, tgt, start, end) {
    var idx;
    Sk.builtin.pyCheckArgsLen("rindex", arguments.length, 2, 4);
    idx = Sk.misceval.callsimArray(self["rfind"], [self, tgt, start, end]);
    if (Sk.builtin.asnum$(idx) === -1) {
        throw new Sk.builtin.ValueError("substring not found");
    }
    return idx;
});

Sk.builtin.str.prototype["startswith"] = Sk.builtin.bytes.prototype["startswith"] = new Sk.builtin.func(function (self, tgt) {
    Sk.builtin.pyCheckArgsLen("startswith", arguments.length, 2, 2);
    Sk.builtin.pyCheckType("tgt", self.__class__.$englishname, checkStringish(self, tgt));
    return new Sk.builtin.bool( self.v.indexOf(tgt.v) === 0);
});

// http://stackoverflow.com/questions/280634/endswith-in-javascript
Sk.builtin.str.prototype["endswith"] = Sk.builtin.bytes.prototype["endswith"] = new Sk.builtin.func(function (self, tgt) {
    Sk.builtin.pyCheckArgsLen("endswith", arguments.length, 2, 2);
    Sk.builtin.pyCheckType("tgt", self.__class__.$englishname, checkStringish(self, tgt));
    return new Sk.builtin.bool( self.v.indexOf(tgt.v, self.v.length - tgt.v.length) !== -1);
});

Sk.builtin.str.prototype["replace"] = Sk.builtin.bytes.prototype["replace"] = new Sk.builtin.func(function (self, oldS, newS, count) {
    var c;
    var patt;
    Sk.builtin.pyCheckArgsLen("replace", arguments.length, 3, 4);
    Sk.builtin.pyCheckType("oldS", self.__class__.$englishname, checkStringish(self, oldS));
    Sk.builtin.pyCheckType("newS", self.__class__.$englishname, checkStringish(self, newS));
    if ((count !== undefined) && !Sk.builtin.checkInt(count)) {
        throw new Sk.builtin.TypeError("integer argument expected, got " +
            Sk.abstr.typeName(count));
    }
    count = Sk.builtin.asnum$(count);
    patt = new RegExp(Sk.builtin.str.re_escape_(oldS.v), "g");

    if ((count === undefined) || (count < 0)) {
        return new self.__class__(self.v.replace(patt, newS.v));
    }

    c = 0;

    function replacer (match) {
        c++;
        if (c <= count) {
            return newS.v;
        }
        return match;
    }

    return new self.__class__(self.v.replace(patt, replacer));
});

Sk.builtin.str.prototype["zfill"] = Sk.builtin.bytes.prototype["zfill"] = new Sk.builtin.func(function (self, len) {
    var str = self.v;
    var ret;
    var zeroes;
    var offset;
    var pad = "";

    Sk.builtin.pyCheckArgsLen("zfill", arguments.length, 2, 2);
    if (! Sk.builtin.checkInt(len)) {
        throw new Sk.builtin.TypeError("integer argument expected, got " + Sk.abstr.typeName(len));
    }

    // figure out how many zeroes are needed to make the proper length
    zeroes = len.v - str.length;
    // offset by 1 if there is a +/- at the beginning of the string
    offset = (str[0] === "+" || str[0] === "-") ? 1 : 0;
    for(var i = 0; i < zeroes; i++){
        pad += "0";
    }
    // combine the string and the zeroes
    ret = str.substr(0, offset) + pad + str.substr(offset);
    return new self.__class__(ret);


});

Sk.builtin.str.prototype["isdigit"] = Sk.builtin.bytes.prototype["isdigit"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("isdigit", arguments.length, 1, 1);
    return new Sk.builtin.bool( /^\d+$/.test(self.v));
});

Sk.builtin.str.prototype["isspace"] = Sk.builtin.bytes.prototype["isspace"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("isspace", arguments.length, 1, 1);
    return new Sk.builtin.bool( /^\s+$/.test(self.v));
});


Sk.builtin.str.prototype["expandtabs"] = Sk.builtin.bytes.prototype["expandtabs"] = new Sk.builtin.func(function (self, tabsize) {
    // var input = self.v;
    // var expanded = "";
    // var split;
    // var spacestr = "";
    // var spacerem;


    var spaces;
    var expanded;

    Sk.builtin.pyCheckArgsLen("expandtabs", arguments.length, 1, 2);


    if ((tabsize !== undefined) && ! Sk.builtin.checkInt(tabsize)) {
        throw new Sk.builtin.TypeError("integer argument expected, got " + Sk.abstr.typeName(tabsize));
    }
    if (tabsize === undefined) {
        tabsize = 8;
    } else {
        tabsize = Sk.builtin.asnum$(tabsize);
    }

    spaces = (new Array(tabsize + 1)).join(" ");
    expanded = self.v.replace(/([^\r\n\t]*)\t/g, function(a, b) {
        return b + spaces.slice(b.length % tabsize);
    });
    return new self.__class__(expanded);
});

Sk.builtin.str.prototype["swapcase"] = Sk.builtin.bytes.prototype["swapcase"] = new Sk.builtin.func(function (self) {
    var ret;
    Sk.builtin.pyCheckArgsLen("swapcase", arguments.length, 1, 1);


    ret = self.v.replace(/[a-z]/gi, function(c) {
        var lc = c.toLowerCase();
        return lc === c ? c.toUpperCase() : lc;
    });

    return new self.__class__(ret);
});

Sk.builtin.str.prototype["splitlines"] = Sk.builtin.bytes.prototype["splitlines"] = new Sk.builtin.func(function (self, keepends) {
    var data = self.v;
    var i = 0;
    var j = i;
    var selflen = self.v.length;
    var strs_w = [];
    var ch;
    var eol;
    var sol = 0;
    var slice;
    Sk.builtin.pyCheckArgsLen("splitlines", arguments.length, 1, 2);
    if ((keepends !== undefined) && ! Sk.builtin.checkBool(keepends)) {
        throw new Sk.builtin.TypeError("boolean argument expected, got " + Sk.abstr.typeName(keepends));
    }
    if (keepends === undefined) {
        keepends = false;
    } else {
        keepends = keepends.v;
    }


    for (i = 0; i < selflen; i ++) {
        ch = data.charAt(i);
        if (data.charAt(i + 1) === "\n" && ch === "\r") {
            eol = i + 2;
            slice = data.slice(sol, eol);
            if (! keepends) {
                slice = slice.replace(/(\r|\n)/g, "");
            }
            strs_w.push(new Sk.builtin.str(slice));
            sol = eol;
        } else if ((ch === "\n" && data.charAt(i - 1) !== "\r") || ch === "\r") {
            eol = i + 1;
            slice = data.slice(sol, eol);
            if (! keepends) {
                slice = slice.replace(/(\r|\n)/g, "");
            }
            strs_w.push(new Sk.builtin.str(slice));
            sol = eol;
        }

    }
    if (sol < selflen) {
        eol = selflen;
        slice = data.slice(sol, eol);
        if (! keepends) {
            slice = slice.replace(/(\r|\n)/g, "");
        }
        strs_w.push(new self.__class__(slice));
    }
    return new Sk.builtin.list(strs_w);
});

Sk.builtin.str.prototype["title"] = Sk.builtin.bytes.prototype["title"] = new Sk.builtin.func(function (self) {
    var ret;

    Sk.builtin.pyCheckArgsLen("title", arguments.length, 1, 1);

    ret = self.v.replace(/[a-z][a-z]*/gi, function(str) {
        return str[0].toUpperCase() + str.substr(1).toLowerCase();
    });

    return new self.__class__(ret);
});

Sk.builtin.str.prototype["isalpha"] = Sk.builtin.bytes.prototype["isalpha"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("isalpha", arguments.length, 1, 1);
    return new Sk.builtin.bool( self.v.length && !/[^a-zA-Z]/.test(self.v));
});

Sk.builtin.str.prototype["isalnum"] = Sk.builtin.bytes.prototype["isalnum"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("isalnum", arguments.length, 1, 1);
    return new Sk.builtin.bool( self.v.length && !/[^a-zA-Z0-9]/.test(self.v));
});

// does not account for unicode numeric values
Sk.builtin.str.prototype["isnumeric"] = Sk.builtin.bytes.prototype["isnumeric"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("isnumeric", arguments.length, 1, 1);
    return new Sk.builtin.bool( self.v.length && !/[^0-9]/.test(self.v));
});

Sk.builtin.str.prototype["islower"] = Sk.builtin.bytes.prototype["islower"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("islower", arguments.length, 1, 1);
    return new Sk.builtin.bool( self.v.length && /[a-z]/.test(self.v) && !/[A-Z]/.test(self.v));
});

Sk.builtin.str.prototype["isupper"] = Sk.builtin.bytes.prototype["isupper"] = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("isupper", arguments.length, 1, 1);
    return new Sk.builtin.bool( self.v.length && !/[a-z]/.test(self.v) && /[A-Z]/.test(self.v));
});

Sk.builtin.str.prototype["istitle"] = Sk.builtin.bytes.prototype["istitle"] = new Sk.builtin.func(function (self) {
    // Comparing to str.title() seems the most intuitive thing, but it fails on "",
    // Other empty-ish strings with no change.
    var input = self.v;
    var cased = false;
    var previous_is_cased = false;
    var pos;
    var ch;
    Sk.builtin.pyCheckArgsLen("istitle", arguments.length, 1, 1);
    for (pos = 0; pos < input.length; pos ++) {
        ch = input.charAt(pos);
        if (! /[a-z]/.test(ch) && /[A-Z]/.test(ch)) {
            if (previous_is_cased) {
                return new Sk.builtin.bool( false);
            }
            previous_is_cased = true;
            cased = true;
        } else if (/[a-z]/.test(ch) && ! /[A-Z]/.test(ch)) {
            if (! previous_is_cased) {
                return new Sk.builtin.bool( false);
            }
            cased = true;
        } else {
            previous_is_cased = false;
        }
    }
    return new Sk.builtin.bool( cased);
});

Sk.builtin.str.prototype["encode"] = new Sk.builtin.func(function (self, encoding, errors) {
    // TODO errors are currently always "strict"
    // (other modes will require manual UTF-8-bashing)

    Sk.builtin.pyCheckArgsLen("encode", arguments.length, 1, 3);

    if (encoding) {
        Sk.builtin.pyCheckType("encoding", "string", Sk.builtin.checkString(encoding));
        if (!/^utf-?8$/i.test(encoding.v)) {
            throw new Sk.builtin.ValueError("Only UTF-8 or ASCII encoding and decoding is supported");
        }
    }

    let v;
    try {
        v = unescape(encodeURIComponent(self.v));
    } catch (e) {
        throw new Sk.builtin.UnicodeEncodeError("UTF-8 encoding failed");
    }

    return Sk.__future__.python3 ? new Sk.builtin.bytes(v) : new Sk.builtin.str(v);
});

Sk.builtin.bytes.prototype["decode"] = new Sk.builtin.func(function (self, encoding, errors) {
    // TODO errors are currently always "strict"
    // (other modes will require manual UTF-8-bashing)

    Sk.builtin.pyCheckArgsLen("decode", arguments.length, 1, 3);

    if (encoding) {
        Sk.builtin.pyCheckType("encoding", "string", Sk.builtin.checkString(encoding));
        if (!/^utf-?8$/i.test(encoding.v)) {
            throw new Sk.builtin.ValueError("Only UTF-8 encoding and decoding is supported");
        }
    }

    let v;
    try {
        v = decodeURIComponent(escape(self.v));
    } catch (e) {
        throw new Sk.builtin.UnicodeEncodeError("UTF-8 decoding failed");
    }

    return new Sk.builtin.str(v);
});

Sk.builtin.bytes.prototype["fromhex"] = new Sk.builtin.staticfunc(function(hex) {
    Sk.builtin.pyCheckArgsLen("decode", arguments.length, 1, 3);
    Sk.builtin.pyCheckType("hex", "string", Sk.builtin.checkString(hex));

    let h = hex.v.replace(/\s*/g, "");
    let v = "";

    for (let i = 0; i < h.length; i += 2) {
        let s = h.substr(i, 2);
        let n = parseInt(s, 16);
        if (isNaN(n) || s.length != 2 || !/^[abcdefABCDEF0123456789]{2}$/.test(s)) {
            throw new Sk.builtin.ValueError("non-hexadecimal number found in fromhex() arg");
        }
        v += String.fromCharCode(n);
    }

    return new Sk.builtin.bytes(v);
});

Sk.builtin.bytes.prototype["hex"] = new Sk.builtin.func(function(self) {
    // TODO Python 3.8 has added some args here
    Sk.builtin.pyCheckArgsLen("hex", arguments.length, 1, 1);

    let r = "";
    for (let i=0; i < self.v.length; i++) {
        r += ("0" + self.v.charCodeAt(i).toString(16)).substr(-2);
    }
    return new Sk.builtin.str(r);
});

Sk.builtin.str.prototype.nb$remainder = Sk.builtin.bytes.prototype.nb$remainder = function (rhs) {
    // % format op. rhs can be a value, a tuple, or something with __getitem__ (dict)

    // From http://docs.python.org/library/stdtypes.html#string-formatting the
    // format looks like:
    // 1. The '%' character, which marks the start of the specifier.
    // 2. Mapping key (optional), consisting of a parenthesised sequence of characters (for example, (somename)).
    // 3. Conversion flags (optional), which affect the result of some conversion types.
    // 4. Minimum field width (optional). If specified as an '*' (asterisk), the actual width is read from the next
    // element of the tuple in values, and the object to convert comes after the minimum field width and optional
    // precision. 5. Precision (optional), given as a '.' (dot) followed by the precision. If specified as '*' (an
    // asterisk), the actual width is read from the next element of the tuple in values, and the value to convert comes
    // after the precision. 6. Length modifier (optional). 7. Conversion type.  length modifier is ignored

    var ret;
    var replFunc;
    var index;
    var regex;
    var val;

    let self = this;

    if (rhs.constructor !== Sk.builtin.tuple && (rhs.mp$subscript === undefined || rhs.constructor === Sk.builtin.str)) {
        rhs = new Sk.builtin.tuple([rhs]);
    }
    // general approach is to use a regex that matches the format above, and
    // do an re.sub with a function as replacement to make the subs.

    //           1 2222222222222222   33333333   444444444   5555555555555  66666  777777777777777777
    regex = /%(\([a-zA-Z0-9]+\))?([#0 +\-]+)?(\*|[0-9]+)?(\.(\*|[0-9]+))?[hlL]?([diouxXeEfFgGcrs%])/g;
    index = 0;
    replFunc = function (substring, mappingKey, conversionFlags, fieldWidth, precision, precbody, conversionType) {
        var result;
        var convName;
        var convValue;
        var base;
        var r;
        var mk;
        var value;
        var handleWidth;
        var formatNumber;
        var alternateForm;
        var precedeWithSign;
        var blankBeforePositive;
        var leftAdjust;
        var zeroPad;
        var i;
        fieldWidth = Sk.builtin.asnum$(fieldWidth);
        precision = Sk.builtin.asnum$(precision);

        if ((mappingKey === undefined || mappingKey === "") && conversionType != "%") {
            i = index++;
        } // ff passes '' not undef for some reason

        if (precision === "") { // ff passes '' here aswell causing problems with G,g, etc.
            precision = undefined;
        }

        zeroPad = false;
        leftAdjust = false;
        blankBeforePositive = false;
        precedeWithSign = false;
        alternateForm = false;
        if (conversionFlags) {
            if (conversionFlags.indexOf("-") !== -1) {
                leftAdjust = true;
            } else if (conversionFlags.indexOf("0") !== -1) {
                zeroPad = true;
            }

            if (conversionFlags.indexOf("+") !== -1) {
                precedeWithSign = true;
            } else if (conversionFlags.indexOf(" ") !== -1) {
                blankBeforePositive = true;
            }

            alternateForm = conversionFlags.indexOf("#") !== -1;
        }

        if (precision) {
            precision = parseInt(precision.substr(1), 10);
        }

        formatNumber = function (n, base) {
            var precZeroPadded;
            var prefix;
            var didSign;
            var neg;
            var r;
            var j;
            base = Sk.builtin.asnum$(base);
            neg = false;
            didSign = false;
            if (typeof n === "number") {
                if (n < 0) {
                    n = -n;
                    neg = true;
                }
                r = n.toString(base);
            } else if (n instanceof Sk.builtin.float_) {
                r = n.str$(base, false);
                if (r.length > 2 && r.substr(-2) === ".0") {
                    r = r.substr(0, r.length - 2);
                }
                neg = n.nb$isnegative();
            } else if (n instanceof Sk.builtin.int_) {
                r = n.str$(base, false);
                neg = n.nb$isnegative();
            } else if (n instanceof Sk.builtin.lng) {
                r = n.str$(base, false);
                neg = n.nb$isnegative();
            }

            Sk.asserts.assert(r !== undefined, "unhandled number format");

            precZeroPadded = false;

            if (precision) {
                //print("r.length",r.length,"precision",precision);
                for (j = r.length; j < precision; ++j) {
                    r = "0" + r;
                    precZeroPadded = true;
                }
            }

            prefix = "";

            if (neg) {
                prefix = "-";
            } else if (precedeWithSign) {
                prefix = "+" + prefix;
            } else if (blankBeforePositive) {
                prefix = " " + prefix;
            }

            if (alternateForm) {
                if (base === 16) {
                    prefix += "0x";
                } else if (base === 8 && !precZeroPadded && r !== "0") {
                    prefix += "0";
                }
            }

            return [prefix, r];
        };

        handleWidth = function (args) {
            var totLen;
            var prefix = args[0];
            var r = args[1];
            var j;

            if (fieldWidth) {
                fieldWidth = parseInt(fieldWidth, 10);
                totLen = r.length + prefix.length;
                if (zeroPad) {
                    for (j = totLen; j < fieldWidth; ++j) {
                        r = "0" + r;
                    }
                } else if (leftAdjust) {
                    for (j = totLen; j < fieldWidth; ++j) {
                        r = r + " ";
                    }
                } else {
                    for (j = totLen; j < fieldWidth; ++j) {
                        prefix = " " + prefix;
                    }
                }
            }
            return prefix + r;
        };

        //print("Rhs:",rhs, "ctor", rhs.constructor);
        if (rhs.constructor === Sk.builtin.tuple) {
            value = rhs.v[i];
        } else if (rhs.mp$subscript !== undefined && mappingKey !== undefined) {
            mk = mappingKey.substring(1, mappingKey.length - 1);
            //print("mk",mk);
            value = rhs.mp$subscript(new Sk.builtin.str(mk));
        } else if (rhs.constructor === Sk.builtin.dict || rhs.constructor === Sk.builtin.list) {
            // new case where only one argument is provided
            value = rhs;
        } else {
            throw new Sk.builtin.AttributeError(rhs.tp$name + " instance has no attribute 'mp$subscript'");
        }
        base = 10;
        if (conversionType === "d" || conversionType === "i") {
            return handleWidth(formatNumber(value, 10));
        } else if (conversionType === "o") {
            return handleWidth(formatNumber(value, 8));
        } else if (conversionType === "x") {
            return handleWidth(formatNumber(value, 16));
        } else if (conversionType === "X") {
            return handleWidth(formatNumber(value, 16)).toUpperCase();
        } else if (conversionType === "f" || conversionType === "F" || conversionType === "e" || conversionType === "E" || conversionType === "g" || conversionType === "G") {
            convValue = Sk.builtin.asnum$(value);
            if (typeof convValue === "string") {
                convValue = Number(convValue);
            }
            if (convValue === Infinity) {
                return "inf";
            }
            if (convValue === -Infinity) {
                return "-inf";
            }
            if (isNaN(convValue)) {
                return "nan";
            }
            convName = ["toExponential", "toFixed", "toPrecision"]["efg".indexOf(conversionType.toLowerCase())];
            if (precision === undefined || precision === "") {
                
                if (conversionType === "e" || conversionType === "E") {
                    precision = 6;
                } else if (conversionType === "f" || conversionType === "F") {
                    if (Sk.__future__.python3) {
                        precision = 6;
                    } else {
                        precision = 7;
                    }
                }
            }
            result = (convValue)[convName](precision); // possible loose of negative zero sign

            // apply sign to negative zeros, floats only!
            if(Sk.builtin.checkFloat(value)) {
                if(convValue === 0 && 1/convValue === -Infinity) {
                    result = "-" + result; // add sign for zero
                }
            }
            if (Sk.__future__.python3) {
                if ((result.length >= 7) && (result.slice(0, 6) == "0.0000")) {

                    val = parseFloat(result);
                    result = val.toExponential(); 
                }
                if (result.charAt(result.length -2) == "-") {
                    result = result.slice(0, result.length - 1) + "0" + result.charAt(result.length - 1);
                }
            }
            if ("EFG".indexOf(conversionType) !== -1) {
                result = result.toUpperCase();
            }
            return handleWidth(["", result]);
        } else if (conversionType === "c") {
            if (typeof value === "number") {
                return String.fromCharCode(value);
            } else if (value instanceof Sk.builtin.int_) {
                return String.fromCharCode(value.v);
            } else if (value instanceof Sk.builtin.float_) {
                return String.fromCharCode(value.v);
            } else if (value instanceof Sk.builtin.lng) {
                return String.fromCharCode(value.str$(10, false)[0]);
            } else if (value.constructor === Sk.builtin.str) {
                return value.v.substr(0, 1);
            } else {
                throw new Sk.builtin.TypeError("an integer is required");
            }
        } else if (conversionType === "r") {
            r = Sk.builtin.repr(value);
            if (precision) {
                return r.v.substr(0, precision);
            }
            return r.v;
        } else if (conversionType === "s") {
            r = new self.__class__(value);
            r = r.$jsstr();
            if (precision) {
                return r.substr(0, precision);
            }
            if(fieldWidth) {
                r = handleWidth([" ", r]);
            }
            return r;
        } else if (conversionType === "%") {
            return "%";
        }
    };
    ret = this.v.replace(regex, replFunc);
    return new self.__class__(ret);
};

/**
 * @constructor
 * @param {Object} obj
 */
Sk.builtin.str_iter_ = function (obj) {
    if (!(this instanceof Sk.builtin.str_iter_)) {
        return new Sk.builtin.str_iter_(obj);
    }
    this.$index = 0;
    this.$obj = obj.v.slice();
    this.tp$iter = this;
    this.$cls = obj.__class__;
    if (obj.$hasAstralCodePoints()) {
        this.sq$length = obj.codepoints.length;
        this.$codepoints = obj.codepoints.slice();
        this.tp$iternext = function () {
            if (this.$index >= this.sq$length) {
                return undefined;
            }

            let r = new this.$cls(this.$obj.substring(this.$codepoints[this.$index], this.$codepoints[this.$index+1]));
            this.$index++;
            return r;
        };
    } else {
        this.sq$length = this.$obj.length;
        this.tp$iternext = function () {
            if (this.$index >= this.sq$length) {
                return undefined;
            }
            return new Sk.builtin.str(this.$obj.substr(this.$index++, 1));
        };
    }
    this.$r = function () {
        return new Sk.builtin.str("iterator");
    };
    return this;
};

Sk.abstr.setUpInheritance("iterator", Sk.builtin.str_iter_, Sk.builtin.object);

Sk.builtin.str_iter_.prototype.__class__ = Sk.builtin.str_iter_;

Sk.builtin.str_iter_.prototype.__iter__ = new Sk.builtin.func(function (self) {
    Sk.builtin.pyCheckArgsLen("__iter__", arguments.length, 0, 0, true, false);
    return self;
});

Sk.builtin.str_iter_.prototype.next$ = function (self) {
    var ret = self.tp$iternext();
    if (ret === undefined) {
        throw new Sk.builtin.StopIteration();
    }
    return ret;
};
