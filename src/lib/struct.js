/**
Functions to convert between Python values and C structs.
Python strings are used to hold the data representing the C struct
and also as format strings to describe the layout of data in the C struct.

The optional first format char indicates byte order, size and alignment:
 @: native order, size & alignment (default)
 =: native order, std. size & alignment
 <: little-endian, std. size & alignment
 >: big-endian, std. size & alignment
 !: same as >

The remaining chars indicate types of args and must match exactly;
these can be preceded by a decimal repeat count:
   x: pad byte (no data);
   c:char;
   b:signed byte;
   B:unsigned byte;
   h:short;
   H:unsigned short;
   i:int;
   I:unsigned int;
   l:long;
   L:unsigned long;
   f:float;
   d:double.
Special cases (preceding decimal count indicates length):
   s:string (array of char); p: pascal string (with count byte).
Special case (only available in native format):
   P:an integer type that is wide enough to hold a pointer.
Special case (not in native mode unless 'long long' in platform C):
   q:long long;
   Q:unsigned long long
Whitespace between formats is ignored.

The variable struct.error is an exception raised on errors.
 */

var $builtinmodule = function (name) {
    var mod = {};

    mod.error = function StructError (args) {
	    if (!(this instanceof StructError)) {
	        o = Object.create(Sk.builtin.Exception.prototype);
	        o.constructor.apply(o, arguments);
	        return o;
	    }
	    Sk.builtin.Exception.apply(this, arguments);
    };

    mod.pack = new Sk.builtin.func(function(fmt, vals) {
        Sk.builtin.pyCheckType("fmt", "string", Sk.builtin.checkString(x));

    });

}
