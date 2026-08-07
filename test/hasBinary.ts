import expect = require("expect.js");
import { hasBinary } from "../lib/util";

describe("hasBinary", () => {
  it("returns true when the payload contains binary data", () => {
    expect(hasBinary(new Uint8Array([1, 2, 3]))).to.be(true);
    expect(hasBinary({ a: { b: new ArrayBuffer(4) } })).to.be(true);
    expect(hasBinary(["a", new Uint8Array(1)])).to.be(true);
  });

  it("returns false when the payload does not contain binary data", () => {
    expect(hasBinary({ a: 1, b: "two", c: [3, 4] })).to.be(false);
    expect(hasBinary(null)).to.be(false);
    expect(hasBinary("string")).to.be(false);
  });

  it("does not overflow the stack on objects with circular references and a toJSON() method (e.g. Mongoose documents)", () => {
    const doc: any = { name: "test" };
    doc.$__ = { document: doc }; // circular internal reference, like Mongoose's $__
    doc.toJSON = () => ({ name: "test" });

    expect(() => hasBinary(doc)).to.not.throwException();
    expect(hasBinary(doc)).to.be(false);
  });

  it("detects binary through the toJSON() representation", () => {
    const doc: any = { name: "test" };
    doc.$__ = { document: doc }; // circular internal reference
    doc.toJSON = () => ({ name: "test", avatar: new Uint8Array([1, 2]) });

    expect(hasBinary(doc)).to.be(true);
  });
});
