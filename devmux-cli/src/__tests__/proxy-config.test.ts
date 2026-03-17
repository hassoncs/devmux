import { describe, it, expect } from "vitest";
import { parseHostname, formatUrl } from "../proxy/manager.js";

describe("parseHostname", () => {
	it("appends .localhost to bare names", () => {
		expect(parseHostname("myapp")).toBe("myapp.localhost");
	});

	it("preserves existing .localhost suffix", () => {
		expect(parseHostname("myapp.localhost")).toBe("myapp.localhost");
	});

	it("strips protocol prefixes", () => {
		expect(parseHostname("http://myapp")).toBe("myapp.localhost");
		expect(parseHostname("https://myapp.localhost")).toBe("myapp.localhost");
	});

	it("supports dotted subdomains", () => {
		expect(parseHostname("api.myapp")).toBe("api.myapp.localhost");
	});

	it("rejects empty hostnames", () => {
		expect(() => parseHostname("")).toThrow("cannot be empty");
	});

	it("rejects consecutive dots", () => {
		expect(() => parseHostname("my..app")).toThrow("consecutive dots");
	});

	it("rejects invalid characters", () => {
		expect(() => parseHostname("my_app")).toThrow("must contain only");
	});
});

describe("formatUrl", () => {
	it("returns clean http url", () => {
		expect(formatUrl("app.localhost")).toBe("http://app.localhost");
	});
});
